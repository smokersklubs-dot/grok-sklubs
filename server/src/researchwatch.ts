import { createHash, randomBytes } from "node:crypto"; import { tr } from "./i18n.js";
import type { Hono } from "hono";
import { db, q } from "./db.js";
import { bots, type BotRecord } from "./store.js";
import type { ResearchBrief, ResearchSection } from "./researchevidence.js";
import { relevance } from "./researchsignals.js";

/**
 * L87, the rest of « Recherche approfondie fiable » (Sklubot's own code):
 *  - « Ce qui a changé »: a report on a subject already researched by the same bot ends with what is new since the last
 *    one (sources never cited before) and what is no longer cited — the owner sees the change, not the whole report again.
 *  - « Veille »: a report can be run again by itself every week or month (the same plan; nothing is spent between runs).
 *  - « Chercher dans mes rapports »: past reports of the account, ranked by how well they answer the words.
 *  - Flux Atom (RFC 4287): the account's finished reports, at a private address with a secret token (only its hash is
 *    kept), for a feed reader. Revoking the token stops the feed at once.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS research_watch (report_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, every TEXT NOT NULL, next_at INTEGER NOT NULL, runs INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS research_feed (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
`);

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
interface DoneRow { id: string; bot: string; generation: number; thread: number; brief: string; sections: string; state: string; updated: number }
const urlsOf = (sections: ResearchSection[]) => new Set(sections.flatMap((s) => s.findings.map((f) => f.url)));

/** The last finished report of this bot on the same subject (same words once folded), other than `exceptId`. */
export function previousReport(botId: string, subject: string, exceptId: string): { id: string; updated: number; sections: ResearchSection[] } | null {
  const want = fold(subject);
  for (const r of q.all<DoneRow>("SELECT * FROM research_reports WHERE bot=? AND state='done' AND id!=? ORDER BY updated DESC LIMIT 50", botId, exceptId)) {
    try { if (fold((JSON.parse(r.brief) as ResearchBrief).subject) === want) return { id: r.id, updated: r.updated, sections: JSON.parse(r.sections) }; } catch { /* unreadable row */ }
  }
  return null;
}

/** « Ce qui a changé depuis le rapport du … »: new sources and sources no longer cited; "" when there is no earlier report. */
export function changesBlock(brief: ResearchBrief, sections: ResearchSection[], prev: { updated: number; sections: ResearchSection[] } | null): string {
  if (!prev) return "";
  const loc = brief.locale, before = urlsOf(prev.sections), now = urlsOf(sections);
  const added = sections.flatMap((s) => s.findings.filter((f) => !before.has(f.url)).map((f) => f));
  const gone = prev.sections.flatMap((s) => s.findings.filter((f) => !now.has(f.url)));
  const day = new Date(prev.updated).toISOString().slice(0, 10);
  const safe = (s: string) => s.replace(/[<>()\[\]_*#`\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  const lines = [`\n${tr(loc, "What changed since the report of {day}:", { day })}`];
  if (!added.length && !gone.length) lines.push(tr(loc, "- Nothing new: the same sources."));
  if (added.length) lines.push(tr(loc, "- {n} new source(s):", { n: added.length }), ...added.slice(0, 10).map((f) => `  - ${safe(f.title) || f.url}${f.published ? ` (${f.published})` : ""}`));
  if (gone.length) lines.push(tr(loc, "- {n} source(s) no longer cited this time.", { n: gone.length }));
  return lines.join("\n");
}

// ── Veille ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const WATCH_EVERY = { week: 7 * 86400_000, month: 30 * 86400_000 } as const;
export type WatchEvery = keyof typeof WATCH_EVERY;
export function setWatch(bot: BotRecord, reportId: string, every: WatchEvery | null, now = Date.now()): { every: WatchEvery | null; nextAt: number | null } {
  if (!q.get("SELECT id FROM research_reports WHERE id=? AND bot=?", reportId, bot.id)) throw new Error("Rapport introuvable.");
  if (every === null) { q.run("DELETE FROM research_watch WHERE report_id=?", reportId); return { every: null, nextAt: null }; }
  if (!(every in WATCH_EVERY)) throw new Error("Choisis week ou month.");
  const next = now + WATCH_EVERY[every];
  q.run("INSERT INTO research_watch (report_id, bot_id, every, next_at) VALUES (?, ?, ?, ?) ON CONFLICT(report_id) DO UPDATE SET every=excluded.every, next_at=excluded.next_at", reportId, bot.id, every, next);
  return { every, nextAt: next };
}
export const watchOf = (reportId: string, botId?: string) => q.get<{ every: WatchEvery; next_at: number }>(botId ? "SELECT every, next_at FROM research_watch WHERE report_id=? AND bot_id=?" : "SELECT every, next_at FROM research_watch WHERE report_id=?", ...(botId ? [reportId, botId] : [reportId])) ?? null;

/** Starts the due runs (called by the research worker's tick): a new report with the same brief, in the same thread. */
export function runDueWatches(create: (bot: BotRecord, brief: Partial<ResearchBrief>, request: string, thread: number) => unknown, now = Date.now()): number {
  let started = 0;
  for (const w of q.all<{ report_id: string; bot_id: string; every: WatchEvery; next_at: number; runs: number }>("SELECT * FROM research_watch WHERE next_at<=? LIMIT 10", now)) {
    const r = q.get<DoneRow>("SELECT * FROM research_reports WHERE id=?", w.report_id);
    const bot = bots.byId(w.bot_id);
    q.run("UPDATE research_watch SET next_at=?, runs=runs+1 WHERE report_id=?", now + (WATCH_EVERY[w.every] ?? WATCH_EVERY.week), w.report_id);
    if (!r || !bot || bot.generation !== r.generation) continue;
    try { create(bot, JSON.parse(r.brief), `watch-${w.report_id.slice(0, 36)}-${w.runs + 1}`, r.thread); started++; } catch (err) { console.error("[research watch]", (err as Error).message); }
  }
  return started;
}

// ── Search in past reports ──────────────────────────────────────────────────────────────────────────────────────
export interface PastReportHit { id: string; botId: string; botName: string; subject: string; updated: number; score: number; excerpt: string }
export function searchPastReports(userId: string, query: string, limit = 8): PastReportHit[] {
  const mine = new Map(bots.list(userId).filter((b) => b.kind === "agent").map((b) => [b.id, b]));
  if (!mine.size || !query.trim()) return [];
  const ph = [...mine.keys()].map(() => "?").join(",");
  const hits: PastReportHit[] = [];
  for (const r of q.all<DoneRow>(`SELECT * FROM research_reports WHERE state='done' AND bot IN (${ph}) ORDER BY updated DESC LIMIT 500`, ...mine.keys())) {
    let brief: ResearchBrief, sections: ResearchSection[];
    try { brief = JSON.parse(r.brief); sections = JSON.parse(r.sections); } catch { continue; }
    const claims = sections.flatMap((s) => s.findings.map((f) => `${f.claim} ${f.quote}`));
    const score = Math.max(relevance(query, `${brief.subject} ${brief.plan.join(" ")}`), 0.8 * relevance(query, claims.join(" ")));
    if (score < 0.2) continue;
    const best = claims.map((c) => ({ c, s: relevance(query, c) })).sort((a, b) => b.s - a.s)[0];
    hits.push({ id: r.id, botId: r.bot, botName: mine.get(r.bot)!.name, subject: brief.subject, updated: r.updated, score, excerpt: (best?.c ?? brief.plan[0] ?? "").replace(/\s+/g, " ").trim().slice(0, 300) });
  }
  return hits.sort((a, b) => b.score - a.score || b.updated - a.updated).slice(0, limit);
}

// ── Atom feed ───────────────────────────────────────────────────────────────────────────────────────────────────
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
export function newFeedToken(userId: string): string {
  const token = randomBytes(24).toString("base64url");
  q.run("INSERT INTO research_feed (user_id, token_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash, created_at=excluded.created_at", userId, hash(token), Date.now());
  return token;
}
export const hasFeed = (userId: string) => !!q.get("SELECT 1 AS x FROM research_feed WHERE user_id=?", userId);
export const dropFeed = (userId: string) => { q.run("DELETE FROM research_feed WHERE user_id=?", userId); };
const xml = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** The Atom document for a token, or null for an unknown token (RFC 4287: feed id/title/updated, entries id/title/updated/content). */
export function atomFor(token: string, message: (brief: ResearchBrief, sections: ResearchSection[]) => string, base = ""): string | null {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const owner = q.get<{ user_id: string }>("SELECT user_id FROM research_feed WHERE token_hash=?", hash(token))?.user_id;
  if (!owner) return null;
  const mine = bots.list(owner).filter((b) => b.kind === "agent").map((b) => b.id);
  const rowsDone = mine.length ? q.all<DoneRow>(`SELECT * FROM research_reports WHERE state='done' AND bot IN (${mine.map(() => "?").join(",")}) ORDER BY updated DESC LIMIT 25`, ...mine) : [];
  const updated = new Date(rowsDone[0]?.updated ?? 0).toISOString();
  const entries = rowsDone.flatMap((r) => {
    try {
      const brief = JSON.parse(r.brief) as ResearchBrief, sections = JSON.parse(r.sections) as ResearchSection[];
      return [`<entry><id>urn:sklubot:research:${xml(r.id)}</id><title>${xml(brief.subject.slice(0, 200))}</title><updated>${new Date(r.updated).toISOString()}</updated><content type="text">${xml(message(brief, sections).slice(0, 20_000))}</content></entry>`];
    } catch { return []; }
  });
  return `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom"><id>urn:sklubot:research-feed:${hash(owner).slice(0, 16)}</id><title>Sklubot — rapports de recherche</title><updated>${updated}</updated>${base ? `<link rel="self" href="${xml(base)}"/>` : ""}${entries.join("")}</feed>`;
}

/** Public (before the session check): the feed address works without signing in, with its secret token only. */
export function registerResearchFeedPublic(api: Hono<any>, message: (brief: ResearchBrief, sections: ResearchSection[]) => string) {
  api.get("/research-feed/:token", (c) => {
    const doc = atomFor(String(c.req.param("token") ?? "").replace(/\.atom$/, ""), message);
    if (!doc) return c.json({ error: "Unknown feed." }, 404);
    return c.body(doc, 200, { "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "private, no-store" });
  });
}
