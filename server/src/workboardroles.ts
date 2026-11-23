/**
 * « Tableau de travail », the rest of L163 (RESTE 23/11): a model per task, project roles, saved model sets, who really
 * runs a task, and the open decisions. See docs/TABLEAU.md.
 *
 * Clean room: built from docs/cleanroom/10-timon.md T10, T11 and T12 (and T6/T7 for « ce qui demande une décision ») only;
 * the studied product is AGPL-3.0: ideas only, none of its code was read. T9 (the lead's plan form in the chat) is not
 * built here.
 *
 *  - T10, the model a task runs on, most precise first: the task's own model, then its role's model, then the bot's own
 *    (and, after that, the bot's usual choices: conversation model, named mode — agent/workmodel.ts). Each level only
 *    fills what the level above left empty. A choice that cannot run (provider gone, another subscription engine) is
 *    ignored by workmodel.ts as for every other choice.
 *  - T12, who runs it: a bot pinned on the task's role takes every task of that kind; else the bot named on the task,
 *    unless it is the lead (the main bot) or holds ANOTHER role and the task's role has a holder — then the role's holder;
 *    else the role's holder; else nobody (it cannot start; said in the open decisions). No bot is created by itself.
 *    The card says « exécutée par X » and why.
 *  - T11, model sets: a named model per role, applied in one click; roles the set does not cover keep their choice; a
 *    model the account no longer has is skipped and named. At most 50 sets per account (stored on the server, so they
 *    follow the owner on every device).
 * Isolation: every row carries the owner's user id; a role's bot must be one of the owner's own agent bots.
 */
import { q } from "./db.js";
import { modelAvailable } from "./llm/index.js";
import { isEngineRef } from "./agent/engine.js";
import { bots, clip, newId, now } from "./store.js";
import { BOARD_ROLES, TASK_KINDS, type BoardDecision, type BoardModelSet, type BoardRole, type BoardRoleName, type TaskKind } from "./workboardtypes.js";

q.run(`CREATE TABLE IF NOT EXISTS board_task_meta (
  task_id TEXT PRIMARY KEY REFERENCES board_tasks(id) ON DELETE CASCADE, kind TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
  exec_reason TEXT NOT NULL DEFAULT '')`);
q.run(`CREATE TABLE IF NOT EXISTS board_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, bot_id TEXT, model TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, role))`);
q.run(`CREATE TABLE IF NOT EXISTS board_model_sets (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, models TEXT NOT NULL, created_at INTEGER NOT NULL)`);

export const MAX_MODEL_SETS = 50;

export class RoleError extends Error { constructor(public status: 400 | 404 | 409, message: string, public vars: Record<string, string | number> = {}) { super(message); } }
const bad = (m: string, vars: Record<string, string | number> = {}): never => { throw new RoleError(400, m, vars); };

const isKind = (k: unknown): k is TaskKind => (TASK_KINDS as readonly string[]).includes(String(k));
const isRole = (k: unknown): k is BoardRoleName => (BOARD_ROLES as readonly string[]).includes(String(k));
const usable = (ref: string, userId: string) => isEngineRef(ref) || modelAvailable(ref, userId);
function cleanModel(raw: unknown, userId: string): string {
  const ref = String(raw ?? "").trim();
  if (!ref) return "";
  return usable(ref, userId) ? clip(ref, 200) : bad("That model is not available on your account: {model}.", { model: clip(ref, 80) });
}

// ── Task meta (kind, model) ─────────────────────────────────────────────────────────────────────────────────────
interface MetaRow { task_id: string; kind: string; model: string; exec_reason: string }
const metaOf = (taskId: string) => q.get<MetaRow>("SELECT * FROM board_task_meta WHERE task_id = ?", taskId) ?? { task_id: taskId, kind: "", model: "", exec_reason: "" };
function writeMeta(m: MetaRow) {
  q.run("INSERT INTO board_task_meta (task_id, kind, model, exec_reason) VALUES (?, ?, ?, ?) ON CONFLICT(task_id) DO UPDATE SET kind = excluded.kind, model = excluded.model, exec_reason = excluded.exec_reason", m.task_id, m.kind, m.model, m.exec_reason);
}
/** Create / update a task's kind and model (fields absent: unchanged). Checked before anything is written by the caller. */
export function checkMeta(userId: string, o: { kind?: unknown; model?: unknown }): { kind?: string; model?: string } {
  const out: { kind?: string; model?: string } = {};
  if (o.kind !== undefined) out.kind = o.kind === "" || o.kind === null ? "" : isKind(o.kind) ? String(o.kind) : bad("Unknown task kind.");
  if (o.model !== undefined) out.model = cleanModel(o.model, userId);
  return out;
}
export function setMeta(taskId: string, m: { kind?: string; model?: string }) {
  if (m.kind === undefined && m.model === undefined) return;
  const cur = metaOf(taskId);
  writeMeta({ ...cur, ...(m.kind !== undefined ? { kind: m.kind } : {}), ...(m.model !== undefined ? { model: m.model } : {}) });
}

// ── Roles ─────────────────────────────────────────────────────────────────────────────────────────────────────
interface RoleRow { user_id: string; role: string; bot_id: string | null; model: string; pinned: number }
const roleRow = (userId: string, role: string) => q.get<RoleRow>("SELECT * FROM board_roles WHERE user_id = ? AND role = ?", userId, role);
/** The lead: the bot set on the « lead » role, else the account's main bot. */
export function leadOf(userId: string): string | null { return roleRow(userId, "lead")?.bot_id ?? bots.primary(userId)?.id ?? null; }

export const roles = {
  list(userId: string): BoardRole[] {
    return BOARD_ROLES.map((role) => { const r = roleRow(userId, role); return { role, botId: role === "lead" ? leadOf(userId) : r?.bot_id ?? null, model: r?.model ?? "", pinned: !!r?.pinned }; });
  },
  set(userId: string, role: unknown, o: { botId?: unknown; model?: unknown; pinned?: unknown }): BoardRole[] {
    if (!isRole(role)) throw new RoleError(404, "Unknown role.");
    const cur = roleRow(userId, role) ?? { user_id: userId, role, bot_id: null, model: "", pinned: 0 };
    let botId = cur.bot_id;
    if (o.botId !== undefined) {
      if (o.botId === null || o.botId === "") botId = null;
      else { const b = bots.owned(userId, String(o.botId)); if (!b || b.kind !== "agent") bad("That bot is not one of yours."); botId = b!.id; }
    }
    const model = o.model !== undefined ? cleanModel(o.model, userId) : cur.model;
    const pinned = o.pinned !== undefined ? (o.pinned ? 1 : 0) : cur.pinned;
    if (pinned && !botId) bad("Choose the bot of this role before pinning it.");
    q.run("INSERT INTO board_roles (user_id, role, bot_id, model, pinned, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, role) DO UPDATE SET bot_id = excluded.bot_id, model = excluded.model, pinned = excluded.pinned, updated_at = excluded.updated_at",
      userId, role, botId, model, role === "lead" ? 0 : pinned, now());
    return roles.list(userId);
  },
};

// ── T12: who runs a task; T10: on which model ───────────────────────────────────────────────────────────────────
export type ExecReason = "pinned" | "named" | "role" | "lead-redirected" | "other-role" | "none";
export interface Executor { botId: string | null; reason: ExecReason; role: string }
export function executorFor(t: { id: string; user_id: string; bot_id: string | null }): Executor {
  const kind = metaOf(t.id).kind;
  const role = kind ? roleRow(t.user_id, kind) : undefined;
  const holder = role?.bot_id && bots.owned(t.user_id, role.bot_id)?.kind === "agent" ? role.bot_id : null;
  if (holder && role?.pinned) return { botId: holder, reason: "pinned", role: kind };
  if (t.bot_id) {
    if (holder && holder !== t.bot_id) {
      if (t.bot_id === leadOf(t.user_id)) return { botId: holder, reason: "lead-redirected", role: kind };
      const other = q.get<{ role: string }>("SELECT role FROM board_roles WHERE user_id = ? AND bot_id = ? AND role != ? AND role != 'lead' LIMIT 1", t.user_id, t.bot_id, kind);
      if (other) return { botId: holder, reason: "other-role", role: kind };
    }
    return { botId: t.bot_id, reason: "named", role: kind };
  }
  return holder ? { botId: holder, reason: "role", role: kind } : { botId: null, reason: "none", role: kind };
}
/** Records who runs it and why (called when it starts). */
export function noteExecutor(taskId: string, e: Executor) { writeMeta({ ...metaOf(taskId), exec_reason: e.reason }); }

/** T10: the task's model, else its role's, else "" (the bot's own choices apply). */
export function taskModelOf(t: { id: string; user_id: string }): { model: string; from: "task" | "role" | "bot" } {
  const m = metaOf(t.id);
  if (m.model) return { model: m.model, from: "task" };
  const r = m.kind ? roleRow(t.user_id, m.kind) : undefined;
  return r?.model ? { model: r.model, from: "role" } : { model: "", from: "bot" };
}
/** For agent/workmodel.ts: the board model of a goal's round, or "" (not a board task, or no model set). */
export function boardModelForGoal(goalId: string | undefined): string {
  if (!goalId) return "";
  const t = q.get<{ id: string; user_id: string }>("SELECT id, user_id FROM board_tasks WHERE goal_id = ?", goalId);
  return t ? taskModelOf(t).model : "";
}

/** What a task card shows (kind, model and where it comes from, who runs it and why). */
export function taskMetaView(t: { id: string; user_id: string; bot_id: string | null; state: string }) {
  const m = metaOf(t.id);
  const e = executorFor(t);
  const mod = taskModelOf(t);
  return { kind: (isKind(m.kind) ? m.kind : "") as TaskKind | "", model: m.model, runModel: mod.model, modelFrom: mod.from, executorId: e.botId, execReason: (t.state === "waiting" ? e.reason : (m.exec_reason || e.reason)) as ExecReason };
}

// ── T11: model sets ──────────────────────────────────────────────────────────────────────────────────────────────
const toSet = (r: { id: string; name: string; models: string; created_at: number }): BoardModelSet => ({ id: r.id, name: r.name, models: JSON.parse(r.models), createdAt: r.created_at });
export const modelSets = {
  list: (userId: string) => q.all<any>("SELECT * FROM board_model_sets WHERE user_id = ? ORDER BY created_at", userId).map(toSet),
  save(userId: string, name: unknown, models: unknown): BoardModelSet {
    if (q.get<{ n: number }>("SELECT COUNT(*) AS n FROM board_model_sets WHERE user_id = ?", userId)!.n >= MAX_MODEL_SETS) throw new RoleError(409, "At most {n} model sets: delete one first.", { n: MAX_MODEL_SETS });
    const n = clip(String(name ?? "").replace(/\s+/g, " ").trim(), 60) || bad("Give the set a name.");
    const src = models && typeof models === "object" && !Array.isArray(models) ? (models as Record<string, unknown>) : bad("Give a model for at least one role.");
    const clean: Record<string, string> = {};
    for (const [role, ref] of Object.entries(src)) { if (!isRole(role)) bad("Unknown role."); const m = String(ref ?? "").trim(); if (m) clean[role] = clip(m, 200); }
    if (!Object.keys(clean).length) bad("Give a model for at least one role.");
    const id = newId("bms");
    q.run("INSERT INTO board_model_sets (id, user_id, name, models, created_at) VALUES (?, ?, ?, ?, ?)", id, userId, n, JSON.stringify(clean), now());
    return toSet(q.get<any>("SELECT * FROM board_model_sets WHERE id = ?", id));
  },
  remove(userId: string, id: string) { if (!q.run("DELETE FROM board_model_sets WHERE id = ? AND user_id = ?", id, userId).changes) throw new RoleError(404, "That model set does not exist."); },
  /** Fills the roles the set covers; a model the account no longer has is skipped and named. */
  apply(userId: string, id: string): { roles: BoardRole[]; applied: string[]; skipped: { role: string; model: string }[] } {
    const r = q.get<any>("SELECT * FROM board_model_sets WHERE id = ? AND user_id = ?", id, userId);
    if (!r) throw new RoleError(404, "That model set does not exist.");
    const applied: string[] = [], skipped: { role: string; model: string }[] = [];
    for (const [role, model] of Object.entries(toSet(r).models)) {
      if (!usable(model, userId)) { skipped.push({ role, model }); continue; }
      roles.set(userId, role, { model });
      applied.push(role);
    }
    return { roles: roles.list(userId), applied, skipped };
  },
};

// ── Open decisions (T6/T7: « ce qui demande une décision » toujours visible) ────────────────────────────────────────
export function openDecisions(userId: string): BoardDecision[] {
  const out: BoardDecision[] = [];
  for (const t of q.all<{ id: string; user_id: string; title: string; state: string; note: string; bot_id: string | null; armed: number; priority: number; chantier_id: string | null }>(
    "SELECT id, user_id, title, state, note, bot_id, armed, priority, chantier_id FROM board_tasks WHERE user_id = ? AND (state IN ('review', 'blocked') OR (state = 'waiting' AND armed = 1)) ORDER BY priority, created_at", userId)) {
    if (t.state === "review") out.push({ taskId: t.id, title: t.title, kind: "review", why: "" });
    else if (t.state === "blocked") out.push({ taskId: t.id, title: t.title, kind: "blocked", why: t.note });
    else if (!t.chantier_id && !executorFor(t).botId) out.push({ taskId: t.id, title: t.title, kind: "nobody", why: "" });
  }
  return out.slice(0, 50);
}
