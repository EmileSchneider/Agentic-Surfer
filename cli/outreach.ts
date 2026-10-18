import type { AuthMessage, CommandReply, CommandRequest, ProfilePersonConnectResult } from "../types.ts";

async function checkConnection(command?: CommandRequest): Promise<ProfilePersonConnectResult | undefined> {
  const done = Promise.withResolvers<void>();
  const connection: { socket: WebSocket | null } = { socket: null };
  let verified = false;
  let result: ProfilePersonConnectResult | undefined;
  let commandSent = false;

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
          if (message.token !== "REMOVED_LOCAL_TOKEN" || message.clientId !== "default") {
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
          if (command) {
            if (!commandSent) {
              commandSent = true;
              console.error("Extension connected. Sending connection request...");
              socket.send(JSON.stringify(command));
            }
          } else {
            verified = true;
            done.resolve();
          }
          return;
        }
        if (command && commandSent) {
          const reply = message as unknown as CommandReply;
          if (reply.id !== command.id) return;
          if (!reply.ok) {
            done.reject(new Error(`${reply.error.code}: ${reply.error.message}`));
            return;
          }
          const sent = reply.result as Partial<ProfilePersonConnectResult> | null;
          if (sent?.sent !== true || sent.memberId !== command.args.memberId) {
            done.reject(new Error("Extension did not confirm the requested connection."));
            return;
          }
          result = sent as ProfilePersonConnectResult;
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
    done.reject(new Error(commandSent
      ? "No send confirmation received. Check LinkedIn before you retry. The task was not changed."
      : "No confirmed extension connection within 60 seconds."));
  }, command ? 120_000 : 60_000);

  try {
    await done.promise;
    if (!command) console.log("Extension connected. Ping confirmed.");
    return result;
  } finally {
    clearTimeout(timeout);
    if (connection.socket?.readyState === WebSocket.OPEN) connection.socket.close();
    await server.shutdown();
  }
}

async function runOneTask(taskId: string): Promise<void> {
  const { readTodayOutreachTasks, completeOutreachTask } = await import("../twenty.ts");
  const task = (await readTodayOutreachTasks()).find((task) => task.id === taskId);
  if (!task) throw new Error("Task is not an open connection request task due today.");
  const people = task.taskTargets.filter((target) => target.targetPerson !== null);
  if (people.length !== 1) throw new Error("Task must link to exactly one person.");
  const person = people[0]!.targetPerson!;
  const url = new URL(person.linkedinLink.primaryLinkUrl);
  const profileName = /^\/in\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  let memberId = "";
  try {
    memberId = decodeURIComponent(profileName ?? "");
  } catch {
    throw new Error("Person has an invalid encoded LinkedIn profile name.");
  }
  if (url.protocol !== "https:" || !["linkedin.com", "www.linkedin.com"].includes(url.hostname) || !/^[\p{L}\p{M}\p{N}_-]+$/u.test(memberId)) {
    throw new Error("Person does not have a valid LinkedIn profile URL.");
  }
  console.error(`Task ${task.id}: ${person.name.firstName} ${person.name.lastName} — ${url.href}`);
  await checkConnection({ id: `outreach-connect-${task.id}`, cacheReply: false, command: "profile.person.connect", args: { memberId } });
  console.error("Extension confirmed the request was sent. Marking task DONE...");
  try {
    const completed = await completeOutreachTask(task.id);
    console.log(JSON.stringify(completed, null, 2));
  } catch (error) {
    throw new Error(`Connection request was sent, but the CRM update failed. Update task ${task.id} manually. ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runAllTasks(limit?: number): Promise<void> {
  const { readTodayOutreachTasks } = await import("../twenty.ts");
  const availableTasks = await readTodayOutreachTasks();
  console.error(`${availableTasks.length} open connection request tasks due today.`);
  const tasks = availableTasks.slice(0, limit);
  for (const [index, task] of tasks.entries()) {
    console.error(`Running task ${index + 1} of ${tasks.length}: ${task.id}`);
    try {
      await runOneTask(task.id);
    } catch (error) {
      throw new Error(`Stopped at task ${task.id}. ${index} tasks completed in this run. ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.error(`Completed ${tasks.length} tasks.`);
}

try {
  if (Deno.args[0] === "tasks") {
    const { readTodayOutreachTasks } = await import("../twenty.ts");
    const tasks = await readTodayOutreachTasks();
    console.error(`${tasks.length} open connection request tasks due today.`);
    console.log(JSON.stringify(tasks, null, 2));
  } else if (Deno.args[0] === "run-one" && Deno.args.length === 2) {
    await runOneTask(Deno.args[1]!);
  } else if (Deno.args[0] === "run-all" &&
    (Deno.args.length === 1 || (Deno.args.length === 3 && Deno.args[1] === "--limit"))) {
    const limit = Deno.args.length === 3 ? Number(Deno.args[2]) : undefined;
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
      throw new Error("--limit must be a positive integer.");
    }
    await runAllTasks(limit);
  } else if (Deno.args.length === 0) {
    await checkConnection();
  } else {
    throw new Error("Usage: outreach.ts [tasks | run-one TASK_ID | run-all [--limit N]]");
  }
} catch (error) {
  console.error(error instanceof Deno.errors.AddrInUse
    ? "Port 8000 is in use. Stop the existing RPC server before running this tool."
    : error instanceof Error ? error.message : String(error));
  Deno.exitCode = 1;
}
