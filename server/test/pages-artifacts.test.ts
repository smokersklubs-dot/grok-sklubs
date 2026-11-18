import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Pages published by bots, "like artifacts" (pagefiles.ts, pageroutes.ts, agent/pagetools.ts): files next to the HTML,
// served in a sandbox (opaque origin, strict CSP, framed by the app only); private pages with files under a signed
// address; a version per publish and edit, restore and a new address; atomic edits; plan limits; nothing across accounts.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-pages-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "pgscript:p-1";
delete process.env.MAX_BOTS;
delete process.env.HOSTED_MODE;

const { registerProvider } = await import("../src/llm/index.js");
const { api, site } = await import("../src/routes.js");
const { bots, users, pages } = await import("../src/store.js");
const { pageTools } = await import("../src/agent/pagetools.js");
const pf = await import("../src/pagefiles.js");
const hosted = await import("../src/hosted.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

registerProvider({
  id: "pgscript", label: "Script", models: ["p-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> { req.onText?.("ok"); return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "p-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } }; },
});
function client() {
  let cookie = "";
  const go = async (app: typeof api | typeof site, method: string, url: string, body?: unknown, withCookie = true) => {
    const res = await app.request(url, { method, redirect: "manual", headers: { "content-type": "application/json", origin: process.env.PUBLIC_URL!, host: "bots.example.test", ...(cookie && withCookie ? { cookie } : {}) }, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set && set.startsWith("sklubot_session=")) cookie = set.split(";")[0];
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { api: (m: string, u: string, b?: unknown) => go(api, m, u, b), site: (u: string, withCookie = true) => go(site, "GET", u, undefined, withCookie) };
}
const A = client(), B = client();
const ids: Record<string, string> = {};
const publish = pageTools.find((t) => t.spec.name === "page_publish")!;
const edit = pageTools.find((t) => t.spec.name === "page_edit")!;
const ctx = (who: "a" | "b") => ({ bot: bots.byId(ids[`${who}Bot`])!, user: users.byId(ids[who])!, depth: 0, signal: AbortSignal.timeout(10_000) });
const tokenOf = (url: string) => url.split("/p/")[1];

const HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Calculette</title><link rel="stylesheet" href="css/site.css"></head><body><h1>Calculette</h1><script src="app.js"></script></body></html>`;

test("publish an interactive page with files: served in the sandbox, files beside it", async () => {
  ids.a = (await A.api("POST", "/auth/signup", { email: "a@example.com", name: "Alice", password: "password123", locale: "fr", acceptTerms: true })).json.user.id;
  ids.b = (await B.api("POST", "/auth/signup", { email: "b@example.com", name: "Bob", password: "password123", acceptTerms: true })).json.user.id;
  ids.aBot = bots.list(ids.a).find((x) => x.kind === "agent")!.id;
  ids.bBot = bots.list(ids.b).find((x) => x.kind === "agent")!.id;
  const out = await publish.run({ name: "calc", title: "Calculette", html: HTML, visibility: "link", files: [{ path: "css/site.css", content: "body{color:#123}" }, { path: "app.js", content: "document.body.dataset.ok='1'" }, { path: "data/v.json", content: "{\"x\":1}" }] }, ctx("a"));
  assert.equal(out.isError, undefined, String(out.content));
  const page = pages.list(ids.a, "https://bots.example.test")[0];
  ids.token = page.token;
  const r1 = await A.site(`/p/${page.token}`, false);
  assert.equal(r1.status, 302);
  assert.equal(r1.headers.get("location"), `/p/${page.token}/`);
  const r2 = await A.site(`/p/${page.token}/`, false);
  assert.equal(r2.status, 200);
  assert.equal(r2.text, HTML);
  const csp = r2.headers.get("content-security-policy")!;
  assert.match(csp, /^sandbox allow-scripts allow-popups;/);
  assert.doesNotMatch(csp, /allow-same-origin|allow-forms|allow-modals|allow-top-navigation/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https:\/\/cdnjs\.cloudflare\.com https:\/\/cdn\.jsdelivr\.net https:\/\/unpkg\.com;/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /form-action 'none'/);
  assert.equal(r2.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(r2.headers.get("x-robots-tag"), "noindex");
  const css = await A.site(`/p/${page.token}/css/site.css`, false);
  assert.equal(css.status, 200);
  assert.equal(css.text, "body{color:#123}");
  assert.equal(css.headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal(css.headers.get("access-control-allow-origin"), "*");
  assert.match(css.headers.get("content-security-policy")!, /^sandbox/);
  assert.equal((await A.site(`/p/${page.token}/data/v.json`, false)).headers.get("content-type"), "application/json; charset=utf-8");
  for (const bad of ["../calc.html", "%2e%2e/calc.html", "nope.css", ".env", "app.exe"]) assert.equal((await A.site(`/p/${page.token}/${bad}`, false)).status, 404, bad);
});

test("file names and sizes are checked before anything is published", async () => {
  const bad = async (files: unknown, html = HTML) => (await publish.run({ name: "bad", title: "Bad", html, files }, ctx("a")));
  for (const f of [[{ path: "../x.css", content: "" }], [{ path: "/abs.js", content: "" }], [{ path: "x.exe", content: "" }], [{ path: "a\\b.js", content: "" }], [{ path: ".hidden.js", content: "" }], [{ path: "a.js", content: "" }, { path: "a.js", content: "" }]]) {
    const r = await bad(f);
    assert.equal(r.isError, true, JSON.stringify(f));
    assert.match(String(r.content), /Nothing was published/);
  }
  assert.equal((await bad(Array.from({ length: 21 }, (_, i) => ({ path: `f${i}.js`, content: "" })))).isError, true);
  assert.equal((await bad([{ path: "big.js", content: "x".repeat(1_000_001) }])).isError, true);
  assert.equal(pages.list(ids.a, "https://bots.example.test").some((p) => p.title === "Bad"), false);
  assert.equal(pf.cleanFileName("css/site.css"), "css/site.css");
  assert.equal(pf.cleanFileName("a/b/c/d/e.js"), null, "4 folders deep at most");
});

test("page_edit: the HTML or a file, all or nothing, a version each time; restore and history", async () => {
  const fail = await edit.run({ name: "calc", edits: [{ find: "Calculette", replace: "X" }] }, ctx("a"));
  assert.equal(fail.isError, true, "appears twice → refused");
  assert.equal((await A.site(`/p/${ids.token}/`, false)).text, HTML, "unchanged");
  const ok = await edit.run({ name: "calc", file: "css/site.css", edits: [{ find: "#123", replace: "#456" }] }, ctx("a"));
  assert.equal(ok.isError, undefined, String(ok.content));
  assert.equal((await A.site(`/p/${ids.token}/css/site.css`, false)).text, "body{color:#456}");
  const add = await edit.run({ name: "calc", file: "extra.js", edits: [{ find: "", replace: "console.log(1)" }] }, ctx("a"));
  assert.equal(add.isError, undefined, String(add.content));
  const h = await edit.run({ name: "calc", edits: [{ find: "<h1>Calculette</h1>", replace: "<h1>Calculatrice</h1>" }] }, ctx("a"));
  assert.equal(h.isError, undefined);
  const v = await A.api("GET", `/pages/${ids.token}/versions`);
  assert.equal(v.status, 200, v.text);
  assert.equal(v.json.versions.length, 4);
  assert.deepEqual(v.json.versions.map((x: any) => x.note), ["edited", "edited extra.js", "edited css/site.css", "published"]);
  assert.deepEqual(v.json.files, ["app.js", "css/site.css", "data/v.json", "extra.js"]);
  const first = v.json.versions[3];
  const view = await A.api("GET", `/pages/${ids.token}/versions/${first.id}/view`);
  assert.equal(view.text, HTML);
  assert.match(view.headers.get("content-security-policy")!, /^sandbox allow-scripts/);
  // B sees nothing of A's history and cannot restore it or move its address.
  assert.equal((await B.api("GET", `/pages/${ids.token}/versions`)).status, 404);
  assert.equal((await B.api("GET", `/pages/${ids.token}/versions/${first.id}/view`)).status, 404);
  assert.equal((await B.api("POST", `/pages/${ids.token}/versions/${first.id}/restore`)).status, 404);
  assert.equal((await B.api("POST", `/pages/${ids.token}/rotate`)).status, 404);
  const back = await A.api("POST", `/pages/${ids.token}/versions/${first.id}/restore`);
  assert.equal(back.status, 200, back.text);
  assert.equal((await A.site(`/p/${ids.token}/`, false)).text, HTML);
  assert.equal((await A.site(`/p/${ids.token}/css/site.css`, false)).text, "body{color:#123}");
  assert.equal((await A.site(`/p/${ids.token}/extra.js`, false)).status, 404, "the restored version had no extra.js");
  assert.equal((await A.api("GET", `/pages/${ids.token}/versions`)).json.versions[0].note, "restored version 1");
});

test("private page with files: the owner gets a signed address, strangers get nothing", async () => {
  assert.equal((await A.api("PATCH", `/pages/${ids.token}`, { visibility: "private" })).status, 200);
  assert.equal((await B.site(`/p/${ids.token}`)).status, 404);
  assert.equal((await A.site(`/p/${ids.token}`, false)).status, 404);
  assert.equal((await A.site(`/p/${ids.token}/css/site.css`, false)).status, 404, "no unsigned file of a private page");
  const r = await A.site(`/p/${ids.token}`);
  assert.equal(r.status, 302);
  const loc = r.headers.get("location")!;
  assert.match(loc, new RegExp(`^/p/${ids.token}/s/\\d+\\.[A-Za-z0-9_-]{32}/$`));
  // Under the signed address the page and its files come without any cookie (the sandboxed page sends none).
  assert.equal((await B.site(loc, false)).text, HTML);
  assert.equal((await B.site(`${loc}css/site.css`, false)).text, "body{color:#123}");
  assert.equal((await B.site(loc.replace(/\.[A-Za-z0-9_-]{32}\//, ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/"), false)).status, 404, "a forged signature");
  const other = pages.create(bots.byId(ids.bBot)!, "B's", "pages/b.html", "https://bots.example.test", "private");
  assert.equal((await B.site(loc.replace(ids.token, other.token), false)).status, 404, "a signature is for one page");
  assert.equal(pf.verifySigned(ids.token, loc.split("/")[4], Date.now() + pf.SIGNED_MS + 60_000), false, "it expires");
});

test("a new address: the old link stops working at once", async () => {
  await A.api("PATCH", `/pages/${ids.token}`, { visibility: "link" });
  const r = await A.api("POST", `/pages/${ids.token}/rotate`);
  assert.equal(r.status, 200, r.text);
  assert.equal((await A.site(`/p/${ids.token}/`, false)).status, 404);
  assert.equal((await A.site(`/p/${r.json.token}/`, false)).status, 200);
  assert.equal((await A.api("GET", `/pages/${r.json.token}/versions`)).json.versions.length, 5, "the history follows the page");
  ids.token = r.json.token;
});

test("a single-file page is still served as before; a free hosted plan gets small quotas", async () => {
  const out = await publish.run({ name: "simple", title: "Simple", html: "<!doctype html><p>hi</p>" }, ctx("b"));
  const url = String(out.content).match(/https:\/\/bots\.example\.test\/p\/[A-Za-z0-9_-]+/)![0];
  const r = await B.site(`/p/${tokenOf(url)}`, false);
  assert.equal(r.status, 200);
  assert.equal(r.text, "<!doctype html><p>hi</p>");
  process.env.HOSTED_MODE = "1";
  try {
    if (!hosted.plans.get("free")) hosted.plans.save({ id: "free", kind: "free", nameFr: "Gratuit", nameEn: "Free" }, ids.a);
    hosted.subscriptions.ensure(ids.b);
    hosted.subscriptions.update(ids.b, { planId: "free", status: "active" });
    assert.deepEqual(pf.pageLimits(ids.b), { files: 5, fileBytes: 200_000, totalBytes: 1_000_000, htmlBytes: 1_000_000, versions: 5 });
    assert.equal(pf.pageLimits(ids.a).files, 20, "the operator");
    const many = await publish.run({ name: "many", title: "Many", html: "<p>x</p>", files: Array.from({ length: 6 }, (_, i) => ({ path: `f${i}.js`, content: "" })) }, ctx("b"));
    assert.equal(many.isError, true);
    for (let i = 0; i < 7; i++) await edit.run({ name: "simple", edits: [{ find: i ? `v${i - 1}` : "hi", replace: `v${i}` }] }, ctx("b"));
    assert.equal((await B.api("GET", `/pages/${tokenOf(url)}/versions`)).json.versions.length, 5, "the oldest versions are dropped");
  } finally { delete process.env.HOSTED_MODE; }
});
