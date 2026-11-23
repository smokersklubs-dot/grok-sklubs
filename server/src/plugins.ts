import { createHash } from "node:crypto";
import { q } from "./db.js";
import { emit } from "./bus.js";
import { localTools, setToolFilter, type CachedTool } from "./localtools.js";
import { netPolicy } from "./netpolicy.js";
import { scanText } from "./skillscan.js";
import type { ScanFinding } from "./skillscantypes.js";
import { audit, bots, clip, newId, now, skills } from "./store.js";
import { tr } from "./i18n.js";
import type { Locale } from "./shared.js";

/**
 * L174 « Greffons » : third-party tools for a bot, in a declared format, that RUN ONLY IN THE BOT'S OWN COMPUTER.
 *
 * A plugin is one JSON manifest (format "sklubot-plugin/1", docs/EXTENSIONS.md):
 *   { format, name, version, description, author?, license?, homepage?,
 *     run: { command: "npx" | "uvx" | "bunx", args: [...] }   an MCP stdio tool server, package pinned to an exact version
 *     tools: [{ name, description, readOnly?, committing? }]   the only tools offered (others it lists are dropped)
 *     permissions: { network: "none" | "bot" | [hosts], files: "none" | "workspace" }
 *     skill?: { name, when, steps } }                         optional instructions, saved as a draft skill
 *
 * How the rules apply:
 *  - where it runs: as a local tool server (localtools.ts): `docker exec` in the bot's sandboxed computer, no shell, no
 *    host variable, never in the Sklubot server process; no secret is ever given to it;
 *  - declared permissions: shown on the owner's review; « files » and « network » are what the bot's computer already
 *    allows (its sandbox and its internet rules, netpolicy.ts) — a plugin never widens them, and a host it declares
 *    that the bot's rules refuse is pointed out on the review (it will be refused);
 *  - the skill scanner (skillscan.ts) reads its description, tool descriptions and skill: a danger blocks it until the
 *    owner reads the findings and accepts them; a bot can only propose a plugin, never install or accept one;
 *  - approval gates: installing is the owner's yes in the app; each tool call then goes through the usual path for
 *    an app's tools (card unless allowed, irreversible ones say so; a tool declared `committing` is always treated as
 *    destructive, a tool is read-only only if BOTH the manifest and the server say so);
 *  - code that calls several tools in one go stays the run_steps model (agent/tools-steps.ts): a plugin adds tools, it
 *    does not run Sklubot's tools itself.
 * Table created here (house pattern).
 */
q.run(`CREATE TABLE IF NOT EXISTS plugins (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, bot_id TEXT NOT NULL, name TEXT NOT NULL, version TEXT NOT NULL, manifest TEXT NOT NULL, manifest_hash TEXT NOT NULL, status TEXT NOT NULL, lts_id TEXT, skill_id TEXT, accepted_hash TEXT, proposed_by TEXT NOT NULL DEFAULT 'owner', created_at INTEGER NOT NULL)`);
q.run("CREATE INDEX IF NOT EXISTS plugins_bot ON plugins (bot_id)");

export const PLUGIN_FORMAT = "sklubot-plugin/1";
export interface PluginTool { name: string; description: string; readOnly: boolean; committing: boolean }
export interface PluginManifest {
  format: string; name: string; version: string; description: string; author: string; license: string; homepage: string;
  run: { command: string; args: string[] }; tools: PluginTool[];
  permissions: { network: "none" | "bot" | string[]; files: "none" | "workspace" };
  skill: { name: string; when: string; steps: string } | null;
}
export interface PluginReview { id: string; botId: string; name: string; version: string; status: "review" | "active" | "blocked"; manifest: PluginManifest; findings: ScanFinding[]; worst: "ok" | "info" | "warning" | "danger"; accepted: boolean; networkNotes: string[]; proposedBy: "owner" | "bot"; createdAt: number }

const LAUNCHERS = new Set(["npx", "uvx", "bunx"]);
const PINNED = /^(@?[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@|==)\d+\.\d+\.\d+([-+][\w.]+)?$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
const HOST = /^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i;

/** Checks a manifest. Returns it normalized, or the problems (English sentences for the owner or the bot). */
export function parseManifest(raw: unknown): { manifest: PluginManifest } | { problems: string[] } {
  let m: any = raw;
  if (typeof raw === "string") { try { m = JSON.parse(raw); } catch { return { problems: ["The manifest is not valid JSON."] }; } }
  if (!m || typeof m !== "object" || Array.isArray(m)) return { problems: ["The manifest must be a JSON object."] };
  const p: string[] = [];
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  if (m.format !== PLUGIN_FORMAT) p.push(`"format" must be "${PLUGIN_FORMAT}".`);
  const name = s(m.name, 40);
  if (!SLUG.test(name)) p.push('"name": 2 to 40 lowercase letters, digits or dashes.');
  const version = s(m.version, 40);
  if (!/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(version)) p.push('"version": an exact version such as 1.2.0.');
  const description = s(m.description, 500);
  if (!description) p.push('"description" is required.');
  const homepage = s(m.homepage, 300);
  if (homepage && !/^https:\/\//.test(homepage)) p.push('"homepage" must start with https://.');
  const command = s(m.run?.command, 20);
  const args: string[] = Array.isArray(m.run?.args) ? m.run.args.filter((x: unknown) => typeof x === "string").map((x: string) => x.slice(0, 300)).slice(0, 30) : [];
  if (!LAUNCHERS.has(command)) p.push('"run.command" must be npx, uvx or bunx (a package from its registry, run in the bot\'s computer).');
  else if (!args.some((a) => !a.startsWith("-") && PINNED.test(a))) p.push('"run.args" must name the package with an exact version (pkg@1.2.3, or pkg==1.2.3 for uvx).');
  if (args.some((a) => /[\u0000-\u001f]/.test(a))) p.push('"run.args": one line each.');
  const tools: PluginTool[] = (Array.isArray(m.tools) ? m.tools : []).slice(0, 50).map((t: any) => ({ name: s(t?.name, 64), description: s(t?.description, 1000), readOnly: t?.readOnly === true, committing: t?.committing === true }));
  if (!tools.length) p.push('"tools" must list at least one tool.');
  for (const t of tools) if (!/^[A-Za-z0-9_-]{1,64}$/.test(t.name) || !t.description) { p.push(`Tool "${clip(t.name, 40)}": a name (letters, digits, _ or -) and a description.`); break; }
  if (new Set(tools.map((t) => t.name)).size !== tools.length) p.push("Two tools have the same name.");
  const perms = m.permissions ?? {};
  let network: PluginManifest["permissions"]["network"] = "none";
  if (Array.isArray(perms.network)) { network = perms.network.map((h: unknown) => s(h, 253).toLowerCase()).filter(Boolean).slice(0, 50); if ((network as string[]).some((h) => !HOST.test(h))) p.push('"permissions.network": host names only (example.com).'); }
  else if (perms.network === "bot") network = "bot";
  else if (perms.network !== undefined && perms.network !== "none") p.push('"permissions.network": "none", "bot" or a list of hosts.');
  const files = perms.files === "workspace" ? "workspace" : "none";
  if (perms.files !== undefined && perms.files !== "none" && perms.files !== "workspace") p.push('"permissions.files": "none" or "workspace".');
  if (perms.secrets !== undefined && !(Array.isArray(perms.secrets) && perms.secrets.length === 0)) p.push("A plugin cannot ask for secrets: they never enter the bot's computer (use the credential relay for an API key).");
  let skill: PluginManifest["skill"] = null;
  if (m.skill !== undefined && m.skill !== null) {
    skill = { name: s(m.skill.name, 80), when: s(m.skill.when, 300), steps: typeof m.skill.steps === "string" ? m.skill.steps.slice(0, 20_001) : "" };
    if (!skill.name || !skill.steps) p.push('"skill" needs a name and steps.');
    if (skill.steps.length > 20_000) p.push('"skill.steps": 20 000 characters at most.');
  }
  if (p.length) return { problems: p };
  return { manifest: { format: PLUGIN_FORMAT, name, version, description, author: s(m.author, 100), license: s(m.license, 60), homepage, run: { command, args }, tools, permissions: { network, files }, skill } };
}

const hashOf = (m: PluginManifest) => createHash("sha256").update(JSON.stringify(m)).digest("hex");
const RANK = { danger: 0, warning: 1, info: 2 } as const;
/** The skill scanner over everything a model will read from the plugin. */
export function scanManifest(m: PluginManifest): { findings: ScanFinding[]; worst: PluginReview["worst"] } {
  const text = [m.name, m.description, ...m.tools.map((t) => `${t.name}: ${t.description}`), ...(m.skill ? [m.skill.name, m.skill.when, m.skill.steps] : [])].join("\n");
  const findings = scanText(text).sort((a, b) => RANK[a.severity] - RANK[b.severity]).slice(0, 50);
  const worst = findings.some((f) => f.severity === "danger") ? "danger" : findings.some((f) => f.severity === "warning") ? "warning" : findings.length ? "info" : "ok";
  return { findings, worst };
}

/** What the bot's internet rules will do to the hosts a plugin declares. */
export function networkNotes(botId: string, m: PluginManifest, locale: Locale = "en"): string[] {
  const pol = netPolicy.get(botId);
  if (m.permissions.network === "none") return pol.mode === "none" ? [] : [tr(locale, "It says it needs no internet, but runs with the bot's computer's internet rules.")];
  if (pol.mode === "none") return [tr(locale, "The bot's computer has no internet: this plugin's network use will be refused.")];
  if (pol.mode === "list" && Array.isArray(m.permissions.network)) {
    const out = m.permissions.network.filter((h) => !pol.hosts.some((x) => h === x || h.endsWith(`.${x}`)));
    return out.length ? [tr(locale, "Not in the bot's allowed sites, so refused: {hosts}.", { hosts: out.join(", ") })] : [];
  }
  return [];
}

interface Row { id: string; user_id: string; bot_id: string; name: string; version: string; manifest: string; manifest_hash: string; status: string; lts_id: string | null; skill_id: string | null; accepted_hash: string | null; proposed_by: string; created_at: number }
const rowOf = (id: string) => q.get<Row>("SELECT * FROM plugins WHERE id = ?", id) ?? null;
function review(r: Row, locale: Locale = "en"): PluginReview {
  const manifest = JSON.parse(r.manifest) as PluginManifest;
  const { findings, worst } = scanManifest(manifest);
  return { id: r.id, botId: r.bot_id, name: r.name, version: r.version, status: r.status as PluginReview["status"], manifest, findings, worst, accepted: r.accepted_hash === r.manifest_hash, networkNotes: networkNotes(r.bot_id, manifest, locale), proposedBy: r.proposed_by === "bot" ? "bot" : "owner", createdAt: r.created_at };
}

export class PluginError extends Error { constructor(public status: 400 | 404 | 409, message: string) { super(message); } }

/** The declared tools of each active plugin's server, to narrow what that server lists (localtools.ts). */
setToolFilter((serverId, tools: CachedTool[]) => {
  const r = q.get<{ manifest: string }>("SELECT manifest FROM plugins WHERE lts_id = ? AND status = 'active'", serverId);
  if (!r) return tools;
  const declared = new Map((JSON.parse(r.manifest) as PluginManifest).tools.map((t) => [t.name, t]));
  return tools.filter((t) => declared.has(t.name)).map((t) => {
    const d = declared.get(t.name)!;
    return { ...t, description: clip(d.description, 1000), readOnly: t.readOnly && d.readOnly && !d.committing, destructive: t.destructive || d.committing };
  });
});

export const plugins = {
  list: (botId: string, locale: Locale = "en"): PluginReview[] => q.all<Row>("SELECT * FROM plugins WHERE bot_id = ? ORDER BY created_at", botId).map((r) => review(r, locale)),
  get(userId: string, id: string) { const r = rowOf(id); return r && r.user_id === userId ? review(r) : null; },
  /** A plugin to review (the owner pasted it, or a bot proposed it): nothing runs yet. */
  propose(bot: { id: string; userId: string; name: string }, raw: unknown, by: "owner" | "bot"): PluginReview {
    const parsed = parseManifest(raw);
    if ("problems" in parsed) throw new PluginError(400, parsed.problems.join(" "));
    const m = parsed.manifest;
    if (q.get("SELECT 1 FROM plugins WHERE bot_id = ? AND name = ?", bot.id, m.name)) throw new PluginError(409, "This bot already has a plugin of that name: remove it first.");
    if (q.get<{ n: number }>("SELECT COUNT(*) AS n FROM plugins WHERE bot_id = ?", bot.id)!.n >= 10) throw new PluginError(409, "A bot can have 10 plugins at most.");
    const id = newId("plg");
    q.run("INSERT INTO plugins (id, user_id, bot_id, name, version, manifest, manifest_hash, status, proposed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'review', ?, ?)", id, bot.userId, bot.id, m.name, m.version, JSON.stringify(m), hashOf(m), by, now());
    audit(bot.userId, "apps", `${bot.name}: plugin ${by === "bot" ? "proposed by the bot" : "added for review"} — ${m.name} ${m.version}`, bot.id);
    emit(bot.userId, { type: "localtools", botId: bot.id });
    return review(rowOf(id)!);
  },
  /**
   * The owner installs it: a danger in the scan must be accepted first (accept: true). Starts its tool server in the
   * bot's computer and saves its skill as a draft.
   */
  approve(userId: string, id: string, accept: boolean): PluginReview {
    const r = rowOf(id);
    if (!r || r.user_id !== userId) throw new PluginError(404, "No such plugin.");
    if (r.status === "active") return review(r);
    const bot = bots.byId(r.bot_id);
    if (!bot) throw new PluginError(404, "No such bot.");
    const m = JSON.parse(r.manifest) as PluginManifest;
    const { worst } = scanManifest(m);
    if (worst === "danger" && !accept && r.accepted_hash !== r.manifest_hash) {
      q.run("UPDATE plugins SET status = 'blocked' WHERE id = ?", id);
      throw new PluginError(409, "The safety check found a danger in this plugin: read the findings, then accept them to install it anyway.");
    }
    let lts: { id: string };
    try { lts = localTools.add(bot, { name: `plugin ${m.name}`, command: m.run.command, args: m.run.args }, "owner"); } catch (e) { throw new PluginError(400, (e as Error).message); }
    let skillId: string | null = null;
    if (m.skill) {
      // A draft from outside: the owner activates it in the bot's skills (the scanner's state is shown there too).
      try { skillId = skills.create(bot.id, m.skill.name, m.skill.when, m.skill.steps, false, { outside: true, draft: true }).id; } catch { skillId = null; }
    }
    q.run("UPDATE plugins SET status = 'active', lts_id = ?, skill_id = ?, accepted_hash = ? WHERE id = ?", lts.id, skillId, worst === "danger" ? r.manifest_hash : r.accepted_hash, id);
    audit(userId, "apps", `${bot.name}: plugin installed — ${m.name} ${m.version} (runs in the bot's computer)`, bot.id);
    void localTools.start(lts.id);
    emit(userId, { type: "localtools", botId: bot.id });
    return review(rowOf(id)!);
  },
  async remove(userId: string, id: string) {
    const r = rowOf(id);
    if (!r || r.user_id !== userId) throw new PluginError(404, "No such plugin.");
    if (r.lts_id) await localTools.remove(r.lts_id);
    q.run("DELETE FROM plugins WHERE id = ?", id);
    audit(userId, "apps", `Plugin removed: ${r.name}`, r.bot_id);
    emit(userId, { type: "localtools", botId: r.bot_id });
  },
};
