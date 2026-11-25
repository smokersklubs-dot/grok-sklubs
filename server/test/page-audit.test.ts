import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// L115 — Lighthouse and axe in the bot's computer image (owner decision n° 10): page_audit (pageaudit.ts,
// agent/tools-pageaudit.ts) and the image's own chrome-devtools-mcp (thirdpartymcp.ts).
// Unit part: a fake computer. Live part: the desktop image (SKLUBOT_AUDIT_IMAGE, default sklubot-desktop:latest), skipped
// when Docker, the image or its audit tools are missing.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-pageaudit-"));

const { PAGE_AUDIT_JS, formatAudit, libraryPath } = await import("../src/pageaudit.js");
const T = await import("../src/agent/tools-pageaudit.js");
const { publishPage } = await import("../src/agent/pagetools.js");
const { users, bots } = await import("../src/store.js");
const { hardenCommand, classifyTool, IMAGE_CHROMIUM } = await import("../src/thirdpartymcp.js");
import type { PageAuditAnswer } from "../src/pageaudit.js";
import type { ToolContext } from "../src/agent/tools.js";

const user = users.create("audit@example.com", "Audit", "x", "fr");
const bot = bots.create(user.id, { name: "Suzanne" });
const ctx = { bot, user, depth: 0, signal: new AbortController().signal } as unknown as ToolContext;
const tool = T.pageAuditTools[0];
const text = (o: { content: unknown }) => (typeof o.content === "string" ? o.content : JSON.stringify(o.content));

const FAILED = Array.from({ length: 11 }, (_, i) => ({ cat: i < 3 ? "accessibility" : "seo", id: `audit-${i}`, title: `Problem number ${i}`, score: 0, items: i + 1, where: `div.x${i}` }));
const ANSWER: PageAuditAnswer = {
  ok: true, url: null, dir: "/root/files/audits/boulangerie-20261125-161900",
  lighthouse: { ok: true, version: "13.6.0", scores: { performance: 100, accessibility: 42, "best-practices": 92, seo: 82 }, metrics: { "largest-contentful-paint": "0.8 s", "total-blocking-time": "0 ms", "cumulative-layout-shift": "0" }, failed: FAILED, failedCount: 11 },
  axe: { ok: true, version: "4.14.1", count: 2, violations: [{ id: "image-alt", impact: "critical", help: "Images must have alternative text", nodes: 1, where: "img" }, { id: "color-contrast", impact: "serious", help: "Elements must meet minimum color contrast ratio thresholds", nodes: 3, where: "p.muted" }] },
};
let calls: Record<string, any>[] = [];
let next: PageAuditAnswer = ANSWER;
T.setPageAuditRunner(async (_c, req) => { calls.push(req as Record<string, any>); return next; });
after(() => T.setPageAuditRunner(null));

test("page_audit on a published page: the page, its files and headers go to the computer; a short summary comes back", async () => {
  const html = "<!doctype html><html lang=fr><head><title>Boulangerie</title><link rel=stylesheet href=css/site.css></head><body><h1>Pain</h1></body></html>";
  const pub = publishPage({ name: "boulangerie", title: "Boulangerie", html, visibility: "private", files: [{ path: "css/site.css", content: "h1{color:#333}" }] }, ctx);
  assert.ok(!pub.isError, String(pub.content));
  calls = []; next = ANSWER;
  const out = await tool.run({ name: "boulangerie" }, ctx);
  const s = text(out);
  assert.equal(out.isError, undefined, s);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "boulangerie");
  assert.equal(calls[0].html, html);
  assert.deepEqual(calls[0].files, [{ path: "css/site.css", content: "h1{color:#333}" }]);
  assert.ok(calls[0].headers["content-security-policy"], "the real page's headers");
  assert.equal(calls[0].headers["x-robots-tag"], undefined, "noindex is on purpose for bot pages: not a finding");
  assert.equal(calls[0].url, undefined);
  assert.match(s, /^Audit of your page “boulangerie”/);
  assert.match(s, /Lighthouse 13\.6\.0: performance 100\/100 · accessibility 42\/100 · best practices 92\/100 · SEO 82\/100/);
  assert.match(s, /largest paint 0\.8 s, blocking 0 ms, layout shift 0/);
  assert.equal((s.match(/^- \[(accessibility|SEO)\]/gm) ?? []).length, 8, "at most 8 Lighthouse findings");
  assert.match(s, /… and 3 more Lighthouse findings in the report/);
  assert.match(s, /axe 4\.14\.1: 2 rules failed\n- \[critical\] image-alt: .* — 1 element, e\.g\. img\n- \[serious\] color-contrast/);
  assert.match(s, /Full reports in your library: audits\/boulangerie-20261125-161900\/lighthouse\.report\.html/);
  assert.match(s, /about a third/);
  assert.ok(s.length < 2500, `short summary (${s.length} characters)`);
  assert.equal(out.summary, "a11y 42 · perf 100 · axe 2");
});

test("page_audit: an unknown page lists the bot's pages; an older computer says the tools come with the next image", async () => {
  const miss = await tool.run({ name: "nope" }, ctx);
  assert.equal(miss.isError, true);
  assert.match(text(miss), /No page called "nope"\. Your pages: boulangerie\./);
  next = { error: "no_tools" };
  const old = await tool.run({ name: "boulangerie" }, ctx);
  assert.equal(old.isError, true);
  assert.match(text(old), /older image without Lighthouse and axe/);
  next = { error: "timeout" };
  assert.match(text(await tool.run({ name: "boulangerie" }, ctx)), /longer than 4 minutes/);
  next = ANSWER;
  assert.match(text(await tool.run({}, ctx)), /Give `name`/);
});

test("page_audit on an address: http(s) only, never a user name or password in it", async () => {
  for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "ftp://example.com/", "https://me:secret@example.com/", "pas une adresse"]) {
    assert.equal(T.auditUrl(bad), null, bad);
    calls = [];
    const out = await tool.run({ url: bad }, ctx);
    assert.equal(out.isError, true, bad);
    assert.equal(calls.length, 0, `${bad}: nothing runs`);
  }
  calls = []; next = { ...ANSWER, url: "https://example.com/", dir: "/root/files/audits/example.com-20261125-170000" };
  const out = await tool.run({ url: "https://example.com/" }, ctx);
  assert.deepEqual(calls[0], { name: "example.com", url: "https://example.com/" });
  assert.match(text(out), /^Audit of https:\/\/example\.com\//);
});

test("the summary says when a tool could not run, and the library path drops /root/files", () => {
  const s = formatAudit("x", { ok: true, dir: "/root/audits/x-1", lighthouse: { ok: false, error: "lighthouse exited with 1: Chrome did not start" }, axe: { ok: true, count: 0, violations: [], version: "4.14.1" } });
  assert.match(s, /Lighthouse could not run: lighthouse exited with 1: Chrome did not start/);
  assert.match(s, /axe 4\.14\.1: no rule failed/);
  assert.equal(libraryPath("/root/files/audits/a-1"), "audits/a-1");
});

test("the in-computer script is valid JavaScript and answers no_tools where the tools are missing", { skip: spawnSync("node", ["--version"]).status !== 0 && "no node" }, () => {
  const file = path.join(process.env.DATA_DIR!, "audit.js");
  writeFileSync(file, PAGE_AUDIT_JS);
  assert.equal(spawnSync("node", ["--check", file]).status, 0);
  const r = spawnSync("node", ["-e", PAGE_AUDIT_JS], { input: JSON.stringify({ name: "x", html: "<p>x</p>" }), encoding: "utf8", timeout: 20_000 });
  assert.deepEqual(JSON.parse(r.stdout), { error: "no_tools" }, "this machine has no /opt/sklubot/web-tools");
});

test("L115: the image's own chrome-devtools-mcp needs no version, gets the computer's Chromium headless; telemetry stays off", () => {
  assert.deepEqual(hardenCommand("chrome-devtools-mcp", []), { command: "chrome-devtools-mcp", args: ["--no-usage-statistics", "--no-performance-crux", `--executablePath=${IMAGE_CHROMIUM}`, "--headless"] });
  assert.deepEqual(hardenCommand("chrome-devtools-mcp", ["--browserUrl=http://127.0.0.1:9222"]).args, ["--browserUrl=http://127.0.0.1:9222", "--no-usage-statistics", "--no-performance-crux"], "joining the bot's own browser: no second one");
  assert.deepEqual(hardenCommand("chrome-devtools-mcp", ["-e", "/usr/bin/chromium", "--headless=false"]).args, ["-e", "/usr/bin/chromium", "--headless=false", "--no-usage-statistics", "--no-performance-crux"]);
  assert.deepEqual(hardenCommand("chrome-devtools-mcp", ["--no-headless"]).args, ["--no-headless", "--no-usage-statistics", "--no-performance-crux", `--executablePath=${IMAGE_CHROMIUM}`]);
  assert.throws(() => hardenCommand("npx", ["-y", "chrome-devtools-mcp"]), /exact version/, "npx still needs a pinned version");
  assert.throws(() => hardenCommand("chrome-devtools-mcp@latest", []), /exact version/);
  assert.deepEqual(classifyTool("chrome-devtools-mcp", [], { name: "set_logpoints", readOnly: true, destructive: false }), { readOnly: false, destructive: true });
  assert.deepEqual(classifyTool("chrome-devtools-mcp", [], { name: "lighthouse_audit", readOnly: true, destructive: false }), { readOnly: true, destructive: false });
});

// ── Live: the real tools in the desktop image ─────────────────────────────────────────────────────────────────────
const IMAGE = process.env.SKLUBOT_AUDIT_IMAGE || "sklubot-desktop:latest";
const docker = (args: string[], input?: string, timeout = 60_000) => spawnSync("docker", args, { input, encoding: "utf8", timeout });
const liveSkip = (() => {
  if (docker(["version", "--format", "{{.Server.Version}}"]).status !== 0) return "no Docker here";
  if (docker(["image", "inspect", IMAGE]).status !== 0) return `no image ${IMAGE}`;
  if (docker(["run", "--rm", "--entrypoint", "test", IMAGE, "-x", "/opt/sklubot/sklubot-axe"]).status !== 0) return `${IMAGE} has no audit tools (built before L115): set SKLUBOT_AUDIT_IMAGE`;
  return false;
})();
test("live: Lighthouse and axe audit a small page inside the desktop image, reports saved, summary short", { skip: liveSkip, timeout: 300_000 }, () => {
  const name = `sklubot-audit-test-${process.pid}`;
  assert.equal(docker(["run", "-d", "--init", "--name", name, "--entrypoint", "sleep", IMAGE, "infinity"]).status, 0);
  try {
    const html = "<!doctype html><html><head><meta charset=utf-8><title>Essai</title><style>p{color:#bbb;background:#fff}</style></head><body><h1>Bonjour</h1><p>Texte pâle</p><img src=x.png><button></button></body></html>";
    const r = docker(["exec", "-i", name, "node", "-e", PAGE_AUDIT_JS], JSON.stringify({ name: "essai", html, files: [], headers: {} }), 280_000);
    const ans = JSON.parse(r.stdout) as PageAuditAnswer;
    assert.equal(ans.ok, true, r.stderr);
    assert.equal(ans.lighthouse?.ok, true, ans.lighthouse?.error);
    assert.ok((ans.lighthouse?.scores?.accessibility ?? 100) < 90, "the broken page scores low");
    const ids = (ans.axe?.violations ?? []).map((v) => v.id);
    for (const id of ["image-alt", "button-name", "html-has-lang", "color-contrast"]) assert.ok(ids.includes(id), `axe finds ${id}: ${ids.join(", ")}`);
    assert.match(ans.dir ?? "", /^\/root\/audits\/essai-\d{8}-\d{6}$/, "no library here: the home folder");
    assert.equal(docker(["exec", name, "test", "-s", `${ans.dir}/lighthouse.report.html`]).status, 0);
    assert.equal(docker(["exec", name, "test", "-s", `${ans.dir}/axe.json`]).status, 0);
    assert.ok(formatAudit("your page “essai”", ans).length < 2500);
  } finally { docker(["rm", "-f", name]); }
});
