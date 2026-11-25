/** L161 « récapitulatif global » (globalrecap.ts): one recap of every bot over the last days. Client-safe. */
export interface GlobalRecapBot {
  botId: string; botName: string; shared: boolean;
  /** Things finished in the period (goals, tasks, routine runs, files, mails…), as "Aujourd'hui" counts them. */
  finished: number; minutes: number; kinds: Record<string, number>;
  /** Up to 3 of the newest finished things. */
  highlights: string[];
  /** Its latest line in a chat (null: never). */
  lastActiveAt: number | null;
  /** Its goals still open (up to 3). */
  openGoals: string[];
  /** Cards and requests waiting for the owner now. */
  waiting: number;
  /** Open goals but nothing for DORMANT_DAYS days: left aside. */
  dormant: boolean;
}
export interface GlobalRecap {
  days: number; start: number; end: number; generatedAt: number;
  totals: { finished: number; minutes: number; waiting: number; bots: number; dormant: number };
  bots: GlobalRecapBot[];
  /** The same in a few lines (at most 2 500 characters), for a bot to read or the owner to copy. */
  text: string;
}
