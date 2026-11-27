/** L142: which bots just stopped or started work, between two snapshots of the live states (pure; lib/stopcauses.ts). */
/** The bots whose turn just ended (running before, not now): the list is fetched again when there are any. */
export function endedRuns(prev: Record<string, { running: boolean }>, next: Record<string, { running: boolean }>): string[] {
  return Object.keys(next).filter((id) => prev[id]?.running && !next[id].running);
}
/** Bots that started work: their chip goes away at once (the new work may end differently). */
export function startedRuns(prev: Record<string, { running: boolean }>, next: Record<string, { running: boolean }>): string[] {
  return Object.keys(next).filter((id) => next[id].running && !prev[id]?.running);
}
