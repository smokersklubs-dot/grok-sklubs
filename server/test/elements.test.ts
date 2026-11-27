import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Element references (wave 8, item 6) on a real bot computer (Docker and the desktop image): a snapshot of the page's
// interactive elements, click / type / select by reference, stale references refused, and a committing click bound and
// judged like a pixel click.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-el-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "linux";
process.env.MAX_DESKTOPS = "4";
process.env.DEFAULT_MODEL = "demo:demo";

const { initComputer, screen, workspaceOf } = await import("../src/computer.js");
const { containerName, docker, linuxScreen } = await import("../src/linux.js");
const { rememberSnapshot, resolveRef } = await import("../src/agent/elements.js");
const { bindCall } = await import("../src/agent/bind.js");
const { authorize, external } = await import("../src/agent/authorize.js");
const { newTurn } = await import("../src/agent/loop.js");
const { builtinTools } = await import("../src/agent/tools.js");
const { bots, users } = await import("../src/store.js");
await initComputer();

const user = users.create("el@example.com", "Léa", "x", "en");
const bot = bots.create(user.id, { name: "Clicker", autonomy: "balanced" });
const B = bot.id;
after(async () => { await linuxScreen.destroy(B).catch(() => {}); });

const PAGE = `<!doctype html><html><head><title>Shop</title></head><body>
<a href="#about">About us</a>
<form action="https://shop.example/order" method="post">
<label>Name <input id="n" value="old"></label>
<label>City <select id="c"><option value="p">Paris</option><option value="l">Lyon</option></select></label>
<button type="button" onclick="document.title='paid by '+document.getElementById('n').value+' in '+document.getElementById('c').value">Pay now</button>
<button type="button" onclick="document.title='next'">Next</button>
<button disabled>Disabled one</button>
</form><div style="height:3000px"></div><button type="button" onclick="document.title='far'">Far away</button></body></html>`;

const title = async () => (await screen.read(B, user.id)).title;
async function openPage() {
  writeFileSync(path.join(workspaceOf(B), "t.html"), PAGE);
  await screen.wake(B, user.id);
  await docker(["exec", containerName(B), "sh", "-c", "pkill -f sklubot-browser; sleep 1; true"]);
  await docker(["exec", "-d", containerName(B), "/opt/sklubot/open-browser.sh", "file:///root/files/t.html"]);
  for (let i = 0; i < 60; i++) { try { if ((await title()) === "Shop") return; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("the test page did not open");
}
const refOf = (text: string, name: string) => new RegExp(`\\[([0-9a-f]{4}\\.\\d+)\\] \\w+ "${name}"`).exec(text)?.[1] ?? "";
const tool = (name: string) => builtinTools().find((t) => t.spec.name === name)!;
const ctx = () => ({ bot: bots.byId(B)!, user, depth: 0, signal: new AbortController().signal });

test("snapshot: links, fields, lists and buttons with short references, on the screen first", async () => {
  await openPage();
  const out = await tool("element_snapshot").run({}, ctx());
  const text = String(out.content);
  assert.equal(tool("element_snapshot").outside, true, "the page's words are outside content");
  for (const n of ["About us", "Name", "City", "Pay now", "Next", "Far away"]) assert.ok(refOf(text, n), `${n} listed:\n${text}`);
  assert.match(text, /textbox "Name" value="old"/);
  assert.match(text, /"Disabled one" \(disabled\)/);
  assert.match(text, /"Far away" \(off-screen\)/);
  assert.ok(text.indexOf("Far away") > text.indexOf("Next"), "off-screen last");
});

test("type, select and click by reference; a far element is scrolled into view", async () => {
  const text = String((await tool("element_snapshot").run({}, ctx())).content);
  const typed = await tool("element_type").run({ ref: refOf(text, "Name"), text: "Zoé €", clear: true }, ctx());
  assert.ok(!typed.isError, String(typed.content));
  // L65/L74: the action answers in words (no screenshot unless asked), with the field read back.
  assert.equal(typeof typed.content, "string", "no screenshot by default");
  assert.match(String(typed.content), /verified: the field now reads “Zoé €”/);
  const chose = await tool("element_select").run({ ref: refOf(text, "City"), option: "lyon" }, ctx());
  assert.ok(!chose.isError && /Chose “Lyon”/.test(JSON.stringify(chose.content)));
  const none = await tool("element_select").run({ ref: refOf(text, "City"), option: "Rome" }, ctx());
  assert.ok(none.isError && /"Paris", "Lyon"/.test(String(none.content)));
  const clicked = await tool("element_click").run({ ref: refOf(text, "Next") }, ctx());
  assert.ok(!clicked.isError);
  assert.equal(await title(), "next");
  await tool("element_click").run({ ref: refOf(text, "Far away") }, ctx());
  assert.equal(await title(), "far");
  const disabled = await tool("element_click").run({ ref: refOf(text, "Disabled one") }, ctx());
  assert.ok(disabled.isError && /disabled/.test(String(disabled.content)));
});

test("stale references fail clearly and do nothing: unknown, new page; on the same page they stay valid (L74)", async () => {
  const first = String((await tool("element_snapshot").run({}, ctx())).content);
  const second = String((await tool("element_snapshot").run({}, ctx())).content);
  assert.equal(refOf(first, "Next"), refOf(second, "Next"), "the same element keeps its reference on the same page");
  const old = await tool("element_click").run({ ref: refOf(first, "Next") }, ctx());
  assert.ok(!old.isError, String(old.content));
  assert.ok((await tool("element_click").run({ ref: "zz" }, ctx())).isError);
  assert.ok("error" in resolveRef(B, `${refOf(second, "Next").split(".")[0]}.999`));
  // The page is loaded again: same address, new document. Nothing is clicked.
  await docker(["exec", containerName(B), "python3", "/opt/sklubot/page-text.py", "--eval", "location.reload(), 1"]);
  await new Promise((r) => setTimeout(r, 1500));
  const stale = await tool("element_click").run({ ref: refOf(second, "Next") }, ctx());
  assert.ok(stale.isError && /stale: the page changed/.test(String(stale.content)), String(stale.content));
  assert.equal(await title(), "Shop");
  void rememberSnapshot;
});

test("a committing click by reference is bound to that control and asks, like a pixel click", async () => {
  const text = String((await tool("element_snapshot").run({}, ctx())).content);
  const turn = await newTurn(bots.byId(B)!, user, 0, new AbortController().signal);
  const call = { type: "tool_use" as const, id: "c1", name: "element_click", input: { ref: refOf(text, "Pay now"), seen_target: { label: "Next", host: "", form: "" } } as Record<string, unknown> };
  await bindCall(turn, call);
  // Whatever the model put in seen_target is replaced by what the page says.
  assert.deepEqual(call.input.seen_target, { label: "Pay now", host: "", form: "POST https://shop.example/order" });
  assert.equal(external(turn, "element_click", call.input), true);
  const d = await authorize(turn, call);
  assert.equal(d.kind, "ask");
  assert.match((d as { title: string }).title, /click “Pay now”/);
  // An ordinary control is not a commitment.
  const next = { type: "tool_use" as const, id: "c2", name: "element_click", input: { ref: refOf(text, "Next") } as Record<string, unknown> };
  await bindCall(turn, next);
  assert.equal(external(turn, "element_click", next.input), false);
  assert.equal((await authorize(turn, next)).kind, "allow");
});
