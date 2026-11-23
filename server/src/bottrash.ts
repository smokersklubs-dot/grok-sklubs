import { q } from "./db.js";
import { audit, bots, clip, newId, now, type BotRecord } from "./store.js";

/**
 * L144 « Corbeille des bots » (backlog A-FAIRE). Before a bot is deleted, what can be given back is copied here: its
 * settings and look, its conversations (every one, with the model's history), its notes, skills, tasks, rules, routines
 * (they come back switched off, never firing on their own), summaries, voice and per-bot choices. « Restaurer » makes a
 * new bot from that copy (the usual limits apply: plan, team size), « Supprimer pour de bon » forgets it, and a copy is
 * forgotten by itself after TRASH_DAYS days.
 *
 * Never copied (and so never given back): secrets and channel tokens (Telegram, Slack, Discord, mail, webhooks, API
 * keys of the bot), approvals and runtime state, its computer and its files (they are deleted with the bot, and the
 * preview says so before the owner confirms).
 */
export const TRASH_DAYS = 30;
const DAY = 86_400_000;

q.run(`CREATE TABLE IF NOT EXISTS bot_trash (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, bot_id TEXT NOT NULL, name TEXT NOT NULL,
  kind TEXT NOT NULL, snapshot TEXT NOT NULL, counts TEXT NOT NULL, deleted_at INTEGER NOT NULL
)`);
q.run("CREATE INDEX IF NOT EXISTS bot_trash_user ON bot_trash(user_id, deleted_at)");

/** Bot columns a restored bot takes back (everything else — tokens, relay, unread marks — starts fresh). */
const BOT_COLUMNS = ["label", "description", "instructions", "shape", "color", "mode", "effort", "model", "autonomy", "voice", "character", "room_rule", "disabled_tools", "pinned", "section_id", "fallback_models", "nudges", "spend_checkpoint_usd", "computer_mode", "generation", "next_seq"];
/** Tables copied with the bot, keyed by bot_id. `fresh`: columns reset on the way back. */
export const TRASH_TABLES: { table: string; label: TrashPart; fresh?: Record<string, unknown> }[] = [
  { table: "rows", label: "messages" },
  { table: "history", label: "history" },
  { table: "memories", label: "memories" },
  { table: "skills", label: "skills" },
  { table: "tasks", label: "tasks" },
  { table: "rules", label: "rules" },
  { table: "routines", label: "routines", fresh: { enabled: 0, hook_token: null, native_account_id: null, paused_reason: "restored" } },
  { table: "compactions", label: "history" },
  { table: "compaction_summaries", label: "history" },
  { table: "feedback", label: "history" },
  { table: "bot_voices", label: "settings" },
  { table: "memory_bot_prefs", label: "settings" },
  { table: "bot_work_models", label: "settings" },
  { table: "conv_meta", label: "settings" },
  { table: "bot_style", label: "settings" },
];
export type TrashPart = "messages" | "history" | "memories" | "skills" | "tasks" | "rules" | "routines" | "settings";
export interface TrashCounts { conversations: number; messages: number; memories: number; skills: number; routines: number; tasks: number; rules: number; files: boolean; computer: boolean }
export interface TrashItem { id: string; botId: string; name: string; kind: string; deletedAt: number; expiresAt: number; counts: TrashCounts }

const tableExists = (t: string) => !!q.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", t);
const columnsOf = (t: string) => q.all<{ name: string }>(`PRAGMA table_info("${t}")`).map((c) => c.name);

/** What deleting this bot takes away, for the confirmation (« Ce qui sera supprimé »). Pure reads. */
export function deletionPreview(bot: BotRecord): TrashCounts & { restorable: TrashPart[]; days: number; helpers: number } {
  const n = (sql: string, ...p: (string | number)[]) => q.get<{ n: number }>(sql, ...p)?.n ?? 0;
  return {
    conversations: n("SELECT COUNT(DISTINCT generation) AS n FROM rows WHERE bot_id = ?", bot.id),
    messages: n("SELECT COUNT(*) AS n FROM rows WHERE bot_id = ? AND kind = 'message'", bot.id),
    memories: n("SELECT COUNT(*) AS n FROM memories WHERE bot_id = ?", bot.id),
    skills: n("SELECT COUNT(*) AS n FROM skills WHERE bot_id = ?", bot.id),
    routines: n("SELECT COUNT(*) AS n FROM routines WHERE bot_id = ?", bot.id),
    tasks: n("SELECT COUNT(*) AS n FROM tasks WHERE bot_id = ?", bot.id),
    rules: n("SELECT COUNT(*) AS n FROM rules WHERE bot_id = ?", bot.id),
    files: bot.kind === "agent", computer: bot.kind === "agent",
    helpers: bots.children(bot.id).filter((c) => c.id !== bot.id).length,
    restorable: ["messages", "memories", "skills", "routines", "tasks", "rules", "settings"], days: TRASH_DAYS,
  };
}

/** Copies the bot into the trash. Called just before the deletion steps (retire.ts); never throws into them. */
export function putInTrash(bot: BotRecord): string | null {
  try {
    const record = q.get<Record<string, unknown>>("SELECT * FROM bots WHERE id = ?", bot.id);
    if (!record) return null;
    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const { table } of TRASH_TABLES) if (tableExists(table)) tables[table] = q.all<Record<string, unknown>>(`SELECT * FROM "${table}" WHERE bot_id = ?`, bot.id);
    const p = deletionPreview(bot);
    const counts: TrashCounts = { conversations: p.conversations, messages: p.messages, memories: p.memories, skills: p.skills, routines: p.routines, tasks: p.tasks, rules: p.rules, files: p.files, computer: p.computer };
    const id = newId("trash");
    const bot0 = Object.fromEntries(Object.entries(record).filter(([k]) => BOT_COLUMNS.includes(k) || k === "kind" || k === "name" || k === "members"));
    q.run("INSERT INTO bot_trash (id, user_id, bot_id, name, kind, snapshot, counts, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id, bot.userId, bot.id, clip(bot.name, 60), bot.kind, JSON.stringify({ bot: bot0, tables }), JSON.stringify(counts), now());
    return id;
  } catch (err) {
    console.error(`[trash ${bot.id}]`, (err as Error)?.message ?? err);
    return null;
  }
}

/** Copies older than TRASH_DAYS are forgotten (on every read of the list, and at start). */
export function purgeTrash(at = now()) {
  return Number(q.run("DELETE FROM bot_trash WHERE deleted_at < ?", at - TRASH_DAYS * DAY).changes);
}

export function trashList(userId: string): TrashItem[] {
  purgeTrash();
  return q.all<{ id: string; bot_id: string; name: string; kind: string; deleted_at: number; counts: string }>(
    "SELECT id, bot_id, name, kind, deleted_at, counts FROM bot_trash WHERE user_id = ? ORDER BY deleted_at DESC", userId,
  ).map((r) => ({ id: r.id, botId: r.bot_id, name: r.name, kind: r.kind, deletedAt: r.deleted_at, expiresAt: r.deleted_at + TRASH_DAYS * DAY, counts: JSON.parse(r.counts) }));
}

export function forgetTrash(userId: string, id: string): boolean {
  return Number(q.run("DELETE FROM bot_trash WHERE id = ? AND user_id = ?", id, userId).changes) > 0;
}

export class TrashError extends Error { constructor(public status: 404 | 409, message: string) { super(message); } }

/**
 * « Restaurer »: a new bot (bots.create, so the plan and team limits apply) with the copy's settings and content. The
 * copy leaves the trash. Routines come back switched off. Rows of a table that no longer fit (a column gone) are skipped.
 */
export function restoreFromTrash(userId: string, id: string): BotRecord {
  const r = q.get<{ snapshot: string; name: string; kind: string }>("SELECT snapshot, name, kind FROM bot_trash WHERE id = ? AND user_id = ?", id, userId);
  if (!r) throw new TrashError(404, "This bot is no longer in the trash.");
  const snap = JSON.parse(r.snapshot) as { bot: Record<string, unknown>; tables: Record<string, Record<string, unknown>[]> };
  const kind = r.kind === "room" ? "room" : "agent";
  const memberIds = kind === "room" ? (JSON.parse(String(snap.bot.members ?? "[]")) as string[]).filter((m) => bots.owned(userId, m)) : undefined;
  const taken = bots.byName(userId, r.name);
  const fresh = bots.create(userId, { kind, name: taken ? clip(`${r.name} (2)`, 60) : r.name, memberIds });
  try { return q.tx(() => restoreInto(fresh.id, id, r.name, userId, snap)); }
  catch (err) { bots.remove(fresh.id); throw err; } // nothing half-restored is left behind
}

function restoreInto(freshId: string, id: string, name: string, userId: string, snap: { bot: Record<string, unknown>; tables: Record<string, Record<string, unknown>[]> }): BotRecord {
  const fresh = { id: freshId };
  const r = { name };
  {
    const sets = BOT_COLUMNS.filter((c) => c in snap.bot);
    if (sets.length) {
      try { q.run(`UPDATE bots SET ${sets.map((c) => `"${c}" = ?`).join(", ")} WHERE id = ?`, ...sets.map((c) => snap.bot[c] as string | number | null), fresh.id); }
      catch { // a section deleted since: the bot goes back to the main list
        const noSection = sets.filter((c) => c !== "section_id");
        q.run(`UPDATE bots SET ${noSection.map((c) => `"${c}" = ?`).join(", ")} WHERE id = ?`, ...noSection.map((c) => snap.bot[c] as string | number | null), fresh.id);
      }
    }
    for (const { table, fresh: reset } of TRASH_TABLES) {
      const list = snap.tables[table];
      if (!list?.length || !tableExists(table)) continue;
      const cols = new Set(columnsOf(table));
      q.run(`DELETE FROM "${table}" WHERE bot_id = ?`, fresh.id); // a fresh bot may already hold default rows (one per bot)
      for (const row of list) {
        const data: Record<string, unknown> = { ...row, ...(reset ?? {}), bot_id: fresh.id };
        if (table === "routines" && "paused_reason" in data && !cols.has("paused_reason")) delete data.paused_reason;
        const keys = Object.keys(data).filter((k) => cols.has(k));
        try { q.run(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, ...keys.map((k) => data[k] as string | number | null)); }
        catch { /* a row that no longer fits (its id taken, a reference gone) is skipped */ }
      }
    }
    q.run("DELETE FROM bot_trash WHERE id = ?", id);
    audit(userId, "system", `${r.name}: restored from the trash`, fresh.id);
    return bots.byId(fresh.id)!;
  }
}

purgeTrash();
