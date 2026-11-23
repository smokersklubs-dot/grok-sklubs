import { q } from "./db.js";
import { emit } from "./bus.js";
import type { ServerEvent } from "./shared.js";
import { audit, bots, clip, newId, now } from "./store.js";
import { TextOp } from "./clientshared/textop.js";
import type { LiveDocChange, LiveDocEvent, LiveDocInfo } from "./clientshared/livedoctypes.js";

/**
 * L178 « Document partagé » : a Markdown document the owner and their bots edit at the same time.
 *
 * Conflicts: operational transformation (clientshared/textop.ts, adapted from ot.js, MIT). The server is the single
 * source of truth: every change names the revision it was made on; changes the author had not seen yet are folded in
 * first (TextOp.transform), then it is applied and numbered. Two people typing at the same place both keep their text.
 * A bot edits the CURRENT text (doc_live_edit: replace one exact passage), so it never conflicts.
 *
 * History: every change is kept with its author, time and its inverse (the text it removed), 2000 per document; the
 * text at any kept revision can be rebuilt. Undo: « Annuler » on a change applies its inverse, transformed over the
 * changes made since, as a new change (nothing is rewritten; the undo can itself be undone).
 *
 * Live: each change goes to the owner's open pages as a "livedoc" event (web/src/lib/livedocEvents.ts). Bots see a
 * document only when the owner shared it with them. Tables created here (house pattern).
 */
q.run(`CREATE TABLE IF NOT EXISTS live_docs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0, bots TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
q.run(`CREATE TABLE IF NOT EXISTS live_doc_ops (doc_id TEXT NOT NULL REFERENCES live_docs(id) ON DELETE CASCADE, rev INTEGER NOT NULL, op TEXT NOT NULL, inverse TEXT NOT NULL, author_kind TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL, undoes INTEGER, undone INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, PRIMARY KEY (doc_id, rev))`);
q.run("CREATE INDEX IF NOT EXISTS live_docs_user ON live_docs (user_id, updated_at)");

export const MAX_DOC_CHARS = 200_000;
export const KEEP_OPS = 2000;
export const MAX_DOCS = 100;

export interface Author { kind: "owner" | "bot"; id: string; name: string }
interface Row { id: string; user_id: string; title: string; text: string; revision: number; bots: string; created_at: number; updated_at: number }
const parseBots = (s: string): string[] => { try { const v = JSON.parse(s); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };
const info = (r: Row): LiveDocInfo => ({ id: r.id, title: r.title, revision: r.revision, bots: parseBots(r.bots), chars: r.text.length, createdAt: r.created_at, updatedAt: r.updated_at });
const rowOf = (id: string) => q.get<Row>("SELECT * FROM live_docs WHERE id = ?", id) ?? null;

export class LiveDocError extends Error { constructor(public status: 400 | 404 | 409 | 413, message: string) { super(message); } }

/** Words of a change for the history ("+12 −3"), from its operation. */
function counts(op: TextOp) { let plus = 0, minus = 0; for (const o of op.ops) { if (typeof o === "string") plus += o.length; else if (o < 0) minus -= o; } return { plus, minus }; }

function broadcast(userId: string, ev: LiveDocEvent) {
  // Not part of the shared ServerEvent union on purpose (shared.ts is at its size limit): the web app reads it first.
  emit(userId, ev as unknown as ServerEvent);
}

export const liveDocs = {
  list: (userId: string): LiveDocInfo[] => q.all<Row>("SELECT * FROM live_docs WHERE user_id = ? ORDER BY updated_at DESC", userId).map(info),
  /** The documents a bot may see: its owner's, shared with it. */
  forBot: (botId: string): LiveDocInfo[] => { const b = bots.byId(botId); return b ? liveDocs.list(b.userId).filter((d) => d.bots.includes(botId)) : []; },
  owned(userId: string, id: string) { const r = rowOf(id); return r && r.user_id === userId ? { ...info(r), text: r.text } : null; },
  /** A document by id or title, if shared with this bot. */
  forBotByName(botId: string, name: string) {
    const b = bots.byId(botId);
    if (!b) return null;
    const n = String(name ?? "").trim().toLowerCase();
    const r = q.all<Row>("SELECT * FROM live_docs WHERE user_id = ?", b.userId).find((x) => x.id === name || x.title.toLowerCase() === n);
    return r && parseBots(r.bots).includes(botId) ? { ...info(r), text: r.text } : null;
  },
  create(userId: string, f: { title?: unknown; text?: unknown }): LiveDocInfo {
    const count = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM live_docs WHERE user_id = ?", userId)!.n;
    if (count >= MAX_DOCS) throw new LiveDocError(409, "At most {n} shared documents.");
    const text = typeof f.text === "string" ? f.text : "";
    if (text.length > MAX_DOC_CHARS) throw new LiveDocError(413, "The document is too long.");
    const id = newId("ldoc"), t = now();
    q.run("INSERT INTO live_docs (id, user_id, title, text, revision, bots, created_at, updated_at) VALUES (?, ?, ?, ?, 0, '[]', ?, ?)", id, userId, clip(String(f.title ?? "").trim(), 120) || "Sans titre", text, t, t);
    audit(userId, "tool", `Shared document created: ${clip(String(f.title ?? ""), 80)}`);
    return info(rowOf(id)!);
  },
  update(userId: string, id: string, f: { title?: unknown; bots?: unknown }): LiveDocInfo {
    const r = rowOf(id);
    if (!r || r.user_id !== userId) throw new LiveDocError(404, "No such document.");
    const title = f.title === undefined ? r.title : clip(String(f.title).trim(), 120) || r.title;
    const list = f.bots === undefined ? parseBots(r.bots) : (Array.isArray(f.bots) ? f.bots : []).map(String).filter((b, i, a) => a.indexOf(b) === i && bots.byId(b)?.userId === userId).slice(0, 50);
    q.run("UPDATE live_docs SET title = ?, bots = ?, updated_at = ? WHERE id = ?", title, JSON.stringify(list), now(), id);
    return info(rowOf(id)!);
  },
  remove(userId: string, id: string) {
    const r = rowOf(id);
    if (!r || r.user_id !== userId) throw new LiveDocError(404, "No such document.");
    q.run("DELETE FROM live_doc_ops WHERE doc_id = ?", id);
    q.run("DELETE FROM live_docs WHERE id = ?", id);
    audit(userId, "tool", `Shared document deleted: ${clip(r.title, 80)}`);
  },

  /**
   * A change made on `revision` (the author's last known one). Changes made since are folded in first, then it is
   * applied, kept and sent to everyone. Returns the change as applied and the new revision.
   */
  apply(id: string, revision: number, raw: unknown, author: Author, opts: { clientId?: string; undoes?: number } = {}): { revision: number; op: TextOp } {
    const r = rowOf(id);
    if (!r) throw new LiveDocError(404, "No such document.");
    let op: TextOp;
    try { op = raw instanceof TextOp ? raw : TextOp.fromJSON(raw); } catch { throw new LiveDocError(400, "This change cannot be read."); }
    if (!Number.isInteger(revision) || revision < 0 || revision > r.revision) throw new LiveDocError(409, "This change was made on an unknown version: reload the document.");
    const oldest = q.get<{ rev: number }>("SELECT MIN(rev) AS rev FROM live_doc_ops WHERE doc_id = ?", id)?.rev;
    if (revision < r.revision && (oldest === undefined || oldest === null || oldest > revision + 1)) throw new LiveDocError(409, "This change was made on a version too old: reload the document.");
    const since = q.all<{ op: string }>("SELECT op FROM live_doc_ops WHERE doc_id = ? AND rev > ? ORDER BY rev", id, revision);
    try { for (const s of since) op = TextOp.transform(op, TextOp.fromJSON(JSON.parse(s.op)))[0]; } catch { throw new LiveDocError(409, "This change no longer fits the document: reload it."); }
    let text: string;
    try { text = op.apply(r.text); } catch { throw new LiveDocError(409, "This change no longer fits the document: reload it."); }
    if (text.length > MAX_DOC_CHARS) throw new LiveDocError(413, "The document is too long.");
    const rev = r.revision + 1, at = now();
    const inverse = op.invert(r.text);
    q.run("UPDATE live_docs SET text = ?, revision = ?, updated_at = ? WHERE id = ?", text, rev, at, id);
    q.run("INSERT INTO live_doc_ops (doc_id, rev, op, inverse, author_kind, author_id, author_name, undoes, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", id, rev, JSON.stringify(op.toJSON()), JSON.stringify(inverse.toJSON()), author.kind, author.id, clip(author.name, 60), opts.undoes ?? null, at);
    if (opts.undoes) q.run("UPDATE live_doc_ops SET undone = 1 WHERE doc_id = ? AND rev = ?", id, opts.undoes);
    q.run("DELETE FROM live_doc_ops WHERE doc_id = ? AND rev <= ?", id, rev - KEEP_OPS);
    broadcast(r.user_id, { type: "livedoc", docId: id, revision: rev, op: op.toJSON(), author: author.name, authorKind: author.kind, ...(opts.clientId ? { clientId: clip(opts.clientId, 40) } : {}) });
    return { revision: rev, op };
  },

  /** A bot's edit on the current text: one exact passage replaced (or text added at the end when `find` is empty). */
  replace(id: string, find: string, replacement: string, author: Author): { revision: number; text: string } {
    const r = rowOf(id);
    if (!r) throw new LiveDocError(404, "No such document.");
    let at: number;
    if (!find) at = r.text.length;
    else {
      at = r.text.indexOf(find);
      if (at < 0) throw new LiveDocError(400, "That passage is not in the document (it may have just changed): read it again.");
      if (r.text.indexOf(find, at + 1) >= 0) throw new LiveDocError(400, "That passage appears several times: give a longer, unique passage.");
    }
    const op = new TextOp().retain(at).delete(find.length).insert(replacement).retain(r.text.length - at - find.length);
    const out = liveDocs.apply(id, r.revision, op, author);
    return { revision: out.revision, text: rowOf(id)!.text };
  },

  history(id: string, limit = 100): LiveDocChange[] {
    return q.all<any>("SELECT rev, op, author_kind, author_name, undoes, undone, at FROM live_doc_ops WHERE doc_id = ? ORDER BY rev DESC LIMIT ?", id, Math.min(KEEP_OPS, limit))
      .map((x) => ({ revision: x.rev, author: x.author_name, authorKind: x.author_kind, at: x.at, undone: !!x.undone, undoes: x.undoes ?? null, ...counts(TextOp.fromJSON(JSON.parse(x.op))) }));
  },

  /** The text as it was right after `revision` (the current text with later changes taken back). */
  textAt(id: string, revision: number): string {
    const r = rowOf(id);
    if (!r) throw new LiveDocError(404, "No such document.");
    if (revision >= r.revision) return r.text;
    const later = q.all<{ rev: number; inverse: string }>("SELECT rev, inverse FROM live_doc_ops WHERE doc_id = ? AND rev > ? ORDER BY rev DESC", id, revision);
    if (later.length !== r.revision - revision) throw new LiveDocError(404, "That version is no longer kept.");
    let text = r.text;
    for (const l of later) text = TextOp.fromJSON(JSON.parse(l.inverse)).apply(text);
    return text;
  },

  /** « Annuler » one change: its inverse, carried over the changes made since, applied as a new change. */
  undo(id: string, revision: number, author: Author): { revision: number } {
    const r = rowOf(id);
    if (!r) throw new LiveDocError(404, "No such document.");
    const row = q.get<{ inverse: string; undone: number }>("SELECT inverse, undone FROM live_doc_ops WHERE doc_id = ? AND rev = ?", id, revision);
    if (!row) throw new LiveDocError(404, "That change is no longer kept.");
    if (row.undone) throw new LiveDocError(409, "That change was already undone.");
    // The inverse applies to the text right after `revision`: apply() folds in everything made since.
    return { revision: liveDocs.apply(id, revision, TextOp.fromJSON(JSON.parse(row.inverse)), author, { undoes: revision }).revision };
  },
};
