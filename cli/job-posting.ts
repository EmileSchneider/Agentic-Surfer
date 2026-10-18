import type { AuthMessage, CommandReply, CommandRequest, CommandResultMap } from "../types.ts";
import { jobPostingUrl } from "../job-posting/extractor.ts";

const quiet = Deno.args.includes("--quiet");
const args = Deno.args.filter(arg => arg !== "--quiet");

async function readJobPosting(url: string): Promise<string> {
  const command: CommandRequest = {
    id: crypto.randomUUID(),
    command: "jobPosting.read",
    args: { url },
  };
  const done = Promise.withResolvers<string>();
  const connection: { socket: WebSocket | null } = { socket: null };
  let finished = false;
  let timer: ReturnType<typeof setTimeout>;
  const server = Deno.serve({
    hostname: "localhost",
    port: 8000,
    onListen: () => {
      if (!quiet) console.error("Waiting for the extension on localhost:8000...");
    },
  }, request => {
    if (new URL(request.url).pathname !== "/ws/agent") return new Response("Not found", { status: 404 });
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket required", { status: 400 });
    if (connection.socket) return new Response("An extension is already connected", { status: 409 });
    const { socket, response } = Deno.upgradeWebSocket(request);
    connection.socket = socket;
    let authenticated = false;
    socket.addEventListener("message", event => {
      try {
        const message = JSON.parse(event.data);
        if (!authenticated) {
          const auth = message as AuthMessage;
          if (auth.token !== "REMOVED_LOCAL_TOKEN" || auth.clientId !== "default") {
            socket.close(1008, "Invalid authentication");
            done.reject(new Error("Extension authentication failed."));
            return;
          }
          authenticated = true;
          clearTimeout(timer);
          timer = setTimeout(() => done.reject(new Error("Job posting read timed out.")), 60_000);
          if (!quiet) console.error("Extension connected. Reading job posting...");
          socket.send(JSON.stringify({ type: "ready" }));
          socket.send(JSON.stringify(command));
          return;
        }
        if (message.type === "ping") return;
        const reply = message as CommandReply;
        if (reply.id !== command.id) return;
        if (!reply.ok) {
          done.reject(new Error(`${reply.error.code}: ${reply.error.message}`));
          return;
        }
        const result = reply.result as Partial<CommandResultMap["jobPosting.read"]> | null;
        if (typeof result?.descriptionMarkdown !== "string" || !result.descriptionMarkdown.trim()) {
          done.reject(new Error("Extension returned no job description."));
          return;
        }
        finished = true;
        done.resolve(result.descriptionMarkdown);
      } catch {
        done.reject(new Error("Invalid message received from the extension."));
      }
    });
    socket.addEventListener("close", () => {
      if (!finished) done.reject(new Error("Extension disconnected before the job description was returned."));
    });
    socket.addEventListener("error", () => done.reject(new Error("Extension WebSocket failed.")));
    return response;
  });
  timer = setTimeout(() => done.reject(new Error("Extension did not connect within 60 seconds.")), 60_000);
  try {
    return await done.promise;
  } finally {
    clearTimeout(timer);
    if (connection.socket?.readyState === WebSocket.OPEN) connection.socket.close();
    await server.shutdown();
  }
}

try {
  let input: string;
  if (args[0] === "company" && args.length === 2) {
    const { readCompanyJobPostingUrl } = await import("../twenty.ts");
    if (!quiet) console.error("Reading company job posting URL from Twenty...");
    input = await readCompanyJobPostingUrl(args[1]!);
  } else if (args.length === 1) {
    input = args[0]!;
  } else {
    throw new Error("Usage: job-posting.ts [--quiet] URL | company COMPANY_ID");
  }
  const url = jobPostingUrl(input);
  console.log(await readJobPosting(url));
} catch (error) {
  console.error(error instanceof Deno.errors.AddrInUse
    ? "Port 8000 is in use. Stop the existing RPC server or CLI first."
    : error instanceof Error ? error.message : String(error));
  Deno.exitCode = 1;
}
