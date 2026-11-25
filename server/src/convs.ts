import { q } from "./db.js";
import { bots, clip, now, type BotRecord } from "./store.js";

/**
 * L146 « Plusieurs conversations par bot » (backlog A-FAIRE). A bot already keeps every earlier conversation (one
 * "generation" each: « Nouvelle conversation » starts the next one). This module gives them a list: an automatic title
 * (the first words the owner wrote), « Renommer », « Épingler », a folder, the « Automatiques » filter (conversations a
 * routine, a webhook, an email or another bot started) and « Rouvrir » an earlier one.
 *
 * Rouvrir moves the earlier conversation to the end, as the newest generation, with everything that belongs to it
 * (messages, the model's history, summaries, the subscription tool's session…: every table keyed by bot and generation),
 * and the conversation that was open stays in the list. Generation numbers only ever go up, so an open app sees it as a
 * new conversation and reloads it. Only when the bot is idle.
 *
 * L150 (part): a model chosen for one conversation (`model`), used for the owner's own messages in it (agent/workmodel.ts);
 * and its reasoning level (`effort`, column added below: "" = the project's preset or the bot's own level).
 * L161 (part): « Garder l'historique » — earlier conversations not pinned and untouched for N days are deleted.
 */
q.run(`CREATE TABLE IF NOT EXISTS conv_meta (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, generation INTEGER NOT NULL,
  title TEXT, pinned INTEGER NOT NULL DEFAULT 0, folder TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL, PRIMARY KEY (bot_id, generation)
)`);
try { q.run("ALTER TABLE conv_meta ADD COLUMN effort TEXT NOT NULL DEFAULT ''"); } catch { /* already there */ }
q.run(`CREATE TABLE IF NOT EXISTS history_retention (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, days INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);

export const AUTO_ORIGINS = ["routine", "webhook", "email", "api", "nudge", "bot"] as const;
export const RETENTION_DAYS = [0, 30, 90, 365] as const;
export const MAX_FOLDER = 40;
export const MAX_TITLE = 80;
/** Reasoning levels a conversation may choose (the bot's own levels, store.ts ENUMS.effort); "" = not chosen. */
export const CONV_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

export interface Conversation {
  generation: number; title: string; autoTitle: boolean; pinned: boolean; folder: string; model: string; effort: string;
  automatic: boolean; messages: number; startedAt: number; lastAt: number; current: boolean;
}

/** The first words of a text, on one line: the automatic title. */
export function autoTitle(text: string): string {
  const one = text.replace(/[`*_#>\[\]]/g, "").replace(/\s+/g, " ").trim();
  if (!one) return "";
  if (one.length <= 60) return one;
  const cut = one.slice(0, 61).replace(/\s+\S*$/, "").replace(/[\s,;:.]+$/, "") || one.slice(0, 60);
  return `${cut}…`;
}

interface MetaRow { generation: number; title: string | null; pinned: number; folder: string; model: string; effort?: string }
const metaOf = (botId: string, generation: number) => q.get<MetaRow>("SELECT * FROM conv_meta WHERE bot_id = ? AND generation = ?", botId, generation);

export function listConversations(bot: BotRecord, filter: { automatic?: boolean; folder?: string; q?: string } = {}): Conversation[] {
  const gens = q.all<{ generation: number; n: number; first: number; last: number }>(
    "SELECT generation, SUM(kind = 'message') AS n, MIN(created_at) AS first, MAX(created_at) AS last FROM rows WHERE bot_id = ? GROUP BY generation", bot.id,
  );
  if (!gens.some((g) => g.generation === bot.generation)) gens.push({ generation: bot.generation, n: 0, first: now(), last: now() });
  const metas = new Map(q.all<MetaRow>("SELECT * FROM conv_meta WHERE bot_id = ?", bot.id).map((m) => [m.generation, m]));
  const out = gens.map((g): Conversation => {
    const first = q.get<{ body: string }>("SELECT body FROM rows WHERE bot_id = ? AND generation = ? AND thread = 0 AND kind = 'message' AND json_extract(body, '$.role') = 'user' ORDER BY seq LIMIT 1", bot.id, g.generation);
    const body = first ? JSON.parse(first.body) as { text?: string; origin?: { kind: string; name?: string } } : null;
    const automatic = !!body?.origin && (AUTO_ORIGINS as readonly string[]).includes(body.origin.kind);
    const m = metas.get(g.generation);
    const auto = autoTitle(body?.text ?? "") || (body?.origin?.name ? clip(body.origin.name, 60) : "");
    return {
      generation: g.generation, title: m?.title || auto, autoTitle: !m?.title, pinned: !!m?.pinned, folder: m?.folder ?? "", model: m?.model ?? "", effort: m?.effort ?? "",
      automatic, messages: g.n ?? 0, startedAt: g.first, lastAt: g.last, current: g.generation === bot.generation,
    };
  });
  const needle = filter.q?.trim().toLowerCase();
  return out
    .filter((c) => filter.automatic === undefined || c.automatic === filter.automatic)
    .filter((c) => filter.folder === undefined || c.folder === filter.folder)
    .filter((c) => !needle || c.title.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.current) - Number(a.current) || Number(b.pinned) - Number(a.pinned) || b.lastAt - a.lastAt);
}

export class ConvError extends Error { constructor(public status: 400 | 404 | 409, message: string) { super(message); } }

const exists = (bot: BotRecord, generation: number) =>
  generation === bot.generation || !!q.get("SELECT 1 FROM rows WHERE bot_id = ? AND generation = ? LIMIT 1", bot.id, generation);

/** « Renommer », « Épingler », folder, model: one conversation's own choices. An empty title goes back to the automatic one. */
export function updateConversation(bot: BotRecord, generation: number, patch: { title?: unknown; pinned?: unknown; folder?: unknown; model?: unknown; effort?: unknown }) {
  if (!Number.isInteger(generation) || !exists(bot, generation)) throw new ConvError(404, "That conversation does not exist.");
  const cur = metaOf(bot.id, generation) ?? { generation, title: null, pinned: 0, folder: "", model: "", effort: "" };
  const title = patch.title === undefined ? cur.title : String(patch.title ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) || null;
  const folder = patch.folder === undefined ? cur.folder : String(patch.folder ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_FOLDER);
  const pinned = patch.pinned === undefined ? cur.pinned : patch.pinned === true ? 1 : 0;
  let model = cur.model;
  if (patch.model !== undefined) {
    model = String(patch.model ?? "").trim();
    if (model && !/^[A-Za-z0-9._:/@+-]{1,120}$/.test(model)) throw new ConvError(400, "Choose an available model.");
  }
  let effort = cur.effort ?? "";
  if (patch.effort !== undefined) {
    effort = String(patch.effort ?? "").trim();
    if (effort && !(CONV_EFFORTS as readonly string[]).includes(effort)) throw new ConvError(400, "Choose a reasoning level: light, normal, deep or maximum.");
  }
  q.run(`INSERT INTO conv_meta (bot_id, generation, title, pinned, folder, model, effort, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (bot_id, generation) DO UPDATE SET title = excluded.title, pinned = excluded.pinned, folder = excluded.folder, model = excluded.model, effort = excluded.effort, updated_at = excluded.updated_at`,
    bot.id, generation, title, pinned, folder, model, effort, now());
}

export function foldersOf(bot: BotRecord): string[] {
  return q.all<{ folder: string }>("SELECT DISTINCT folder FROM conv_meta WHERE bot_id = ? AND folder != '' ORDER BY folder COLLATE NOCASE", bot.id).map((r) => r.folder);
}

/** The model chosen for the bot's open conversation ("" = the bot's own). */
export function conversationModel(botId: string, generation: number): string {
  return metaOf(botId, generation)?.model ?? "";
}

/** The reasoning level chosen for the bot's open conversation ("" = not chosen). */
export function conversationEffort(botId: string, generation: number): string {
  return metaOf(botId, generation)?.effort ?? "";
}

/** Every table that holds something of one conversation (bot_id + generation), found from the schema. */
function generationTables(): string[] {
  return q.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql NOT LIKE '%VIRTUAL TABLE%'")
    .map((t) => t.name)
    .filter((t) => { const cols = q.all<{ name: string }>(`PRAGMA table_info("${t}")`).map((c) => c.name); return cols.includes("bot_id") && cols.includes("generation"); });
}

/** « Rouvrir »: the earlier conversation becomes the open one (moved to a new, higher generation). Returns that number. */
export function reopenConversation(bot: BotRecord, generation: number, busy: boolean): number {
  if (generation === bot.generation) return generation;
  if (busy) throw new ConvError(409, "Wait until the bot has finished, then open that conversation again.");
  if (!Number.isInteger(generation) || generation > bot.generation || !exists(bot, generation)) throw new ConvError(404, "That conversation does not exist.");
  return q.tx(() => {
    const cur = q.get<{ generation: number }>("SELECT generation FROM bots WHERE id = ?", bot.id)!.generation;
    const next = cur + 1;
    for (const t of generationTables()) q.run(`UPDATE "${t}" SET generation = ? WHERE bot_id = ? AND generation = ?`, next, bot.id, generation);
    const max = q.get<{ m: number | null }>("SELECT MAX(seq) AS m FROM rows WHERE bot_id = ? AND generation = ?", bot.id, next)?.m ?? 0;
    q.run("UPDATE bots SET generation = ?, next_seq = ?, updated_at = ? WHERE id = ?", next, max + 1, now(), bot.id);
    return next;
  });
}

// ── « Garder l'historique » (L161) ──
export function retentionDays(userId: string): number {
  return q.get<{ days: number }>("SELECT days FROM history_retention WHERE user_id = ?", userId)?.days ?? 0;
}
export function setRetentionDays(userId: string, days: number) {
  if (!(RETENTION_DAYS as readonly number[]).includes(days)) throw new ConvError(400, "Choose 30, 90 or 365 days, or keep everything.");
  q.run("INSERT INTO history_retention (user_id, days, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET days = excluded.days, updated_at = excluded.updated_at", userId, days, now());
}

/**
 * Deletes the earlier conversations of the user's bots that are not pinned and had nothing new for `days` days. The
 * open conversation of a bot is never touched. Returns how many conversations went. 0 days = keep everything.
 */
export function applyRetention(userId: string, at = now()): number {
  const days = retentionDays(userId);
  if (!days) return 0;
  const cut = at - days * 86_400_000;
  const tables = generationTables();
  let gone = 0;
  for (const bot of bots.list(userId, true)) {
    const old = q.all<{ generation: number }>(
      `SELECT generation FROM rows WHERE bot_id = ? AND generation < ? GROUP BY generation HAVING MAX(created_at) < ?
       AND generation NOT IN (SELECT generation FROM conv_meta WHERE bot_id = ? AND pinned = 1)`, bot.id, bot.generation, cut, bot.id,
    );
    if (!old.length) continue;
    q.tx(() => { for (const { generation } of old) for (const t of tables) q.run(`DELETE FROM "${t}" WHERE bot_id = ? AND generation = ?`, bot.id, generation); });
    gone += old.length;
  }
  return gone;
}

/** Every user with a retention set, once a day (and once shortly after start). Not under NO_SCHEDULER (tests). */
export function startRetention() {
  if (process.env.NO_SCHEDULER === "1") return;
  const pass = () => { for (const { user_id } of q.all<{ user_id: string }>("SELECT user_id FROM history_retention WHERE days > 0")) { try { applyRetention(user_id); } catch (err) { console.error("[retention]", (err as Error)?.message ?? err); } } };
  setTimeout(pass, 60_000).unref();
  setInterval(pass, 86_400_000).unref();
}
startRetention();
