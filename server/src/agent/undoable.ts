import { emit } from "../bus.js";
import { q } from "../db.js";
import { tr } from "../i18n.js";
import { routines } from "../routines.js";
import { schedule } from "../scheduler.js";
import type { Profile } from "../shared.js";
import { audit, newId, rows, settings, skills, users, type BotRecord } from "../store.js";
import type { MemoryUndo } from "./memorymarks.js";
/** Set by memorymarks.ts (it imports this file): puts a memory change back, all of it or nothing. */
let memoryUndo: (bot: BotRecord, u: MemoryUndo) => boolean = () => false;
export const setMemoryUndo = (f: typeof memoryUndo) => { memoryUndo = f; };

/**
 * L98 — reversible changes applied at once, with « Annuler » (backlog A-FAIRE L98; owner decision 1 of A-FAIRE: "balanced"
 * by default, and Undo for changes without risk; idea from the OMB audit, our own code).
 *
 * The shared profile (profile_update), a skill the bot saves (skill_save) and a routine it changes or pauses
 * (routine_update) are applied right away — exactly as before, no new card — and the chat now shows what changed with
 * « Annuler » for UNDO_WINDOW_MS: one click puts back the state from just before (a new skill is removed, an edited one gets
 * its old text back, the profile and routine their old fields). Nothing here asks less than before: the cards these tools
 * show after outside content (their gates) and the deterministic floor are untouched; only the after-the-fact Undo is new.
 * Like self_update's undo (tools-team.ts), which this mirrors for the other reversible settings.
 */
q.run("CREATE TABLE IF NOT EXISTS undo_actions (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, before TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)");

export const UNDO_WINDOW_MS = 24 * 3_600_000;
export type UndoKind = "profile" | "skill" | "routine" | /** memorymarks.ts: a note updated, or a tidy batch */ "memory";
type SkillBefore = { name: string; description: string; body: string } | null;
type RoutineBefore = Partial<{ name: string; prompt: string; schedule: string; timezone: string; enabled: boolean }>;

/** Writes the change's line with « Annuler » in the chat (the turn's conversation). `before`: null for a skill just created. */
export function offerUndo(bot: BotRecord, o: { kind: UndoKind; ref: string; before: Profile | SkillBefore | RoutineBefore | MemoryUndo; text: string; thread?: number }, at = Date.now()): string {
  const id = newId("und");
  q.run("INSERT INTO undo_actions (id, bot_id, kind, ref, before, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, bot.id, o.kind, o.ref, JSON.stringify(o.before), at, at + UNDO_WINDOW_MS);
  rows.append(bot, { kind: "notice", tone: "info", text: o.text, action: { kind: "undo", undoId: id, status: "pending", expiresAt: at + UNDO_WINDOW_MS } }, o.thread || undefined);
  return id;
}

/** « Annuler »: puts back the state from before the change. "done", or why not. */
export function undoChange(bot: BotRecord, undoId: string, at = Date.now()): "done" | "gone" | "expired" {
  const r = q.get<{ kind: UndoKind; ref: string; before: string; status: string; expires_at: number }>("SELECT kind, ref, before, status, expires_at FROM undo_actions WHERE id = ? AND bot_id = ?", undoId, bot.id);
  if (!r || r.status !== "pending") return "gone";
  if (r.expires_at < at) { q.run("UPDATE undo_actions SET status = 'expired' WHERE id = ?", undoId); return "expired"; }
  const before = JSON.parse(r.before) as unknown;
  if (r.kind === "profile") {
    const p = before as Profile;
    settings.saveProfile(bot.userId, { name: p.name, timezone: p.timezone, company: p.company, preferences: p.preferences });
    emit(bot.userId, { type: "profile" });
  } else if (r.kind === "skill") {
    const s = before as SkillBefore;
    if (!skills.list(bot.id).some((k) => k.id === r.ref)) return "gone";
    if (s) skills.update(r.ref, s); else skills.remove(r.ref);
    emit(bot.userId, { type: "memories", botId: bot.id });
  } else if (r.kind === "memory") {
    if (!memoryUndo(bot, before as MemoryUndo)) return "gone";
  } else {
    const cur = routines.byId(r.ref);
    if (!cur || cur.botId !== bot.id) return "gone";
    routines.update(r.ref, before as RoutineBefore);
    schedule(r.ref);
    emit(bot.userId, { type: "routines", botId: bot.id });
  }
  q.run("UPDATE undo_actions SET status = 'done' WHERE id = ?", undoId);
  audit(bot.userId, "account", `${bot.name}: change undone (${r.kind})`, bot.id);
  return "done";
}

/** The chat line of an undone (or expired) change is rewritten so its button goes away. */
export function settleUndoRow(bot: BotRecord, seq: number, status: "done" | "expired"): void {
  const row = rows.get(bot.id, bot.generation, seq);
  if (row?.body.kind === "notice" && row.body.action?.kind === "undo") rows.rewrite(bot, bot.generation, seq, { ...row.body, action: { ...row.body.action, status } });
}

/** The lines the tools write (French in i18n). */
export const undoText = {
  profile: (bot: BotRecord, fields: string[]) => tr(users.localeOf(bot.userId), "{bot} updated your shared profile ({fields}).", { bot: bot.name, fields: fields.join(", ") }),
  skill: (bot: BotRecord, name: string, created: boolean) => tr(users.localeOf(bot.userId), created ? "{bot} saved a new skill: {name}." : "{bot} changed its skill: {name}.", { bot: bot.name, name }),
  routine: (bot: BotRecord, name: string, paused: boolean) => tr(users.localeOf(bot.userId), paused ? "{bot} paused the routine {name}." : "{bot} changed the routine {name}.", { bot: bot.name, name }),
};
