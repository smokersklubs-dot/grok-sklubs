import type { ToolSpec } from "../llm/index.js";
import { settings } from "../store.js";
import { LOCK_MAX_MIN, LOCKS_FILE, locksOf, readTeamText, releaseAllOf, releaseLock, takeLock, writeTeamText } from "../teamlock.js";
import type { BuiltinTool, ToolContext } from "./tools.js";

/**
 * L161 « verrou d'écriture sur le dossier d'équipe » — the tools of teamlock.ts: read and write a file of the team folder
 * (~/team) without two bots writing it at once, and hold a file while editing it with commands. Listed for bots with a
 * Linux computer (tools.ts); each call checks that the account switched the team folder on.
 */

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });
const tool = (name: string, description: string, schema: ToolSpec["inputSchema"], rest: Omit<BuiltinTool, "spec">): BuiltinTool => ({ spec: { name, description, inputSchema: schema }, group: "team", ...rest });
const off = (c: ToolContext) => (settings.team(c.bot.userId).enabled ? null : { content: "The team folder is off for this account (Settings → Library → Team folder).", isError: true });
const at = (t: number) => new Date(t).toISOString().slice(11, 16);

export const teamFolderTools: BuiltinTool[] = [
  tool("team_file_read", "Read a text file of the team folder (~/team, shared with your teammates) and get its version. Pass that version as `expected` to team_file_write so you never overwrite a change a teammate made in between.",
    obj({ path: str("Path inside the team folder, e.g. clients/liste.csv") }, ["path"]), {
    activity: "reading", label: "Reading the team folder", parallel: true, outside: true, detail: (a) => String(a.path ?? ""),
    run: async (a, c) => {
      const no = off(c); if (no) return no;
      const r = readTeamText(c.bot, a.path);
      if ("error" in r) return { content: r.error, isError: true };
      const lock = r.lock && r.lock.botId !== c.bot.id ? `\n(Locked by ${r.lock.botName} until ${at(r.lock.until)} UTC: do not change it before.)` : "";
      return { content: `Version ${r.version}${lock}\n\n${r.content}`, summary: r.path };
    },
  }),
  tool("team_file_write", "Write a text file of the team folder (~/team) safely: one writer at a time, never half a file. Refused while a teammate holds a lock on it (team_lock), and, with `expected`, when it changed since you read it. Use this rather than a shell command to change a shared file.",
    obj({ path: str("Path inside the team folder"), content: str("The full text (or the text to add with append)"), append: { type: "boolean", description: "Add at the end instead of replacing" }, expected: str("The version team_file_read gave you (\"absent\" for a file that must not exist yet)") }, ["path", "content"]), {
    activity: "saving", label: "Writing in the team folder", audited: true, detail: (a) => String(a.path ?? ""),
    run: async (a, c) => {
      const no = off(c); if (no) return no;
      const r = await writeTeamText(c.bot, a.path, a.content, { append: a.append === true, expected: a.expected });
      if ("error" in r) return { content: r.error, isError: true, summary: "refused" };
      return { content: `Written: ~/team/${r.path} (${r.bytes} bytes, version ${r.version})${r.waitedMs > 1000 ? `, after waiting ${Math.round(r.waitedMs / 1000)} s for a teammate's write` : ""}.`, summary: r.path };
    },
  }),
  tool("team_lock", `Hold a file of the team folder while you change it with your own commands (a script, an office tool): teammates cannot write it until you call team_unlock or the time is up (at most ${LOCK_MAX_MIN} minutes). The locks are listed in ~/team/${LOCKS_FILE}.`,
    obj({ path: str("Path inside the team folder"), minutes: { type: "integer", description: `How long, 1 to ${LOCK_MAX_MIN} (default 10)` } }, ["path"]), {
    activity: "saving", label: "Locking a shared file", detail: (a) => String(a.path ?? ""),
    run: async (a, c) => {
      const no = off(c); if (no) return no;
      const r = takeLock(c.bot, a.path, a.minutes);
      if ("error" in r) return { content: r.error, isError: true, summary: "held by a teammate" };
      return { content: `Locked ~/team/${r.lock.path} until ${at(r.lock.until)} UTC. Call team_unlock as soon as you are done.`, summary: r.lock.path };
    },
  }),
  tool("team_unlock", "Let go of a team-folder file you locked with team_lock (path \"*\": every file you hold).",
    obj({ path: str("Path inside the team folder, or * for all of yours") }, ["path"]), {
    activity: "saving", label: "Unlocking a shared file", detail: (a) => String(a.path ?? ""),
    run: async (a, c) => {
      if (String(a.path ?? "").trim() === "*") { const n = releaseAllOf(c.bot.id); return { content: n ? `Let go of ${n} file(s).` : "You held no file.", summary: String(n) }; }
      if (releaseLock(c.bot, a.path)) return { content: "Unlocked.", summary: String(a.path) };
      const mine = locksOf(c.bot.userId).filter((l) => l.botId === c.bot.id).map((l) => l.path);
      return { content: `You hold no lock on that file.${mine.length ? ` Yours: ${mine.join(", ")}.` : ""}`, isError: true };
    },
  }),
];
