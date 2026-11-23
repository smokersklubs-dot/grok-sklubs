import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L140 « Commenter la page »: the page route adds the comment layer only on ?sklubot-comment=1, keeps the page's
// sandbox CSP, keeps the parameter through the redirects (files, private signed address), and never touches the page
// served without it.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-pagecomment-"));
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
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

registerProvider({
  id: "pgscript", label: "Script", models: ["p-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> { req.onText?.("ok"); return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "p-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } }; },
});
let cookie = "";
const go = async (app: typeof api | typeof site, method: string, url: string, body?: unknown, withCookie = true) => {
  const res = await app.request(url, { method, redirect: "manual", headers: { "content-type": "application/json", origin: process.env.PUBLIC_URL!, host: "bots.example.test", ...(cookie && withCookie ? { cookie } : {}) }, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set && set.startsWith("sklubot_session=")) cookie = set.split(";")[0];
  return { status: res.status, text: await res.text(), headers: res.headers };
};
const publish = pageTools.find((t) => t.spec.name === "page_publish")!;
const HTML = `<!doctype html><html><head><title>T</title></head><body><h1>Tarifs</h1></body></html>`;
const LAYER = /<script data-sklubot-layer>[\s\S]*sklubot-page-pick[\s\S]*<\/script><\/body>/;

test("the layer only on ?sklubot-comment=1, before </body>, under the same sandbox CSP", async () => {
  const userId = JSON.parse((await go(api, "POST", "/auth/signup", { email: "c@example.com", name: "Chloé", password: "password123", locale: "fr", acceptTerms: true })).text).user.id;
  const ctx = { bot: bots.byId(bots.list(userId).find((x) => x.kind === "agent")!.id)!, user: users.byId(userId)!, depth: 0, signal: AbortSignal.timeout(10_000) };
  assert.equal((await publish.run({ name: "plain", title: "Plain", html: HTML, visibility: "link" }, ctx)).isError, undefined);
  assert.equal((await publish.run({ name: "files", title: "Files", html: HTML, visibility: "link", files: [{ path: "a.css", content: "h1{}" }] }, ctx)).isError, undefined);
  assert.equal((await publish.run({ name: "priv", title: "Priv", html: HTML, visibility: "private", files: [{ path: "a.css", content: "h1{}" }] }, ctx)).isError, undefined);
  const tok = (title: string) => pages.list(userId, "https://bots.example.test").find((p) => p.title === title)!.token;

  const plain = await go(site, "GET", `/p/${tok("Plain")}`, undefined, false);
  assert.equal(plain.text, HTML, "no parameter: the page exactly as published");
  const commented = await go(site, "GET", `/p/${tok("Plain")}?sklubot-comment=1`, undefined, false);
  assert.equal(commented.status, 200);
  assert.match(commented.text, LAYER);
  assert.equal(commented.text.replace(/<script data-sklubot-layer>[\s\S]*?<\/script>/, ""), HTML, "nothing else changed");
  assert.equal(commented.headers.get("content-security-policy"), plain.headers.get("content-security-policy"), "same sandbox");
  assert.match(commented.headers.get("content-security-policy")!, /^sandbox allow-scripts allow-popups;/);
  assert.doesNotMatch(commented.headers.get("content-security-policy")!, /allow-same-origin/);
  assert.equal((await go(site, "GET", `/p/${tok("Plain")}?sklubot-comment=0`, undefined, false)).text, HTML);

  const redirect = await go(site, "GET", `/p/${tok("Files")}?sklubot-comment=1`, undefined, false);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), `/p/${tok("Files")}/?sklubot-comment=1`);
  assert.match((await go(site, "GET", redirect.headers.get("location")!, undefined, false)).text, LAYER);

  const signed = await go(site, "GET", `/p/${tok("Priv")}?sklubot-comment=1`);
  assert.equal(signed.status, 302);
  assert.match(signed.headers.get("location")!, /^\/p\/[^/]+\/s\/[^/]+\/\?sklubot-comment=1$/);
  assert.match((await go(site, "GET", signed.headers.get("location")!, undefined, false)).text, LAYER);
  assert.equal((await go(site, "GET", `/p/${tok("Priv")}?sklubot-comment=1`, undefined, false)).status, 404, "private stays private");
});
