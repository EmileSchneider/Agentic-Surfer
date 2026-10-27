import * as z from "zod/v4";

const AuthSchema = z.object({
  token: z.literal("REMOVED_LOCAL_TOKEN"),
  clientId: z.literal("default"),
});

const RpcSchema = z.object({
  command: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  cacheReply: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(2_147_483_647).optional(),
});

const ReplySchema = z.discriminatedUnion("ok", [
  z.object({
    id: z.string(),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    id: z.string(),
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
    }),
  }),
]);

type Request = {
  id: string;
  body: z.infer<typeof RpcSchema>;
  resolve: (response: Response) => void;
  queuedAt: number;
};

type Running = {
  request: Request;
  socket: WebSocket;
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
};

const sockets = new Set<WebSocket>();
const queue: Request[] = [];

let extensionSocket: WebSocket | null = null;
let running: Running | null = null;

function failure(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

function connected(): boolean {
  return extensionSocket?.readyState === WebSocket.OPEN;
}

function logCommand(request: Request, startedAt: number): void {
  const duration = Math.round(performance.now() - startedAt);
  console.error(
    `Command id=${request.id} name=${request.body.command} durationMs=${duration}`,
  );
}

function finish(response: Response): void {
  if (!running) return;

  const current = running;
  running = null;
  clearTimeout(current.timer);
  logCommand(current.request, current.startedAt);
  current.request.resolve(response);
  pump();
}

function pump(): void {
  if (running) return;

  while (queue.length > 0) {
    const request = queue.shift()!;
    const socket = extensionSocket;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      logCommand(request, request.queuedAt);
      request.resolve(
        failure(503, "NOT_CONNECTED", "Extension is not connected"),
      );
      continue;
    }

    const timeoutMs = request.body.timeoutMs ?? 60_000;
    const timer = setTimeout(() => {
      finish(
        failure(
          504,
          "TIMEOUT",
          `Extension request timed out after ${timeoutMs} ms`,
        ),
      );
    }, timeoutMs);

    running = {
      request,
      socket,
      timer,
      startedAt: performance.now(),
    };

    const { command, args, cacheReply } = request.body;

    try {
      socket.send(JSON.stringify({
        id: request.id,
        command,
        args,
        ...(cacheReply === undefined ? {} : { cacheReply }),
      }));
    } catch {
      disconnect(socket);
      socket.close();
    }

    return;
  }
}

function disconnect(socket: WebSocket): void {
  sockets.delete(socket);

  if (extensionSocket === socket) {
    extensionSocket = null;
  }

  if (running?.socket === socket) {
    finish(
      failure(503, "NOT_CONNECTED", "Extension disconnected"),
    );
  } else {
    pump();
  }
}

function upgrade(req: globalThis.Request): Response {
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket upgrade required", { status: 400 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  let authenticated = false;

  socket.addEventListener("open", () => {
    sockets.add(socket);
    console.error("Extension connected");
  });

  socket.addEventListener("close", () => {
    disconnect(socket);
    console.error("Extension disconnected");
  });

  socket.addEventListener("message", (event) => {
    let message: unknown;

    try {
      message = JSON.parse(event.data);
    } catch {
      socket.close(1008, "Invalid JSON");
      return;
    }

    if (!authenticated) {
      if (!AuthSchema.safeParse(message).success) {
        socket.close(1008, "Invalid authentication");
        return;
      }

      socket.send(JSON.stringify({ type: "ready" }));

      const previous = extensionSocket;
      extensionSocket = socket;
      authenticated = true;
      console.error("Extension authenticated");

      if (previous && previous !== socket) {
        disconnect(previous);
        previous.close(1000, "Replaced by a new connection");
      }

      pump();
      return;
    }

    if (socket !== extensionSocket) return;

    if (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "ping"
    ) {
      return;
    }

    const reply = ReplySchema.safeParse(message);
    if (!reply.success) return;

    if (
      running?.socket === socket &&
      running.request.id === reply.data.id
    ) {
      finish(Response.json(message));
    }
  });

  return response;
}

Deno.serve(
  { hostname: "localhost", port: 8001 },
  async (req) => {
    const { pathname } = new URL(req.url);

    if (req.method === "GET" && pathname === "/ws/agent") {
      return upgrade(req);
    }

    if (req.method === "GET" && pathname === "/status") {
      return Response.json({
        connected: [...sockets].some(
          (socket) => socket.readyState === WebSocket.OPEN,
        ),
        authenticated: connected(),
        queueLength: queue.length,
        running: running?.request.body.command ?? null,
      });
    }

    if (req.method === "POST" && pathname === "/rpc") {
      let body: unknown;

      try {
        body = await req.json();
      } catch {
        return failure(400, "BAD_ARGS", "Body must be valid JSON");
      }

      const parsed = RpcSchema.safeParse(body);
      if (!parsed.success) {
        return failure(
          400,
          "BAD_ARGS",
          "Expected command, args, optional cacheReply and positive timeoutMs",
        );
      }

      if (!connected()) {
        return failure(503, "NOT_CONNECTED", "Extension is not connected");
      }

      return new Promise<Response>((resolve) => {
        queue.push({
          id: crypto.randomUUID(),
          body: parsed.data,
          queuedAt: performance.now(),
          resolve,
        });
        pump();
      });
    }

    return new Response("Not found", { status: 404 });
  },
);

setInterval(() => {
  const socket = extensionSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  try {
    socket.send(JSON.stringify({ type: "ping" }));
  } catch {
    disconnect(socket);
    socket.close();
  }
}, 10_000);
