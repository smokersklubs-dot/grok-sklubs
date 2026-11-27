import { db, q } from "./db.js";
import type { SearchHit } from "./shared.js";
import type { AroundMessage } from "./memorytypes.js";
import { fold, rankNotes, tokenize } from "./agent/recall.js";

/**
 * Search across every conversation, current and earlier (conversation_search, the search box of the app).
 *
 * The same words as the memory recall (agent/recall.ts): accents, elisions and plurals folded, small words dropped — so
 * "reunion budget" finds "Réunion du budget" and "les factures" finds "facture". A message holding any of the words is a
 * candidate; the candidates are ranked by BM25 (the words they hold, the rarer the better, and recency breaks ties), and
 * the messages that only hold a word inside a longer one ("factur" in "facturation") come after, newest first.
 *
 * L73: candidates come from a full-text index (SQLite FTS5, built into node:sqlite) kept up to date by triggers on
 * `rows`, so a search no longer reads every message. The index folds accents itself (tokenizer "unicode61
 * remove_diacritics 2": https://www.sqlite.org/fts5.html#unicode61_tokenizer) and each query word is a prefix query
 * (`"factur"*`: https://www.sqlite.org/fts5.html#fts5_prefix_queries). It holds no text of its own (contentless, with
 * deletes: https://www.sqlite.org/fts5.html#contentless_delete_tables). When the index is missing (an SQLite built
 * without FTS5) or finds nothing, the former scan runs: a small deterministic function folds accents on the server's own
 * connection — Node's `DatabaseSync.function(name, options, fn)` (node:sqlite, added in v22.13.0, the minimum this
 * server needs): https://nodejs.org/docs/latest-v22.x/api/sqlite.html#databasefunctionname-options-function — and it
 * also finds a word inside a longer one ("1234" in "A-1234").
 *
 * Filters: a date range (`since` included, `until` excluded, in ms) and one bot. `messagesAround` gives the few messages
 * before and after a hit, in the same conversation and thread.
 */

/** Messages ranked at most per search (the newest that hold a word); each is folded once. */
export const SEARCH_CANDIDATES = 2000;
/** Words of the query used at most. */
export const SEARCH_TERMS = 6;
/** « Messages autour »: how many before and after, at most. */
export const AROUND_MAX = 10;

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

// ── The full-text index (created at module load, like the other tables; filled once from the existing messages) ──────
const KEY = "bot_id = %.bot_id AND generation = %.generation AND seq = %.seq";
const key = (side: "new" | "old") => KEY.replaceAll("%", side);
const indexText = "COALESCE(json_extract(new.body, '$.text'), '')";
function createIndex(): boolean {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS rows_fts_map (id INTEGER PRIMARY KEY, bot_id TEXT NOT NULL, generation INTEGER NOT NULL, seq INTEGER NOT NULL, UNIQUE (bot_id, generation, seq));
      CREATE VIRTUAL TABLE IF NOT EXISTS rows_fts USING fts5(text, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');
      CREATE TABLE IF NOT EXISTS rows_fts_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
      CREATE TRIGGER IF NOT EXISTS rows_fts_ai AFTER INSERT ON rows WHEN new.kind = 'message' BEGIN
        INSERT OR IGNORE INTO rows_fts_map (bot_id, generation, seq) VALUES (new.bot_id, new.generation, new.seq);
        DELETE FROM rows_fts WHERE rowid = (SELECT id FROM rows_fts_map WHERE ${key("new")});
        INSERT INTO rows_fts (rowid, text) SELECT id, ${indexText} FROM rows_fts_map WHERE ${key("new")};
      END;
      CREATE TRIGGER IF NOT EXISTS rows_fts_au AFTER UPDATE OF body ON rows WHEN new.kind = 'message' BEGIN
        INSERT OR IGNORE INTO rows_fts_map (bot_id, generation, seq) VALUES (new.bot_id, new.generation, new.seq);
        DELETE FROM rows_fts WHERE rowid = (SELECT id FROM rows_fts_map WHERE ${key("new")});
        INSERT INTO rows_fts (rowid, text) SELECT id, ${indexText} FROM rows_fts_map WHERE ${key("new")};
      END;
      CREATE TRIGGER IF NOT EXISTS rows_fts_ad AFTER DELETE ON rows WHEN old.kind = 'message' BEGIN
        DELETE FROM rows_fts WHERE rowid = (SELECT id FROM rows_fts_map WHERE ${key("old")});
        DELETE FROM rows_fts_map WHERE ${key("old")};
      END;`);
    if (!q.get("SELECT v FROM rows_fts_meta WHERE k = 'filled'")) {
      // The messages written before the index existed, once (in one transaction, so a crash leaves it to do again).
      q.tx(() => {
        q.run("INSERT INTO rows_fts (rows_fts) VALUES ('delete-all')");
        q.run("DELETE FROM rows_fts_map");
        q.run("INSERT INTO rows_fts_map (bot_id, generation, seq) SELECT bot_id, generation, seq FROM rows WHERE kind = 'message'");
        q.run("INSERT INTO rows_fts (rowid, text) SELECT m.id, COALESCE(json_extract(r.body, '$.text'), '') FROM rows_fts_map m JOIN rows r ON r.bot_id = m.bot_id AND r.generation = m.generation AND r.seq = m.seq");
        q.run("INSERT INTO rows_fts_meta (k, v) VALUES ('filled', ?)", Date.now());
      });
    }
    return true;
  } catch (err) {
    console.error("[convsearch] full-text index unavailable, plain scan used:", (err as Error).message);
    return false;
  }
}
const hasIndex = createIndex();
/** Whether the full-text index is in use (false: SQLite without FTS5, the plain scan is used). */
export const fullTextIndex = () => hasIndex;

export interface SearchOptions { botId?: string; limit?: number; /** ms, included */ since?: number; /** ms, excluded */ until?: number }

/** The query as an FTS5 expression: each word a quoted prefix, any of them (`"reunion"* OR "budget"*`). */
export const ftsQuery = (terms: string[]) => terms.map((t) => `"${t.replace(/"/g, "")}"*`).join(" OR ");

export function searchMessages(userId: string, query: string, opts: SearchOptions = {}): SearchHit[] {
  register();
  // The query's meaningful words (stemmed: a plural finds the singular); only small words: the plain folded pieces.
  let terms = [...new Set(tokenize(query))].slice(0, SEARCH_TERMS);
  if (!terms.length) terms = [...new Set(fold(query).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1))].slice(0, SEARCH_TERMS);
  if (!terms.length) return [];
  const limit = Math.min(opts.limit ?? 40, 40);
  const filters = `b.user_id = ? AND b.hidden = 0 ${opts.botId ? "AND b.id = ?" : ""} ${opts.since != null ? "AND r.created_at >= ?" : ""} ${opts.until != null ? "AND r.created_at < ?" : ""} AND r.kind = 'message'`;
  const params = [userId, ...(opts.botId ? [opts.botId] : []), ...(opts.since != null ? [opts.since] : []), ...(opts.until != null ? [opts.until] : [])];
  const cols = "r.bot_id, r.generation, r.seq, r.thread, r.created_at, r.body, b.name, b.generation AS cur";
  let found: any[] = [];
  if (hasIndex) {
    try {
      found = q.all<any>(
        `SELECT ${cols} FROM rows_fts f JOIN rows_fts_map m ON m.id = f.rowid JOIN rows r ON r.bot_id = m.bot_id AND r.generation = m.generation AND r.seq = m.seq
         JOIN bots b ON b.id = r.bot_id WHERE rows_fts MATCH ? AND ${filters} ORDER BY r.created_at DESC LIMIT ?`,
        ftsQuery(terms), ...params, SEARCH_CANDIDATES);
    } catch (err) { console.error("[convsearch]", (err as Error).message); }
  }
  // No index, or nothing found by whole words or word starts: the plain scan (a word inside a longer one).
  if (!found.length)
    found = q.all<any>(
      `SELECT ${cols} FROM rows r JOIN bots b ON b.id = r.bot_id WHERE ${filters} AND sk_hits(json_extract(r.body, '$.text'), ?) > 0 ORDER BY r.created_at DESC LIMIT ?`,
      ...params, JSON.stringify(terms), SEARCH_CANDIDATES);
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


/**
 * « Messages autour »: the `n` messages before and after one message, in the same conversation (generation) and the same
 * thread, oldest first. Only a bot of this user (never a hidden one); null when there is no such message.
 */
export function messagesAround(userId: string, botId: string, generation: number, seq: number, n = 3): AroundMessage[] | null {
  const k = Math.max(1, Math.min(AROUND_MAX, Math.floor(n) || 3));
  const own = q.get<{ id: string }>("SELECT id FROM bots WHERE id = ? AND user_id = ? AND hidden = 0", botId, userId);
  const hit = own ? q.get<{ thread: number | null }>("SELECT thread FROM rows WHERE bot_id = ? AND generation = ? AND seq = ? AND kind = 'message'", botId, generation, seq) : undefined;
  if (!hit) return null;
  const thread = hit.thread ?? 0;
  const pick = (dir: "<" | ">") => q.all<{ seq: number; created_at: number; body: string }>(
    `SELECT seq, created_at, body FROM rows WHERE bot_id = ? AND generation = ? AND kind = 'message' AND COALESCE(thread, 0) = ? AND seq ${dir} ? ORDER BY seq ${dir === "<" ? "DESC" : "ASC"} LIMIT ?`,
    botId, generation, thread, seq, k);
  const self = q.get<{ seq: number; created_at: number; body: string }>("SELECT seq, created_at, body FROM rows WHERE bot_id = ? AND generation = ? AND seq = ?", botId, generation, seq)!;
  return [...pick("<").reverse(), self, ...pick(">")].map((r) => {
    const body = JSON.parse(r.body);
    return { seq: r.seq, at: r.created_at, role: body.role === "user" ? "user" : "assistant", text: String(body.text ?? ""), hit: r.seq === seq };
  });
}

/** A "YYYY-MM-DD" day as ms (UTC midnight), or undefined. `end`: the day after (so the day itself is included). */
export function dayBound(v: unknown, end = false): number | undefined {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return undefined;
  const t = Date.parse(`${v.trim()}T00:00:00Z`);
  return Number.isFinite(t) ? t + (end ? 86400_000 : 0) : undefined;
}

/** What the conversation_search tool answers (tools.ts): hits with their number, or the messages around one of them. */
export function conversationSearchAnswer(userId: string, botId: string, a: Record<string, unknown>): { content: string; summary: string } {
  if (a.around_seq != null) {
    const bot = q.get<{ generation: number }>("SELECT generation FROM bots WHERE id = ? AND user_id = ?", botId, userId);
    const gen = a.generation != null ? Number(a.generation) : bot?.generation ?? 0;
    const list = messagesAround(userId, botId, gen, Number(a.around_seq), Number(a.count ?? 3));
    if (!list) return { content: "No message with that number in this conversation.", summary: "0" };
    return { content: list.map((m) => `${m.hit ? "→ " : ""}[#${m.seq} · ${new Date(m.at).toISOString().slice(0, 16)} · ${m.role}] ${m.text.slice(0, 1200)}`).join("\n"), summary: `${list.length}` };
  }
  const everyone = a.scope === "everyone";
  const hits = searchMessages(userId, String(a.query ?? ""), { botId: everyone ? undefined : botId, limit: 12, since: dayBound(a.since), until: dayBound(a.until, true) });
  if (!hits.length) return { content: "Nothing matching was said.", summary: "0" };
  return { content: hits.map((h) => `[#${h.seq}${h.current ? "" : ` (conversation ${h.generation})`} · ${new Date(h.at).toISOString().slice(0, 16)} · ${h.role === "user" ? "user" : h.botName}${h.current ? "" : " · earlier conversation"}${everyone ? ` · in ${h.botName}'s chat` : ""}] ${h.snippet}`).join("\n"), summary: `${hits.length}` };
}
