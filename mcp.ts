import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';



const AuthSchema = z.object({
  token: z.string(),
  clientId: z.string(),
});

let is_authenticated = false;
let extensionSocket: WebSocket | null = null;

const pending = new Map<string, {
  resolve: (result: unknown) => void,
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  socket: WebSocket;
}>();

Deno.serve(
  { hostname: "localhost", port: 8000 },
  (req) => {
    const url = new URL(req.url);

    if (url.pathname !== "/ws/agent") {
      return new Response("Not found", { status: 404 });
    }
    
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response(null, { status: 501 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    extensionSocket = socket;

    socket.addEventListener("open", () => {      
      console.error("Extension connected");	                  
    });

    socket.addEventListener("close", () => {
      if (extensionSocket === socket) {
	extensionSocket = null;
      }

      for (const [id, request] of pending) {
	if (request.socket !== socket) continue;

	clearTimeout(request.timer);
	pending.delete(id);
	request.reject(new Error("Extension disconnected"));
      }
    });
    
    socket.addEventListener("message", (event) => {      
      if (event.data === "ping") {
	socket.send("pong");
	return;
      }
      const message = JSON.parse(event.data);

      if (!is_authenticated) {
	const result = AuthSchema.safeParse(message);
	if (!result.success) {
	  socket.close(1008, "Invalid authentication shape");
	  return;
	}
	const auth_message = result.data;
	
	if (auth_message.clientId !== "default" || auth_message.token !== "REMOVED_LOCAL_TOKEN") {
	  socket.close(1008, "Invalid authentication");
	  return;
	}

	// success
	socket.send(JSON.stringify({ type: "ready" }));
	is_authenticated = true;
      };
      //

      const request = pending.get(message.id);
      if (!request || request.socket !== socket) return;
      
      if (request) {
	clearTimeout(request.timer);
	pending.delete(message.id);

	if (message.ok) {
	  request.resolve(message.result);	  
	} else {
	  request.reject(new Error(message.error.message));
	}
      }
    });

    //

    return response;
  }
);

async function sendMessage(command: string, args: object) {
  const id = crypto.randomUUID();
  const socket = extensionSocket;

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("Extension is not connected");
  }

  const result = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Extension request timed out: ${id}`));
    }, 60_000);
	
    pending.set(id, { resolve, reject, timer, socket });

    try {
      socket.send(JSON.stringify(
	{
	  id,
	  command: command,
	  args: args,
	}
      ));
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
		
  });

  return result;
}

serveStdio(() => {
  const server = new McpServer({ name: 'linkedin-browser', version: '0.0.1' });

  server.registerTool(
    'ping-status',
    {
      description: 'Get the status of the server',
      inputSchema: z.object({})
    },
    async () => ({
      
      content: [
	{type: 'text', text: is_authenticated ? 'working' : 'unauthenticated' }
      ]
    })
  );

  server.registerTool(
    'read-company-sales-nav-profile',
    {
      description: 'Read the sales navigator profile including optional AccountIq of a company by its accountId',
      inputSchema: z.object({ accountId: z.string() })
    },
    async ({ accountId }) => {
      const profile_result = await sendMessage("accountProfile.read", { accountId });

      return {
	content: [{
	  type: "text", text: `${JSON.stringify(profile_result)}`
	}]
      }
    }
  );

  server.registerTool(
    'read-person-profile',
    {
      description: 'Get the profile of a person by a memberId',
      inputSchema: z.object({memberId: z.string() })
    },    
    async ({memberId}) => {
      const result = await sendMessage("profile.person.read", { memberId });
      
      return {
	content: [{
	  type: "text", text: JSON.stringify(result)
	}]
      }
    }    
  );
  
  return server;
});
