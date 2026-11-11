import type { AuthMessage } from "../types.ts";

const agentToken = Deno.env.get("AGENT_TOKEN");
if (!agentToken?.trim()) throw new Error("Set AGENT_TOKEN before starting the server.");


async function checkConnection(): Promise<void> {
  const done = Promise.withResolvers<void>();
  const connection: { socket: WebSocket | null } = { socket: null };
  let verified = false;

  const server = Deno.serve({
    hostname: "localhost",
    port: 8000,
    onListen: () => console.error("Waiting for the extension on localhost:8000..."),
  }, (request) => {
    if (new URL(request.url).pathname !== "/ws/agent") {
      return new Response("Not found", { status: 404 });
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket required", { status: 400 });
    }
    if (connection.socket) {
      return new Response("An extension is already connected", { status: 409 });
    }

    const { socket, response } = Deno.upgradeWebSocket(request);
    connection.socket = socket;
    let authenticated = false;

    socket.addEventListener("message", (event) => {
      try {
        const message: Partial<AuthMessage> & { type?: string } =
          JSON.parse(event.data);

        if (!authenticated) {
          if (message.token !== agentToken || message.clientId !== "default") {
            socket.close(1008, "Invalid authentication");
            done.reject(new Error("Extension authentication failed."));
            return;
          }
          authenticated = true;
          console.error("Extension authenticated. Checking ping...");
          socket.send(JSON.stringify({ type: "ready" }));
          socket.send(JSON.stringify({ type: "ping" }));
          return;
        }

        if (message.type === "ping") {
          verified = true;
          done.resolve();
        }
      } catch {
        done.reject(new Error("Invalid message received from the extension."));
      }
    });
    socket.addEventListener("close", () => {
      if (!verified) done.reject(new Error("Extension disconnected before the ping reply."));
    });
    socket.addEventListener("error", () => {
      done.reject(new Error("Extension WebSocket failed."));
    });

    return response;
  });

  const timeout = setTimeout(() => {
    done.reject(new Error("No confirmed extension connection within 60 seconds."));
  }, 60_000);

  try {
    await done.promise;
    console.log("Extension connected. Ping confirmed.");
  } finally {
    clearTimeout(timeout);
    if (connection.socket?.readyState === WebSocket.OPEN) connection.socket.close();
    await server.shutdown();
  }
}

try {
  if (Deno.args.length !== 0) throw new Error("Usage: outreach.ts");
  await checkConnection();
} catch (error) {
  console.error(error instanceof Deno.errors.AddrInUse
    ? "Port 8000 is in use. Stop the existing RPC server before running this tool."
    : error instanceof Error ? error.message : String(error));
  Deno.exitCode = 1;
}
