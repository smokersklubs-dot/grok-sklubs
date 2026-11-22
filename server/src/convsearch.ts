import { db, q } from "./db.js";
import type { SearchHit } from "./shared.js";
import { fold, rankNotes, tokenize } from "./agent/recall.js";

/**
 * Search across every conversation, current and earlier (conversation_search, the search box of the app).
 *
 * The same words as the memory recall (agent/recall.ts): accents, elisions and plurals folded, small words dropped — so
 * "reunion budget" finds "Réunion du budget" and "les factures" finds "facture". A message holding any of the words is a
 * candidate; the candidates are ranked by BM25 (the words they hold, the rarer the better, and recency breaks ties), and
 * the messages that only hold a word inside a longer one ("factur" in "facturation") come after, newest first.
 *
 * SQLite cannot fold accents by itself: a small deterministic function does it, registered on the server's own
 * connection. Node's `DatabaseSync.function(name, options, fn)` (node:sqlite, added in v22.13.0 — the minimum this
 * server needs, package.json "engines"): https://nodejs.org/docs/latest-v22.x/api/sqlite.html#databasefunctionname-options-function
 */

/** Messages ranked at most per search (the newest that hold a word); each is folded once. */
export const SEARCH_CANDIDATES = 2000;
/** Words of the query used at most. */
export const SEARCH_TERMS = 6;

let registered = false;
function register() {
  if (registered) return;
  // sk_hits(text, '["word", …]'): how many of the folded words the folded text holds (0: not a candidate).
  db.function("sk_hits", { deterministic: true }, (text: unknown, terms: unknown) => {
    if (typeof text !== "string" || !text) return 0;
    const f = fold(text);
    let n = 0;
    for (const t of JSON.parse(String(terms)) as string[]) if (f.includes(t)) n++;
    return n;
  });
  registered = true;
}

export function searchMessages(userId: string, query: string, opts: { botId?: string; limit?: number } = {}): SearchHit[] {
  register();
  // The query's meaningful words (stemmed: a plural finds the singular); only small words: the plain folded pieces.
  let terms = [...new Set(tokenize(query))].slice(0, SEARCH_TERMS);
  if (!terms.length) terms = [...new Set(fold(query).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1))].slice(0, SEARCH_TERMS);
  if (!terms.length) return [];
  const limit = Math.min(opts.limit ?? 40, 40);
  const found = q.all<any>(
    `SELECT r.bot_id, r.generation, r.seq, r.thread, r.created_at, r.body, b.name, b.generation AS cur FROM rows r JOIN bots b ON b.id = r.bot_id
     WHERE b.user_id = ? AND b.hidden = 0 ${opts.botId ? "AND b.id = ?" : ""} AND r.kind = 'message' AND sk_hits(json_extract(r.body, '$.text'), ?) > 0
     ORDER BY r.created_at DESC LIMIT ?`,
    userId, ...(opts.botId ? [opts.botId] : []), JSON.stringify(terms), SEARCH_CANDIDATES);
  const items = found.map((r, i) => {
    const body = JSON.parse(r.body);
    return { r, body, text: String(body.text ?? ""), note: { id: String(i), text: String(body.text ?? ""), createdAt: Number(r.created_at), status: "active" as const, confidence: "once" as const } };
  });
  // Whole words first (ranked), then the messages that only hold a piece of a word, newest first.
  const ranked = rankNotes(items.map((x) => x.note), query);
  const order = [...ranked.map((x) => Number(x.note.id))];
  const seen = new Set(order);
  for (let i = 0; i < items.length; i++) if (!seen.has(i)) order.push(i);
  return order.slice(0, limit).map((i) => {
    const { r, body, text } = items[i];
    const f = fold(text);
    const hits = terms.map((t) => f.indexOf(t)).filter((n) => n >= 0);
    const at = hits.length ? Math.min(...hits) : 0;
    return {
      botId: r.bot_id, botName: r.name, generation: r.generation, current: r.generation === r.cur, seq: r.seq, at: r.created_at, role: body.role, ...(r.thread ? { thread: r.thread } : {}),
      snippet: (at > 80 ? "…" : "") + text.slice(Math.max(0, at - 80), at + 220).replace(/\s+/g, " ") + (text.length > at + 220 ? "…" : ""),
    };
  });
}
