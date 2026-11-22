/**
 * « Chantier » — the data model (tables created at module load, the house pattern), the plan check, the graph helpers,
 * the lessons and the metrics. The runner (chantierrunner.ts) moves tasks along; the planner (chantierplanner.ts) writes
 * the first plan; the checks (chantierchecks.ts) judge each attempt. See docs/CHANTIER.md.
 *
 * Isolation: every row carries the owner's user id; every read goes through `chantiers.owned(userId, id)` and every bot
 * named in a plan must be one of that owner's own agent bots. Nothing here reads another account's data.
 */
import { q } from "./db.js";
import { bots, clip, newId, now } from "./store.js";
import { ct } from "./chantieri18n.js";
import { goals } from "./agent/goals.js";
import type { Locale } from "./shared.js";
import {
  CHECK_KINDS, TASK_ROLES,
  type Chantier, type ChantierAttempt, type ChantierDecision, type ChantierLesson, type ChantierMetrics, type ChantierNudge, type ChantierPlan,
  type ChantierStatus, type ChantierSummary, type ChantierTask, type ChantierView, type CheckResult, type CodeCheck, type DecisionAnswer,
  type DecisionKind, type FailureReport, type FileRef, type PlanEdge, type PlanTask, type TaskState,
} from "./chantiertypes.js";

q.run(`CREATE TABLE IF NOT EXISTS chantiers (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, brief TEXT NOT NULL,
  planner_bot_id TEXT NOT NULL, status TEXT NOT NULL, plan TEXT, note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, approved_at INTEGER, ended_at INTEGER)`);
q.run("CREATE INDEX IF NOT EXISTS chantiers_user ON chantiers(user_id, created_at)");
q.run(`CREATE TABLE IF NOT EXISTS chantier_tasks (
  chantier_id TEXT NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE, task_key TEXT NOT NULL, state TEXT NOT NULL,
  bot_id TEXT NOT NULL, thread INTEGER NOT NULL DEFAULT 0, goal_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, extra INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '', started_at INTEGER, ended_at INTEGER, PRIMARY KEY (chantier_id, task_key))`);
q.run(`CREATE TABLE IF NOT EXISTS chantier_attempts (
  id TEXT PRIMARY KEY, chantier_id TEXT NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE, task_key TEXT NOT NULL, n INTEGER NOT NULL,
  bot_id TEXT NOT NULL, goal_id TEXT, started_at INTEGER NOT NULL, ended_at INTEGER, result TEXT NOT NULL DEFAULT 'running',
  summary TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '', checks TEXT NOT NULL DEFAULT '[]', report TEXT,
  cost_usd REAL NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0)`);
q.run("CREATE INDEX IF NOT EXISTS chantier_attempts_task ON chantier_attempts(chantier_id, task_key, n)");
q.run(`CREATE TABLE IF NOT EXISTS chantier_decisions (
  id TEXT PRIMARY KEY, chantier_id TEXT NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE, task_key TEXT NOT NULL, kind TEXT NOT NULL,
  question TEXT NOT NULL, options TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', answer TEXT, note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, answered_at INTEGER)`);
q.run(`CREATE TABLE IF NOT EXISTS chantier_lessons (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, rule TEXT NOT NULL, evidence TEXT NOT NULL,
  applies_to TEXT NOT NULL, check_json TEXT, status TEXT NOT NULL DEFAULT 'active', source_chantier TEXT NOT NULL DEFAULT '',
  uses INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
q.run(`CREATE TABLE IF NOT EXISTS chantier_nudges (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chantier_id TEXT NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE, at INTEGER NOT NULL,
  kind TEXT NOT NULL, reason TEXT NOT NULL)`);
/** Extra spend outside attempts (the planner turn, the reviews), counted in the chantier's cost. */
q.run(`CREATE TABLE IF NOT EXISTS chantier_spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chantier_id TEXT NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE, what TEXT NOT NULL,
  cost_usd REAL NOT NULL, tokens INTEGER NOT NULL, at INTEGER NOT NULL)`);

export const DEFAULT_MAX_ATTEMPTS = 3;
export const MAX_TASKS = 20;
const json = <T>(s: unknown, fallback: T): T => { try { return s ? (JSON.parse(String(s)) as T) : fallback; } catch { return fallback; } };

const toChantier = (r: any): Chantier & { userId: string } => ({
  id: r.id, userId: r.user_id, title: r.title, brief: r.brief, plannerBotId: r.planner_bot_id, status: r.status, plan: json<ChantierPlan | null>(r.plan, null),
  note: r.note, createdAt: r.created_at, approvedAt: r.approved_at ?? null, endedAt: r.ended_at ?? null,
});
const toTask = (r: any): ChantierTask => ({ key: r.task_key, state: r.state, botId: r.bot_id, thread: r.thread, goalId: r.goal_id ?? null, attempts: r.attempts, extra: r.extra ?? 0, waiting: "", note: r.note, startedAt: r.started_at ?? null, endedAt: r.ended_at ?? null });
const toAttempt = (r: any): ChantierAttempt => ({
  id: r.id, taskKey: r.task_key, n: r.n, botId: r.bot_id, goalId: r.goal_id ?? null, startedAt: r.started_at, endedAt: r.ended_at ?? null, result: r.result,
  summary: r.summary, evidence: r.evidence, checks: json<CheckResult[]>(r.checks, []), report: json<FailureReport | null>(r.report, null), costUsd: r.cost_usd, tokens: r.tokens,
});
const toDecision = (r: any): ChantierDecision => ({ id: r.id, taskKey: r.task_key, kind: r.kind, question: r.question, options: json<DecisionAnswer[]>(r.options, []), status: r.status, answer: r.answer ?? null, note: r.note, createdAt: r.created_at });
const toLesson = (r: any): ChantierLesson => ({ id: r.id, rule: r.rule, evidence: r.evidence, appliesTo: r.applies_to, check: json<CodeCheck | null>(r.check_json, null), status: r.status, sourceChantier: r.source_chantier, uses: r.uses, createdAt: r.created_at, updatedAt: r.updated_at });

export type ChantierRecord = ReturnType<typeof toChantier>;

export const chantiers = {
  byId: (id: string) => { const r = q.get("SELECT * FROM chantiers WHERE id = ?", id); return r ? toChantier(r) : null; },
  /** The caller's own chantier, else null (another account's reads as missing). */
  owned: (userId: string, id: string) => { const c = chantiers.byId(id); return c && c.userId === userId ? c : null; },
  list: (userId: string, limit = 50) => q.all("SELECT * FROM chantiers WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", userId, limit).map(toChantier),
  /** Chantiers the runner must look after (after a restart too). */
  live: () => q.all("SELECT * FROM chantiers WHERE status IN ('running', 'waiting_owner') ORDER BY created_at").map(toChantier),
  create(userId: string, o: { title: string; brief: string; plannerBotId: string }): ChantierRecord {
    const id = newId("ch");
    const t = now();
    q.run("INSERT INTO chantiers (id, user_id, title, brief, planner_bot_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'planning', ?, ?)",
      id, userId, clip(o.title.trim(), 160), clip(o.brief.trim(), 20_000), o.plannerBotId, t, t);
    return chantiers.byId(id)!;
  },
  set(id: string, patch: { status?: ChantierStatus; plan?: ChantierPlan; note?: string; approvedAt?: number; endedAt?: number | null }) {
    const cols: string[] = [];
    const vals: (string | number | null)[] = [];
    if (patch.status) { cols.push("status = ?"); vals.push(patch.status); }
    if (patch.plan) { cols.push("plan = ?"); vals.push(JSON.stringify(patch.plan)); }
    if (patch.note !== undefined) { cols.push("note = ?"); vals.push(clip(patch.note, 1000)); }
    if (patch.approvedAt !== undefined) { cols.push("approved_at = ?"); vals.push(patch.approvedAt); }
    if (patch.endedAt !== undefined) { cols.push("ended_at = ?"); vals.push(patch.endedAt); }
    if (!cols.length) return;
    q.run(`UPDATE chantiers SET ${cols.join(", ")}, updated_at = ? WHERE id = ?`, ...vals, now(), id);
  },
};

export const tasks = {
  of: (chantierId: string) => q.all("SELECT * FROM chantier_tasks WHERE chantier_id = ? ORDER BY rowid", chantierId).map(toTask),
  get: (chantierId: string, key: string) => { const r = q.get("SELECT * FROM chantier_tasks WHERE chantier_id = ? AND task_key = ?", chantierId, key); return r ? toTask(r) : null; },
  byGoal: (goalId: string) => { const r = q.get<any>("SELECT * FROM chantier_tasks WHERE goal_id = ?", goalId); return r ? { chantierId: r.chantier_id as string, task: toTask(r) } : null; },
  create(chantierId: string, t: PlanTask) {
    q.run("INSERT OR IGNORE INTO chantier_tasks (chantier_id, task_key, state, bot_id) VALUES (?, ?, 'waiting', ?)", chantierId, t.key, t.botId);
  },
  set(chantierId: string, key: string, patch: Partial<{ state: TaskState; thread: number; goalId: string | null; attempts: number; extra: number; note: string; startedAt: number | null; endedAt: number | null }>) {
    const map: Record<string, string> = { state: "state", thread: "thread", goalId: "goal_id", attempts: "attempts", extra: "extra", note: "note", startedAt: "started_at", endedAt: "ended_at" };
    const cols: string[] = [];
    const vals: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(patch)) { if (map[k] && v !== undefined) { cols.push(`${map[k]} = ?`); vals.push(k === "note" ? clip(String(v), 600) : (v as string | number | null)); } }
    if (cols.length) q.run(`UPDATE chantier_tasks SET ${cols.join(", ")} WHERE chantier_id = ? AND task_key = ?`, ...vals, chantierId, key);
  },
};

export const attempts = {
  of: (chantierId: string) => q.all("SELECT * FROM chantier_attempts WHERE chantier_id = ? ORDER BY started_at, n", chantierId).map(toAttempt),
  last: (chantierId: string, key: string) => { const r = q.get("SELECT * FROM chantier_attempts WHERE chantier_id = ? AND task_key = ? ORDER BY n DESC LIMIT 1", chantierId, key); return r ? toAttempt(r) : null; },
  start(chantierId: string, key: string, n: number, botId: string, goalId: string | null): string {
    const id = newId("att");
    q.run("INSERT INTO chantier_attempts (id, chantier_id, task_key, n, bot_id, goal_id, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, chantierId, key, n, botId, goalId, now());
    return id;
  },
  finish(id: string, o: { result: ChantierAttempt["result"]; summary?: string; evidence?: string; checks?: CheckResult[]; report?: FailureReport | null; costUsd?: number; tokens?: number }) {
    q.run("UPDATE chantier_attempts SET result = ?, summary = ?, evidence = ?, checks = ?, report = ?, cost_usd = ?, tokens = ?, ended_at = ? WHERE id = ?",
      o.result, clip(o.summary ?? "", 1000), clip(o.evidence ?? "", 3000), JSON.stringify(o.checks ?? []), o.report ? JSON.stringify(o.report) : null, o.costUsd ?? 0, o.tokens ?? 0, now(), id);
  },
  /** Rechecks of an integration task add their results to its last attempt (nothing is thrown away). */
  addChecks(id: string, more: CheckResult[], result: ChantierAttempt["result"], report: FailureReport | null) {
    const r = q.get<any>("SELECT checks FROM chantier_attempts WHERE id = ?", id);
    q.run("UPDATE chantier_attempts SET checks = ?, result = ?, report = ?, ended_at = ? WHERE id = ?", JSON.stringify([...json<CheckResult[]>(r?.checks, []), ...more]), result, report ? JSON.stringify(report) : null, now(), id);
  },
};

export const decisions = {
  of: (chantierId: string) => q.all("SELECT * FROM chantier_decisions WHERE chantier_id = ? ORDER BY created_at", chantierId).map(toDecision),
  get: (chantierId: string, id: string) => { const r = q.get("SELECT * FROM chantier_decisions WHERE chantier_id = ? AND id = ?", chantierId, id); return r ? toDecision(r) : null; },
  openFor: (chantierId: string, key: string) => q.all("SELECT * FROM chantier_decisions WHERE chantier_id = ? AND task_key = ? AND status = 'open'", chantierId, key).map(toDecision),
  open(chantierId: string, key: string, kind: DecisionKind, question: string, options: DecisionAnswer[]): ChantierDecision {
    const existing = decisions.openFor(chantierId, key).find((d) => d.kind === kind);
    if (existing) return existing;
    const id = newId("dec");
    q.run("INSERT INTO chantier_decisions (id, chantier_id, task_key, kind, question, options, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, chantierId, key, kind, clip(question, 2000), JSON.stringify(options), now());
    return decisions.get(chantierId, id)!;
  },
  answer(chantierId: string, id: string, answer: DecisionAnswer, note: string) {
    q.run("UPDATE chantier_decisions SET status = 'answered', answer = ?, note = ?, answered_at = ? WHERE chantier_id = ? AND id = ?", answer, clip(note, 1000), now(), chantierId, id);
  },
  closeFor(chantierId: string, key?: string) {
    q.run(`UPDATE chantier_decisions SET status = 'answered', answered_at = ? WHERE chantier_id = ? AND status = 'open'${key ? " AND task_key = ?" : ""}`, now(), chantierId, ...(key ? [key] : []));
  },
  openCount: (chantierId: string) => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM chantier_decisions WHERE chantier_id = ? AND status = 'open'", chantierId)!.n,
};

export const nudges = {
  add(chantierId: string, kind: ChantierNudge["kind"], reason: string) { q.run("INSERT INTO chantier_nudges (chantier_id, at, kind, reason) VALUES (?, ?, ?, ?)", chantierId, now(), kind, clip(reason.trim() || "-", 600)); },
  of: (chantierId: string): ChantierNudge[] => q.all<any>("SELECT at, kind, reason FROM chantier_nudges WHERE chantier_id = ? ORDER BY id", chantierId),
};

export const spend = {
  add(chantierId: string, what: string, costUsd: number, tokens: number) { q.run("INSERT INTO chantier_spend (chantier_id, what, cost_usd, tokens, at) VALUES (?, ?, ?, ?, ?)", chantierId, what, costUsd, tokens, now()); },
};

/** What a bot spent between two moments (its usage rows): an estimate when the bot did other work meanwhile. */
export function usageBetween(botId: string, from: number, to: number): { costUsd: number; tokens: number } {
  const r = q.get<{ c: number | null; t: number | null }>("SELECT SUM(cost_usd) AS c, SUM(input_tokens + output_tokens) AS t FROM usage WHERE bot_id = ? AND at >= ? AND at <= ?", botId, from, to);
  return { costUsd: r?.c ?? 0, tokens: r?.t ?? 0 };
}

// ── Lessons (principle 7) ─────────────────────────────────────────────────────────────────────────────────────────
export const lessons = {
  of: (userId: string, all = false) => q.all(`SELECT * FROM chantier_lessons WHERE user_id = ?${all ? "" : " AND status = 'active'"} ORDER BY created_at`, userId).map(toLesson),
  get: (userId: string, id: string) => { const r = q.get("SELECT * FROM chantier_lessons WHERE user_id = ? AND id = ?", userId, id); return r ? toLesson(r) : null; },
  add(userId: string, o: { rule: string; evidence: string; appliesTo: string; check: CodeCheck | null; sourceChantier: string }): ChantierLesson {
    const id = newId("lesson");
    const t = now();
    q.run("INSERT INTO chantier_lessons (id, user_id, rule, evidence, applies_to, check_json, source_chantier, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, userId, clip(o.rule.trim(), 600), clip(o.evidence.trim(), 2000), clip(o.appliesTo.trim(), 300), o.check ? JSON.stringify(o.check) : null, o.sourceChantier, t, t);
    return lessons.get(userId, id)!;
  },
  /** The owner revises a lesson (its words, where it applies) or retires it. */
  edit(userId: string, id: string, patch: { rule?: string; appliesTo?: string; status?: "active" | "retired" }) {
    const l = lessons.get(userId, id);
    if (!l) return null;
    q.run("UPDATE chantier_lessons SET rule = ?, applies_to = ?, status = ?, updated_at = ? WHERE id = ?",
      clip((patch.rule ?? l.rule).trim() || l.rule, 600), clip((patch.appliesTo ?? l.appliesTo).trim() || l.appliesTo, 300), patch.status ?? l.status, now(), id);
    return lessons.get(userId, id);
  },
  used(id: string) { q.run("UPDATE chantier_lessons SET uses = uses + 1 WHERE id = ?", id); },
};

const words = (s: string) => new Set(s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 4));

/** Whether a lesson applies to a task: its « applies to » names the task's role, or shares a word with its title / deliverable. */
export function lessonApplies(l: Pick<ChantierLesson, "appliesTo">, t: Pick<PlanTask, "role" | "title" | "deliverable">): boolean {
  const a = words(l.appliesTo);
  if (a.has(t.role)) return true;
  for (const w of words(`${t.title} ${t.deliverable}`)) if (a.has(w)) return true;
  return false;
}

/**
 * Feeds the owner's active lessons into a plan: each lesson with a check adds that check to every task it applies to
 * (once, marked `fromLesson`). Returns the lesson ids used.
 */
export function applyLessons(userId: string, plan: ChantierPlan): string[] {
  const used = new Set<string>();
  for (const l of lessons.of(userId)) {
    if (!l.check) continue;
    for (const t of plan.tasks) {
      if (t.integration || !lessonApplies(l, t)) continue;
      if (t.contract.checks.some((c) => c.fromLesson === l.id)) { used.add(l.id); continue; }
      t.contract.checks.push({ ...l.check, id: `${l.check.id}-l${t.contract.checks.length + 1}`, task: undefined, fromLesson: l.id });
      used.add(l.id);
    }
  }
  return [...used];
}

// ── The plan check ────────────────────────────────────────────────────────────────────────────────────────────────
const s = (v: unknown, n: number) => clip(String(v ?? "").trim(), n);
const list = (v: unknown, n: number, each: number) => (Array.isArray(v) ? v : []).slice(0, n).map((x) => s(x, each)).filter(Boolean);
const KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PATH = (p: string) => p === "" || (!p.startsWith("/") && !p.includes("\\") && !p.split("/").some((seg) => seg === ".." || seg === "."));
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const ref = (v: any): FileRef | undefined => (v && typeof v === "object" ? { path: s(v.path, 200), ...(v.field ? { field: s(v.field, 80) } : {}), ...(v.task ? { task: s(v.task, 40) } : {}) } : undefined);

function cleanCheck(raw: any, i: number): CodeCheck {
  const kind = String(raw?.kind ?? "") as CodeCheck["kind"];
  const c: CodeCheck = { id: KEY.test(String(raw?.id ?? "")) ? String(raw.id) : `c${i + 1}`, kind, label: s(raw?.label, 300), path: s(raw?.path, 200) };
  if (raw?.task) c.task = s(raw.task, 40);
  if (raw?.ext) c.ext = s(raw.ext, 12).toLowerCase();
  for (const k of ["equals", "min", "max", "width", "height"] as const) { const n = num(raw?.[k]); if (n !== undefined) c[k] = n; }
  if (raw?.countOf) c.countOf = ref(raw.countOf);
  if (raw?.other) c.other = ref(raw.other);
  if (raw?.textsOf) c.textsOf = ref(raw.textsOf);
  if (Array.isArray(raw?.fields)) c.fields = list(raw.fields, 30, 80);
  if (raw?.field) c.field = s(raw.field, 80);
  if (Array.isArray(raw?.texts)) c.texts = list(raw.texts, 50, 500);
  if (typeof raw?.fromLesson === "string") c.fromLesson = s(raw.fromLesson, 60);
  return c;
}

/** Why a check cannot run, or null. */
function checkProblem(c: CodeCheck, keys: Set<string>): string | null {
  if (!(CHECK_KINDS as readonly string[]).includes(c.kind)) return "unknown kind";
  if (!c.label) return "no label";
  const paths = [c.path, c.countOf?.path, c.other?.path, c.textsOf?.path].filter((p): p is string => p !== undefined);
  if (paths.some((p) => !PATH(p))) return "a path must stay inside the task's folder";
  for (const t of [c.task, c.countOf?.task, c.other?.task, c.textsOf?.task]) if (t && !keys.has(t)) return "it reads a task that does not exist";
  switch (c.kind) {
    case "file_exists": return c.path ? null : "no path";
    case "file_count": return c.equals === undefined && !c.countOf?.path ? "needs equals or countOf" : null;
    case "size_between": return !c.path || (c.min === undefined && c.max === undefined) ? "needs a path and min or max" : null;
    case "json_fields": return !c.path || !c.fields?.length ? "needs a path and fields" : null;
    case "same_order": return !c.path || !c.field || !c.other?.path || !c.other.field ? "needs path, field, other.path and other.field" : null;
    case "text_present": return !c.path || (!c.texts?.length && !c.textsOf?.path) ? "needs a path and texts or textsOf" : null;
    case "image_size": return !c.width || !c.height ? "needs width and height" : null;
  }
  return null;
}

/** Edges that make a cycle (a task waiting, through others, on itself), as "a → b". */
export function cycleOf(keys: string[], edges: PlanEdge[]): string | null {
  const next = new Map<string, string[]>(keys.map((k) => [k, []]));
  for (const e of edges) next.get(e.from)?.push(e.to);
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (k: string): string | null => {
    if (state.get(k) === 2) return null;
    if (state.get(k) === 1) return [...stack.slice(stack.indexOf(k)), k].join(" → ");
    state.set(k, 1); stack.push(k);
    for (const n of next.get(k) ?? []) { const c = visit(n); if (c) return c; }
    stack.pop(); state.set(k, 2);
    return null;
  };
  for (const k of keys) { const c = visit(k); if (c) return c; }
  return null;
}

/**
 * Cleans a plan (the planner's, or the owner's edited one) and lists what is wrong with it, in the owner's words. A plan
 * with problems is kept as a proposal; only a plan without any can be approved.
 */
export function checkPlan(raw: unknown, userId: string, loc: Locale): { plan: ChantierPlan; problems: string[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as any;
  const problems: string[] = [];
  const plan: ChantierPlan = {
    observations: list(r.observations, 40, 600),
    assumptions: list(r.assumptions, 40, 600),
    unknowns: (Array.isArray(r.unknowns) ? r.unknowns : []).slice(0, 30).map((u: any, i: number) => (typeof u === "string" ? { id: `q${i + 1}`, text: s(u, 600), answer: "" } : { id: KEY.test(String(u?.id ?? "")) ? String(u.id) : `q${i + 1}`, text: s(u?.text, 600), answer: s(u?.answer, 1000) })).filter((u: { text: string }) => u.text),
    requirements: (Array.isArray(r.requirements) ? r.requirements : []).slice(0, 60).map((x: any, i: number) => ({ id: KEY.test(String(x?.id ?? "")) ? String(x.id) : `r${i + 1}`, text: s(x?.text, 600), acceptance: s(x?.acceptance, 600) })).filter((x: { text: string }) => x.text),
    tasks: [],
    edges: [],
    maxAttempts: Math.min(10, Math.max(1, Math.floor(num(r.maxAttempts) ?? DEFAULT_MAX_ATTEMPTS))),
  };
  for (const x of plan.requirements) if (!x.acceptance) problems.push(ct(loc, "Requirement “{id}” has no acceptance check.", { id: x.id }));
  const rawTasks: any[] = (Array.isArray(r.tasks) ? r.tasks : []).slice(0, MAX_TASKS);
  if (!rawTasks.length) problems.push(ct(loc, "The plan has no task."));
  const keys = new Set<string>();
  for (const t of rawTasks) {
    const key = String(t?.key ?? "").trim().toLowerCase();
    if (!KEY.test(key)) { problems.push(ct(loc, "A task needs a short key (letters, digits, dashes): “{key}”.", { key: clip(key, 40) })); continue; }
    if (keys.has(key)) { problems.push(ct(loc, "Two tasks have the key “{key}”.", { key })); continue; }
    keys.add(key);
  }
  for (const t of rawTasks) {
    const key = String(t?.key ?? "").trim().toLowerCase();
    if (!keys.has(key) || plan.tasks.some((x) => x.key === key)) continue;
    const c = t?.contract ?? {};
    const task: PlanTask = {
      key, title: s(t?.title, 160) || key, role: (TASK_ROLES as readonly string[]).includes(t?.role) ? t.role : "other",
      botId: s(t?.botId, 60), reviewerBotId: s(t?.reviewerBotId, 60), deliverable: s(t?.deliverable, 600),
      contract: { input: s(c.input, 2000), output: s(c.output, 2000), checks: (Array.isArray(c.checks) ? c.checks : []).slice(0, 30).map(cleanCheck), criteria: (Array.isArray(c.criteria) ? c.criteria : []).slice(0, 15).map((x: any, i: number) => ({ id: KEY.test(String(x?.id ?? "")) ? String(x.id) : `k${i + 1}`, text: s(typeof x === "string" ? x : x?.text, 500) })).filter((x: { text: string }) => x.text), scope: list(c.scope, 20, 300) },
      resources: list(t?.resources, 10, 200).map((x) => x.toLowerCase()),
      ...(t?.integration ? { integration: true } : {}),
    };
    const name = task.title;
    const bot = bots.byId(task.botId);
    if (!bot || bot.userId !== userId || bot.kind !== "agent" || bot.hidden) problems.push(ct(loc, "Task “{task}”: choose one of your bots to do it.", { task: name }));
    if (task.reviewerBotId) {
      const rv = bots.byId(task.reviewerBotId);
      if (!rv || rv.userId !== userId || rv.kind !== "agent" || rv.hidden) problems.push(ct(loc, "Task “{task}”: the reviewer must be one of your bots.", { task: name }));
      else if (rv.id === task.botId) problems.push(ct(loc, "Task “{task}”: the reviewer must be another bot than the one doing it.", { task: name }));
    } else if (task.contract.criteria.length) problems.push(ct(loc, "Task “{task}”: choose a reviewer bot for its criteria.", { task: name }));
    if (!task.contract.input) problems.push(ct(loc, "Task “{task}”: say what it receives (input).", { task: name }));
    if (!task.contract.output) problems.push(ct(loc, "Task “{task}”: say what it must deliver (output).", { task: name }));
    if (!task.contract.scope.length) problems.push(ct(loc, "Task “{task}”: say what must not change (scope).", { task: name }));
    if (!task.contract.checks.length && !task.contract.criteria.length) problems.push(ct(loc, "Task “{task}”: it needs at least one check.", { task: name }));
    const ids = new Set<string>();
    for (const ch of task.contract.checks) {
      if (ids.has(ch.id)) ch.id = `${ch.id}-${ids.size + 1}`;
      ids.add(ch.id);
      const p = checkProblem(ch, keys);
      if (p) problems.push(ct(loc, "Task “{task}”, check “{check}”: {problem}.", { task: name, check: ch.label || ch.id, problem: ct(loc, p) }));
    }
    plan.tasks.push(task);
  }
  const seen = new Set<string>();
  for (const e of Array.isArray(r.edges) ? r.edges.slice(0, 100) : []) {
    const edge: PlanEdge = { from: s(e?.from, 40).toLowerCase(), to: s(e?.to, 40).toLowerCase(), artifact: s(e?.artifact, 200) };
    if (!keys.has(edge.from) || !keys.has(edge.to) || edge.from === edge.to) { problems.push(ct(loc, "A link joins tasks that do not exist: {from} → {to}.", { from: edge.from || "?", to: edge.to || "?" })); continue; }
    if (seen.has(`${edge.from}>${edge.to}`)) continue;
    seen.add(`${edge.from}>${edge.to}`);
    if (!edge.artifact) problems.push(ct(loc, "The link {from} → {to} must name what passes along it.", edge as unknown as Record<string, string>));
    plan.edges.push(edge);
  }
  // An integration check reading another task's output needs that task to come first.
  for (const t of plan.tasks) for (const ch of t.contract.checks) for (const other of [ch.task, ch.countOf?.task, ch.other?.task, ch.textsOf?.task]) {
    if (other && other !== t.key && !upstreamOf(plan, t.key).has(other)) problems.push(ct(loc, "Task “{task}” checks the output of “{other}”: add a link {other} → {key}.", { task: t.title, other, key: t.key }));
  }
  const cycle = cycleOf(plan.tasks.map((t) => t.key), plan.edges);
  if (cycle) problems.push(ct(loc, "The graph goes round in a circle: {cycle}.", { cycle }));
  return { plan, problems: [...new Set(problems)] };
}

/** Every task `key` waits on, directly or through others. */
export function upstreamOf(plan: Pick<ChantierPlan, "edges">, key: string): Set<string> {
  const out = new Set<string>();
  const todo = [key];
  while (todo.length) { const k = todo.pop()!; for (const e of plan.edges) if (e.to === k && !out.has(e.from)) { out.add(e.from); todo.push(e.from); } }
  return out;
}
/** Every task that waits on `key`, directly or through others. */
export function downstreamOf(plan: Pick<ChantierPlan, "edges">, key: string): Set<string> {
  const out = new Set<string>();
  const todo = [key];
  while (todo.length) { const k = todo.pop()!; for (const e of plan.edges) if (e.from === k && !out.has(e.to)) { out.add(e.to); todo.push(e.to); } }
  return out;
}

// ── Metrics and the page ──────────────────────────────────────────────────────────────────────────────────────────
export function metricsOf(c: ChantierRecord): ChantierMetrics {
  const list = attempts.of(c.id);
  const extra = q.get<{ c: number | null; t: number | null }>("SELECT SUM(cost_usd) AS c, SUM(tokens) AS t FROM chantier_spend WHERE chantier_id = ?", c.id);
  const ns = nudges.of(c.id);
  const latest = new Map<string, ChantierAttempt>();
  for (const a of list) latest.set(a.taskKey, a);
  let defects = 0;
  for (const t of tasks.of(c.id)) if (t.state !== "accepted") defects += latest.get(t.key)?.checks.filter((x) => !x.pass).length ?? 0;
  return {
    durationMs: c.approvedAt ? (c.endedAt ?? now()) - c.approvedAt : 0,
    costUsd: Math.round((list.reduce((n, a) => n + a.costUsd, 0) + (extra?.c ?? 0)) * 10_000) / 10_000,
    tokens: list.reduce((n, a) => n + a.tokens, 0) + (extra?.t ?? 0),
    defects,
    interventions: ns.filter((x) => x.kind === "intervention").length,
    continues: ns.filter((x) => x.kind === "continue").length,
    restates: ns.filter((x) => x.kind === "restate").length,
    attempts: list.length,
  };
}

const publicChantier = (c: ChantierRecord): Chantier => { const { userId: _u, ...rest } = c; return rest; };

export function viewOf(c: ChantierRecord): ChantierView {
  return {
    chantier: publicChantier(c), tasks: tasks.of(c.id).map((t) => ({ ...t, waiting: (t.state === "running" || t.state === "repairing") && t.goalId ? goals.byId(t.goalId)?.waiting ?? "" : "" })), attempts: attempts.of(c.id), decisions: decisions.of(c.id),
    lessons: lessons.of(c.userId, true).filter((l) => l.sourceChantier === c.id || (c.plan?.tasks ?? []).some((t) => t.contract.checks.some((x) => x.fromLesson === l.id))),
    nudges: nudges.of(c.id), metrics: metricsOf(c),
  };
}

export function summaryOf(c: ChantierRecord): ChantierSummary {
  const ts = tasks.of(c.id);
  return { id: c.id, title: c.title, status: c.status, tasks: c.plan?.tasks.length ?? ts.length, accepted: ts.filter((t) => t.state === "accepted").length, blocked: ts.filter((t) => t.state === "blocked").length, openDecisions: decisions.openCount(c.id), createdAt: c.createdAt };
}
