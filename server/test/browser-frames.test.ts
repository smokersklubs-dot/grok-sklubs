import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

// L14 — frames of another site (payment box, consent banner, CAPTCHA) read through their own DevTools target, on a real
// bot computer (Docker and the desktop image). 127.0.0.1:8041 is the shop; localhost:8042 is "another site", which
// Chromium runs in its own process.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-frames-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "linux";
process.env.MAX_DESKTOPS = "4";
process.env.DEFAULT_MODEL = "demo:demo";

const { initComputer, screen, workspaceOf } = await import("../src/computer.js");
const { containerName, docker, linuxScreen } = await import("../src/linux.js");
const { bindCall } = await import("../src/agent/bind.js");
const { authorize } = await import("../src/agent/authorize.js");
const { newTurn } = await import("../src/agent/loop.js");
const { builtinTools } = await import("../src/agent/tools.js");
const { bots, users } = await import("../src/store.js");
const { getLive } = await import("../src/bus.js");
await initComputer();

const user = users.create("frames@example.com", "Léa", "x", "en");
const bot = bots.create(user.id, { name: "Framy", autonomy: "balanced" });
const B = bot.id;
after(async () => { await linuxScreen.destroy(B).catch(() => {}); });

const FILES: Record<string, string> = {
  "shop.html": `<!doctype html><title>Shop</title><body style="margin:0"><h1>Checkout</h1>
<iframe id="pay" src="http://localhost:8042/pay.html" style="position:absolute;left:60px;top:150px;width:420px;height:120px;border:0"></iframe>
<iframe src="http://localhost:8042/recaptcha/anchor.html" style="position:absolute;left:60px;top:320px;width:300px;height:80px;border:0"></iframe>
<div id="veil" hidden style="position:fixed;inset:0;background:rgba(0,0,0,.3)"></div></body>`,
  "pay.html": `<!doctype html><title>Pay box</title><body style="margin:0"><label>Card number <input id="card"></label>
<button onclick="document.getElementById('done').textContent='Paid in frame'">Pay 10 EUR</button>
<button onclick="document.getElementById('done').textContent='Coupon shown'">Show coupon</button><p id="done"></p></body>`,
  "anchor.html": `<!doctype html><title>reCAPTCHA</title><label><input type="checkbox" id="robot"> I am not a robot</label>`,
};
const tool = (name: string) => builtinTools().find((t) => t.spec.name === name)!;
const ctx = () => ({ bot: bots.byId(B)!, user, depth: 0, signal: new AbortController().signal });
const text = (o: { content: unknown }) => (typeof o.content === "string" ? o.content : (o.content as { type: string; text?: string }[]).map((b) => b.text ?? "").join("\n"));
const refOf = (snap: string, name: string) => new RegExp(`\\[([0-9a-f]{4}\\.\\d+)\\] \\w+ "${name}`).exec(snap)?.[1] ?? "";
const snapshot = async () => text(await tool("element_snapshot").run({}, ctx()));
/** The pay box's own text, read through its target in the computer (python3 + websocket, as the browser helper). */
const payText = async () => {
  const py = "import json,urllib.request\nfrom websocket import create_connection\nt=[x for x in json.load(urllib.request.urlopen('http://127.0.0.1:9222/json/list')) if x.get('type')=='iframe' and 'pay.html' in x.get('url','')][0]\nw=create_connection(t['webSocketDebuggerUrl'],origin='http://127.0.0.1:9222')\nw.send(json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':'document.body.innerText','returnByValue':True}}))\nprint(json.loads(w.recv())['result']['result']['value'])";
  return (await docker(["exec", containerName(B), "python3", "-c", py])).stdout.toString();
};
const frameText = async () => {
  const r = await docker(["exec", containerName(B), "sh", "-c", "curl -s http://127.0.0.1:9222/json/list"]);
  const list = JSON.parse(r.stdout.toString()) as { type: string; url: string }[];
  return list.filter((t) => t.type === "iframe").map((t) => t.url);
};

before(async () => {
  writeFileSync(path.join(workspaceOf(B), "shop.html"), FILES["shop.html"]);
  writeFileSync(path.join(workspaceOf(B), "pay.html"), FILES["pay.html"]);
  const { mkdirSync } = await import("node:fs");
  mkdirSync(path.join(workspaceOf(B), "recaptcha"), { recursive: true });
  writeFileSync(path.join(workspaceOf(B), "recaptcha", "anchor.html"), FILES["anchor.html"]);
  await screen.wake(B, user.id);
  const n = containerName(B);
  await docker(["exec", n, "sh", "-c", "pkill -f sklubot-browser; sleep 1; true"]);
  for (const port of ["8041", "8042"]) await docker(["exec", "-d", "-w", "/root/files", n, "python3", "-m", "http.server", port, "--bind", "127.0.0.1"]);
  await new Promise((r) => setTimeout(r, 800));
  await tool("browser_open").run({ url: "http://127.0.0.1:8041/shop.html" }, ctx());
});

test("L14: the controls of another site's frame are listed with that site; a CAPTCHA frame is named, never read", async () => {
  assert.ok((await frameText()).some((u) => u.includes("localhost:8042/pay.html")), "the pay box runs as its own target");
  const snap = await snapshot();
  assert.match(snap, /button "Pay 10 EUR" \[in frame: localhost, another site: click or hover only\]/);
  assert.match(snap, /textbox "Card number" \[in frame: localhost, another site/);
  assert.match(snap, /A CAPTCHA from localhost is on this page: never solve it yourself — ask the user with ask_takeover/);
  assert.doesNotMatch(snap, /I am not a robot/, "nothing of the CAPTCHA is listed");
  assert.notEqual(refOf(snap, "Pay 10 EUR"), refOf(snap, "Card number"), "a reference per control, though node numbers repeat across processes");
});

test("L14: a plain control of the frame is clicked through the page, and the page reads what changed", async () => {
  const snap = await snapshot();
  const r = await tool("element_click").run({ ref: refOf(snap, "Show coupon") }, ctx());
  assert.ok(!r.isError, text(r));
  assert.match(text(r), /Clicked button “Show coupon”/);
  assert.match(await payText(), /Coupon shown/, "the click reached the control inside the frame");
  // L149: the click left its point on the screen (the frame sits at 60–480 × 150–270 of the page, under the toolbars).
  const p = getLive(B).activity?.point;
  assert.ok(p && p.x > 0.05 && p.x < 0.4 && p.y > 0.15 && p.y < 0.6, JSON.stringify(p));
});

test("L14: a committing click in the frame is bound and asked like any other; a changed page clicks nothing", async () => {
  const snap = await snapshot();
  const ref = refOf(snap, "Pay 10 EUR");
  const turn = await newTurn(bots.byId(B)!, user, 0, new AbortController().signal);
  const call = { type: "tool_use" as const, id: "p1", name: "element_click", input: { ref } as Record<string, unknown> };
  await bindCall(turn, call);
  assert.deepEqual((call.input.seen_target as { label: string; host: string }).label, "Pay 10 EUR", "the control's own words are read in its frame");
  assert.equal((call.input.seen_target as { host: string }).host, "127.0.0.1", "bound to the page's site");
  assert.equal((await authorize(turn, call)).kind, "ask", "a payment click asks");
  // Approved for "Pay 10 EUR", but by the time it runs the frame shows another button under that reference: nothing done.
  const wrong = await tool("element_click").run({ ref, seen_target: { label: "Pay 99 EUR", host: "127.0.0.1", form: "" } }, ctx());
  assert.ok(wrong.isError && /changed/.test(text(wrong)), text(wrong));
  // Covered in the page (a veil over the frame): nothing is clicked.
  await linuxScreen.targetAt(B, "(document.getElementById('veil').hidden = false, {})");
  const covered = await tool("element_click").run({ ref, seen_target: call.input.seen_target }, ctx());
  assert.ok(covered.isError && /covered by div#veil/.test(text(covered)), text(covered));
  await linuxScreen.targetAt(B, "(document.getElementById('veil').hidden = true, {})");
  const ok = await tool("element_click").run({ ref, seen_target: call.input.seen_target }, ctx());
  assert.ok(!ok.isError, text(ok));
  assert.match(await payText(), /Paid in frame/);
});

test("L14: typing, choosing and filling are refused in another site's frame (card_fill / screen_type instead)", async () => {
  const snap = await snapshot();
  const typed = await tool("element_type").run({ ref: refOf(snap, "Card number"), text: "4242" }, ctx());
  assert.ok(typed.isError && /frame of another site.*card_fill/.test(text(typed)), text(typed));
  const filled = await tool("element_fill").run({ fields: [{ ref: refOf(snap, "Card number"), value: "4242" }] }, ctx());
  assert.ok(filled.isError && /inside a frame of another site/.test(text(filled)), text(filled));
});
