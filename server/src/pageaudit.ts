/**
 * L115 « Lighthouse / axe dans l'image du bot » (owner decision n° 10): page_audit measures one page — a page the bot
 * published, or an address — with Lighthouse and axe on the bot's OWN Linux computer, saves the full reports in its
 * library (files/audits/<name>-<date>/) and returns a short summary. Our own code. Tools (docker/desktop/Dockerfile, all
 * started with the computer's Chromium through /opt/sklubot/headless-chromium, never a second Chrome):
 *  - Lighthouse 13.6.0 CLI, flags as documented by `lighthouse --help` (GoogleChrome/lighthouse cli/cli-flags.js):
 *    --output json --output html --output-path <dir>/lighthouse (two outputs: lighthouse.report.json and .report.html),
 *    --only-categories, --chrome-flags, --quiet, --no-enable-error-reporting (docs/error-reporting.md). The JSON report
 *    is read as documented in docs/understanding-results.md: categories.<id>.score (0–1), audits.<id>.{score,
 *    scoreDisplayMode, title, displayValue, details.items}.
 *  - sklubot-axe (docker/desktop/sklubot-axe: axe-core 4.14 through puppeteer-core) with --json <file>; its file is
 *    axe.run's result object (axe-core doc/API.md "Results Object": violations[].{id, impact, help, nodes[].target}).
 * A published page is served from memory on 127.0.0.1 inside the computer, with the same headers as the real page
 * (pagefiles.ts pageHeaders), only for the time of the audit, like the automatic check of pagecheck.ts.
 *
 * PAGE_AUDIT_JS runs inside the computer (`node -e`, the request as JSON on standard input, one JSON answer on standard
 * output). Request: { url?: string, html?: string, files?: {path, content}[], headers?: {}, name: string }.
 */
export const PAGE_AUDIT_JS = String.raw`
const fs = require("node:fs"), http = require("node:http"), path = require("node:path"), { execFile } = require("node:child_process");
const out = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0); };
const TOOLS = "/opt/sklubot/web-tools/node_modules";
const run = (cmd, args, ms) => new Promise((resolve) => execFile(cmd, args, { timeout: ms, maxBuffer: 4e6 }, (err, so, se) => resolve({ code: err ? (typeof err.code === "number" ? err.code : -1) : 0, killed: !!(err && err.killed), stderr: String(se || "").slice(-600) })));
const TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8", svg: "image/svg+xml; charset=utf-8", csv: "text/csv; charset=utf-8", txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8" };
let input = "";
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", async () => {
  let req; try { req = JSON.parse(input || "{}"); } catch { out({ error: "bad_request" }); }
  if (!fs.existsSync(TOOLS + "/lighthouse") || !fs.existsSync("/opt/sklubot/sklubot-axe")) out({ error: "no_tools" });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const base = fs.existsSync("/root/files") ? "/root/files/audits" : "/root/audits";
  const dir = path.join(base, String(req.name || "page").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60) + "-" + stamp);
  fs.mkdirSync(dir, { recursive: true });
  let url = req.url, server = null;
  if (!url) {
    const files = new Map([["", req.html || ""], ["index.html", req.html || ""], ...(req.files || []).map((f) => [String(f.path).replace(/^\/+/, ""), String(f.content)])]);
    server = http.createServer((q, s) => {
      const rel = decodeURIComponent(new URL(q.url, "http://x").pathname).replace(/^\/+/, "");
      const body = files.get(rel);
      if (body === undefined) { s.writeHead(404); s.end(); return; }
      s.writeHead(200, Object.assign({}, req.headers || {}, { "content-type": TYPES[(rel || "index.html").split(".").pop().toLowerCase()] || "application/octet-stream" }));
      s.end(body);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    url = "http://127.0.0.1:" + server.address().port + "/";
  }
  const ans = { ok: true, url: req.url || null, dir };
  const lh = await run("lighthouse", [url, "--output=json", "--output=html", "--output-path=" + dir + "/lighthouse", "--only-categories=performance,accessibility,best-practices,seo", "--chrome-flags=--headless=new", "--quiet", "--no-enable-error-reporting"], 170000);
  try {
    const r = JSON.parse(fs.readFileSync(dir + "/lighthouse.report.json", "utf8"));
    const scores = {}; for (const [k, c] of Object.entries(r.categories || {})) scores[k] = c.score == null ? null : Math.round(c.score * 100);
    const inCat = {}; for (const [k, c] of Object.entries(r.categories || {})) for (const ref of c.auditRefs || []) if (ref.weight > 0 || k === "accessibility") inCat[ref.id] = inCat[ref.id] || k;
    const failed = [];
    for (const [id, a] of Object.entries(r.audits || {})) {
      if (!inCat[id] || a.score == null || a.score >= 0.9 || !["binary", "numeric", "metricSavings"].includes(a.scoreDisplayMode)) continue;
      const items = (a.details && a.details.items) || [];
      const first = items[0] || {};
      const where = (first.node && (first.node.selector || first.node.snippet)) || first.url || first.source && first.source.url || "";
      failed.push({ cat: inCat[id], id, title: String(a.title || id).slice(0, 160), score: Math.round(a.score * 100), value: a.displayValue ? String(a.displayValue).slice(0, 60) : "", items: items.length, where: String(where).slice(0, 120) });
    }
    const order = { accessibility: 0, "best-practices": 1, seo: 2, performance: 3 };
    failed.sort((x, y) => (order[x.cat] - order[y.cat]) || (x.score - y.score));
    const metrics = {}; for (const m of ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index"]) if (r.audits && r.audits[m] && r.audits[m].displayValue) metrics[m] = r.audits[m].displayValue;
    ans.lighthouse = { ok: true, version: r.lighthouseVersion, scores, metrics, failed: failed.slice(0, 30), failedCount: failed.length, runtimeError: r.runtimeError ? String(r.runtimeError.message || r.runtimeError.code).slice(0, 200) : undefined };
  } catch { ans.lighthouse = { ok: false, error: lh.killed ? "timeout" : ("lighthouse exited with " + lh.code + (lh.stderr ? ": " + lh.stderr.trim().split("\n").slice(-2).join(" ") : "")).slice(0, 300) }; }
  const ax = await run("/opt/sklubot/sklubot-axe", [url, "--json", dir + "/axe.json"], 90000);
  try {
    const r = JSON.parse(fs.readFileSync(dir + "/axe.json", "utf8"));
    const rank = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    const v = (r.violations || []).map((x) => ({ id: x.id, impact: x.impact || "?", help: String(x.help || "").slice(0, 160), nodes: (x.nodes || []).length, where: x.nodes && x.nodes[0] ? String([].concat(x.nodes[0].target).join(" ")).slice(0, 120) : "" }));
    v.sort((a, b) => (rank[a.impact] ?? 4) - (rank[b.impact] ?? 4));
    ans.axe = { ok: true, version: r.testEngine && r.testEngine.version, violations: v.slice(0, 30), count: v.length };
  } catch { ans.axe = { ok: false, error: ax.killed ? "timeout" : ("sklubot-axe exited with " + ax.code + (ax.stderr ? ": " + ax.stderr.trim().split("\n").slice(-1)[0] : "")).slice(0, 300) }; }
  if (server) server.close();
  out(ans);
});
`;

export interface AuditFailed { cat: string; id: string; title: string; score: number; value?: string; items: number; where?: string }
export interface AxeViolation { id: string; impact: string; help: string; nodes: number; where?: string }
export interface PageAuditAnswer {
  ok?: boolean; error?: string; detail?: string; url?: string | null; dir?: string;
  lighthouse?: { ok: boolean; error?: string; version?: string; scores?: Record<string, number | null>; metrics?: Record<string, string>; failed?: AuditFailed[]; failedCount?: number; runtimeError?: string };
  axe?: { ok: boolean; error?: string; version?: string; violations?: AxeViolation[]; count?: number };
}

const NAMES: Record<string, string> = { performance: "performance", accessibility: "accessibility", "best-practices": "best practices", seo: "SEO" };
const one = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
/** Where the reports are, as the bot names library files ("audits/…"), from the folder inside the computer. */
export const libraryPath = (dir: string) => dir.replace(/^\/root\/files\//, "");

/** The short summary the bot gets: scores, the failures (at most 8 + 8 lines), where the full reports are. */
export function formatAudit(what: string, r: PageAuditAnswer): string {
  const lines = [`Audit of ${what} on your computer (Lighthouse and axe, phone size):`];
  const lh = r.lighthouse;
  if (lh?.ok) {
    const scores = Object.entries(lh.scores ?? {}).map(([k, v]) => `${NAMES[k] ?? k} ${v ?? "—"}/100`).join(" · ");
    lines.push(`Lighthouse ${lh.version ?? ""}: ${scores}`.replace("  ", " "));
    const m = lh.metrics ?? {};
    const metrics = [["largest-contentful-paint", "largest paint"], ["total-blocking-time", "blocking"], ["cumulative-layout-shift", "layout shift"]].filter(([k]) => m[k]).map(([k, label]) => `${label} ${one(m[k], 20)}`);
    if (metrics.length) lines.push(`Speed (simulated slow phone): ${metrics.join(", ")}`);
    if (lh.runtimeError) lines.push(`Lighthouse warning: ${one(lh.runtimeError, 160)}`);
    for (const f of (lh.failed ?? []).slice(0, 8)) lines.push(`- [${NAMES[f.cat] ?? f.cat}] ${one(f.title, 140)}${f.value ? ` (${one(f.value, 40)})` : ""}${f.items ? ` — ${f.items} item${f.items > 1 ? "s" : ""}` : ""}${f.where ? `, e.g. ${one(f.where, 100)}` : ""}`);
    if ((lh.failedCount ?? 0) > 8) lines.push(`- … and ${(lh.failedCount ?? 0) - 8} more Lighthouse findings in the report`);
  } else lines.push(`Lighthouse could not run: ${one(lh?.error ?? "no answer", 200)}`);
  const ax = r.axe;
  if (ax?.ok) {
    const n = ax.count ?? 0;
    lines.push(`axe ${ax.version ?? ""}: ${n ? `${n} rule${n > 1 ? "s" : ""} failed` : "no rule failed"}`.replace("  ", " "));
    for (const v of (ax.violations ?? []).slice(0, 8)) lines.push(`- [${v.impact}] ${v.id}: ${one(v.help, 140)} — ${v.nodes} element${v.nodes > 1 ? "s" : ""}${v.where ? `, e.g. ${one(v.where, 100)}` : ""}`);
    if (n > 8) lines.push(`- … and ${n - 8} more axe rules in the report`);
  } else lines.push(`axe could not run: ${one(ax?.error ?? "no answer", 200)}`);
  if (r.dir) { const lib = libraryPath(r.dir); lines.push(`Full reports ${lib === r.dir ? "on your computer" : "in your library"}: ${lib}/lighthouse.report.html (opens in a browser), ${lib}/lighthouse.report.json, ${lib}/axe.json. Do not paste them into the chat; read a part only if you need a detail.`); }
  lines.push("An automatic audit finds only part of the problems (about a third for accessibility): also do the manual checks of the skill “Accessibilité mesurée” (keyboard, focus, names, zoom). Fix your own pages with page_edit, then audit again. Tell the user the scores and the main fixes in a few plain sentences.");
  return lines.join("\n");
}
