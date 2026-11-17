/**
 * "Aujourd'hui" — the time-saved table (today.ts, the Today page, Settings → Aujourd'hui).
 *
 * How many minutes a PERSON would usually spend doing one of each by hand. The page adds them up over what the bots
 * finished that day: the result is an ESTIMATE, shown as such with its formula (count × minutes per kind), never a
 * measurement. Nothing here is measured or learned; the numbers are round, deliberately modest guesses, and the owner of
 * the account can change any of them (Settings → Aujourd'hui → "Minutes par résultat", stored in settings.today).
 *
 * Shared by the server and the web app (web/src/types.ts re-exports it): this file imports nothing.
 * Same idea as OpenMausBot's shared/today-outcomes.ts (minutes per kind of outcome; Apache-2.0, ideas only).
 *
 * Kinds and what counts as one:
 * - task: a task of the task list marked done that day (task_update → done).
 * - bgTask: a background task (task_start) that finished that day.
 * - goal: a goal (goal mode) marked complete that day, with its evidence.
 * - routine: a routine run that finished that day ("done", or "quiet": it looked and had nothing to report).
 * - job: a long command on a bot's computer that ended successfully that day.
 * - fileEdit: one file changed by a turn ("Fichiers modifiés" card); at most FILES_PER_TURN files counted per turn,
 *   so one turn that rewrites a whole folder does not count as hours of work.
 * - emailSent: an email the bot sent (its own address, or Gmail / Outlook through a built-in app).
 * - messagePosted: a message the bot posted elsewhere (Slack).
 * - eventBooked: a calendar event created or changed.
 * - pagePublished: a page the bot published (page_publish).
 * - research: a stretch of web reading — at least RESEARCH_MIN_READS reads (web_fetch, search_web, reach_read…) by one
 *   bot with no gap longer than RESEARCH_GAP_MIN minutes between two of them — counts as one piece of research.
 */
export const TODAY_KINDS = ["task", "bgTask", "goal", "routine", "job", "fileEdit", "emailSent", "messagePosted", "eventBooked", "pagePublished", "research"] as const;
export type TodayKind = (typeof TODAY_KINDS)[number];

/** Minutes saved per finished outcome, by default. */
export const DEFAULT_MINUTES: Readonly<Record<TodayKind, number>> = {
  task: 15,
  bgTask: 20,
  goal: 30,
  routine: 5,
  job: 5,
  fileEdit: 4,
  emailSent: 3,
  messagePosted: 2,
  eventBooked: 3,
  pagePublished: 15,
  research: 10,
};

/** At most this many changed files are counted for one turn. */
export const FILES_PER_TURN = 10;
/** Web reads that make one "research". */
export const RESEARCH_MIN_READS = 3;
/** Longest pause (minutes) between two web reads of the same research. */
export const RESEARCH_GAP_MIN = 15;
/** The highest value an owner may set for one kind (8 hours). */
export const MAX_MINUTES = 480;

/** The table in force: the defaults, with the owner's overrides (whole minutes, 0–MAX_MINUTES) on top. */
export function minutesTable(overrides: Partial<Record<string, unknown>> | null | undefined): Record<TodayKind, number> {
  const out = { ...DEFAULT_MINUTES } as Record<TodayKind, number>;
  for (const k of TODAY_KINDS) {
    const v = overrides?.[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_MINUTES) out[k] = Math.round(v);
  }
  return out;
}

/** Minutes saved for these counts with this table: Σ count × minutes. */
export function minutesSaved(counts: Partial<Record<TodayKind, number>>, table: Record<TodayKind, number>): number {
  return TODAY_KINDS.reduce((sum, k) => sum + (counts[k] ?? 0) * table[k], 0);
}
