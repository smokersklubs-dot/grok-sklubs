import { readFileSync } from "node:fs";
import { workspaceOf } from "../computer.js";
import { linuxExec } from "../linux.js";
import type { BuiltinTool } from "./tools.js";

export const craftReady: BuiltinTool = {
  spec: {
    name: "craft_workspace",
    description: "Prepare the built-in Craft Anything CLI on this bot's Linux computer for a clean-room design study or a web build. New desktops already have it. No third-party model key is needed for the bot's own connected Codex subscription.",
    inputSchema: { type: "object", properties: {} },
  },
  group: "shell", activity: "shell", label: "Preparing the design workspace",
  run: async (_args, ctx) => {
    const script = readFileSync(new URL("../../../docker/desktop/install-craft.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const result = await linuxExec(ctx.bot.id, ctx.user.id, workspaceOf(ctx.bot.id), ["sh", "-c", script], 200, { signal: ctx.signal, maxBytes: 2000 });
    if (result.code !== 0) return { isError: true, content: "The design workspace could not be prepared. " + result.stderr.slice(-300) };
    return { content: "Craft Anything 0.6.1 is ready at /usr/local/bin/craft-anything-cli. Use --clean-room. For a requested web rebuild on the bot's connected Codex account run rebuild with --backend Codex --build-with 'Plain HTML and CSS' --rounds 0 --unattended, a new --project-folder under /root/files, and -- - for no reference. Request a self-contained app/index.html. Check the exit status, then use artifact_from_file. For ordinary artifacts create directly with artifact_create." };
  },
};
