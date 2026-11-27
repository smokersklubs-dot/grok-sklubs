import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L56 (the automatic check of a published page: its static rules and its report), L81 (masking of request headers and
// addresses, console lines) and L65/L74 (stable references, "what changed", read-back words) — the parts that need no
// browser. The browser parts are tested on the real bot computer in browser-text.test.ts.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-pchk-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.DEFAULT_MODEL = "demo:demo";

const { staticFindings, formatReport, withPageCheck } = await import("../src/pagecheck.js");
const { maskHeaders, maskUrl, consoleLines, requestLine } = await import("../src/browser-devtools.js");
const { afterAction, rememberSnapshot, resolveRef, refusal, typedWords, noteMoved } = await import("../src/agent/elements.js");
const { builtinTools } = await import("../src/agent/tools.js");
const { bots, users } = await import("../src/store.js");

const BAD = `<!doctype html><html><head><title>Bad</title><style>
.a { transition: all .3s; width: 100vw; color: #111; background: #fff; border-color: #222; outline-color: #333; }
.b { color: #444; background: #555; fill: #666; stroke: #777; caret-color: #888; }
@keyframes spin { to { transform: rotate(1turn); } }
</style><script type="application/ld+json">{ broken</script></head>
<body><a href="#x">Lien</a><img src="photo.jpg"><img src="b.png" alt="ok">Texte​ caché</body></html>`;
const GOOD = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Good</title>
<style>:root { --ink: #111; --paper: #fff; } body { color: var(--ink); background: var(--paper); } a:focus-visible { outline: 2px solid var(--ink); }
@media (prefers-reduced-motion: reduce) { * { animation: none; } } .x { transition: opacity .2s; }</style>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Bakery"}</script></head><body><a href="#x">Lien</a><img src="a.jpg" alt="Le four"></body></html>`;

test("L56: the static floor finds each fault once, in plain words; a careful page has none", () => {
  const f = staticFindings(BAD, [{ path: "css/site.css", content: ".c { transition: all 1s }" }]);
  const rules = f.map((x) => x.rule).sort();
  assert.deepEqual(rules, ["100vw", "alt", "colors", "focus", "invisible", "json-ld", "lang", "motion", "transition-all", "viewport"].sort());
  assert.match(f.find((x) => x.rule === "alt")!.text, /^1 image without alt text \(photo\.jpg\)/);
  assert.match(f.find((x) => x.rule === "transition-all")!.text, /\(2×\)/, "the page's CSS file is read too");
  assert.match(f.find((x) => x.rule === "invisible")!.text, /U\+200B/);
  assert.deepEqual(staticFindings(GOOD, []), []);
});

test("L56: the report — findings listed, «nothing found» never called clean, and why nothing was rendered", () => {
  const rendered = { ok: true, shots: [], console: [{ width: 390, text: "Uncaught TypeError: x is not a function", line: 12 }, { width: 1280, text: "Uncaught TypeError: x is not a function", line: 12 }], failed: [{ width: 390, url: "http://127.0.0.1:4111/p/check/css/missing.css", status: 404 }], rules: { "390": [{ rule: "overflow", text: "the page is 1012 px wide at 390 px: it scrolls sideways" }], "1280": [] } };
  const r = formatReport(staticFindings(BAD, []), rendered, null);
  assert.match(r, /^Automatic check of the page \(rendered at 390 and 1280 px/);
  assert.match(r, /Console: 1 error — “Uncaught TypeError: x is not a function” \(line 12\)/, "the same error at both widths is said once");
  assert.match(r, /Failed loads: 1 — 404 css\/missing\.css/);
  assert.match(r, /At 390 px: the page is 1012 px wide/);
  assert.match(r, /do not call the page finished while an error or an overflow remains/);
  const clean = formatReport([], { ok: true, shots: [], console: [], failed: [], rules: {} }, null);
  assert.match(clean, /- Nothing found by these checks\./);
  assert.match(clean, /is not proof that the page is right/);
  assert.doesNotMatch(clean.replace("without calling it “clean”", ""), /clean/i);
  const unrendered = formatReport([], null, "there is no browser on this server");
  assert.match(unrendered, /its code only — there is no browser on this server: no picture, no console/);
});

test("L56: page_publish and page_edit answer with the check (no browser here: the code-only report)", async () => {
  const user = users.create("pc@example.com", "Léa", "x", "en");
  const bot = bots.create(user.id, { name: "Pager", autonomy: "balanced" });
  const ctx = { bot, user, depth: 0, signal: new AbortController().signal } as never;
  const publish = builtinTools().find((t) => t.spec.name === "page_publish")!;
  const out = await publish.run({ name: "bad", title: "Bad", html: BAD, visibility: "private" }, ctx);
  assert.ok(!out.isError, String(out.content));
  assert.equal(typeof out.content, "string", "no picture without a browser");
  assert.match(String(out.content), /^Published at .*\n\nAutomatic check of the page \(its code only — there is no browser on this server/s);
  assert.match(String(out.content), /1 image without alt text/);
  const edit = builtinTools().find((t) => t.spec.name === "page_edit")!;
  const fixed = await edit.run({ name: "bad", edits: [{ find: '<img src="photo.jpg">', replace: '<img src="photo.jpg" alt="Le four">' }] }, ctx);
  assert.match(String(fixed.content), /^Applied 1 edit/);
  assert.doesNotMatch(String(fixed.content), /without alt text/, "the edited page is the one checked");
  const kept = await withPageCheck({ content: [{ type: "text" as const, text: "Done." }] }, { bot, user }, GOOD, []);
  assert.match(String(kept.content), /^Done\.\n\nAutomatic check/);
});

test("L81: header values that can carry a secret are masked; secret-looking query values too", () => {
  const h = maskHeaders({ Authorization: "Bearer sk-fake-for-tests", Cookie: "sid=abc", "Set-Cookie": "sid=abc", "X-Api-Key": "sk-fake-for-tests", "X-CSRF-Token": "t", "content-type": "application/json", "x-session-id": "s1" });
  assert.deepEqual(h, { Authorization: "(masked)", Cookie: "(masked)", "Set-Cookie": "(masked)", "X-Api-Key": "(masked)", "X-CSRF-Token": "(masked)", "content-type": "application/json", "x-session-id": "(masked)" });
  assert.equal(maskUrl("https://api.example/v1/items?page=2&access_token=sk-fake-for-tests&key=k"), "https://api.example/v1/items?page=2&access_token=(masked)&key=(masked)");
  const line = requestLine({ id: "1", method: "GET", url: "https://api.example/a?token=zz", status: 200, type: "Fetch", size: 2048 }, 3);
  assert.equal(line, "#3 GET 200 fetch https://api.example/a?token=(masked) 2.0 kB");
  assert.match(requestLine({ id: "2", method: "POST", url: "https://x.example/", failed: "net::ERR_FAILED", blocked: "csp" }, 4), /^#4 POST failed \(net::ERR_FAILED, blocked: csp\)/);
  const c = consoleLines([{ level: "log", text: "hi" }, { level: "error", text: "boom", url: "https://x.example/app.js", line: 7 }, { level: "warning", text: "careful" }], false, 40);
  assert.deepEqual(c, { lines: ["[error] boom (app.js:7)", "[warning] careful"], errors: 1, total: 3 });
  assert.equal(consoleLines([{ level: "log", text: "hi" }], true, 40).lines[0], "[log] hi");
});

const el = (node: number, role: string, name: string, extra: Record<string, unknown> = {}) => ({ node, role, name, visible: true, ...extra });
const snap = (loader: string, elements: ReturnType<typeof el>[], lines: string[] = [], url = "https://shop.example/a") => ({ url, title: "Shop", target: "T1", loader, elements, more: 0, outline: { headings: [{ level: 1, text: "Shop" }], lines, textLength: 500, media: 0 } });

test("L74/L65: references stay the same on one page; a new page starts afresh; what changed is said in words", () => {
  const B = "bot-stable";
  const first = rememberSnapshot(B, snap("L1", [el(10, "button", "Add"), el(11, "link", "Home", { href: "https://shop.example/home?x=1" }), el(12, "button", "", { hint: "icon:trash; in:Blue mug" })]));
  const id = /Element snapshot ([0-9a-f]{4})/.exec(first)![1];
  assert.match(first, new RegExp(`\\[${id}\\.2\\] link "Home" → /home\\?x=1`), "a link's address, short on its own site");
  assert.match(first, /button "" hint="icon:trash; in:Blue mug"/);
  assert.match(first, /- h1 Shop/);
  // The same page, looked at again after a click: same numbers, the new control and new text said; old references still work.
  const after = afterAction(B, snap("L1", [el(10, "button", "Add", { disabled: true }), el(11, "link", "Home"), el(13, "button", "Undo")], ["Added to the basket"]));
  assert.equal(after.fresh, false);
  assert.match(after.text, new RegExp(`What changed:\\n\\+ \\[${id}\\.4\\] button "Undo"`));
  assert.match(after.text, /− button "" is gone/);
  assert.match(after.text, new RegExp(`~ \\[${id}\\.1\\] button "Add" \\(disabled\\) \\(was: no state\\)`));
  assert.match(after.text, /New text on the page: “Added to the basket”/);
  assert.ok(!("error" in resolveRef(B, `${id}.2`)), "a reference from the first look still works");
  // A redrawn element (same role and name, new node) is neither new nor gone; once found again its reference follows it.
  const redrawn = afterAction(B, snap("L1", [el(10, "button", "Add", { disabled: true }), el(21, "link", "Home"), el(13, "button", "Undo")], ["Added to the basket"]));
  assert.match(redrawn.text, /Nothing visible changed/);
  noteMoved(B, `${id}.2`, 21);
  assert.equal((resolveRef(B, `${id}.2`) as { req: { node: number } }).req.node, 21);
  // A new document: a new id, a whole listing, and the old references fail clearly.
  const next = afterAction(B, snap("L2", [el(30, "button", "Pay")], [], "https://shop.example/pay"));
  assert.equal(next.fresh, true);
  assert.match(next.text, /^Page: Shop — https:\/\/shop\.example\/pay\nHeadings:/);
  assert.match((resolveRef(B, `${id}.1`) as { error: string }).error, /from an older page/);
  assert.equal(afterAction(B, { ...snap("L2", []), outline: { lines: [], textLength: 20, media: 0 } }).sparse, true, "no control, almost no text: a picture is needed");
});

test("L74: refusals say whether trying again is safe; typing is read back", () => {
  assert.match(refusal("b", { covered: 'div#cookie "We use cookies"' }), /Nothing was clicked\. Deal with what covers it first/);
  assert.match(refusal("b", { sent: true, error: "the page did not confirm the click (late)" }, "click"), /^The click was sent, but the page did not confirm it: .* do not repeat it blindly/);
  assert.match(refusal("b", { error: "that element is disabled" }), /will not help until the page enables it/);
  assert.match(refusal("b", { stale: "that element is no longer on the page" }), /safe to try again/);
  assert.equal(typedWords({ verified: true, value: "Zoé" }), "— verified: the field now reads “Zoé”");
  assert.match(typedWords({ verified: false, value: "abc" }), /NOT verified: the field now reads “abc”/);
  assert.equal(typedWords({ verified: true }), "— verified (the field holds it; its value is hidden)");
});
