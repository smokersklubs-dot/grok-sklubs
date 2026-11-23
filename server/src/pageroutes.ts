import type { Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE, userForToken } from "./auth.js";
import { emit } from "./bus.js";
import { computerKind, readLibraryFile, saveFile } from "./computer.js";
import { config } from "./config.js";
import { RateWindow } from "./hardening.js";
import { cleanFileName, contentTypeOf, pageFiles, pageHeaders, pageVersions, signPage, verifySigned } from "./pagefiles.js";
import { registerVideoStudio } from "./videostudio.js";
import { exportArtifact } from "./artifact-export.js";
import { audit, pages, randomToken, type UserRecord } from "./store.js";
import { q } from "./db.js";
import { PAGE_COMMENT_PARAM, withCommentLayer } from "./clientshared/pagecomment.js";

/**
 * Pages published by bots (pagefiles.ts says the policy).
 *
 * Public side (no /api, no session needed except for a private page's owner):
 *   GET /p/:token                  the page; with files, a redirect to /p/:token/ (link) or to its signed address (private)
 *   GET /p/:token/<file>           a file of a "link" page
 *   GET /p/:token/s/:sig/[<file>]  a private page and its files under a signed address (12 hours)
 * Owner side (signed in; only their own pages):
 *   GET  /pages/:token/versions               the history
 *   GET  /pages/:token/versions/:id/view      a version's HTML, under the same sandbox (preview)
 *   POST /pages/:token/versions/:id/restore   puts that version back (a new version is kept)
 *   POST /pages/:token/rotate                 a new address: the old link stops working at once
 */
type PageRow = NonNullable<ReturnType<typeof pages.byToken>>;
const NOT_SHARED = "This page is no longer shared.";
const owns = (c: Context, page: PageRow) => userForToken(getCookie(c, SESSION_COOKIE))?.id === page.userId;
const artifactName = (page: PageRow) => page.path.split("/").pop()!.replace(/\.html$/, "");
const isArtifact = (page: PageRow) => page.path.startsWith("artifacts/");
/** Context for a revision requested from the open panel. Only the user's words appear in chat. */
export function revisionTarget(userId: string, botId: string, token: string) {
  const page = pages.byToken(token, config.publicUrl);
  if (!page || page.userId !== userId || page.botId !== botId || !isArtifact(page)) return null;
  const version = pageVersions.list(botId, page.path)[0];
  if (!version) return null;
  const name = artifactName(page);
  const instruction = /^artifact-video-[a-f0-9-]{36}$/.test(name)
    ? `Edit video project ${name} from version ${version.id}. Read studio.json and use video_studio_update. For an advanced render consult production.md.`
    : `Revise the open artifact ${name}. Read its saved source and update the same files and address.`;
  return { version: version.id, instruction };
}
function documentHeaders(page: PageRow, directory: string) {
  if (!isArtifact(page)) return pageHeaders();
  const assets = new URL(directory, config.publicUrl).href;
  return pageHeaders({ "content-security-policy": [
    "sandbox allow-scripts allow-forms", "default-src 'none'", `script-src 'unsafe-inline' ${assets}`,
    `style-src 'unsafe-inline' ${assets}`, `img-src data: blob: ${assets}`,
    `font-src data: ${assets}`, `connect-src ${assets}`, `media-src data: blob: ${assets}`,
    "form-action 'none'", "base-uri 'none'", "frame-ancestors 'self'",
  ].join("; ") });
}
// L140: the chat's preview asks for the comment layer (clientshared/pagecomment.ts); the page keeps its sandbox and CSP.
const commenting = (c: Context) => c.req.query(PAGE_COMMENT_PARAM) === "1";
const html = (c: Context, page: PageRow, body: string) =>
  c.body(commenting(c) ? withCommentLayer(body) : body, 200, { ...documentHeaders(page, c.req.path.endsWith("/") ? c.req.path : `${c.req.path}/`), "content-type": "text/html; charset=utf-8", "x-frame-options": "SAMEORIGIN", "cache-control": page.visibility === "private" ? "private, no-store" : "no-cache" });

function readHtml(page: PageRow): string | null {
  // Read through the library guard: a page file the bot replaced with a link is refused, never served.
  try { return readLibraryFile(page.botId, page.path).toString("utf8"); } catch { return null; }
}
function serveFile(c: Context, page: PageRow, rest: string) {
  const file = cleanFileName(rest);
  const content = file ? pageFiles.get(page.botId, page.path, file) : null;
  if (content === null) return c.text("Not found.", 404, pageHeaders());
  // CORS *: the page's own fetch() comes from its opaque (sandboxed) origin; these files are as visible as the page.
  return c.body(content, 200, { ...documentHeaders(page, c.req.path.slice(0, -rest.length)), "content-type": contentTypeOf(file!), "access-control-allow-origin": "*", "x-frame-options": "SAMEORIGIN", "cache-control": page.visibility === "private" ? "private, no-store" : "no-cache" });
}

export function registerPageSite(site: Hono<any>) {
  const top = (c: Context, slash: boolean) => {
    const page = pages.byToken(c.req.param("token")!, config.publicUrl);
    if (!page) return c.text(NOT_SHARED, 404, pageHeaders());
    // A private page is only for its owner, signed in to this Sklubot (the session cookie); anyone else gets a 404.
    if (page.visibility === "private" && !owns(c, page)) return c.text("This page is private. Sign in to Sklubot as its owner to open it.", 404, { "cache-control": "no-store", "x-robots-tag": "noindex" });
    const hasFiles = pageFiles.names(page.botId, page.path).length > 0;
    const keep = commenting(c) ? `?${PAGE_COMMENT_PARAM}=1` : "";
    if (hasFiles && page.visibility === "private") return c.redirect(`/p/${page.token}/s/${signPage(page.token)}/${keep}`, 302);
    if (hasFiles && !slash) return c.redirect(`/p/${page.token}/${keep}`, 302);
    const body = readHtml(page);
    return body === null ? c.text(NOT_SHARED, 404, pageHeaders()) : html(c, page, body);
  };
  site.get("/p/:token", (c) => top(c, false));
  site.get("/p/:token/", (c) => top(c, true));
  site.get("/p/:token/v/:id/:sig/*", (c) => {
    const { token, id, sig } = c.req.param();
    const page = pages.byToken(token, config.publicUrl);
    if (!page || !verifySigned(`version:${token}:${id}`, sig)) return c.text(NOT_SHARED, 404, pageHeaders());
    const snapshot = pageVersions.get(page.botId, page.path, Number(id));
    if (!snapshot) return c.text(NOT_SHARED, 404, pageHeaders());
    const dir = `/p/${token}/v/${id}/${sig}/`;
    const rest = c.req.path.slice(dir.length);
    const file = rest ? snapshot.files.find((f) => f.file === cleanFileName(rest)) : null;
    if (rest && !file) return c.text("Not found.", 404, pageHeaders());
    return c.body(file ? file.content : snapshot.html, 200, {
      ...documentHeaders(page, dir), "content-type": file ? contentTypeOf(file.file) : "text/html; charset=utf-8",
      "x-frame-options": "SAMEORIGIN", "cache-control": "private, no-store", ...(file ? { "access-control-allow-origin": "*" } : {}),
    });
  });
  site.get("/p/:token/s/:sig/*", (c) => {
    const page = pages.byToken(c.req.param("token")!, config.publicUrl);
    if (!page || !verifySigned(page.token, c.req.param("sig")!)) return c.text("This address has expired. Open the page again from Sklubot.", 404, pageHeaders());
    const rest = decodeURIComponent(c.req.path.split("/").slice(5).join("/"));
    if (!rest) { const body = readHtml(page); return body === null ? c.text(NOT_SHARED, 404, pageHeaders()) : html(c, page, body); }
    return serveFile(c, page, rest);
  });
  site.get("/p/:token/*", (c) => {
    const page = pages.byToken(c.req.param("token")!, config.publicUrl);
    if (!page || page.visibility === "private") return c.text("Not found.", 404, pageHeaders());
    let rest = "";
    try { rest = decodeURIComponent(c.req.path.split("/").slice(3).join("/")); } catch { /* not a name */ }
    return serveFile(c, page, rest);
  });
}

const restores = new RateWindow(30, 60_000);
export function registerPageApi(api: Hono<any>) {
  registerVideoStudio(api);
  const mine = (c: Context): PageRow | null => {
    const user = c.get("user") as UserRecord;
    const page = pages.byToken(c.req.param("token")!, config.publicUrl);
    return page && page.userId === user.id ? page : null;
  };
  const loc = (c: Context) => (c.get("user") as UserRecord).locale;
  const gone = (c: Context) => c.json({ error: loc(c) === "fr" ? "Cette page n'existe pas." : "That page does not exist." }, 404);

  const versionUrl = (token: string, id: number) => `/p/${token}/v/${id}/${signPage(`version:${token}:${id}`)}/`;
  api.get("/pages/:token/export", (c) => {
    const page = mine(c);
    if (!page) return gone(c);
    const id = c.req.query("version");
    const snapshot = id === undefined ? { html: readHtml(page), files: pageFiles.list(page.botId, page.path) }
      : pageVersions.get(page.botId, page.path, Number(id));
    if (snapshot?.html == null) return gone(c);
    return exportArtifact(artifactName(page).replace(/[^\w-]/g, "-"), snapshot.html, snapshot.files);
  });
  api.get("/pages/:token/versions", (c) => {
    const page = mine(c);
    if (!page) return gone(c);
    const versions = pageVersions.list(page.botId, page.path).map((v) => ({ ...v, preview: versionUrl(page.token, v.id) }));
    c.header("Cache-Control", "private, no-store");
    return c.json({ name: artifactName(page), botId: page.botId, title: page.title, studioMp4: computerKind() === "linux", versions, files: pageFiles.names(page.botId, page.path) });
  });
  api.get("/pages/:token/versions/:id/view", (c) => {
    const page = mine(c);
    const v = page ? pageVersions.get(page.botId, page.path, Number(c.req.param("id"))) : null;
    if (!page || !v) return gone(c);
    if (v.files.length || isArtifact(page)) return c.redirect(versionUrl(page.token, Number(c.req.param("id"))), 302);
    return c.body(v.html, 200, pageHeaders({ "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-frame-options": "SAMEORIGIN" }));
  });
  api.post("/pages/:token/versions/:id/restore", (c) => {
    const user = c.get("user") as UserRecord;
    if (restores.over(user.id)) return c.json({ error: loc(c) === "fr" ? "Trop de demandes. Attends une minute." : "Too many requests. Wait a minute." }, 429);
    const page = mine(c);
    const v = page ? pageVersions.get(page.botId, page.path, Number(c.req.param("id"))) : null;
    if (!page || !v) return gone(c);
    const n = pageVersions.list(page.botId, page.path).find((x) => x.id === Number(c.req.param("id")))?.n ?? 0;
    saveFile(page.botId, page.path, v.html);
    pageFiles.replace(page.botId, page.path, v.files);
    pageVersions.record(user.id, page.botId, page.path, v.html, `restored version ${n}`);
    audit(user.id, "account", `Page ${page.title}: version ${n} restored`, page.botId);
    emit(user.id, { type: "pages", token: page.token });
    return c.json({ ok: true });
  });
  api.post("/pages/:token/rotate", (c) => {
    const user = c.get("user") as UserRecord;
    const page = mine(c);
    if (!page) return gone(c);
    const token = randomToken(18);
    q.run("UPDATE pages SET token = ? WHERE token = ? AND user_id = ?", token, page.token, user.id);
    audit(user.id, "account", `Page ${page.title}: new address, the old link no longer works`, page.botId);
    emit(user.id, { type: "pages", token: page.token });
    return c.json({ url: `${config.publicUrl}/p/${token}`, token });
  });
}
