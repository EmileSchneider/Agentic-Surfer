# LinkedIn extension

TypeScript browser extension for LinkedIn and Sales Navigator. Commands pass through a local WebSocket connection. See COMMANDS.md for the command list.

## Build

Install Deno, then run `deno task build`. Load `dist/` as an unpacked extension.

## Connection token

Set a private token in the extension service worker console:

```js
await chrome.storage.local.set({ agentToken: "YOUR_PRIVATE_TOKEN" });
```

Use the same token in the Django backend. The extension connects to `ws://localhost:8001/ws/agent`.

For the local Deno RPC server, set `AGENT_TOKEN` in the environment and run:

```sh
deno run --allow-env=AGENT_TOKEN --allow-net=localhost:8001 rpc-server.ts
```

The older CLI and MCP servers use port 8000. They also require `AGENT_TOKEN` and environment access permission. Stop other servers before using the same port. Set the extension WebSocket URL to match if you use these servers.

Keep tokens, CRM exports, and saved pages outside Git. Build output is ignored.

## License

This project is licensed under the GNU General Public License, version 3 only (`GPL-3.0-only`). See [LICENSE](LICENSE). Third-party dependencies retain their own licenses.
