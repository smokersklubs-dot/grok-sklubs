/**
 * « Chantier » (chantiers.ts, chantierrunner.ts, docs/CHANTIER.md): the wire types, shared by the server and the web app
 * (the web imports them straight from here, so shared.ts does not grow). A chantier is a piece of work split between
 * several bots: what the planner understood (observations, assumptions, open questions), the requirements with their
 * acceptance check, the graph of tasks (who does what, what passes along each edge), and for each task a contract written
 * before anything runs (input, output, exact checks, reviewer criteria, what must not change).
 */

export const CHANTIER_STATUSES = ["planning", "proposed", "running", "waiting_owner", "done", "stopped"] as const;
export type ChantierStatus = (typeof CHANTIER_STATUSES)[number];

/** A task's state, as the graph colours it: en attente, en cours, acceptée, en réparation, bloquée (plus arrêtée). */
export const TASK_STATES = ["waiting", "running", "checking", "accepted", "repairing", "blocked", "stopped"] as const;
export type TaskState = (typeof TASK_STATES)[number];

/** A participant's bounded job (principle 2): what kind of deliverable it owes. */
export const TASK_ROLES = ["research", "spec", "build", "check", "other"] as const;
export type TaskRole = (typeof TASK_ROLES)[number];

/**
 * Exact checks, run by code on the task's output folder (chantiers/<chantier>/<task>/ in the library of the bot that did
 * it). `task`: read another task's output instead (an integration check; a failure there is blamed on that task).
 *  - file_exists   `path` exists
 *  - file_count    files in folder `path` (only those ending in `ext`) = `equals`, or = the length of the JSON array
 *                  `countOf.field` of `countOf.path` (e.g. one image per card)
 *  - size_between  file `path` is between `min` and `max` bytes
 *  - json_fields   JSON file `path` (an object, or every item of the array `field`) has every name in `fields`
 *  - same_order    the values `field` of the array in `path` equal, in order, those of `other.field` in `other.path`
 *  - text_present  file `path` contains each of `texts` (or, with `textsOf`, each value of that JSON array field)
 *  - image_size    every PNG in folder `path` is `width` × `height` pixels (read from the file header)
 */
export const CHECK_KINDS = ["file_exists", "file_count", "size_between", "json_fields", "same_order", "text_present", "image_size"] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

export interface FileRef { path: string; field?: string; task?: string }
export interface CodeCheck {
  id: string;
  kind: CheckKind;
  /** The check in plain words, as the owner reads it. */
  label: string;
  path: string;
  task?: string;
  ext?: string;
  equals?: number;
  countOf?: FileRef;
  min?: number;
  max?: number;
  fields?: string[];
  field?: string;
  other?: FileRef;
  texts?: string[];
  textsOf?: FileRef;
  width?: number;
  height?: number;
  /** Added from a lesson of an earlier chantier (principle 7). */
  fromLesson?: string;
}

/** What a reviewer bot judges (meaning, visual quality): one explicit criterion each. */
export interface ReviewCriterion { id: string; text: string }

/** « Fini » for one task, written before it runs (principle 4). */
export interface TaskContract {
  input: string;
  output: string;
  checks: CodeCheck[];
  criteria: ReviewCriterion[];
  /** What must NOT change. */
  scope: string[];
}

export interface PlanTask {
  key: string;
  title: string;
  role: TaskRole;
  /** The bot that does it (its model is the bot's). */
  botId: string;
  /** The bot that judges the criteria; must not be the producer. Empty: no reviewer (then `criteria` must be empty). */
  reviewerBotId: string;
  deliverable: string;
  contract: TaskContract;
  /** Shared resources (a file, the screen): two tasks naming the same one never run at the same time. */
  resources: string[];
  /** Runs no production of its own: only its checks, over the outputs of the tasks it depends on. */
  integration?: boolean;
}

/** An edge of the graph: `to` waits for `from`, and gets its artifact (requirements, sources, code, failure report…). */
export interface PlanEdge { from: string; to: string; artifact: string }

export interface Requirement { id: string; text: string; acceptance: string }
export interface OpenQuestion { id: string; text: string; answer: string }

export interface ChantierPlan {
  observations: string[];
  assumptions: string[];
  unknowns: OpenQuestion[];
  requirements: Requirement[];
  tasks: PlanTask[];
  edges: PlanEdge[];
  /** Attempts per task before its branch stops and the owner is asked (default 3). */
  maxAttempts: number;
}

export interface CheckResult { id: string; label: string; kind: CheckKind | "review"; pass: boolean; actual: string; expected: string; blame?: string; unsure?: boolean }

/** A failure report (principle 5): enough to repair only the failed unit and check it again. */
export interface FailureReport {
  component: string;
  conditions: string;
  failure: string;
  expected: string;
  repairScope: string;
  recheck: string[];
}

export interface ChantierAttempt {
  id: string;
  taskKey: string;
  n: number;
  botId: string;
  goalId: string | null;
  startedAt: number;
  endedAt: number | null;
  result: "running" | "accepted" | "failed" | "blocked" | "stopped";
  summary: string;
  evidence: string;
  checks: CheckResult[];
  report: FailureReport | null;
  costUsd: number;
  tokens: number;
}

export interface ChantierTask {
  key: string;
  state: TaskState;
  botId: string;
  thread: number;
  goalId: string | null;
  attempts: number;
  /** Attempts the owner granted past the limit. */
  extra: number;
  /** The task's goal waits on the owner: an approval (publishing, paying, deleting…), a question, a spend checkpoint. */
  waiting: "" | "approval" | "user" | "checkpoint";
  /** Why it is blocked or stopped, in words. */
  note: string;
  startedAt: number | null;
  endedAt: number | null;
}

export const DECISION_KINDS = ["escalation", "blocked", "review"] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];
export const DECISION_ANSWERS = ["retry", "accept", "redo", "stop_branch", "resume"] as const;
export type DecisionAnswer = (typeof DECISION_ANSWERS)[number];
export interface ChantierDecision {
  id: string;
  taskKey: string;
  kind: DecisionKind;
  question: string;
  options: DecisionAnswer[];
  status: "open" | "answered";
  answer: DecisionAnswer | null;
  note: string;
  createdAt: number;
}

export interface ChantierLesson {
  id: string;
  rule: string;
  evidence: string;
  appliesTo: string;
  check: CodeCheck | null;
  status: "active" | "retired";
  sourceChantier: string;
  uses: number;
  createdAt: number;
  updatedAt: number;
}

/** Owner interventions and « continue » / restated asks, each with its reason. */
export interface ChantierNudge { at: number; kind: "intervention" | "continue" | "restate"; reason: string }

export interface ChantierMetrics {
  /** From approval to the end (or now), in ms; 0 before approval. */
  durationMs: number;
  costUsd: number;
  tokens: number;
  /** Checks still failing in tasks that are not accepted. */
  defects: number;
  interventions: number;
  continues: number;
  restates: number;
  attempts: number;
}

export interface Chantier {
  id: string;
  title: string;
  brief: string;
  plannerBotId: string;
  status: ChantierStatus;
  plan: ChantierPlan | null;
  /** Why planning fell back to a blank plan, or why the chantier stopped. */
  note: string;
  createdAt: number;
  approvedAt: number | null;
  endedAt: number | null;
}

export interface ChantierView {
  chantier: Chantier;
  tasks: ChantierTask[];
  attempts: ChantierAttempt[];
  decisions: ChantierDecision[];
  lessons: ChantierLesson[];
  nudges: ChantierNudge[];
  metrics: ChantierMetrics;
}

export interface ChantierSummary { id: string; title: string; status: ChantierStatus; tasks: number; accepted: number; blocked: number; openDecisions: number; createdAt: number }
