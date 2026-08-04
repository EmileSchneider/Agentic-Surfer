import { ToolError } from "../types.ts";
import { readAccountAbout } from "./account-about.ts";
import { readAccountIq } from "./account-iq.ts";

export async function runAccountIqTool(msg: {
  command: string;
  args: unknown;
}): Promise<unknown> {
  switch (msg.command) {
    case "accountAbout.read":
      return await readAccountAbout();
    case "accountIq.read":
      return await readAccountIq();
    default:
      throw new ToolError(
        "BAD_ARGS",
        `Unknown Account IQ tool: ${msg.command}`,
      );
  }
}
