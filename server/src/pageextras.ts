import { createRequire } from "node:module";
import type { PageFile } from "./pagefiles.js";

/**
 * L157 « Pages » (backlog A-FAIRE), owner side:
 *  - « Comparer » two versions of a page: a line diff (longest common subsequence, Hunt–McIlroy style, on lines), with
 *    unchanged stretches folded.
 *  - « Copie autonome »: one HTML file that opens anywhere, offline — the page's own stylesheets and scripts are put
 *    inline and its own images/fonts become data: addresses. Nothing is fetched from the internet to build it.
 *  - « Fiche A4 »: the same copy with an A4 print sheet (CSS Paged Media, @page size A4 — https://www.w3.org/TR/css-page-3/)
 *    and a « Enregistrer en PDF » button that opens the browser's print window (window.print()), where PDF is a destination.
 *  - « Capture »: the page rendered from its own files by the server's Chromium (Playwright, browser mode only), full
 *    page (`fullPage: true`) or one element (locator(selector).screenshot()); every request outside the page's own files
 *    is refused. API: https://playwright.dev/docs/api/class-page#page-screenshot, https://playwright.dev/docs/api/class-locator#locator-screenshot
 */
export const DIFF_LIMIT_LINES = 4000;

export interface DiffLine { op: "same" | "add" | "del" | "fold"; text: string; a?: number; b?: number; count?: number }

/** Line diff of two texts. Long unchanged stretches are folded to keep 3 lines of context. */
export function lineDiff(before: string, after: string, context = 3): { lines: DiffLine[]; added: number; removed: number; truncated: boolean } {
  let A = before.replace(/\r\n/g, "\n").split("\n"), B = after.replace(/\r\n/g, "\n").split("\n");
  const truncated = A.length > DIFF_LIMIT_LINES || B.length > DIFF_LIMIT_LINES;
  A = A.slice(0, DIFF_LIMIT_LINES); B = B.slice(0, DIFF_LIMIT_LINES);
  // Common prefix and suffix first (most edits are small), then an LCS table on what is left.
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const a = A.slice(pre, A.length - suf), b = B.slice(pre, B.length - suf);
  const n = a.length, m = b.length;
  const raw: DiffLine[] = A.slice(0, pre).map((text, i) => ({ op: "same", text, a: i + 1, b: i + 1 }));
  if (n * m > 4_000_000) { // too big for the table: everything in between is shown removed then added
    a.forEach((text, i) => raw.push({ op: "del", text, a: pre + i + 1 }));
    b.forEach((text, j) => raw.push({ op: "add", text, b: pre + j + 1 }));
  } else {
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) { raw.push({ op: "same", text: a[i], a: pre + i + 1, b: pre + j + 1 }); i++; j++; }
      else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) { raw.push({ op: "del", text: a[i], a: pre + i + 1 }); i++; }
      else { raw.push({ op: "add", text: b[j], b: pre + j + 1 }); j++; }
    }
  }
  A.slice(A.length - suf).forEach((text, k) => raw.push({ op: "same", text, a: A.length - suf + k + 1, b: B.length - suf + k + 1 }));
  const lines: DiffLine[] = [];
  const near = (k: number) => raw.slice(Math.max(0, k - context), k + context + 1).some((l) => l.op !== "same");
  for (let k = 0; k < raw.length; k++) {
    if (raw[k].op !== "same" || near(k)) { lines.push(raw[k]); continue; }
    const last = lines[lines.length - 1];
    if (last?.op === "fold") last.count = (last.count ?? 0) + 1; else lines.push({ op: "fold", text: "", count: 1 });
  }
  return { lines, added: raw.filter((l) => l.op === "add").length, removed: raw.filter((l) => l.op === "del").length, truncated };
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", json: "application/json", csv: "text/csv" };
const local = (ref: string) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref);
const clean = (ref: string) => decodeURIComponent(ref.split(/[?#]/)[0]).replace(/^\.?\//, "");
const asData = (f: PageFile) => {
  const ext = f.file.split(".").pop()!.toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";
  // Page files are stored as text; binary ones are kept as base64 data: addresses already, so those are passed through.
  if (/^data:/.test(f.content)) return f.content;
  return `data:${mime};base64,${Buffer.from(f.content, "utf8").toString("base64")}`;
};
/** `</script` inside an inlined script would end it early. */
const safeScript = (s: string) => s.replace(/<\/script/gi, "<\\/script");
const safeStyle = (s: string) => s.replace(/<\/style/gi, "<\\/style");

/** One self-contained HTML file: the page's own CSS, JS, images and fonts inline. Outside addresses are left as they are. */
export function standaloneHtml(html: string, files: PageFile[]): string {
  const byName = new Map(files.map((f) => [f.file.replace(/^\.?\//, ""), f]));
  const find = (ref: string) => (local(ref) ? byName.get(clean(ref)) : undefined);
  const inlineUrls = (css: string) => css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (all, _q, ref: string) => { const f = find(ref); return f ? `url("${asData(f)}")` : all; });
  let out = html.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, (tag) => {
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    const f = href ? find(href) : undefined;
    return f ? `<style>${safeStyle(inlineUrls(f.content))}</style>` : tag;
  });
  out = out.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, before: string, src: string, after: string) => {
    const f = find(src);
    return f ? `<script${before}${after}>${safeScript(f.content)}</script>` : tag;
  });
  out = out.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_all, attrs: string, css: string) => `<style${attrs}>${inlineUrls(css)}</style>`);
  out = out.replace(/(<(?:img|source|video|audio)\b[^>]*?\s(?:src|poster)=)(["'])([^"']+)\2/gi, (all, head: string, q: string, ref: string) => { const f = find(ref); return f ? `${head}${q}${asData(f)}${q}` : all; });
  return out;
}

const PRINT_CSS = `@page{size:A4;margin:15mm}@media print{html,body{background:#fff!important}.sklubot-print-bar{display:none!important}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
.sklubot-print-bar{position:fixed;inset:auto 16px 16px auto;z-index:2147483647;font:600 15px/1.2 system-ui,sans-serif;display:flex;gap:8px}
.sklubot-print-bar button{min-height:44px;padding:0 18px;border-radius:10px;border:0;background:#111;color:#fff;cursor:pointer}`;

/** The A4 sheet: the standalone copy with a print stylesheet and a button for the browser's print window. */
export function a4Html(html: string, files: PageFile[], label: string): string {
  const page = standaloneHtml(html, files);
  const bar = `<div class="sklubot-print-bar"><button type="button" onclick="window.print()">${label.replace(/[<>&"]/g, "")}</button></div>`;
  const style = `<style>${PRINT_CSS}</style>`;
  const withStyle = /<\/head>/i.test(page) ? page.replace(/<\/head>/i, `${style}</head>`) : style + page;
  return /<\/body>/i.test(withStyle) ? withStyle.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${bar}</body>`) : withStyle + bar;
}

// ── Capture (browser mode) ──
const BASE = "http://sklubot-capture.invalid/";
const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", svg: "image/svg+xml", json: "application/json" };
export class CaptureError extends Error { constructor(public status: 400 | 404 | 409, message: string) { super(message); } }

type Chromium = { launch(opts: Record<string, unknown>): Promise<any> };
function chromium(): Chromium | null {
  const require = createRequire(import.meta.url);
  for (const name of ["playwright", "playwright-core"]) { try { return (require(name) as { chromium: Chromium }).chromium; } catch { /* next */ } }
  return null;
}

/** A PNG of the page (full page) or of the first element matching `selector`, at `width` CSS pixels. */
export async function capturePage(html: string, files: PageFile[], opts: { selector?: string; width?: number; dark?: boolean }): Promise<Buffer> {
  const engine = chromium();
  if (!engine) throw new CaptureError(409, "Captures need the browser of this server, which is not installed.");
  const selector = (opts.selector ?? "").trim();
  if (selector.length > 200) throw new CaptureError(400, "That element selector is too long.");
  const width = Math.min(1920, Math.max(320, Math.round(opts.width ?? 1280)));
  const served = new Map<string, string>([["", html], ["index.html", html], ...files.map((f) => [f.file.replace(/^\.?\//, ""), f.content] as [string, string])]);
  const browser = await engine.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
  try {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: opts.dark ? "dark" : "light", javaScriptEnabled: true });
    // Only the page's own files: anything else (internet, this server's network) is refused.
    await context.route("**/*", (route: any) => {
      const url = new URL(route.request().url());
      if (url.origin + "/" !== BASE) return route.abort();
      const rel = decodeURIComponent(url.pathname.slice(1));
      const body = served.get(rel);
      if (body === undefined) return route.fulfill({ status: 404, body: "" });
      const ext = rel.split(".").pop()!.toLowerCase();
      const dataUri = /^data:([^;,]+);base64,(.*)$/s.exec(body);
      return dataUri ? route.fulfill({ status: 200, contentType: dataUri[1], body: Buffer.from(dataUri[2], "base64") }) : route.fulfill({ status: 200, contentType: rel === "" ? TYPES.html : TYPES[ext] ?? "application/octet-stream", body });
    });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: "load", timeout: 30_000 });
    await page.waitForTimeout(400);
    if (!selector) return await page.screenshot({ type: "png", fullPage: true });
    const target = page.locator(selector).first();
    if (!(await target.count().catch(() => { throw new CaptureError(400, "That element selector is not valid."); }))) throw new CaptureError(404, "No element of the page matches that selector.");
    return await target.screenshot({ type: "png", timeout: 15_000 });
  } finally { await browser.close().catch(() => {}); }
}
