import { ToolError } from "../types.ts";
import { readAccountAbout } from "./account-about.ts";
import { readAccountIq } from "./account-iq.ts";
import { readAccountProfile } from "./account-profile.ts";
import { readAccountWebsite } from "./account-website.ts";


export async function runAccountIqTool(msg: {
  command: string;
  args: unknown;
}): Promise<unknown> {
  switch (msg.command) {
    case "accountAbout.read":
      return await readAccountAbout();
    case "accountIq.read":
      return await readAccountIq();
    case "accountProfile.website":
      return await readAccountWebsite();
    case "accountProfile.read":
      return await readAccountProfile();
    default:
      throw new ToolError(
        "BAD_ARGS",
        `Unknown Account IQ tool: ${msg.command}`,
      );
  }
}
