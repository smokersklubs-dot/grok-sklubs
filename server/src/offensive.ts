import { q } from "./db.js";
import { audit, now, type BotRecord } from "./store.js";

/**
 * L38 — no security testing of systems that are not the owner's (Claude-BugHunter audit, idea only).
 *
 * A bot never runs a scanner, a password guesser or an exploit tool against a host the owner did not list as theirs. The
 * list is per bot (« Hôtes que ce bot peut tester », bot settings → Security), empty by default: then every such command
 * is refused before it runs, with a sentence that says how to allow a host the owner really owns. Local targets (the
 * bot's own computer: localhost, 127.x, ::1) are always allowed. A heuristic over the command's words: it can only refuse.
 *
 * The same words, in a skill (skillscan.ts, code "offensive-tool"), raise a warning at import: the owner reads it before
 * the skill can be switched on.
 */
q.run(`CREATE TABLE IF NOT EXISTS security_targets (bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, hosts TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL)`);

/** Programs that scan, guess passwords, fuzz or exploit a remote system. */
export const OFFENSIVE_TOOLS = ["nmap", "masscan", "zmap", "rustscan", "sqlmap", "nikto", "hydra", "medusa", "ncrack", "patator", "msfconsole", "msfvenom", "metasploit", "gobuster", "dirb", "dirbuster", "feroxbuster", "ffuf", "wfuzz", "wpscan", "joomscan", "nuclei", "commix", "xsstrike", "dalfox", "slowloris", "hping3", "goldeneye", "loic", "theharvester", "amass", "subfinder", "crackmapexec", "netexec", "responder", "bettercap", "aircrack-ng", "reaver", "beef-xss", "evil-winrm", "impacket"];
/** The ones whose name is not also an ordinary word (amass, responder, hydra…): what a skill's text is checked for. */
export const OFFENSIVE_SKILL_WORDS = OFFENSIVE_TOOLS.filter((t) => !["amass", "responder", "hydra", "medusa", "loic", "reaver", "goldeneye", "impacket", "dirb", "commix", "patator"].includes(t));
const TOOL_RE = new RegExp(`(?:^|[;&|(\`]|\\$\\()\\s*(?:(?:sudo|nohup|exec|time)\\s+|env\\s+(?:\\S+=\\S*\\s+)*|timeout\\s+\\S+\\s+)*(?:python3?\\s+(?:-m\\s+)?)?(?:\\S*/)?(${OFFENSIVE_TOOLS.map((t) => t.replace(/[-]/g, "\\-")).join("|")})(?:\\.py)?(?=\\s|$|[;&|)])`, "i");

/** The scanner / exploit program a command runs, if any. */
export const offensiveTool = (command: string): string | null => TOOL_RE.exec(command)?.[1]?.toLowerCase() ?? null;

/** The hosts a command names (addresses, URLs, IPs, CIDR ranges). */
export function commandTargets(command: string): string[] {
  const out = new Set<string>();
  for (const m of command.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/([^\s/:'"?#]+)/gi)) out.add(m[1].toLowerCase());
  for (const m of command.matchAll(/(?<![\w.-])((?:\d{1,3}\.){3}\d{1,3})(?:\/\d{1,2})?(?![\w.])/g)) out.add(m[1]);
  for (const m of command.matchAll(/(?<![\w./@-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?![\w-])/gi)) {
    const h = m[1].toLowerCase();
    if (!/\.(?:txt|lst|json|xml|csv|py|sh|log|conf|yaml|yml|html?)$/.test(h)) out.add(h);
  }
  if (/(?<![\w.-])localhost(?![\w.-])/i.test(command)) out.add("localhost");
  return [...out].map((h) => h.replace(/^www\./, ""));
}
const LOCAL = (h: string) => h === "localhost" || h.endsWith(".localhost") || /^127\./.test(h) || h === "::1" || h === "0.0.0.0";

export const securityTargets = {
  get(botId: string): string[] {
    const r = q.get<{ hosts: string }>("SELECT hosts FROM security_targets WHERE bot_id = ?", botId);
    try { return r ? (JSON.parse(r.hosts) as unknown[]).filter((h): h is string => typeof h === "string") : []; } catch { return []; }
  },
  set(bot: BotRecord, raw: unknown): string[] {
    const list = [...new Set((Array.isArray(raw) ? raw : String(raw ?? "").split(/[\s,;]+/)).map((s) => String(s).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "")).filter((h) => /^[a-z0-9.:-]{1,253}$/.test(h)))].slice(0, 50);
    q.run("INSERT INTO security_targets (bot_id, hosts, updated_at) VALUES (?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET hosts = excluded.hosts, updated_at = excluded.updated_at", bot.id, JSON.stringify(list), now());
    audit(bot.userId, "tool", `${bot.name}: hosts it may test set (${list.length})`, bot.id);
    return list;
  },
};

/** Null when the command is not a security test of someone else's system; else the refusal (English: the model reads it). */
export function offensiveRefusal(botId: string, command: string): string | null {
  const tool = offensiveTool(command);
  if (!tool) return null;
  const mine = securityTargets.get(botId);
  const all = commandTargets(command);
  const foreign = all.filter((h) => !LOCAL(h) && !mine.some((m) => h === m || h.endsWith(`.${m}`)));
  if (all.length && !foreign.length) return null;
  const which = foreign.length ? foreign.slice(0, 5).join(", ") : "a target that could not be read";
  return `Not run: ${tool} tests the security of a system (${which}), and bots never do that on a system that is not their owner's. If it is the owner's own system, they can add it in this bot's settings (Security → Hosts this bot may test); then run it again. Otherwise, do not try another tool to do it.`;
}
