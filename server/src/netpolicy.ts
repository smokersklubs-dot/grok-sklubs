import { q } from "./db.js";
import { computerKind, workspaceOf } from "./computer.js";
import { addJournal } from "./journal.js";
import { writeComputerFile } from "./linux.js";
import { cleanHost } from "./netjournal.js";
import { audit, bots, now, users, type BotRecord } from "./store.js";

/**
 * L169 — where each bot may go on the internet: « tout » (all, the default), « liste » (only the sites listed for it),
 * « rien » (none); plus sites the OWNER blocks for all their bots (« Sites interdits »). A site is a host name: it covers
 * its subdomains (« example.com » covers « www.example.com » and « api.example.com »).
 *
 * Enforced where outbound traffic of a bot goes through Sklubot itself, BEFORE anything is sent (the refusal is the tool's
 * answer and a "denied" line in the bot's journal):
 *   - browser_open, web_fetch, media_save, page_check sheet (contactsheet.ts), secret_use (agent/tools.ts);
 *   - api_get / api_send of an API connector (apiconnectors.ts);
 *   - the credential relay used by programs on the bot's computer (egress.ts).
 * In the bot's own computer, when it is a Linux computer: the same rules are written as Chromium managed policies
 * (URLBlocklist / URLAllowlist, https://chromeenterprise.google/policies/#URLBlocklist, pattern format
 * https://chromeenterprise.google/policies/url-patterns/) in /etc/chromium/policies/managed/sklubot-network.json, so the
 * browser also refuses clicks, redirects and the resources a page loads. Written when the owner changes the rule and before
 * each browser_open; Chromium reads it at its next start.
 *
 * NOT covered (said in the settings and docs/SECURITE.md): programs on the bot's computer that go to the internet by
 * themselves (curl, pip, git… — the computer is the bot's own machine, its shell is root and could remove the browser
 * policy; for a hard wall use deploy/bots-firewall.sh on the host), the apps connected through MCP (the owner connected
 * them), the model providers, and the server's own fetches that are not a bot's (sign-in pages, pictures of the chat).
 */
q.run(`CREATE TABLE IF NOT EXISTS bot_net_policy (
  bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, mode TEXT NOT NULL DEFAULT 'all', hosts TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL)`);
q.run(`CREATE TABLE IF NOT EXISTS owner_blocked_sites (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, hosts TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL)`);

export type NetMode = "all" | "list" | "none";
export interface NetPolicy { mode: NetMode; hosts: string[] }
export const MAX_SITES = 200;
/** The bot's own computer and this server's local pages are never "the internet". */
const LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);
const POLICY_FILE = "/etc/chromium/policies/managed/sklubot-network.json";

const parse = (s: string | undefined): string[] => { try { const v = JSON.parse(s ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };
/** Host names from a list or a text (one per line, commas, spaces); addresses become their host; at most MAX_SITES. */
export function cleanSites(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(/[\s,;]+/);
  const out: string[] = [];
  for (const x of list) { const h = cleanHost(String(x ?? "").replace(/^\*\./, "")); if (h && !out.includes(h)) out.push(h); if (out.length >= MAX_SITES) break; }
  return out;
}
const covers = (host: string, site: string) => host === site || host.endsWith(`.${site}`);

export const netPolicy = {
  get(botId: string): NetPolicy {
    const r = q.get<{ mode: string; hosts: string }>("SELECT mode, hosts FROM bot_net_policy WHERE bot_id = ?", botId);
    const mode: NetMode = r?.mode === "list" || r?.mode === "none" ? r.mode : "all";
    return { mode, hosts: parse(r?.hosts) };
  },
  set(bot: BotRecord, raw: { mode?: unknown; hosts?: unknown }): NetPolicy {
    const cur = netPolicy.get(bot.id);
    const mode: NetMode = raw.mode === "list" || raw.mode === "none" || raw.mode === "all" ? raw.mode : cur.mode;
    const hosts = raw.hosts === undefined ? cur.hosts : cleanSites(raw.hosts);
    q.run("INSERT INTO bot_net_policy (bot_id, mode, hosts, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET mode = excluded.mode, hosts = excluded.hosts, updated_at = excluded.updated_at", bot.id, mode, JSON.stringify(hosts), now());
    audit(bot.userId, "account", `${bot.name}: internet access set to ${mode}${mode === "list" ? ` (${hosts.length} sites)` : ""}`, bot.id);
    return { mode, hosts };
  },
  blocked: (userId: string): string[] => parse(q.get<{ hosts: string }>("SELECT hosts FROM owner_blocked_sites WHERE user_id = ?", userId)?.hosts),
  setBlocked(userId: string, raw: unknown): string[] {
    const hosts = cleanSites(raw);
    q.run("INSERT INTO owner_blocked_sites (user_id, hosts, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET hosts = excluded.hosts, updated_at = excluded.updated_at", userId, JSON.stringify(hosts), now());
    audit(userId, "account", `Blocked sites for all bots: ${hosts.length}`);
    return hosts;
  },
};

/** Why `bot` may not reach this address or host (a sentence for the model), or null when it may. */
export function netRefusal(bot: Pick<BotRecord, "id" | "userId" | "name">, target: unknown): string | null {
  const host = cleanHost(target);
  if (!host || LOCAL.has(host)) return null;
  const fr = users.localeOf(bot.userId) === "fr";
  const site = netPolicy.blocked(bot.userId).find((s) => covers(host, s));
  if (site) return fr ? `Le propriétaire a interdit le site ${site} à tous ses bots : rien n'a été envoyé. N'essaie pas un autre chemin.` : `The owner blocked ${site} for all their bots: nothing was sent. Do not try another way.`;
  const p = netPolicy.get(bot.id);
  if (p.mode === "none") return fr ? `${bot.name} n'a pas accès à Internet (réglage du propriétaire) : rien n'a été envoyé.` : `${bot.name} has no internet access (owner's setting): nothing was sent.`;
  if (p.mode === "list" && !p.hosts.some((s) => covers(host, s))) return fr ? `${host} n'est pas dans la liste des sites permis à ${bot.name} : rien n'a été envoyé. Demande au propriétaire de l'ajouter s'il le faut.` : `${host} is not in the list of sites ${bot.name} may reach: nothing was sent. Ask the owner to add it if needed.`;
  return null;
}

/** netRefusal, plus a "denied" line in the bot's journal when it refuses (for the tools). */
export function netGate(bot: Pick<BotRecord, "id" | "userId" | "name">, target: unknown, tool: string): string | null {
  const why = netRefusal(bot, target);
  if (why) addJournal({ userId: bot.userId, botId: bot.id, tool, label: `${tool} ${cleanHost(target)}`, decision: "denied", reason: "network policy", status: "denied", origin: "bot" });
  return why;
}

/** The Chromium managed policy for this bot (see above). */
export function browserPolicy(bot: Pick<BotRecord, "id" | "userId">): { URLBlocklist: string[]; URLAllowlist: string[] } {
  const p = netPolicy.get(bot.id);
  const blocked = netPolicy.blocked(bot.userId);
  const local = ["localhost", "127.0.0.1"];
  if (p.mode === "none") return { URLBlocklist: ["*"], URLAllowlist: local };
  if (p.mode === "list") return { URLBlocklist: ["*", ...blocked], URLAllowlist: [...local, ...p.hosts.filter((h) => !blocked.some((b) => covers(h, b)))] };
  return { URLBlocklist: blocked, URLAllowlist: [] };
}

/** What writes the policy on the bot's computer (replaceable in tests). */
let writer = (bot: BotRecord, content: string) => writeComputerFile(bot.id, bot.userId, workspaceOf(bot.id), POLICY_FILE, content, "644");
export const setBrowserPolicyWriter = (fn: typeof writer) => { writer = fn; };
const written = new Map<string, string>();
/** Puts the bot's rule on its Linux computer when it changed since the last write (best effort; never blocks a tool). */
export async function applyBrowserPolicy(bot: BotRecord, force = false): Promise<boolean> {
  if (computerKind() !== "linux" && !force) return false;
  const content = JSON.stringify(browserPolicy(bot));
  if (written.get(bot.id) === content) return true;
  try { await writer(bot, content); written.set(bot.id, content); return true; } catch { return false; }
}
/** All the owner's bots (after « Sites interdits » changed). */
export async function applyBrowserPolicies(userId: string) {
  for (const b of bots.list(userId).filter((x) => x.kind === "agent")) await applyBrowserPolicy(b);
}
