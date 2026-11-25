/**
 * « Tableau de travail » (L163; workboard.ts, docs/TABLEAU.md): the wire types, shared by the server and the web app (the
 * web imports them straight from here, so shared.ts does not grow).
 *
 * Clean room: built from docs/cleanroom/10-timon.md (T1 to T8) only; no code of the studied product was read.
 */

/** A task's state. An unknown state left by another version is shown in « done » without being rewritten (T1). */
/** « delivering » (L175, workboardpr.ts): the work is done and goes out as a pull request; it is done when that is merged. */
export const BOARD_STATES = ["waiting", "running", "review", "delivering", "blocked", "done"] as const;
export type BoardState = (typeof BOARD_STATES)[number];

/** What « done » means for the tasks that wait on this one: the goal's own end, or the owner's acceptance (T3). */
export const ACCEPTANCES = ["auto", "owner"] as const;
export type Acceptance = (typeof ACCEPTANCES)[number];

export const IDEA_URGENCIES = ["critical", "bug", "minor", "idea"] as const;
export type IdeaUrgency = (typeof IDEA_URGENCIES)[number];
export const IDEA_PROGRESS = ["todo", "analysed", "partial", "to_test", "done"] as const;
export type IdeaProgress = (typeof IDEA_PROGRESS)[number];

export interface BoardFile { id: string; name: string; type: string; size: number; addedAt: number }

export interface BoardTask {
  id: string;
  title: string;
  description: string;
  /** The bot that does it; null: nobody yet (it cannot start). */
  botId: string | null;
  /** 1 (most urgent) to 5. */
  priority: number;
  /** Absolute time (ms) before which it does not start; null: as soon as it can. */
  startAt: number | null;
  /** The tasks it waits on (their real result). */
  deps: string[];
  /** Computed: the tasks that wait on this one. */
  dependents: string[];
  /** Computed: the deps that are not done yet (« attend N tâches »). */
  waitingOn: string[];
  files: BoardFile[];
  /** As stored; `column` says where it shows. */
  state: string;
  column: BoardState;
  acceptance: Acceptance;
  /** The owner pressed « Lancer »: it starts by itself once its deps are done and its date has come. */
  armed: boolean;
  goalId: string | null;
  /** A « Chantier » this task follows: done when the chantier is done (no duplicate of its graph here). */
  chantierId: string | null;
  ideaId: string | null;
  /** The conversation thread of the bot where it runs (0: not started). */
  thread: number;
  /** Why it is blocked, what the owner asked to fix, or what it waits for, in words. */
  note: string;
  /** The bot's own summary when it ended. */
  summary: string;
  batch: string;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  /** L163 (workboardroles.ts): its kind (matching a role), its own model, the model it will run on and from where (T10),
   * the bot that really runs it and why (T12). */
  kind?: TaskKind | "";
  model?: string;
  runModel?: string;
  modelFrom?: "task" | "role" | "bot";
  executorId?: string | null;
  execReason?: "pinned" | "named" | "role" | "lead-redirected" | "other-role" | "none";
  /** L175 (workboardpr.ts): delivered by a pull request on GitHub instead of staying local; null: local. */
  delivery?: BoardDelivery | null;
}

/** L175, T16 « Livrer par demande d'intégration » (workboardpr.ts). */
export const DELIVERY_PHASES = ["idle", "approval", "pushing", "open", "merged", "closed", "refused"] as const;
export type DeliveryPhase = (typeof DELIVERY_PHASES)[number];
export interface BoardDelivery {
  repo: string;
  /** The project's clone, inside the bot's files. */
  folder: string;
  /** The branch the pull request goes into ("" : the repository's default branch, found at the first delivery). */
  base: string;
  connectorId: string;
  /** The repository identity commits must carry ("" : the clone's own git identity). */
  identityName: string;
  identityEmail: string;
  branch: string;
  phase: DeliveryPhase;
  prNumber: number | null;
  prUrl: string;
  prState: "" | "open" | "merged" | "closed";
  note: string;
  /** What the owner is asked to allow before the first push to this repository (or after the account changed). */
  pending: { login: string; name: string; email: string; remote: string; base: string; branch: string; expectedLogin: string } | null;
}

export interface BoardIdea {
  id: string;
  /** Per account, 1, 2, 3… */
  number: number;
  author: string;
  title: string;
  body: string;
  urgency: IdeaUrgency;
  progress: IdeaProgress;
  files: BoardFile[];
  /** The tasks made from it (deleted tasks no longer count). */
  taskIds: string[];
  /** Computed: how many of them are done, out of how many. */
  done: number;
  total: number;
  createdAt: number;
  updatedAt: number;
}

/** L163 T12: the kinds of task, each matching a project role; « lead » is the chef (the main bot unless set). */
export const TASK_KINDS = ["code", "review", "research", "docs", "chore"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const BOARD_ROLES = ["lead", ...TASK_KINDS] as const;
export type BoardRoleName = (typeof BOARD_ROLES)[number];
/** A project role: who holds it, its model (T10), pinned = takes every task of its kind (T12). */
export interface BoardRole { role: BoardRoleName; botId: string | null; model: string; pinned: boolean }
/** T11: a named model per role. */
export interface BoardModelSet { id: string; name: string; models: Partial<Record<BoardRoleName, string>>; createdAt: number }
/** Something that waits for the owner: a task to review, a blocked one (its reason), one nobody can run. */
export interface BoardDecision { taskId: string; title: string; kind: "review" | "blocked" | "nobody"; why: string }

export interface BoardView { tasks: BoardTask[]; ideas: BoardIdea[]; roles?: BoardRole[]; modelSets?: BoardModelSet[]; decisions?: BoardDecision[] }

/** One finished task in the grouped recap for the main bot (T6, T7). */
export interface RecapItem { title: string; state: string; summary: string; note: string; priority: number }
