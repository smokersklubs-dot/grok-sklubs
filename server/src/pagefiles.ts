import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { q } from "./db.js";
import { accessOf, hostedMode } from "./hosted.js";
import { now } from "./store.js";

/**
 * Pages published by bots (page_publish / page_edit in agent/pagetools.ts, served by pageroutes.ts): their files next
 * to the HTML, their history, and the exact policy they run under.
 *
 * ISOLATION. A page is bot-written HTML and JavaScript: it must never run as this site. Every page response (its HTML,
 * its files, a version the owner previews) carries the CSP below, whose `sandbox` directive (without allow-same-origin)
 * gives the document an opaque origin: no cookie, no localStorage, no access to the app's pages or /api with the
 * visitor's session, no forms, no modal dialogs. On top of that:
 *  - scripts and styles: the page itself (inline), its own files ('self'), and three CDNs (PAGE_CDNS);
 *  - fonts: its files, data:, the CDNs, Google Fonts; pictures and media: its files, data:, blob:, any https address;
 *  - network calls (fetch, XHR, WebSocket, EventSource): 'self' only, i.e. this server — and since the document's origin
 *    is opaque, such a call carries no cookie; only the page's own files answer it (with CORS *);
 *  - no frames of other sites, no <base>, no form posts; it may be framed by this app only (the chat's preview, itself an
 *    <iframe sandbox="allow-scripts">).
 *
 * FILES. Text files only (FILE_EXT), by a relative name (`css/site.css`); no "..", no absolute path, no hidden name.
 * Stored in the database (page_files), never on the server's disk as code, never run by the server.
 *
 * PRIVATE PAGES with files: the files cannot be authorised by the session cookie (the sandboxed page sends none), so the
 * owner, once recognised by the cookie on /p/<token>, is sent to /p/<token>/s/<expiry>.<signature>/ — a signed address
 * valid 12 hours under which the HTML and its files are served without a cookie. The owner opens /p/<token> again to get
 * a fresh one.
 *
 * VERSIONS. Every publish, edit and restore keeps the page as it was then (HTML + files); the oldest are dropped past the
 * plan's limit (PageLimits.versions).
 */

export const PAGE_CDNS = ["https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "https://unpkg.com"] as const;
export const PAGE_FONTS = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"] as const;

export function pageCsp(): string {
  const cdn = PAGE_CDNS.join(" ");
  return [
    "sandbox allow-scripts allow-popups",
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: ${cdn}`,
    `style-src 'self' 'unsafe-inline' ${cdn} ${PAGE_FONTS[0]}`,
    `font-src 'self' data: ${cdn} ${PAGE_FONTS[1]}`,
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "connect-src 'self'",
    "worker-src blob:",
    "manifest-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
}
/** Headers of every page response. */
export const pageHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-robots-tag": "noindex", "content-security-policy": pageCsp(), ...extra,
});

export const FILE_EXT: Record<string, string> = {
  css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8", svg: "image/svg+xml; charset=utf-8", txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8",
};

export interface PageLimits { files: number; fileBytes: number; totalBytes: number; htmlBytes: number; versions: number }
/** A free hosted plan gets small quotas; everyone else the full ones. */
export function pageLimits(userId: string): PageLimits {
  const full: PageLimits = { files: 20, fileBytes: 1_000_000, totalBytes: 5_000_000, htmlBytes: 2_000_000, versions: 20 };
  if (!hostedMode()) return full;
  const a = accessOf(userId);
  if (a.operator || (a.plan && a.plan.kind !== "free")) return full;
  return { files: 5, fileBytes: 200_000, totalBytes: 1_000_000, htmlBytes: 1_000_000, versions: 5 };
}

/** A page file's relative name, cleaned; null when it is not acceptable. */
export function cleanFileName(raw: unknown): string | null {
  const s = String(raw ?? "").trim().replace(/^\.\//, "");
  if (!s || s.length > 120 || s.includes("\\") || s.startsWith("/") || /[\u0000-\u001f]/.test(s)) return null;
  const parts = s.split("/");
  if (parts.length > 4 || parts.some((p) => !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,59}$/.test(p) || p.includes(".."))) return null;
  const ext = parts[parts.length - 1].split(".").pop()!.toLowerCase();
  return FILE_EXT[ext] && parts[parts.length - 1].includes(".") ? s : null;
}
export const contentTypeOf = (file: string) => FILE_EXT[file.split(".").pop()!.toLowerCase()] ?? "text/plain; charset=utf-8";

export interface PageFile { file: string; content: string }
export class PageFileError extends Error {}

/** Checks a set of files against the limits; throws a PageFileError the bot can read. */
export function checkFiles(userId: string, files: unknown, htmlLength: number): PageFile[] {
  const lim = pageLimits(userId);
  if (htmlLength > lim.htmlBytes) throw new PageFileError(`That page is too large (${Math.round(lim.htmlBytes / 1e6)} MB at most for the HTML).`);
  const list = Array.isArray(files) ? files : [];
  if (list.length > lim.files) throw new PageFileError(`Too many files: ${lim.files} at most next to the HTML.`);
  const out: PageFile[] = [];
  let total = htmlLength;
  for (const f of list) {
    const file = cleanFileName(f?.path ?? f?.file);
    if (!file) throw new PageFileError(`"${String(f?.path ?? f?.file ?? "").slice(0, 80)}" is not an accepted file name: a relative name like css/site.css, ending in ${Object.keys(FILE_EXT).map((e) => `.${e}`).join(", ")}.`);
    if (out.some((o) => o.file === file)) throw new PageFileError(`"${file}" is given twice.`);
    const content = String(f?.content ?? "");
    const bytes = Buffer.byteLength(content);
    if (bytes > lim.fileBytes) throw new PageFileError(`"${file}" is too large (${Math.round(lim.fileBytes / 1e3)} kB at most per file).`);
    total += bytes;
    if (total > lim.totalBytes) throw new PageFileError(`The page and its files are too large (${Math.round(lim.totalBytes / 1e6)} MB at most in all).`);
    out.push({ file, content });
  }
  return out;
}

export const pageFiles = {
  list: (botId: string, path: string): PageFile[] => q.all<PageFile>("SELECT file, content FROM page_files WHERE bot_id = ? AND path = ? ORDER BY file", botId, path),
  names: (botId: string, path: string): string[] => q.all<{ file: string }>("SELECT file FROM page_files WHERE bot_id = ? AND path = ? ORDER BY file", botId, path).map((r) => r.file),
  get: (botId: string, path: string, file: string): string | null => q.get<{ content: string }>("SELECT content FROM page_files WHERE bot_id = ? AND path = ? AND file = ?", botId, path, file)?.content ?? null,
  /** Replaces every file of a page. */
  replace(botId: string, path: string, files: PageFile[]) {
    q.run("DELETE FROM page_files WHERE bot_id = ? AND path = ?", botId, path);
    for (const f of files) q.run("INSERT INTO page_files (bot_id, path, file, content, updated_at) VALUES (?, ?, ?, ?, ?)", botId, path, f.file, f.content, now());
  },
  put: (botId: string, path: string, file: string, content: string) =>
    q.run("INSERT INTO page_files (bot_id, path, file, content, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(bot_id, path, file) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at", botId, path, file, content, now()),
};

export interface PageVersion { id: number; n: number; note: string; createdAt: number; bytes: number; files: number; current: boolean }
export const pageVersions = {
  /** Keeps the page as it is now (HTML given, files from page_files), then drops the oldest past the plan's limit. */
  record(userId: string, botId: string, path: string, html: string, note: string) {
    q.run("INSERT INTO page_versions (bot_id, path, html, files, note, created_at) VALUES (?, ?, ?, ?, ?, ?)", botId, path, html, JSON.stringify(pageFiles.list(botId, path)), note.slice(0, 120), now());
    const keep = pageLimits(userId).versions;
    q.run("DELETE FROM page_versions WHERE bot_id = ? AND path = ? AND id NOT IN (SELECT id FROM page_versions WHERE bot_id = ? AND path = ? ORDER BY id DESC LIMIT ?)", botId, path, botId, path, keep);
  },
  list(botId: string, path: string): PageVersion[] {
    const rows = q.all<{ id: number; note: string; created_at: number; bytes: number; files: string }>("SELECT id, note, created_at, length(html) AS bytes, files FROM page_versions WHERE bot_id = ? AND path = ? ORDER BY id ASC", botId, path);
    return rows.map((r, i) => {
      let files = 0;
      try { files = (JSON.parse(r.files) as unknown[]).length; } catch { /* unreadable: none */ }
      return { id: r.id, n: i + 1, note: r.note, createdAt: r.created_at, bytes: r.bytes, files, current: i === rows.length - 1 };
    }).reverse();
  },
  get(botId: string, path: string, id: number): { html: string; files: PageFile[]; note: string } | null {
    const r = q.get<{ html: string; files: string; note: string }>("SELECT html, files, note FROM page_versions WHERE bot_id = ? AND path = ? AND id = ?", botId, path, id);
    if (!r) return null;
    let files: PageFile[] = [];
    try { files = (JSON.parse(r.files) as PageFile[]).filter((f) => cleanFileName(f?.file) && typeof f.content === "string"); } catch { /* none */ }
    return { html: r.html, files, note: r.note };
  },
};

// ── Signed addresses of private pages with files ──────────────────────────────────────────────────────────────────
const signKey = () => createHash("sha256").update("page-files:" + config.sessionSecret).digest();
export const SIGNED_MS = 12 * 3_600_000;
export function signPage(token: string, at = now()): string {
  const exp = Math.floor((at + SIGNED_MS) / 1000);
  return `${exp}.${createHmac("sha256", signKey()).update(`${token}.${exp}`).digest("base64url").slice(0, 32)}`;
}
export function verifySigned(token: string, sig: string, at = now()): boolean {
  const m = /^(\d{9,11})\.([A-Za-z0-9_-]{32})$/.exec(sig);
  if (!m || Number(m[1]) * 1000 < at) return false;
  const want = Buffer.from(createHmac("sha256", signKey()).update(`${token}.${m[1]}`).digest("base64url").slice(0, 32));
  const got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got);
}
