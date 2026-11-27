import type { Context } from "hono";
import { q } from "./db.js";
import { now, rows } from "./store.js";

/**
 * Send keys: a message is never created twice because its HTTP reply got lost.
 *
 * The composer makes one key per message it sends (`clientKey` in the JSON body, or the `Idempotency-Key` header) and
 * sends the same key again when it retries that message. The first request with a key writes the message and starts the
 * turn as usual; any later request with the same key, for the same account and the same bot, gets the first one's row
 * back and nothing else happens: no second message, no second turn. Two requests that arrive together share one result.
 *
 * Bounded: a key is remembered for SEND_KEY_WINDOW_MS (24 hours), per account and bot; older keys are pruned at each
 * write. A key is only ever looked up with the account that sent it, so one account's key says nothing about another's.
 * A request without a key (older clients, other programs) behaves exactly as before.
 */
export const SEND_KEY_WINDOW_MS = 24 * 3_600_000;
/** A plain token: what `crypto.randomUUID()` gives, and little else. Anything else is ignored. */
const KEY_SHAPE = /^[A-Za-z0-9_-]{8,100}$/;

q.run("CREATE TABLE IF NOT EXISTS send_keys (user_id TEXT NOT NULL, bot_id TEXT NOT NULL, key TEXT NOT NULL, generation INTEGER NOT NULL, seq INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, bot_id, key))");
q.run("CREATE INDEX IF NOT EXISTS send_keys_age ON send_keys (created_at)");

export const sendKeys = {
  /** The message a key already made (its conversation and place), within the window; null otherwise. */
  find(userId: string, botId: string, key: string, t = now()): { generation: number; seq: number } | null {
    return q.get<{ generation: number; seq: number }>("SELECT generation, seq FROM send_keys WHERE user_id = ? AND bot_id = ? AND key = ? AND created_at > ?", userId, botId, key, t - SEND_KEY_WINDOW_MS) ?? null;
  },
  remember(userId: string, botId: string, key: string, generation: number, seq: number, t = now()) {
    q.run("DELETE FROM send_keys WHERE created_at <= ?", t - SEND_KEY_WINDOW_MS);
    q.run("INSERT INTO send_keys (user_id, bot_id, key, generation, seq, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, bot_id, key) DO UPDATE SET generation = excluded.generation, seq = excluded.seq, created_at = excluded.created_at", userId, botId, key, generation, seq, t);
  },
};

/** The key of a request, when it carries a usable one. */
async function keyOf(c: Context): Promise<string> {
  const fromBody = await c.req.json().then((b) => (b && typeof b === "object" ? (b as Record<string, unknown>).clientKey : undefined), () => undefined);
  const raw = typeof fromBody === "string" ? fromBody : c.req.header("idempotency-key") ?? "";
  return KEY_SHAPE.test(raw) ? raw : "";
}

/** Sends under way, by account, bot and key: a second request with the same key waits for the first one's answer. */
const underWay = new Map<string, Promise<{ generation: number; seq: number } | null>>();

/**
 * Runs `send` (the message route's own work, which answers `{ row }`) at most once per key. `botId` is a bot the caller
 * was already checked to have access to. A repeat answers `{ row, duplicate: true }` with the stored row.
 */
export async function sendOnce(c: Context, botId: string, send: () => Promise<Response>): Promise<Response> {
  const key = await keyOf(c);
  if (!key) return send();
  const userId = (c.get("user") as { id: string }).id;
  const slot = `${userId}\n${botId}\n${key}`;
  const again = (at: { generation: number; seq: number } | null) => {
    const row = at ? rows.get(botId, at.generation, at.seq) : null;
    return row ? c.json({ row, duplicate: true }) : null;
  };
  const earlier = again(underWay.has(slot) ? await underWay.get(slot)!.catch(() => null) : sendKeys.find(userId, botId, key));
  if (earlier) return earlier;
  let settle!: (at: { generation: number; seq: number } | null) => void;
  underWay.set(slot, new Promise((r) => { settle = r; }));
  let made: { generation: number; seq: number } | null = null;
  try {
    const res = await send();
    if (res.status === 200) {
      const row = await res.clone().json().then((j) => (j as { row?: { generation?: unknown; seq?: unknown } } | null)?.row, () => undefined);
      if (row && typeof row.generation === "number" && typeof row.seq === "number") { made = { generation: row.generation, seq: row.seq }; sendKeys.remember(userId, botId, key, made.generation, made.seq); }
    }
    return res;
  } finally {
    settle(made);
    underWay.delete(slot);
  }
}
