/**
 * « Tableau de travail » (L163): durable tasks with dependencies that wait for the REAL result, attachments, priority, a
 * start date, a kanban view, and an idea notebook whose ideas can be promoted (once) into tasks. See docs/TABLEAU.md.
 *
 * Clean room: built from docs/cleanroom/10-timon.md (T1 to T8) only (the studied product is AGPL-3.0: ideas only,
 * none of its code was read).
 *
 * It does not duplicate the rest of Sklubot:
 *  - a task RUNS as a goal (agent/goals.ts) of its bot, in its own thread — the same rounds, approvals, round cap, pause
 *    and evidence as any goal; this module only listens to the goal's end (onGoalStatus, origin "board");
 *  - a task may FOLLOW a « Chantier » (chantiers.ts): it is done when that chantier is done; the chantier keeps its own
 *    graph, checks and repairs.
 *
 * « Le vrai résultat » (T3): a dependency counts only once the task it waits on is `done`. A goal that ends « complete »
 * makes a task done only when its acceptance is "auto"; with "owner" the task goes to « à relire » and waits for the
 * owner's « Accepter » (« À corriger » sends it back with the owner's note). A blocked, stopped or refused task never
 * releases what waits on it.
 *
 * Isolation: every row carries the owner's user id; every read goes through `owned(userId, id)`; a task's bot must be
 * one of that owner's own agent bots. Nothing here reads another account's data. Tables are created at load (house pattern).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"; import type { Locale } from "./shared.js";
import path from "node:path";
import { config } from "./config.js";
import { q } from "./db.js";
import { botPathOf, storeBytes } from "./computer.js";
import { createGoal, goalAction, goalRoundPrompt, goals, onGoalStatus, type GoalRecord } from "./agent/goals.js";
import { enqueue } from "./agent/loop.js";
import { chantiers } from "./chantiers.js";
import { emitInternal } from "./internalevents.js";
import { audit, bots, clip, newId, now, rows, users, type BotRecord } from "./store.js";
import { wt } from "./worki18n.js"; import { languageName } from "./clientshared/locales.js";
import {
  ACCEPTANCES, BOARD_STATES, IDEA_PROGRESS, IDEA_URGENCIES,
  type Acceptance, type BoardFile, type BoardIdea, type BoardState, type BoardTask, type BoardView, type IdeaProgress, type IdeaUrgency, type RecapItem,
} from "./workboardtypes.js";
import { checkMeta, executorFor, modelSets, noteExecutor, openDecisions, roles, setMeta, taskMetaView } from "./workboardroles.js";
import { deliveryBrief, deliveryView, interceptDone, onDeliveryEnd, sweepDeliveries } from "./workboardpr.js";

q.run(`CREATE TABLE IF NOT EXISTS board_tasks (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  bot_id TEXT, priority INTEGER NOT NULL DEFAULT 3, start_at INTEGER, state TEXT NOT NULL DEFAULT 'waiting', acceptance TEXT NOT NULL DEFAULT 'auto',
  armed INTEGER NOT NULL DEFAULT 0, goal_id TEXT, chantier_id TEXT, idea_id TEXT, thread INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '', batch TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  started_at INTEGER, ended_at INTEGER)`);
q.run("CREATE INDEX IF NOT EXISTS board_tasks_user ON board_tasks(user_id, created_at)");
q.run(`CREATE TABLE IF NOT EXISTS board_deps (
  task_id TEXT NOT NULL REFERENCES board_tasks(id) ON DELETE CASCADE, dep_id TEXT NOT NULL REFERENCES board_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, dep_id))`);
q.run(`CREATE TABLE IF NOT EXISTS board_files (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL,
  name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, added_at INTEGER NOT NULL)`);
q.run("CREATE INDEX IF NOT EXISTS board_files_owner ON board_files(owner_kind, owner_id)");
q.run(`CREATE TABLE IF NOT EXISTS board_ideas (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, number INTEGER NOT NULL, author TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', urgency TEXT NOT NULL DEFAULT 'idea', progress TEXT NOT NULL DEFAULT 'todo',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
q.run("CREATE UNIQUE INDEX IF NOT EXISTS board_ideas_number ON board_ideas(user_id, number)");

// ── Limits (T1, T4 « valeurs relevées ») ────────────────────────────────────────────────────────────────────────────
export const MAX_FILES = 20;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
/** All board files of one account (tasks and ideas together). */
export const ACCOUNT_FILE_BYTES = 300 * 1024 * 1024;
export const MAX_TASKS = 500;
export const IDEAS_PAGE = 200;
export const IDEAS_PAGE_MAX = 1000;
/** A start date further than this gives a warning (never a refusal). */
export const FAR_START_MS = 18 * 3600_000;
/** Up to 3 tasks of the board at the same time per bot (owner decision). */
export const PER_BOT_RUNNING = 3;

export class BoardError extends Error { constructor(public status: 400 | 404 | 409 | 413, message: string, public vars: Record<string, string | number> = {}) { super(message); } }
const bad = (message: string, vars: Record<string, string | number> = {}): never => { throw new BoardError(400, message, vars); };

// ── Start date (T1 v2) ───────────────────────────────────────────────────────────────────────────────────────────
/**
 * A start date is an absolute time: milliseconds since 1970, or an ISO date-time WITH its time zone. A number that looks
 * like seconds, or free text, is refused (never read as "now"). Returns the time and a warning for a far date.
 */
export function cleanStartAt(raw: unknown, at = now()): { startAt: number | null; warning: string } {
  if (raw === undefined || raw === null || raw === "") return { startAt: null, warning: "" };
  let t: number;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) bad("The start date must be a whole number of milliseconds.");
    if (raw < 100_000_000_000) bad("That start date looks like seconds, not milliseconds: nothing was scheduled. Give the date and time.");
    t = raw;
  } else if (typeof raw === "string") {
    const s = raw.trim();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s)) bad("Give the start date as a date and time with its time zone (for example 2026-11-23T09:00+01:00). Nothing was scheduled.");
    t = Date.parse(s);
    if (!Number.isFinite(t)) bad("Give the start date as a date and time with its time zone (for example 2026-11-23T09:00+01:00). Nothing was scheduled.");
  } else return bad("Give the start date as a date and time with its time zone (for example 2026-11-23T09:00+01:00). Nothing was scheduled.");
  return { startAt: t, warning: t - at > FAR_START_MS ? "This task starts in more than 18 hours." : "" };
}

// ── Attachments (T1): what is accepted, checked on its content ───────────────────────────────────────────────────
const REFUSED: [RegExp, string][] = [
  [/^(html?|xhtml|svg|mht|mhtml|xml)$/, "web pages are not accepted (they can run code when opened)"],
  [/^(js|mjs|cjs|ts|sh|bash|zsh|py|rb|pl|php|bat|cmd|ps1|vbs|lua|jsx|tsx)$/, "scripts are not accepted"],
  [/^(zip|rar|7z|tar|gz|tgz|bz2|xz|zst|cab|iso)$/, "archives are not accepted (send the files themselves)"],
  [/^(exe|msi|dmg|pkg|app|apk|ipa|jar|deb|rpm|bin|com|scr|dll|so|dylib)$/, "programs are not accepted"],
];
const isText = (b: Buffer) => !b.includes(0) && Buffer.from(b.toString("utf8"), "utf8").equals(b);
const zipped = (b: Buffer) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
const ooxml = (b: Buffer) => zipped(b) && b.subarray(0, 4096).includes("[Content_Types].xml");
const odf = (b: Buffer) => zipped(b) && b.subarray(30, 90).toString("latin1").startsWith("mimetypeapplication/vnd.oasis");
const ole = (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
const KINDS: Record<string, { type: string; ok: (b: Buffer) => boolean }> = {
  png: { type: "image/png", ok: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpg: { type: "image/jpeg", ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { type: "image/jpeg", ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  gif: { type: "image/gif", ok: (b) => b.subarray(0, 4).toString("latin1") === "GIF8" },
  webp: { type: "image/webp", ok: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
  pdf: { type: "application/pdf", ok: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  docx: { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ok: ooxml },
  xlsx: { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ok: ooxml },
  pptx: { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ok: ooxml },
  odt: { type: "application/vnd.oasis.opendocument.text", ok: odf },
  ods: { type: "application/vnd.oasis.opendocument.spreadsheet", ok: odf },
  odp: { type: "application/vnd.oasis.opendocument.presentation", ok: odf },
  doc: { type: "application/msword", ok: ole },
  xls: { type: "application/vnd.ms-excel", ok: ole },
  ppt: { type: "application/vnd.ms-powerpoint", ok: ole },
  txt: { type: "text/plain", ok: isText },
  md: { type: "text/markdown", ok: isText },
  csv: { type: "text/csv", ok: isText },
  json: { type: "application/json", ok: isText },
};
export const ACCEPTED_EXTENSIONS = Object.keys(KINDS);

/** A file's name, cleaned (no folders, no control characters), at most 120 characters. */
export const cleanFileName = (raw: string) => clip(String(raw ?? "").split(/[\\/]/).pop()!.replace(/[\u0000-\u001f<>:"|?*]/g, "").trim(), 120);

/** Why this file is refused, or its MIME type. Its content must match the type its name declares. */
export function judgeFile(name: string, bytes: Buffer): { type: string } | { refused: string } {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
  if (!name || !ext) return { refused: "the file needs a name with its type (.pdf, .png, .docx…)" };
  for (const [re, why] of REFUSED) if (re.test(ext)) return { refused: why };
  const k = KINDS[ext];
  if (!k) return { refused: "this type of file is not accepted (images, office documents, PDF and text only)" };
  if (!bytes.length) return { refused: "the file is empty" };
  if (bytes.length > MAX_FILE_BYTES) return { refused: "the file is larger than 15 MB" };
  if (!k.ok(bytes)) return { refused: "its content does not match its type" };
  return { type: k.type };
}

const fileDir = (userId: string, kind: "task" | "idea", ownerId: string) => path.join(config.dataDir, "board", userId, `${kind}-${ownerId}`);
const toFile = (r: any): BoardFile => ({ id: r.id, name: r.name, type: r.type, size: r.size, addedAt: r.added_at });
const filesOf = (kind: "task" | "idea", ownerId: string) => q.all<any>("SELECT * FROM board_files WHERE owner_kind = ? AND owner_id = ? ORDER BY added_at, rowid", kind, ownerId).map(toFile);

function saveFile(userId: string, kind: "task" | "idea", ownerId: string, rawName: string, bytes: Buffer): BoardFile {
  const name = cleanFileName(rawName);
  const verdict = judgeFile(name, bytes);
  if ("refused" in verdict) throw new BoardError(bytes.length > MAX_FILE_BYTES ? 413 : 400, "“{name}” was not added: {why}.", { name: name || "?", why: verdict.refused });
  const have = filesOf(kind, ownerId);
  if (have.length >= MAX_FILES) throw new BoardError(409, "At most {n} files per card.", { n: MAX_FILES });
  if (have.reduce((s, f) => s + f.size, 0) + bytes.length > MAX_TOTAL_BYTES) throw new BoardError(413, "At most 100 MB of files per card.");
  const used = q.get<{ n: number }>("SELECT COALESCE(SUM(size), 0) AS n FROM board_files WHERE user_id = ?", userId)!.n;
  if (used + bytes.length > ACCOUNT_FILE_BYTES) throw new BoardError(413, "The board's files of this account are full (300 MB): remove some first.");
  const id = newId("bf");
  const dir = fileDir(userId, kind, ownerId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, id), bytes, { mode: 0o600 });
  q.run("INSERT INTO board_files (id, user_id, owner_kind, owner_id, name, type, size, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, userId, kind, ownerId, name, verdict.type, bytes.length, now());
  return toFile(q.get("SELECT * FROM board_files WHERE id = ?", id));
}
const readFile = (userId: string, kind: "task" | "idea", ownerId: string, id: string) => readFileSync(path.join(fileDir(userId, kind, ownerId), id));
function dropFiles(userId: string, kind: "task" | "idea", ownerId: string) {
  q.run("DELETE FROM board_files WHERE owner_kind = ? AND owner_id = ?", kind, ownerId);
  rmSync(fileDir(userId, kind, ownerId), { recursive: true, force: true });
}

// ── Records ────────────────────────────────────────────────────────────────────────────────────────────────────────
interface TaskRow {
  id: string; user_id: string; title: string; description: string; bot_id: string | null; priority: number; start_at: number | null; state: string;
  acceptance: string; armed: number; goal_id: string | null; chantier_id: string | null; idea_id: string | null; thread: number; note: string; summary: string;
  batch: string; created_at: number; updated_at: number; started_at: number | null; ended_at: number | null;
}
const taskRow = (id: string) => q.get<TaskRow>("SELECT * FROM board_tasks WHERE id = ?", id);
const ownedRow = (userId: string, id: string) => { const r = taskRow(id); return r && r.user_id === userId ? r : null; };
const depsOf = (id: string) => q.all<{ dep_id: string }>("SELECT dep_id FROM board_deps WHERE task_id = ? ORDER BY rowid", id).map((r) => r.dep_id);
const dependentsOf = (id: string) => q.all<{ task_id: string }>("SELECT task_id FROM board_deps WHERE dep_id = ? ORDER BY rowid", id).map((r) => r.task_id);
const isState = (s: string): s is BoardState => (BOARD_STATES as readonly string[]).includes(s);

function toTask(r: TaskRow): BoardTask {
  const deps = depsOf(r.id);
  return {
    id: r.id, title: r.title, description: r.description, botId: r.bot_id, priority: r.priority, startAt: r.start_at, deps,
    dependents: dependentsOf(r.id), waitingOn: deps.filter((d) => taskRow(d)?.state !== "done"), files: filesOf("task", r.id),
    // T1: a state this version does not know shows in « done », and is never rewritten.
    state: r.state, column: isState(r.state) ? r.state : "done", acceptance: r.acceptance === "owner" ? "owner" : "auto", armed: !!r.armed,
    goalId: r.goal_id, chantierId: r.chantier_id, ideaId: r.idea_id, thread: r.thread, note: r.note, summary: r.summary, batch: r.batch,
    createdAt: r.created_at, updatedAt: r.updated_at, startedAt: r.started_at, endedAt: r.ended_at, ...taskMetaView(r), delivery: deliveryView(r.id), // L163 T10/T12 (workboardroles.ts); L175 pull request (workboardpr.ts)
  };
}

const COLS: Record<string, string> = { title: "title", description: "description", botId: "bot_id", priority: "priority", startAt: "start_at", state: "state", acceptance: "acceptance", armed: "armed", goalId: "goal_id", chantierId: "chantier_id", ideaId: "idea_id", thread: "thread", note: "note", summary: "summary", batch: "batch", startedAt: "started_at", endedAt: "ended_at" };
function setTask(id: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch).filter((k) => COLS[k]);
  if (!keys.length) return;
  q.run(`UPDATE board_tasks SET ${keys.map((k) => `${COLS[k]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, ...keys.map((k) => (typeof patch[k] === "boolean" ? (patch[k] ? 1 : 0) : patch[k] ?? null)) as never[], now(), id);
}

/** Would `taskId` waiting on `deps` close a loop? */
function makesCycle(taskId: string, deps: string[]): boolean {
  const seen = new Set<string>();
  const stack = [...deps];
  while (stack.length) {
    const d = stack.pop()!;
    if (d === taskId) return true;
    if (seen.has(d)) continue;
    seen.add(d);
    stack.push(...depsOf(d));
  }
  return false;
}

const ownAgent = (userId: string, botId: unknown): BotRecord | null => {
  if (botId === null || botId === undefined || botId === "") return null;
  const b = bots.owned(userId, String(botId));
  return b && b.kind === "agent" ? b : bad("That bot is not one of yours.");
};
const cleanTitle = (raw: unknown) => clip(String(raw ?? "").replace(/\s+/g, " ").trim(), 160) || bad("Give the task a title.");
const cleanPriority = (raw: unknown) => { const n = Number(raw ?? 3); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : bad("The priority goes from 1 (most urgent) to 5."); };
const cleanAcceptance = (raw: unknown): Acceptance => (raw === undefined ? "auto" : (ACCEPTANCES as readonly string[]).includes(String(raw)) ? (raw as Acceptance) : bad("Unknown acceptance."));

function cleanDeps(userId: string, taskId: string, raw: unknown): string[] {
  if (raw === undefined) return depsOf(taskId);
  const list = Array.isArray(raw) ? [...new Set(raw.map(String))] : bad("The dependencies must be a list.");
  if (list.length > 20) bad("At most 20 dependencies per task.");
  for (const d of list) if (d === taskId || !ownedRow(userId, d)) bad("A dependency is not one of your tasks.");
  if (makesCycle(taskId, list)) bad("These dependencies would make a loop (a task would wait on itself).");
  return list;
}

export interface TaskInput { title?: unknown; description?: unknown; botId?: unknown; priority?: unknown; startAt?: unknown; deps?: unknown; acceptance?: unknown; chantierId?: unknown; ideaId?: unknown; kind?: unknown; model?: unknown }

export const board = {
  view(userId: string, ideaLimit = IDEAS_PAGE): BoardView {
    syncLinked(userId);
    const tasks = q.all<TaskRow>("SELECT * FROM board_tasks WHERE user_id = ? ORDER BY priority, created_at", userId).map(toTask);
    return { tasks, ideas: ideas.list(userId, ideaLimit), roles: roles.list(userId), modelSets: modelSets.list(userId), decisions: openDecisions(userId) };
  },
  get: (userId: string, id: string) => { const r = ownedRow(userId, id); return r ? toTask(r) : null; },

  create(userId: string, o: TaskInput & { batch?: string }): { task: BoardTask; warning: string } {
    if (q.get<{ n: number }>("SELECT COUNT(*) AS n FROM board_tasks WHERE user_id = ?", userId)!.n >= MAX_TASKS) throw new BoardError(409, "At most {n} tasks on the board: delete finished ones first.", { n: MAX_TASKS });
    const title = cleanTitle(o.title);
    const bot = ownAgent(userId, o.botId);
    const { startAt, warning } = cleanStartAt(o.startAt);
    const chantierId = o.chantierId ? (chantiers.owned(userId, String(o.chantierId))?.id ?? bad("That chantier is not one of yours.")) : null;
    const ideaId = o.ideaId ? (ideaRow(userId, String(o.ideaId)) ?? notFound()).id : null;
    if (ideaId && ideaRow(userId, ideaId)!.progress === "done") throw new BoardError(409, "A done idea is never reopened: write a new one.");
    const meta = metaInput(userId, o); const id = newId("bt");
    const t = now();
    q.tx(() => {
      q.run("INSERT INTO board_tasks (id, user_id, title, description, bot_id, priority, start_at, acceptance, chantier_id, idea_id, batch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id, userId, title, clip(String(o.description ?? "").trim(), 20_000), bot?.id ?? null, cleanPriority(o.priority), startAt, cleanAcceptance(o.acceptance), chantierId, ideaId, o.batch ?? "", t, t);
      for (const d of cleanDeps(userId, id, o.deps ?? [])) q.run("INSERT INTO board_deps (task_id, dep_id) VALUES (?, ?)", id, d);
      setMeta(id, meta);
    });
    return { task: toTask(taskRow(id)!), warning };
  },

  update(userId: string, id: string, o: TaskInput): { task: BoardTask; warning: string } {
    const r = ownedRow(userId, id) ?? notFound();
    const patch: Record<string, unknown> = {};
    let warning = "";
    if (o.title !== undefined) patch.title = cleanTitle(o.title);
    if (o.description !== undefined) patch.description = clip(String(o.description ?? "").trim(), 20_000);
    if (o.priority !== undefined) patch.priority = cleanPriority(o.priority);
    if (o.acceptance !== undefined) patch.acceptance = cleanAcceptance(o.acceptance);
    if (o.botId !== undefined) {
      if (r.state === "running" || r.state === "review") throw new BoardError(409, "This task is under way: stop it before giving it to another bot.");
      patch.botId = ownAgent(userId, o.botId)?.id ?? null;
    }
    if (o.startAt !== undefined) { const s = cleanStartAt(o.startAt); patch.startAt = s.startAt; warning = s.warning; }
    const deps = o.deps !== undefined ? cleanDeps(userId, id, o.deps) : null;
    const meta = metaInput(userId, o);
    q.tx(() => {
      setTask(id, patch); setMeta(id, meta);
      if (deps) { q.run("DELETE FROM board_deps WHERE task_id = ?", id); for (const d of deps) q.run("INSERT INTO board_deps (task_id, dep_id) VALUES (?, ?)", id, d); }
    });
    return { task: toTask(taskRow(id)!), warning };
  },

  /** T8: a task is deleted only when nothing depends on it and it is not under way; its files go with it. */
  remove(userId: string, id: string) {
    const r = ownedRow(userId, id) ?? notFound();
    if (r.state === "running" || r.state === "review" || r.state === "delivering") throw new BoardError(409, "“{title}” is under way: stop it first.", { title: r.title });
    const waiting = dependentsOf(id).map((d) => taskRow(d)?.title ?? "?");
    if (waiting.length) throw new BoardError(409, "“{title}” cannot be deleted: {list} wait(s) on it. Remove that link first.", { title: r.title, list: waiting.map((t) => `« ${t} »`).join(", ") });
    q.run("DELETE FROM board_tasks WHERE id = ?", id);
    dropFiles(userId, "task", id);
    if (r.idea_id) ideas.recompute(userId, r.idea_id);
  },

  addFile: (userId: string, id: string, name: string, bytes: Buffer) => { ownedRow(userId, id) ?? notFound(); return saveFile(userId, "task", id, name, bytes); },
  removeFile(userId: string, id: string, fileId: string) {
    ownedRow(userId, id) ?? notFound();
    const n = q.run("DELETE FROM board_files WHERE id = ? AND owner_kind = 'task' AND owner_id = ?", fileId, id).changes;
    if (!n) notFound();
    rmSync(path.join(fileDir(userId, "task", id), fileId), { force: true });
  },
  fileBytes(userId: string, kind: "task" | "idea", ownerId: string, fileId: string): { file: BoardFile; bytes: Buffer } | null {
    const r = q.get<any>("SELECT * FROM board_files WHERE id = ? AND owner_kind = ? AND owner_id = ? AND user_id = ?", fileId, kind, ownerId, userId);
    return r ? { file: toFile(r), bytes: readFile(userId, kind, ownerId, fileId) } : null;
  },

  /** « Lancer »: the task starts by itself as soon as what it waits on is done and its date has come. */
  launch(userId: string, ids: string[]): BoardTask[] {
    const batch = ids.length > 1 ? newId("bb") : "";
    const out: BoardTask[] = [];
    for (const id of ids) {
      const r = ownedRow(userId, id) ?? notFound();
      if (!r.bot_id && !r.chantier_id && !executorFor(r).botId) throw new BoardError(400, "“{title}” has no bot: choose who does it first.", { title: r.title }); // L163 T12: or a role that has one
      if (r.state === "done") throw new BoardError(409, "“{title}” is already done.", { title: r.title });
      setTask(id, { armed: true, ...(batch ? { batch } : {}), ...(r.state === "blocked" ? { state: "waiting", note: "" } : {}) });
      out.push(toTask(taskRow(id)!));
    }
    sweep(userId);
    return out.map((t) => toTask(taskRow(t.id)!));
  },

  /** The owner stops a task: its goal is stopped, the work done so far stays in the bot's thread. */
  stop(userId: string, id: string): BoardTask {
    const r = ownedRow(userId, id) ?? notFound();
    const g = r.goal_id ? goals.byId(r.goal_id) : null;
    setTask(id, { armed: false, state: r.state === "done" ? "done" : "waiting", note: r.state === "running" ? wt(users.localeOf(userId), "stopped by you") : r.note });
    if (g && ["active", "paused", "proposed"].includes(g.status)) { const b = bots.byId(g.botId); if (b) try { goalAction(b, g.id, "stop"); } catch { /* already ended */ } }
    return toTask(taskRow(id)!);
  },

  /** « Accepter » on a task waiting for review: it is done, and what waits on it may start. */
  accept(userId: string, id: string): BoardTask {
    const r = ownedRow(userId, id) ?? notFound();
    if (r.state !== "review") throw new BoardError(409, "Only a task waiting for your review can be accepted.");
    finish(r, "done", r.summary, wt(users.localeOf(userId), "accepted by you"));
    return toTask(taskRow(id)!);
  },
  /** « À corriger »: back to the bot with the owner's note; what waits on it keeps waiting. */
  reject(userId: string, id: string, note: string): BoardTask {
    const r = ownedRow(userId, id) ?? notFound();
    if (r.state !== "review") throw new BoardError(409, "Only a task waiting for your review can be sent back.");
    const why = clip(String(note ?? "").trim(), 2000) || bad("Say what to fix.");
    setTask(id, { state: "waiting", armed: true, note: why, endedAt: null });
    sweep(userId);
    return toTask(taskRow(id)!);
  },
};
const notFound = (): never => { throw new BoardError(404, "That card does not exist."); };
/** L163: a task's kind and model, checked before anything is written (workboardroles.ts); its errors read as the board's. */
function metaInput(userId: string, o: TaskInput) {
  try { return checkMeta(userId, o); } catch (e) { const err = e as { status?: number; message: string; vars?: Record<string, string | number> }; throw new BoardError((err.status ?? 400) as 400, err.message, err.vars ?? {}); }
}

// ── Ideas (T4) ────────────────────────────────────────────────────────────────────────────────────────────────────
interface IdeaRow { id: string; user_id: string; number: number; author: string; title: string; body: string; urgency: string; progress: string; created_at: number; updated_at: number }
const ideaRow = (userId: string, id: string) => q.get<IdeaRow>("SELECT * FROM board_ideas WHERE id = ? AND user_id = ?", id, userId);
function toIdea(r: IdeaRow): BoardIdea {
  const linked = q.all<{ id: string; state: string }>("SELECT id, state FROM board_tasks WHERE idea_id = ? AND user_id = ?", r.id, r.user_id);
  return {
    id: r.id, number: r.number, author: r.author, title: r.title, body: r.body, urgency: (IDEA_URGENCIES as readonly string[]).includes(r.urgency) ? (r.urgency as IdeaUrgency) : "idea",
    progress: (IDEA_PROGRESS as readonly string[]).includes(r.progress) ? (r.progress as IdeaProgress) : "todo", files: filesOf("idea", r.id),
    taskIds: linked.map((t) => t.id), done: linked.filter((t) => t.state === "done").length, total: linked.length, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export const ideas = {
  list: (userId: string, limit = IDEAS_PAGE) => q.all<IdeaRow>("SELECT * FROM board_ideas WHERE user_id = ? ORDER BY number DESC LIMIT ?", userId, Math.min(IDEAS_PAGE_MAX, Math.max(1, limit))).map(toIdea),
  get: (userId: string, id: string) => { const r = ideaRow(userId, id); return r ? toIdea(r) : null; },
  /** Adding an idea orders nothing: no bot, no model call. */
  create(userId: string, o: { title?: unknown; body?: unknown; urgency?: unknown; author?: string }): BoardIdea {
    const title = clip(String(o.title ?? "").replace(/\s+/g, " ").trim(), 160) || bad("Write the idea in a few words.");
    const urgency = o.urgency === undefined ? "idea" : (IDEA_URGENCIES as readonly string[]).includes(String(o.urgency)) ? String(o.urgency) : bad("Unknown urgency.");
    const id = newId("bi");
    const t = now();
    q.tx(() => {
      const n = (q.get<{ n: number }>("SELECT COALESCE(MAX(number), 0) AS n FROM board_ideas WHERE user_id = ?", userId)!.n) + 1;
      q.run("INSERT INTO board_ideas (id, user_id, number, author, title, body, urgency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", id, userId, n, clip(o.author ?? users.byId(userId)?.name ?? "", 80), title, clip(String(o.body ?? "").trim(), 10_000), urgency, t, t);
    });
    return ideas.get(userId, id)!;
  },
  update(userId: string, id: string, o: { title?: unknown; body?: unknown; urgency?: unknown; progress?: unknown }): BoardIdea {
    const r = ideaRow(userId, id) ?? notFound();
    const title = o.title === undefined ? r.title : clip(String(o.title).replace(/\s+/g, " ").trim(), 160) || bad("Write the idea in a few words.");
    const urgency = o.urgency === undefined ? r.urgency : (IDEA_URGENCIES as readonly string[]).includes(String(o.urgency)) ? String(o.urgency) : bad("Unknown urgency.");
    let progress = r.progress;
    if (o.progress !== undefined) {
      if (!(IDEA_PROGRESS as readonly string[]).includes(String(o.progress))) bad("Unknown progress.");
      // T4: a done idea is never reopened.
      if (r.progress === "done" && o.progress !== "done") throw new BoardError(409, "A done idea is never reopened: write a new one.");
      progress = String(o.progress);
    }
    q.run("UPDATE board_ideas SET title = ?, body = ?, urgency = ?, progress = ?, updated_at = ? WHERE id = ?", title, o.body === undefined ? r.body : clip(String(o.body).trim(), 10_000), urgency, progress, now(), id);
    if (progress === "done" && r.progress !== "done") emitInternal({ type: "idea.resolved", userId, subjectId: id, label: title });
    return ideas.get(userId, id)!;
  },
  remove(userId: string, id: string) {
    ideaRow(userId, id) ?? notFound();
    q.run("UPDATE board_tasks SET idea_id = NULL WHERE idea_id = ? AND user_id = ?", id, userId);
    q.run("DELETE FROM board_ideas WHERE id = ?", id);
    dropFiles(userId, "idea", id);
  },
  addFile: (userId: string, id: string, name: string, bytes: Buffer) => { ideaRow(userId, id) ?? notFound(); return saveFile(userId, "idea", id, name, bytes); },

  /** T4: promoted once; the task keeps a copy of the idea's files. A second promotion names the existing task. */
  promote(userId: string, id: string, o: TaskInput = {}): { task: BoardTask; warning: string } {
    const r = ideaRow(userId, id) ?? notFound();
    const existing = q.get<{ title: string }>("SELECT title FROM board_tasks WHERE idea_id = ? AND user_id = ? ORDER BY created_at LIMIT 1", id, userId);
    if (existing) throw new BoardError(409, "This idea is already a task: “{title}”.", { title: existing.title });
    if (r.progress === "done") throw new BoardError(409, "A done idea is never reopened: write a new one.");
    const made = board.create(userId, { title: o.title ?? r.title, description: o.description ?? r.body, botId: o.botId, priority: o.priority ?? ({ critical: 1, bug: 2, minor: 4, idea: 3 } as Record<string, number>)[r.urgency] ?? 3, startAt: o.startAt, deps: o.deps, acceptance: o.acceptance, ideaId: id });
    for (const f of filesOf("idea", id)) saveFile(userId, "task", made.task.id, f.name, readFile(userId, "idea", id, f.id));
    ideas.recompute(userId, id);
    return { task: toTask(taskRow(made.task.id)!), warning: made.warning };
  },

  /** T4: every task made from it done → the idea checks itself; some done → « partielle ». A done idea stays done. */
  recompute(userId: string, id: string) {
    const r = ideaRow(userId, id);
    if (!r || r.progress === "done") return;
    const i = toIdea(r);
    const next: IdeaProgress = i.total && i.done === i.total ? "done" : i.done > 0 ? "partial" : r.progress === "partial" ? "todo" : (r.progress as IdeaProgress);
    if (next === r.progress) return;
    q.run("UPDATE board_ideas SET progress = ?, updated_at = ? WHERE id = ?", next, now(), id);
    if (next === "done") emitInternal({ type: "idea.resolved", userId, subjectId: id, label: r.title });
  },
};

// ── Running: a task is a goal of its bot (agent/goals.ts) ───────────────────────────────────────────────────────────
const RUNNING_STATES = "('running', 'review')";
const ready = (r: TaskRow, at: number) => r.armed && r.state === "waiting" && (!r.start_at || r.start_at <= at) && depsOf(r.id).every((d) => taskRow(d)?.state === "done");

/** What the bot is told in the first round: the task, its files (copied into its library), what its deps produced. */
export function taskBrief(r: TaskRow, files: string[]): string {
  const loc = users.localeOf(r.user_id);
  const deps = depsOf(r.id).map((d) => taskRow(d)).filter(Boolean) as TaskRow[];
  return [
    `[Board task “${r.title}” — priority ${r.priority} of 5]`,
    r.description ? `What to do:\n${r.description}` : "",
    files.length ? `Its files (copied into your library):\n${files.map((f) => `- ${f}`).join("\n")}` : "",
    deps.length ? `It follows these finished tasks (their results):\n${deps.map((d) => `- “${d.title}”: ${clip(d.summary || "(no summary)", 600)}`).join("\n")}` : "",
    r.note ? `The owner's note (fix this first): ${r.note}` : "",
    deliveryBrief(r.id),
    "When it is done, mark the goal complete with evidence (what you produced and where). If you cannot finish, mark it blocked with the reason.",
    loc && loc !== "en" ? `Answer the owner in ${languageName(loc)}.` : "",
  ].filter(Boolean).join("\n\n");
}

function dispatch(r: TaskRow) {
  const ex = executorFor(r); if (ex.botId && ex.botId !== r.bot_id) { setTask(r.id, { botId: ex.botId }); r = { ...r, bot_id: ex.botId }; } noteExecutor(r.id, ex); // L163 T12 who really runs it (workboardroles.ts)
  const bot = r.bot_id ? bots.owned(r.user_id, r.bot_id) : null;
  const loc = users.localeOf(r.user_id);
  if (!bot) { setTask(r.id, { state: "blocked", armed: false, note: wt(loc, "its bot is gone") }); return; }
  let thread = r.thread;
  if (!thread || !rows.get(bot.id, bot.generation, thread)) {
    thread = rows.append(bot, { kind: "message", role: "assistant", text: wt(loc, "Board task “{title}”: running…", { title: r.title }) }, 0).seq;
    bots.bumpUnread(bot.id);
  }
  const copied: string[] = [];
  for (const f of filesOf("task", r.id)) {
    try { copied.push(botPathOf(storeBytes(bot.id, `tableau/${r.id}`, f.name, readFile(r.user_id, "task", r.id, f.id)).path)); } catch (err) { console.error("[board files]", (err as Error).message); }
  }
  const g = createGoal(bot, { objective: wt(loc, "Board task “{title}”", { title: clip(r.title, 120) }), thread, origin: "board" });
  setTask(r.id, { state: "running", goalId: g.id, thread, startedAt: r.started_at ?? now(), endedAt: null });
  goals.set(g, { queued: true });
  enqueue(bot.id, { kind: "system", text: `${goalRoundPrompt(g, 1)}\n\n${taskBrief({ ...r, thread }, copied)}`, thread, goalRound: g.id, origin: "board", depth: 0 });
  audit(r.user_id, "system", `${bot.name}: board task started — ${clip(r.title, 120)}`, bot.id);
}

/** Starts every task that may start now (deps done, date come, at most PER_BOT_RUNNING per bot). Idempotent. */
export function sweep(userId?: string, at = now()) {
  const list = userId ? q.all<TaskRow>("SELECT * FROM board_tasks WHERE user_id = ? AND armed = 1 AND state = 'waiting' ORDER BY priority, created_at", userId)
    : q.all<TaskRow>("SELECT * FROM board_tasks WHERE armed = 1 AND state = 'waiting' ORDER BY priority, created_at");
  for (const r of list) {
    if (r.chantier_id) continue; // follows its chantier (syncLinked)
    if (!ready(r, at)) continue;
    const running = q.get<{ n: number }>(`SELECT COUNT(*) AS n FROM board_tasks WHERE bot_id = ? AND state IN ${RUNNING_STATES} AND state != 'review'`, r.bot_id)!.n;
    if (running >= PER_BOT_RUNNING) continue;
    dispatch(r);
  }
  if (userId) syncLinked(userId);
}

/** A task that follows a chantier: done when the chantier is done, blocked when it was stopped. */
function syncLinked(userId: string) {
  for (const r of q.all<TaskRow>("SELECT * FROM board_tasks WHERE user_id = ? AND chantier_id IS NOT NULL AND state NOT IN ('done', 'blocked')", userId)) {
    const c = chantiers.owned(userId, r.chantier_id!);
    const loc = users.localeOf(userId);
    if (!c) { finish(r, "blocked", "", wt(loc, "its chantier is gone")); continue; }
    if (c.status === "done") finish(r, "done", wt(loc, "Chantier “{title}” finished.", { title: c.title }), "");
    else if (c.status === "stopped") finish(r, "blocked", "", wt(loc, "its chantier was stopped"));
    else if (r.state === "waiting" && r.armed && c.status !== "planning" && c.status !== "proposed") setTask(r.id, { state: "running", startedAt: r.started_at ?? now() });
  }
}

/** A task ends: done (releases what waits on it), blocked, or waiting for the owner's review. */
function finish(r: TaskRow, state: "done" | "blocked" | "review", summary: string, note: string) {
  if (state === "done" && interceptDone(r.id, summary)) return; // L175: delivered by pull request — done only once it is merged
  const end = state === "review" ? null : now();
  setTask(r.id, { state, summary: clip(summary, 2000), note: clip(note, 2000), endedAt: end, ...(state === "done" ? { armed: false } : {}) });
  const bot = r.bot_id ? bots.byId(r.bot_id) : null;
  if (state !== "review") emitInternal({ type: state === "done" ? "board.task_done" : "board.task_blocked", userId: r.user_id, botId: r.bot_id ?? undefined, subjectId: r.id, label: r.title, data: { summary: clip(summary, 500), note: clip(note, 500), priority: r.priority } });
  if (r.idea_id) ideas.recompute(r.user_id, r.idea_id);
  if (bot && state !== "review") rows.append(bot, { kind: "event", event: "routine", text: wt(users.localeOf(r.user_id), state === "done" ? "Board task “{title}”: done." : "Board task “{title}”: blocked — {note}", { title: r.title, note: note || "?" }) }, r.thread || 0);
  if (state !== "review" && r.batch) recapIfBatchDone(r.user_id, r.batch);
  if (state === "done") sweep(r.user_id);
}

// L175: the pull request was merged (done) or the delivery stopped (blocked, with the reason).
onDeliveryEnd((id, outcome, note) => { const r = taskRow(id); if (r && r.state === "delivering") finish(r, outcome === "merged" ? "done" : "blocked", r.summary, note); });

onGoalStatus((g: GoalRecord) => {
  if (g.origin !== "board") return;
  const r = q.get<TaskRow>("SELECT * FROM board_tasks WHERE goal_id = ?", g.id);
  if (!r || r.state !== "running") return;
  const loc = users.localeOf(r.user_id);
  if (g.status === "complete") {
    // « Le vrai résultat »: a goal ended without any evidence is not taken as done.
    if (!g.evidence.trim() && !g.summary.trim()) return finish(r, "blocked", "", wt(loc, "the bot ended without saying what it produced"));
    return finish(r, r.acceptance === "owner" ? "review" : "done", g.summary || g.evidence, "");
  }
  if (g.status === "blocked" || g.status === "limit") return finish(r, "blocked", g.summary, g.reason || wt(loc, g.status === "limit" ? "it reached its round limit" : "blocked"));
  if (g.status === "stopped" || g.status === "declined") setTask(r.id, { state: "waiting", armed: false, note: g.reason || wt(loc, "stopped") });
});

// ── Grouped recap for the main bot (T6, T7) ─────────────────────────────────────────────────────────────────────
/** Blocked first, then by priority; a finished task with nothing readable is flagged, never sent empty. */
export function recapText(items: RecapItem[], locale: Locale): string {
  const rank = (s: string) => (s === "blocked" ? 0 : s === "review" ? 1 : 2);
  const sorted = [...items].sort((a, b) => rank(a.state) - rank(b.state) || a.priority - b.priority);
  const lines = sorted.map((i) => {
    const what = i.state === "blocked" ? wt(locale, "blocked: {why}", { why: i.note || "?" }) : clip(i.summary.trim(), 300) || wt(locale, "(no readable result: open the task)");
    return `- « ${i.title} » — ${what}`;
  });
  return [wt(locale, "Board: {n} task(s) of the same batch have ended.", { n: items.length }), ...lines].join("\n");
}

function recapIfBatchDone(userId: string, batch: string) {
  const list = q.all<TaskRow>("SELECT * FROM board_tasks WHERE user_id = ? AND batch = ?", userId, batch);
  if (!list.length || list.some((t) => t.state !== "done" && t.state !== "blocked")) return;
  const main = bots.primary(userId);
  if (!main) return;
  const loc = users.localeOf(userId);
  rows.append(main, { kind: "notice", tone: list.some((t) => t.state === "blocked") ? "warn" : "info", text: recapText(list.map((t) => ({ title: t.title, state: t.state, summary: t.summary, note: t.note, priority: t.priority })), loc) });
  q.run("UPDATE board_tasks SET batch = '' WHERE user_id = ? AND batch = ?", userId, batch);
}

let timer: NodeJS.Timeout | null = null;
/** Every 30 s: tasks whose date came or whose deps just ended start (a restart picks up where it was: all in SQLite). */
export function startBoard() {
  if (timer || config.schedulerOff) return;
  timer = setInterval(() => { try { sweep(); } catch (err) { console.error("[board]", (err as Error).message); } void sweepDeliveries().catch((err) => console.error("[board pr]", (err as Error).message)); }, 30_000);
  timer.unref();
}
