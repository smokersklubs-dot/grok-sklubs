/**
 * L154 « boîte d'envoi locale de la transcription » (backlog A-FAIRE): what a call sends to the server — each sentence
 * the owner said (a voice message) and, at the end, the call's transcript — is kept in this browser until the server
 * has it. A send that fails because the network dropped (no answer, 408, 429, 5xx) stays in the outbox and goes again
 * when the browser is back online, every 15 seconds while something waits, and at the next page load. A refusal (any
 * other 4xx) is dropped: sending it again would be refused again.
 *
 * Nothing is sent twice: each voice message carries its own send key (`clientKey`, server sendkeys.ts), so a retry of a
 * message the server already wrote returns that message; ending a call that is already closed answers `duplicate`.
 * At most 200 items and 7 days are kept; storage that is blocked (private mode) only loses the outbox, never the call.
 */
export interface OutboxItem { id: string; path: string; body: unknown; tries: number; at: number; kind: "utterance" | "end" }
export type SendResult = "ok" | "retry" | "drop";
export interface OutboxStorage { getItem(k: string): string | null; setItem(k: string, v: string): void }

export const OUTBOX_KEY = "sklubot.callOutbox";
export const OUTBOX_MAX = 200;
export const OUTBOX_MAX_AGE_MS = 7 * 86_400_000;

/** What an HTTP status means for the outbox (0: no answer at all). */
export function resultOf(status: number): SendResult {
  if (status >= 200 && status < 300) return "ok";
  if (status === 0 || status === 408 || status === 429 || status >= 500) return "retry";
  return "drop";
}

export function createOutbox(o: { storage: () => OutboxStorage | null; send: (item: OutboxItem) => Promise<SendResult>; now?: () => number; onChange?: (n: number) => void }) {
  const now = o.now ?? (() => Date.now());
  const read = (): OutboxItem[] => {
    try {
      const raw = o.storage()?.getItem(OUTBOX_KEY);
      const list = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
      return Array.isArray(list) ? list.filter((i) => i && typeof i.path === "string" && now() - (i.at ?? 0) < OUTBOX_MAX_AGE_MS) : [];
    } catch { return []; }
  };
  const write = (list: OutboxItem[]) => {
    try { o.storage()?.setItem(OUTBOX_KEY, JSON.stringify(list.slice(-OUTBOX_MAX))); } catch { /* blocked storage */ }
    o.onChange?.(list.length);
  };
  let flushing: Promise<number> | null = null;
  const box = {
    pending: (): OutboxItem[] => read(),
    /** Tries to send now; kept for later when the network fails. Resolves with what happened to this item. */
    async send(item: Omit<OutboxItem, "tries" | "at">): Promise<SendResult> {
      const full: OutboxItem = { ...item, tries: 1, at: now() };
      let r: SendResult;
      try { r = await o.send(full); } catch { r = "retry"; }
      if (r === "retry") write([...read().filter((i) => i.id !== full.id), full]);
      return r;
    },
    /** Keeps an item to send later without trying now (the page is going away: a beacon goes too). */
    queue(item: Omit<OutboxItem, "tries" | "at">) { write([...read().filter((i) => i.id !== item.id), { ...item, tries: 0, at: now() }]); },
    /** Sends what waits, oldest first; stops at the first one that still cannot go (order kept). Returns how many went. */
    flush(): Promise<number> {
      flushing ??= (async () => {
        let sent = 0;
        try {
          for (const item of read()) {
            let r: SendResult;
            try { r = await o.send({ ...item, tries: item.tries + 1 }); } catch { r = "retry"; }
            if (r === "retry") { write(read().map((i) => (i.id === item.id ? { ...i, tries: i.tries + 1 } : i))); break; }
            write(read().filter((i) => i.id !== item.id));
            if (r === "ok") sent++;
          }
        } finally { flushing = null; }
        return sent;
      })();
      return flushing;
    },
  };
  return box;
}
