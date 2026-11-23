/**
 * « Tableau de travail » (L163; workboard.ts, docs/TABLEAU.md): the wire types, shared by the server and the web app (the
 * web imports them straight from here, so shared.ts does not grow).
 *
 * Clean room: built from docs/cleanroom/10-timon.md (T1 to T8) only; no code of the studied product was read.
 */

/** A task's state. An unknown state left by another version is shown in « done » without being rewritten (T1). */
export const BOARD_STATES = ["waiting", "running", "review", "blocked", "done"] as const;
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

export interface BoardView { tasks: BoardTask[]; ideas: BoardIdea[] }

/** One finished task in the grouped recap for the main bot (T6, T7). */
export interface RecapItem { title: string; state: string; summary: string; note: string; priority: number }
