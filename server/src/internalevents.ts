/**
 * Internal events (L173, docs/cleanroom/10-timon.md T79): things that happen inside Sklubot and that an owner's trigger
 * (automations.ts) may react to — a board task done or blocked, an idea resolved, a routine run ended, a recorded flow
 * that saw a page change. Server-side only; nothing here goes to the web app or to a model.
 *
 * Loop guard: an event that an automation itself caused carries `cause: "trigger"`, and automations never react to those
 * (two triggers never feed each other, T79 v2). Every event names the account it belongs to; listeners only ever see
 * their own account's events because they filter on `userId` (automations.ts does).
 */

export const INTERNAL_EVENTS = ["board.task_done", "board.task_blocked", "idea.resolved", "routine.run_ok", "routine.run_failed", "flow.page_changed", "flow.run_failed"] as const;
export type InternalEventType = (typeof INTERNAL_EVENTS)[number];
export const isInternalEvent = (s: unknown): s is InternalEventType => (INTERNAL_EVENTS as readonly string[]).includes(String(s));

export interface InternalEvent {
  type: InternalEventType;
  userId: string;
  /** The bot concerned, when there is one (a board task's bot, a routine's bot, a flow's bot). */
  botId?: string;
  /** What it is about: a task id, an idea id, a routine id, a flow id. */
  subjectId: string;
  /** A short label for the owner (a task title, a routine name). */
  label: string;
  /** "trigger": an automation caused it, so no automation reacts to it. */
  cause?: "trigger";
  data?: Record<string, unknown>;
}

type Listener = (e: InternalEvent) => void;
const listeners: Listener[] = [];
export const onInternalEvent = (fn: Listener) => { listeners.push(fn); };

/** Tells every listener, after the current work (a listener's failure never breaks the caller). */
export function emitInternal(e: InternalEvent) {
  for (const fn of listeners) {
    queueMicrotask(() => { try { fn(e); } catch (err) { console.error("[internal event]", e.type, (err as Error).message); } });
  }
}
