import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

// The bot's browser on a real bot computer (Docker and the desktop image), beyond one page (audits of chrome-devtools-mcp
// and agent-browser): one browser whatever the number of browser_open, the active tab followed, JavaScript dialogs
// reported and answered, a covered element not clicked, frames in the snapshot, and secrets / approved clicks checked on
// the exact tab and site they go into.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-bt-"));
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
const { boundCard, boundClick } = await import("../src/agent/tools-browser.js");
const { bots, users, vault } = await import("../src/store.js");
const { seal } = await import("../src/auth.js");
await initComputer();

const user = users.create("bt@example.com", "Léa", "x", "en");
const bot = bots.create(user.id, { name: "Tabby", autonomy: "balanced" });
const B = bot.id;
after(async () => { await linuxScreen.destroy(B).catch(() => {}); });

// Two sites on the computer itself: 127.0.0.1:8011 (the "real" one) and localhost:8012 (another site).
const MAIN = `<!doctype html><title>Main</title>
<a href="second.html" target="_blank">New tab link</a>
<button onclick="alert('Hello from the page')">Alert me</button>
<button onclick="document.title = confirm('Delete everything?') ? 'deleted' : 'kept'">Ask me</button>
<button id="under" onclick="document.title='bought'">Buy now</button>
<div id="cover" style="position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,.2)"><div style="background:#fff;margin:300px auto;width:300px">We use cookies <button onclick="document.getElementById('cover').remove()">Accept cookies</button></div></div>
<form><input id="u" type="text" aria-label="User"><input id="p" type="password" aria-label="Secret"></form>
<iframe srcdoc="<button onclick=&quot;parent.document.title='in frame'&quot;>Frame button</button>" style="width:300px;height:60px"></iframe>
<iframe src="http://localhost:8012/frame.html" style="width:300px;height:80px"></iframe>`;
const FILES: Record<string, string> = {
  "main.html": MAIN,
  "second.html": "<!doctype html><title>Second page</title><p>Second</p>",
  "frame.html": "<!doctype html><title>Framed</title><input id='card' aria-label='Card'><button>Inner pay</button>",
  "fake.html": "<!doctype html><title>Fake login</title><input id='p' type='password' aria-label='Secret'>",
};
const tool = (name: string) => builtinTools().find((t) => t.spec.name === name)!;
const ctx = () => ({ bot: bots.byId(B)!, user, depth: 0, signal: new AbortController().signal });
const text = (o: { content: unknown }) => (typeof o.content === "string" ? o.content : JSON.stringify(o.content));
const refOf = (snap: string, name: string) => new RegExp(`\\[([0-9a-f]{4}\\.\\d+)\\] \\w+ "${name}"`).exec(snap)?.[1] ?? "";
const evalIn = async (expression: string) => (await linuxScreen.targetAt(B, expression))?.target as Record<string, unknown> | null;
const chromiums = async () => Number((await docker(["exec", containerName(B), "sh", "-c", "ps -eo args | grep '^/usr/lib/chromium/chromium' | grep -vc -- --type= || true"])).stdout.toString().trim());
const snapshot = async () => text(await tool("element_snapshot").run({}, ctx()));

before(async () => {
  for (const [f, body] of Object.entries(FILES)) writeFileSync(path.join(workspaceOf(B), f), body);
  await screen.wake(B, user.id);
  const n = containerName(B);
  await docker(["exec", n, "sh", "-c", "pkill -f sklubot-browser; sleep 1; true"]);
  for (const port of ["8011", "8012"]) await docker(["exec", "-d", "-w", "/root/files", n, "python3", "-m", "http.server", port, "--bind", "127.0.0.1"]);
  await new Promise((r) => setTimeout(r, 800));
});

test("a second browser_open reuses the running browser: one Chromium, and every read follows the page shown", async () => {
  await tool("browser_open").run({ url: "http://127.0.0.1:8011/second.html" }, ctx());
  const opened = await tool("browser_open").run({ url: "http://127.0.0.1:8011/main.html" }, ctx());
  assert.match(text(opened), /Page: Main/);
  assert.equal(await chromiums(), 1, "one browser process");
  assert.equal((await screen.read(B, user.id)).title, "Main", "the page read is the page shown");
  // The image's own launcher (the dock, the terminal's $BROWSER) opens a tab in the running browser too.
  await docker(["exec", containerName(B), "/opt/sklubot/open-browser.sh", "http://127.0.0.1:8011/second.html"]);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await chromiums(), 1, "still one browser after open-browser.sh");
  assert.equal((await screen.read(B, user.id)).title, "Second page", "the launcher's new tab is in front and read");
  const tabs = text(await tool("browser_tabs").run({}, ctx()));
  assert.match(tabs, /^2 tabs open/);
  const mainId = /\[([0-9a-f]{6})\] Main/.exec(tabs)?.[1] ?? "";
  const secondId = /\[([0-9a-f]{6})\] \(in front\) Second page/.exec(tabs)?.[1] ?? "";
  assert.ok(mainId && secondId, tabs);
  await tool("browser_tab").run({ action: "close", tab: secondId }, ctx());
  assert.equal((await screen.read(B, user.id)).title, "Main");
});

test("the snapshot lists a frame's controls, names another site's frame, and a covered element is not clicked", async () => {
  const snap = await snapshot();
  assert.match(snap, /button "Frame button" \[in frame: /);
  assert.match(snap, /A frame from localhost is on this page, but its controls cannot be listed/);
  const covered = await tool("element_click").run({ ref: refOf(snap, "Buy now") }, ctx());
  assert.ok(covered.isError && /covered by div#cover "We use cookies/.test(text(covered)), text(covered));
  assert.equal((await screen.read(B, user.id)).title, "Main", "nothing was clicked");
  assert.ok(!(await tool("element_click").run({ ref: refOf(snap, "Accept cookies") }, ctx())).isError);
  const s2 = await snapshot();
  assert.ok(!(await tool("element_click").run({ ref: refOf(s2, "Frame button") }, ctx())).isError);
  assert.equal((await screen.read(B, user.id)).title, "in frame");
});

test("a dialog is reported in words at once (no 15 s wait, no traceback), dismissed freely, and OK is bound and asked", async () => {
  await tool("browser_open").run({ url: "http://127.0.0.1:8011/main.html" }, ctx());
  await tool("element_click").run({ ref: refOf(await snapshot(), "Accept cookies") }, ctx());
  const clicked = await tool("element_click").run({ ref: refOf(await snapshot(), "Alert me") }, ctx());
  assert.match(text(clicked), /The page shows an alert dialog: “Hello from the page”/);
  const t0 = Date.now();
  await assert.rejects(screen.read(B, user.id), /alert dialog: “Hello from the page”.*browser_dialog/);
  await assert.rejects(tool("element_snapshot").run({}, ctx()), /alert dialog/);
  assert.ok(Date.now() - t0 < 8000, `answered in ${Date.now() - t0} ms`);
  assert.match(text(await tool("browser_dialog").run({ action: "dismiss" }, ctx())), /Dismissed the dialog/);
  assert.equal((await screen.read(B, user.id)).title, "Main");

  await tool("element_click").run({ ref: refOf(await snapshot(), "Ask me") }, ctx());
  const turn = await newTurn(bots.byId(B)!, user, 0, new AbortController().signal);
  const accept = { type: "tool_use" as const, id: "d1", name: "browser_dialog", input: { action: "accept", seen_dialog: { type: "alert", message: "fake", host: "" } } as Record<string, unknown> };
  await bindCall(turn, accept);
  assert.deepEqual(accept.input.seen_dialog, { type: "confirm", message: "Delete everything?", host: "127.0.0.1" }, "the server reads the dialog itself");
  const d = await authorize(turn, accept);
  assert.equal(d.kind, "ask");
  assert.equal((d as { once?: boolean }).once, true, "never “Always”");
  assert.match((d as { irreversible?: string }).irreversible ?? "", /deleted/);
  const dismiss = { type: "tool_use" as const, id: "d2", name: "browser_dialog", input: { action: "dismiss" } as Record<string, unknown> };
  await bindCall(turn, dismiss);
  assert.equal((await authorize(turn, dismiss)).kind, "allow");
  // OK for another dialog than the one approved: nothing is answered.
  const wrong = await tool("browser_dialog").run({ action: "accept", seen_dialog: { type: "confirm", message: "Something else?", host: "127.0.0.1" } }, ctx());
  assert.ok(wrong.isError && /changed/.test(text(wrong)));
  assert.match(text(await tool("browser_dialog").run({ action: "accept", seen_dialog: accept.input.seen_dialog }, ctx())), /Answered OK/);
  assert.equal((await screen.read(B, user.id)).title, "deleted");
});

test("a new tab opened by a link is followed by every read; switching tabs moves every read and act", async () => {
  // L65: the click itself says that a new tab opened and is now in front (and reads it).
  const clicked = text(await tool("element_click").run({ ref: refOf(await snapshot(), "New tab link") }, ctx()));
  assert.match(clicked, /A new tab opened \(“Second page”/);
  const page = text(await tool("page_read").run({}, ctx()));
  assert.match(page, /^Second page/);
  const tabs = text(await tool("browser_tabs").run({}, ctx()));
  const mainId = /\[([0-9a-f]{6})\] deleted/.exec(tabs)?.[1] ?? "";
  assert.ok(mainId, tabs);
  assert.match(text(await tool("browser_tab").run({ action: "switch", tab: mainId }, ctx())), /Switched to the tab “deleted”/);
  assert.match(await snapshot(), /"Ask me"/, "the snapshot is of the tab switched to");
  await assert.rejects(tool("browser_tab").run({ action: "switch", tab: "zzzzzz" }, ctx()), /No tab is called "zzzzzz"/);
});

test("a saved login is typed only into the exact tab, frame and field of its site; a look-alike tab gets nothing", async () => {
  const SECRET = "Tr0ub4dor&3-very-secret";
  vault.create(user.id, { name: "Shop", site: "http://127.0.0.1:8011/", username: "lea", passwordEnc: seal(SECRET), note: "" });
  const item = vault.byName(user.id, "Shop");
  assert.ok(item, "vault item saved");
  // The look-alike opens in a NEW tab while the real site stays open behind it: the front tab is what counts.
  await tool("browser_open").run({ url: "http://127.0.0.1:8011/main.html" }, ctx());
  await tool("browser_open").run({ url: "http://localhost:8012/fake.html", new_tab: true }, ctx());
  await evalIn("(document.getElementById('p').focus(), {})");
  const fake = await tool("vault_type").run({ item: "Shop", field: "password" }, ctx());
  assert.ok(fake.isError && /the page in front is localhost/.test(text(fake)), text(fake));
  assert.equal((await evalIn("({v: document.getElementById('p').value})"))?.v, "", "nothing typed into the look-alike");
  const tabs = text(await tool("browser_tabs").run({}, ctx()));
  const realId = /\[([0-9a-f]{6})\] Main/.exec(tabs)?.[1] ?? "";
  await tool("browser_tab").run({ action: "switch", tab: realId }, ctx());
  await tool("element_click").run({ ref: refOf(await snapshot(), "Accept cookies") }, ctx());
  // The username field is not a password field: the password is refused there.
  await evalIn("(document.getElementById('u').focus(), {})");
  const wrongField = await tool("vault_type").run({ item: "Shop", field: "password" }, ctx());
  assert.ok(wrongField.isError && /not a password field/.test(text(wrongField)));
  // Focus inside another site's frame: refused.
  await evalIn("(document.querySelector('iframe[src]').focus(), {})");
  const framed = await tool("vault_type").run({ item: "Shop", field: "username" }, ctx());
  assert.ok(framed.isError && /frame from another site/.test(text(framed)), text(framed));
  await evalIn("(document.getElementById('p').focus(), {})");
  const ok = await tool("vault_type").run({ item: "Shop", field: "password" }, ctx());
  assert.ok(!ok.isError, text(ok));
  assert.equal((await evalIn("({v: document.getElementById('p').value})"))?.v, SECRET);
  // Card fields: the keyboard is only used while the approved site is in front.
  await assert.rejects(boundCard.type(B, user.id, "4242", "shop.example"), /now on 127\.0\.0\.1/);
});

test("an approved pixel click is checked on the active tab right before it lands", async () => {
  await tool("browser_open").run({ url: "http://127.0.0.1:8011/main.html" }, ctx());
  await tool("element_click").run({ ref: refOf(await snapshot(), "Accept cookies") }, ctx());
  // Where "Buy now" is on the whole screen (the same window offsets as targetScript in computer.ts).
  const at = await evalIn("(() => { const r = document.getElementById('under').getBoundingClientRect(); const side = Math.max(0, (outerWidth - innerWidth) / 2); return { x: Math.round(r.left + r.width / 2 + screenX + side), y: Math.round(r.top + r.height / 2 + screenY + Math.max(0, outerHeight - innerHeight - side)) }; })()");
  const x = Number(at?.x), y = Number(at?.y);
  const other = await boundClick(ctx(), { x, y }, { label: "Buy now", host: "shop.example", form: "" });
  assert.ok(other.isError && /now on 127\.0\.0\.1/.test(text(other)), text(other));
  const relabelled = await boundClick(ctx(), { x, y }, { label: "Pay now", host: "127.0.0.1", form: "" });
  assert.ok(relabelled.isError && /now “Buy now”/.test(text(relabelled)), text(relabelled));
  assert.equal((await screen.read(B, user.id)).title, "Main", "nothing was clicked");
  const fine = await boundClick(ctx(), { x, y }, { label: "Buy now", host: "127.0.0.1", form: "" });
  assert.ok(!fine.isError, text(fine));
  assert.equal((await screen.read(B, user.id)).title, "bought");
});
