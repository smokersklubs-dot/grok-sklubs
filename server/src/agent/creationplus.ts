import { readFileSync } from "node:fs";
import { tr } from "../i18n.js";
import { q } from "../db.js";
import { guardedFetch } from "../net.js";
import { clip, now, rows, users, type BotRecord } from "../store.js";
import type { CreationQuestion } from "../creationtypes.js";

/**
 * L158 « Créations », the rest (RESTE 23/11; ideas from the Craft Anything audit, docs/audits/AUDIT-CRAFT-ANYTHING.md
 * « À faire » 9, 13 and 17 — our own code):
 *  - a budget per creation: the owner sets an amount in dollars on the trajectory card; what the bot spent (its model and
 *    media costs, the `usage` table) from the creation's first render until it reached « ready » (or now) is shown next
 *    to it. At 80 % the bot is told; at 100 % it is told to stop and ask the owner (creation_render's reply), and the card
 *    says it. It is the bot's whole spend over that period: a bot doing other work at the same time counts it too (said
 *    on the card). Not a hard block of tools: the account's usage caps (usagecaps.ts) remain the hard stop.
 *  - open questions / hypotheses: creation_render may add questions the bot cannot settle alone and mark some answered;
 *    the card shows the open ones and the owner ticks one off (creationroutes.ts); the bot reads the owner's ticks in its
 *    next render reply.
 *  - a new Craft Anything version: the pinned version (docker/desktop/install-craft.sh `version=`) is compared with the
 *    latest release tag on GitHub (REST "Get the latest release": GET /repos/{owner}/{repo}/releases/latest, field
 *    `tag_name` — https://docs.github.com/en/rest/releases/releases#get-the-latest-release), through guardedFetch, at most
 *    once a day. When newer, the owner is told once per version in the chat where Craft Anything is used. Nothing is ever
 *    installed by itself: the pin and its SHA-256 change only with a new Sklubot version.
 * Additive tables created at load (house pattern); they follow the creation (ON DELETE CASCADE).
 */
q.run("CREATE TABLE IF NOT EXISTS creation_budgets (creation_id TEXT PRIMARY KEY REFERENCES creations(id) ON DELETE CASCADE, budget_usd REAL NOT NULL, updated_at INTEGER NOT NULL)");
q.run(`CREATE TABLE IF NOT EXISTS creation_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, creation_id TEXT NOT NULL REFERENCES creations(id) ON DELETE CASCADE, text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', resolved_by TEXT, seen INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, resolved_at INTEGER)`);
q.run("CREATE TABLE IF NOT EXISTS craft_version_notices (user_id TEXT NOT NULL, version TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, version))");

export const MAX_BUDGET_USD = 10_000;
export const OPEN_QUESTIONS_MAX = 20;
export const WARN_AT = 0.8;

// ── Budget ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function setBudget(creationId: string, usd: unknown): number | null {
  if (usd === null || usd === undefined || usd === "") { q.run("DELETE FROM creation_budgets WHERE creation_id = ?", creationId); return null; }
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_BUDGET_USD) throw new RangeError("budget");
  const v = Math.round(n * 100) / 100;
  q.run("INSERT INTO creation_budgets (creation_id, budget_usd, updated_at) VALUES (?, ?, ?) ON CONFLICT(creation_id) DO UPDATE SET budget_usd = excluded.budget_usd, updated_at = excluded.updated_at", creationId, v, now());
  return v;
}
export const budgetOf = (creationId: string) => q.get<{ budget_usd: number }>("SELECT budget_usd FROM creation_budgets WHERE creation_id = ?", creationId)?.budget_usd ?? null;

/** What the bot spent from the creation's start until it was « ready » (its last update then), or until now. */
export function spentOn(c: { bot_id: string; created_at: number; updated_at: number; stage: string }): number {
  const until = c.stage === "ready" ? c.updated_at : now();
  const r = q.get<{ s: number | null }>("SELECT SUM(cost_usd) AS s FROM usage WHERE bot_id = ? AND at >= ? AND at <= ?", c.bot_id, c.created_at, until);
  return Math.round((r?.s ?? 0) * 10000) / 10000;
}

export type BudgetState = "none" | "ok" | "warn" | "over";
export const budgetState = (budget: number | null, spent: number): BudgetState => (budget == null ? "none" : spent >= budget ? "over" : spent >= budget * WARN_AT ? "warn" : "ok");

// ── Open questions ──────────────────────────────────────────────────────────────────────────────────────────────
interface QRow { id: number; creation_id: string; text: string; status: string; resolved_by: string | null; seen: number }
export const openQuestions = (creationId: string): CreationQuestion[] =>
  q.all<QRow>("SELECT * FROM creation_questions WHERE creation_id = ? AND status = 'open' ORDER BY id LIMIT ?", creationId, OPEN_QUESTIONS_MAX).map((r) => ({ id: r.id, text: r.text }));

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** The bot adds questions (deduplicated, at most OPEN_QUESTIONS_MAX open) and marks some answered (by text or number). */
export function botQuestions(creationId: string, add: unknown, resolved: unknown): { added: number; closed: number } {
  const open = q.all<QRow>("SELECT * FROM creation_questions WHERE creation_id = ? AND status = 'open'", creationId);
  let closed = 0;
  for (const raw of Array.isArray(resolved) ? resolved.slice(0, 50) : []) {
    const key = String(raw ?? "").trim();
    const hit = open.find((o) => String(o.id) === key || norm(o.text) === norm(key));
    if (hit && hit.status === "open") { q.run("UPDATE creation_questions SET status = 'resolved', resolved_by = 'bot', resolved_at = ? WHERE id = ?", now(), hit.id); hit.status = "resolved"; closed++; }
  }
  let added = 0;
  let count = open.filter((o) => o.status === "open").length;
  const known = new Set(q.all<QRow>("SELECT * FROM creation_questions WHERE creation_id = ?", creationId).map((o) => norm(o.text)));
  for (const raw of Array.isArray(add) ? add.slice(0, 20) : []) {
    const text = clip(String(raw ?? "").replace(/\s+/g, " ").trim(), 200);
    if (!text || known.has(norm(text)) || count >= OPEN_QUESTIONS_MAX) continue;
    q.run("INSERT INTO creation_questions (creation_id, text, created_at) VALUES (?, ?, ?)", creationId, text, now());
    known.add(norm(text)); count++; added++;
  }
  return { added, closed };
}

/** The owner ticks a question off (from the card). Returns false when it is not an open question of this creation. */
export function ownerResolves(creationId: string, id: number): boolean {
  return q.run("UPDATE creation_questions SET status = 'resolved', resolved_by = 'owner', seen = 0, resolved_at = ? WHERE id = ? AND creation_id = ? AND status = 'open'", now(), id, creationId).changes > 0;
}

/** The questions the owner ticked off since the bot last heard (then marked as heard). */
export function ownerTicks(creationId: string): string[] {
  const list = q.all<QRow>("SELECT * FROM creation_questions WHERE creation_id = ? AND resolved_by = 'owner' AND seen = 0", creationId);
  if (list.length) q.run("UPDATE creation_questions SET seen = 1 WHERE creation_id = ? AND resolved_by = 'owner' AND seen = 0", creationId);
  return list.map((r) => r.text);
}

// ── Craft Anything: a newer release? ────────────────────────────────────────────────────────────────────────────
export const CRAFT_REPO = "storytold/craft-anything";
/** The version Sklubot installs and checks (install-craft.sh), read from the script itself. */
export function pinnedCraftVersion(): string {
  try { return /^version=([\w.-]+)$/m.exec(readFileSync(new URL("../../../docker/desktop/install-craft.sh", import.meta.url), "utf8"))?.[1] ?? ""; } catch { return ""; }
}
/** -1 / 0 / 1 for dotted numeric versions ("v0.6.10" > "0.6.9"); pre-release suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/i, "").split(/[-+]/)[0].split(".").map((x) => Number(x) || 0);
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}

let cache: { at: number; latest: string | null } | null = null;
export const resetCraftCache = () => { cache = null; };
/** The latest release tag (cached a day; a failure is cached an hour and answers null). */
export async function latestCraftTag(fetcher: typeof guardedFetch = guardedFetch): Promise<string | null> {
  if (cache && now() - cache.at < (cache.latest ? 24 : 1) * 3600_000) return cache.latest;
  let latest: string | null = null;
  try {
    const res = await fetcher(`https://api.github.com/repos/${CRAFT_REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": "sklubot" }, signal: AbortSignal.timeout(10_000) });
    if (res.ok) { const tag = (await res.json() as { tag_name?: unknown }).tag_name; if (typeof tag === "string" && /^v?\d+(\.\d+)*([-+][\w.]+)?$/.test(tag)) latest = tag; }
  } catch { latest = null; }
  cache = { at: now(), latest };
  return latest;
}

export interface CraftUpdate { current: string; latest: string; newer: boolean }
export async function craftUpdate(fetcher?: typeof guardedFetch): Promise<CraftUpdate | null> {
  const current = pinnedCraftVersion();
  const latest = await latestCraftTag(fetcher);
  if (!current || !latest) return null;
  return { current, latest: latest.replace(/^v/i, ""), newer: compareVersions(latest, current) > 0 };
}

/** Tells the owner once per new version, in the chat where Craft Anything is used. Never installs anything. */
export async function noteCraftUpdate(bot: BotRecord, thread?: number, fetcher?: typeof guardedFetch): Promise<CraftUpdate | null> {
  const u = await craftUpdate(fetcher);
  if (!u?.newer) return u;
  if (q.run("INSERT OR IGNORE INTO craft_version_notices (user_id, version, at) VALUES (?, ?, ?)", bot.userId, u.latest, now()).changes)
    rows.append(bot, { kind: "notice", tone: "info", text: tr(users.localeOf(bot.userId), "A newer Craft Anything version is out ({latest}). Sklubot keeps the checked version {current} until a Sklubot update verifies the new one: nothing is installed by itself.", { latest: u.latest, current: u.current }) }, thread || undefined);
  return u;
}
