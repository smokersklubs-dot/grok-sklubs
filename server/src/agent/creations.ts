/**
 * L158 « Créations » (backlog A-FAIRE L158; idea from CLI-Anything's preview trajectory — docs/audits/AUDIT-CLI-ANYTHING.md
 * #3, « À faire » 7 — written for Sklubot, no code reused): the bot records each render of a long creative work with
 * `creation_render` (a page it published, an image, a video or another file of its library) under a named stage
 * (study / build / check / ready). The server keeps a copy of each render (so a later overwrite never changes what an
 * earlier step showed: « never show a stale preview as current »), fingerprints it, and keeps ONE "trajectory" card per
 * creation up to date in the conversation: thumbnails in order, the stage reached, « aucun changement » on a render
 * identical to the one before, « aucun progrès » after STALL_AFTER such renders in a row, and a side-by-side compare.
 *
 * Safety: only files inside the bot's own library (computer.ts resolveInWorkspace: no escape, no link); copies live
 * under DATA_DIR/creations/<bot>/ and are served to the bot's owner only (creationroutes.ts), images and videos inline,
 * pages through their own signed version address, anything else never inline. A copy is kept up to RENDER_COPY_MAX
 * bytes; past that the render is still fingerprinted and listed, without a preview. The tables follow the bot (ON
 * DELETE CASCADE). Additive tables created at module load (house pattern, no numbered migration).
 */
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, mkdirSync, readSync, rmSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { isInlineImage, isInlineVideo, mimeOf, openLibraryFile } from "../computer.js";
import { CREATION_STAGES, STALL_AFTER, TRAJECTORY_SHOWN, type CreationStage, type RenderKind, type TrajectoryCard, type TrajectoryRender } from "../creationtypes.js";
import { q } from "../db.js";
import { pageVersions } from "../pagefiles.js";
import { clip, newId, now, pages, rows, type BotRecord } from "../store.js";
import type { BuiltinTool, ToolContext, ToolOutput } from "./tools.js";

q.run(`CREATE TABLE IF NOT EXISTS creations (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, slug TEXT NOT NULL, title TEXT NOT NULL,
  stage TEXT NOT NULL, generation INTEGER, seq INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (bot_id, slug))`);
q.run(`CREATE TABLE IF NOT EXISTS creation_renders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, creation_id TEXT NOT NULL REFERENCES creations(id) ON DELETE CASCADE, n INTEGER NOT NULL,
  stage TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL, page_token TEXT, page_version INTEGER,
  copy TEXT, digest TEXT NOT NULL, bytes INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', unchanged INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`);
q.run("CREATE INDEX IF NOT EXISTS creation_renders_by_creation ON creation_renders (creation_id, n)");

/** A copy is kept for renders up to this size (25 MB); bigger ones are listed without a preview. */
export const RENDER_COPY_MAX = 25 * 1024 * 1024;
/** Renders kept per creation; the oldest copies and rows go past this. */
export const RENDERS_KEPT = 40;
/** Creations per bot. */
export const CREATIONS_PER_BOT = 100;

interface RenderRow { id: number; creation_id: string; n: number; stage: string; kind: string; name: string; path: string; page_token: string | null; page_version: number | null; copy: string | null; digest: string; bytes: number; note: string; unchanged: number; created_at: number }
interface CreationRow { id: string; bot_id: string; slug: string; title: string; stage: string; generation: number | null; seq: number | null }

const copyDir = (botId: string) => path.join(config.dataDir, "creations", botId.replace(/[^\w-]/g, "_"));
export const slugOf = (title: string) => title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const isStage = (s: unknown): s is CreationStage => typeof s === "string" && (CREATION_STAGES as readonly string[]).includes(s);

function kindOf(rel: string, isPage: boolean): RenderKind {
  if (isPage) return "page";
  const mime = mimeOf(rel);
  return isInlineImage(mime) ? "image" : isInlineVideo(mime) ? "video" : "file";
}

/** The fingerprint and size of a library file, read in chunks (a big video never sits in memory). */
function fingerprint(fd: number): { digest: string; bytes: number } {
  const h = createHash("sha256");
  const buf = Buffer.allocUnsafe(1 << 20);
  let bytes = 0;
  for (;;) { const n = readSync(fd, buf, 0, buf.length, null); if (!n) break; h.update(buf.subarray(0, n)); bytes += n; }
  return { digest: h.digest("hex"), bytes };
}

export const creations = {
  get: (botId: string, id: string) => q.get<CreationRow>("SELECT * FROM creations WHERE bot_id = ? AND id = ?", botId, id) ?? null,
  bySlug: (botId: string, slug: string) => q.get<CreationRow>("SELECT * FROM creations WHERE bot_id = ? AND slug = ?", botId, slug) ?? null,
  renders: (creationId: string) => q.all<RenderRow>("SELECT * FROM creation_renders WHERE creation_id = ? ORDER BY n", creationId),
  render: (creationId: string, id: number) => q.get<RenderRow>("SELECT * FROM creation_renders WHERE creation_id = ? AND id = ?", creationId, id) ?? null,
  /** Where a render's copy lives on disk (null: no copy). */
  copyPath: (botId: string, r: Pick<RenderRow, "copy">) => (r.copy ? path.join(copyDir(botId), r.copy) : null),
  list: (botId: string) => q.all<CreationRow & { updated_at: number }>("SELECT * FROM creations WHERE bot_id = ? ORDER BY updated_at DESC LIMIT ?", botId, CREATIONS_PER_BOT),
};

const toRender = (r: RenderRow): TrajectoryRender => ({ id: r.id, n: r.n, stage: r.stage as CreationStage, kind: r.kind as RenderKind, name: r.name, note: r.note, at: r.created_at, bytes: r.bytes, unchanged: !!r.unchanged, preview: !!r.copy || (r.kind === "page" && r.page_version != null) });

/** The card for a creation as it is now. */
export function trajectoryCard(c: CreationRow): TrajectoryCard {
  const all = creations.renders(c.id);
  const last = all.slice(-STALL_AFTER);
  return {
    type: "trajectory", creationId: c.id, title: c.title, stage: c.stage as CreationStage,
    renders: all.slice(-TRAJECTORY_SHOWN).map(toRender), total: all.length,
    stalled: last.length === STALL_AFTER && last.every((r) => r.unchanged),
  };
}

export interface RenderInput { title: string; stage: string; path: string; note?: string }
export type RenderResult = { error: string } | { creation: CreationRow; render: TrajectoryRender; card: TrajectoryCard; previous: number | null };

/** Records one render (the tool and the tests). Throws nothing: a refusal comes back as `{ error }` the bot can fix. */
export function recordRender(bot: Pick<BotRecord, "id" | "userId">, a: RenderInput): RenderResult {
  const title = clip(String(a.title ?? "").replace(/\s+/g, " ").trim(), 80);
  const slug = slugOf(title);
  if (!slug) return { error: "Give the creation a short title (the same one for every render of this work)." };
  if (!isStage(a.stage)) return { error: `Give the stage: one of ${CREATION_STAGES.join(", ")}.` };
  const rel = String(a.path ?? "").trim().replace(/^\/root\/files\//, "").replace(/^~\/files\//, "");
  if (!rel) return { error: "Give the path of the render in your library (for example renders/poster-v2.png, or the page's HTML file)." };
  let f: { fd: number; full: string; size: number };
  try { f = openLibraryFile(bot.id, rel); } catch (err) { return { error: `That file cannot be read in your library (${(err as Error).message}). Save the render there first.` }; }
  let print: { digest: string; bytes: number };
  try { print = fingerprint(f.fd); } finally { closeSync(f.fd); }
  const page = pages.forPath(bot.id, rel, config.publicUrl);
  const kind = kindOf(rel, !!page);
  let pageVersion: number | null = null;
  if (page) {
    const v = pageVersions.list(bot.id, rel)[0];
    if (v) {
      pageVersion = v.id;
      const snap = pageVersions.get(bot.id, rel, v.id);
      // A page's look is its HTML and its files: both go into the fingerprint.
      if (snap) print = { digest: createHash("sha256").update(snap.html).update(JSON.stringify(snap.files)).digest("hex"), bytes: Buffer.byteLength(snap.html) + snap.files.reduce((s, x) => s + Buffer.byteLength(x.content), 0) };
    }
  }
  let c = creations.bySlug(bot.id, slug);
  if (!c) {
    const n = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM creations WHERE bot_id = ?", bot.id)!.n;
    if (n >= CREATIONS_PER_BOT) q.run("DELETE FROM creations WHERE id = (SELECT id FROM creations WHERE bot_id = ? ORDER BY updated_at LIMIT 1)", bot.id);
    const id = newId("cre");
    q.run("INSERT INTO creations (id, bot_id, slug, title, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, bot.id, slug, title, a.stage, now(), now());
    c = creations.get(bot.id, id)!;
  }
  const before = creations.renders(c.id);
  const prev = before[before.length - 1] ?? null;
  const unchanged = !!prev && prev.digest === print.digest;
  const n = (prev?.n ?? 0) + 1;
  let copy: string | null = null;
  if (kind !== "page" && print.bytes <= RENDER_COPY_MAX) {
    copy = `${c.id}-${n}${path.extname(rel).toLowerCase().replace(/[^.\w]/g, "").slice(0, 8)}`;
    try { mkdirSync(copyDir(bot.id), { recursive: true }); copyFileSync(f.full, path.join(copyDir(bot.id), copy)); } catch { copy = null; }
  }
  const note = clip(String(a.note ?? "").replace(/\s+/g, " ").trim(), 200);
  q.run("INSERT INTO creation_renders (creation_id, n, stage, kind, name, path, page_token, page_version, copy, digest, bytes, note, unchanged, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    c.id, n, a.stage, kind, clip(path.basename(rel), 120), rel, page?.token ?? null, pageVersion, copy, print.digest, print.bytes, note, unchanged ? 1 : 0, now());
  q.run("UPDATE creations SET stage = ?, title = ?, updated_at = ? WHERE id = ?", a.stage, title, now(), c.id);
  // Past RENDERS_KEPT, the oldest renders and their copies go.
  for (const old of creations.renders(c.id).slice(0, -RENDERS_KEPT)) {
    const p = creations.copyPath(bot.id, old);
    if (p) rmSync(p, { force: true });
    q.run("DELETE FROM creation_renders WHERE id = ?", old.id);
  }
  c = creations.get(bot.id, c.id)!;
  const card = trajectoryCard(c);
  const render = card.renders[card.renders.length - 1];
  return { creation: c, render, card, previous: unchanged ? prev!.n : null };
}

/** Puts the creation's card in the conversation: the same card is updated while it is in the current conversation. */
export function showTrajectory(bot: BotRecord, c: CreationRow, card: TrajectoryCard, thread?: number) {
  if (c.seq != null && c.generation === bot.generation) {
    const row = rows.updateCard(bot, bot.generation, c.seq, (k) => (k.type === "trajectory" && k.creationId === c.id ? card : k));
    if (row && row.body.kind === "card" && row.body.card.type === "trajectory") return row;
  }
  const row = rows.append(bot, { kind: "card", card }, thread || 0);
  q.run("UPDATE creations SET generation = ?, seq = ? WHERE id = ?", row.generation, row.seq, c.id);
  return row;
}

/** What the tool tells the bot after a render (kept apart for the tests). */
export function renderReply(r: Exclude<RenderResult, { error: string }>): string {
  const head = `Render ${r.render.n} of “${r.creation.title}” recorded (stage: ${r.render.stage}). The owner sees it in the trajectory card; do not describe the card.`;
  if (r.card.stalled) return `${head} NO PROGRESS: the last ${STALL_AFTER} renders are identical to the one before them. Stop repeating the same step: try a different approach, or ask the owner what to change.`;
  if (r.previous != null) return `${head} Nothing changed: this render is byte for byte the same as render ${r.previous}. Change the work before the next render, or say why it is unchanged.`;
  return head;
}

export const creationTools: BuiltinTool[] = [{
  spec: {
    name: "creation_render",
    description: `For a long creative work (a page, an image, a video, a document you improve step by step): record each render you produce, so the owner follows the work in one "trajectory" card and can compare two renders side by side. Call it after each meaningful render, with the SAME title for the whole work and the stage you are at: study (research, references, sketches), build (making it), check (testing, comparing with the request), ready (done, delivered). The file must be in your library (a published page: its HTML file). You are told when a render is identical to the one before (no change) and when two in a row brought nothing (no progress).`,
    inputSchema: { type: "object", properties: {
      title: { type: "string", description: "The work's short title, the same for every render (e.g. “Affiche du concert”)" },
      stage: { type: "string", enum: [...CREATION_STAGES], description: "study, build, check or ready" },
      path: { type: "string", description: "The render's path in your library" },
      note: { type: "string", description: "One short line: what changed in this render" },
    }, required: ["title", "stage", "path"] },
  },
  activity: "saving", label: "Recording a render",
  async run(a: Record<string, any>, c: ToolContext): Promise<ToolOutput> {
    const r = recordRender(c.bot, { title: a.title, stage: a.stage, path: a.path, note: a.note });
    if ("error" in r) return { content: `${r.error} Nothing was recorded.`, isError: true, summary: "not recorded" };
    showTrajectory(c.bot, r.creation, r.card, c.thread);
    return { content: renderReply(r), summary: clip(`${r.creation.title} · ${r.render.n}`, 60) };
  },
}];
