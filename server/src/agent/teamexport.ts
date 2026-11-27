import { storeBytes, botPathOf } from "../computer.js";
import type { ToolSpec } from "../llm/index.js";
import { bots, rows } from "../store.js";
import { TeamMdError } from "../teammd.js";
import { exportTeamMd } from "../teammdimport.js";
import type { BuiltinTool } from "./tools.js";

/**
 * « Équipe Sklubot (.md) »: a bot writes its owner's team (or part of it) as a team file, on request. The file goes to
 * the bot's own library and is shown in the chat as an attachment: that is a copy for the owner, so no approval is asked.
 * The tool never publishes it: putting it anywhere public (a repository, a gist, a page) is a separate step that needs
 * the owner's own yes, and this tool has no way to do it. Only the owner's own bots can be in it (exportTeamMd).
 */

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });

export const teamMdTools: BuiltinTool[] = [
  {
    spec: {
      name: "team_export",
      description: "Write the user's team as a portable team file (.md, format sklubot-team/1): bots with their roles, instructions, look, skills and routines (paused on import), group chats, and the NAMES of the apps to connect. Never keys, chats, memories, permissions or computer access. The file is saved in your library and shown to the user in the chat. Use it only when the user asks to export, share or back up their team. It is a copy for the user: never publish it anywhere public yourself — if they want it public, tell them how and let them do it.",
      inputSchema: obj({
        scope: { type: "string", enum: ["section", "team", "bots"], description: "\"section\": the bots of your own sidebar section (default); \"team\": every bot of the user; \"bots\": the ones named in `bots`" },
        bots: { type: "array", items: { type: "string" }, description: "With scope \"bots\": the bots' names" },
        name: { type: "string", description: "The team's name in the file (default: the section's name)" },
        description: { type: "string", description: "One line about what this team does" },
      }),
    },
    activity: "saving", label: "Writing the team file", group: "team", audited: true,
    run: async (a, c) => {
      const me = bots.byId(c.bot.id) ?? c.bot;
      const scope = a.scope === "team" || a.scope === "bots" ? a.scope : "section";
      let out;
      try {
        out = exportTeamMd(c.user, {
          ...(scope === "section" && me.sectionId ? { sectionId: me.sectionId } : {}),
          ...(scope === "bots" ? { botNames: Array.isArray(a.bots) ? a.bots : [] } : {}),
          name: a.name, description: a.description,
        });
      } catch (err) {
        if (err instanceof TeamMdError) return { content: `Not written: ${err.text("en")}`, isError: true };
        throw err;
      }
      const att = storeBytes(c.bot.id, "equipes", out.filename, Buffer.from(out.text, "utf8"));
      rows.append(c.bot, { kind: "message", role: "assistant", text: "", attachments: [att] });
      bots.bumpUnread(c.bot.id);
      return {
        content: `Saved as ${botPathOf(att.path)} (${out.bots} bot(s), ${out.groups} group(s), ${out.connectors} app name(s)${out.masked ? `, ${out.masked} secret(s) masked` : ""}) and shown to the user. To use it elsewhere: Sklubot → + → Import a team (.md). Do not publish it anywhere public without the user's explicit yes.`,
        summary: att.name,
      };
    },
  },
];
