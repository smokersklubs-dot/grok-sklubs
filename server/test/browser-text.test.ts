import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

// The bot's browser in words, on a real bot computer (Docker and the desktop image): L65 (opening and clicking answer
// with the page's structure and what changed, a picture only when asked or needed), L74 (hints, link addresses, stable
// references, typing read back, "sent but not confirmed"), L75 (browser_wait, smart wait, element_fill, element_hover,
// element_upload), L81 (browser_console, browser_network with masked headers, the watcher upgraded) and L56 (the
// automatic check of a published page rendered at 390 and 1280 px).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-btx-"));
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
await initComputer();

const user = users.create("btx@example.com", "Léa", "x", "en");
const bot = bots.create(user.id, { name: "Wordy", autonomy: "balanced" });
const B = bot.id;
after(async () => { await linuxScreen.destroy(B).catch(() => {}); });

const ROOT = "http://127.0.0.1:8021";
const FILES: Record<string, string> = {
  "shop.html": `<!doctype html><html lang="en"><head><title>Shop</title></head><body>
<h1>Our shop</h1><h2>Basket</h2>
<a href="/about.html?x=1">About us</a> <a href="https://elsewhere.example/page">Elsewhere</a>
<ul><li>Blue mug <button aria-label="" onclick="1"><svg class="icon-trash"></svg></button></li><li>Red bowl <button onclick="1"><svg class="icon-trash"></svg></button></li></ul>
<button id="add" onclick="document.getElementById('msg').textContent='Added to the basket'; const b=document.createElement('button'); b.textContent='Undo'; document.body.append(b)">Add</button>
<p id="msg"></p>
<button id="slow" onclick="let i=0; const t=setInterval(()=>{ document.getElementById('msg').textContent='step '+(++i); if(i>=10){ clearInterval(t); document.getElementById('msg').textContent='All done'; } }, 100)">Slow work</button>
<button id="redraw" onclick="document.getElementById('box').innerHTML='<input aria-label=&quot;Nickname&quot;>'">Redraw</button>
<div id="box"><input aria-label="Nickname"></div>
<input aria-label="Code" maxlength="3"><input type="password" aria-label="Secret">
<button id="busy" onclick="const end=Date.now()+13000; while(Date.now()<end){}">Freeze</button>
<button id="menu" onmouseover="document.getElementById('sub').hidden=false">Menu</button><div id="sub" hidden><a href="#s">Settings</a></div>
<button onclick="setTimeout(()=>{ const p=document.createElement('p'); p.textContent='Saved at last'; document.body.append(p); document.getElementById('spin').remove() }, 1500)">Save later</button><p id="spin">Loading…</p>
</body></html>`,
  "about.html": "<!doctype html><title>About</title><h1>About</h1><p>We sell mugs.</p>",
  "form.html": `<!doctype html><title>Form</title><form>
<label>First name <input id="fn"></label><label>Town <select id="town"><option>Paris</option><option>Lyon</option></select></label>
<label><input type="checkbox" id="news"> Newsletter</label><label><input type="checkbox" id="terms"> Subscribe to the paid plan</label>
<label>CV <input type="file" id="cv"></label><button type="button">Send</button></form>`,
  "canvas.html": "<!doctype html><title>Game</title><body style='margin:0'><canvas width=1400 height=900></canvas>",
  "console.html": `<!doctype html><title>Console</title><p>Hello</p><script>
console.log('just saying'); console.error('boom from the page');
fetch('/api.json', { headers: { Authorization: 'Bearer sk-fake-for-tests', 'X-Trace': 'abc' } }).then((r) => r.json()).then(() => { document.title = 'Console loaded'; });
setTimeout(() => { null.x; }, 10);
</script>`,
  "api.json": '{"items":[1,2,3],"token":"sk-fake-for-tests-abcdefghijklmnopqrstuv"}',
  "cv.txt": "Léa — CV",
};
const tool = (name: string) => builtinTools().find((t) => t.spec.name === name)!;
const ctx = () => ({ bot: bots.byId(B)!, user, depth: 0, signal: new AbortController().signal });
const text = (o: { content: unknown }) => (typeof o.content === "string" ? o.content : (o.content as { type: string; text?: string }[]).map((b) => b.text ?? "").join("\n"));
const images = (o: { content: unknown }) => (Array.isArray(o.content) ? o.content.filter((b: { type: string }) => b.type === "image").length : 0);
const refOf = (s: string, name: string, role = "\\w+") => new RegExp(`\\[([0-9a-f]{4}\\.\\d+)\\] ${role} "${name}"`).exec(s)?.[1] ?? "";
const evalIn = async (expression: string) => (await linuxScreen.targetAt(B, expression))?.target as Record<string, unknown> | null;
const open = (file: string, extra: Record<string, unknown> = {}) => tool("browser_open").run({ url: `${ROOT}/${file}`, ...extra }, ctx());

before(async () => {
  for (const [f, body] of Object.entries(FILES)) writeFileSync(path.join(workspaceOf(B), f), body);
  await screen.wake(B, user.id);
  const n = containerName(B);
  await docker(["exec", "-d", "-w", "/root/files", n, "python3", "-m", "http.server", "8021", "--bind", "127.0.0.1"]);
  await new Promise((r) => setTimeout(r, 800));
});

test("L65/L74: browser_open answers in words — headings, controls by reference, link addresses, hints — and no picture", async () => {
  const out = await open("shop.html");
  const t = text(out);
  assert.equal(images(out), 0, "no screenshot by default");
  assert.match(t, /^Opened http:\/\/127\.0\.0\.1:8021\/shop\.html \(loaded in [\d.]+ s\)\.\nPage: Shop — http:\/\/127\.0\.0\.1:8021\/shop\.html/);
  assert.match(t, /Headings:\n- h1 Our shop\n {2}- h2 Basket/);
  assert.match(t, /link "About us" → \/about\.html\?x=1/);
  assert.match(t, /link "Elsewhere" → https:\/\/elsewhere\.example\/page/);
  assert.match(t, /button "" hint="icon:icon-trash; in:Blue mug"/);
  assert.match(t, /button "" hint="icon:icon-trash; in:Red bowl"/);
  const shot = await open("shop.html", { screenshot: true });
  assert.equal(images(shot), 1, "a screenshot when asked");
  const game = await open("canvas.html");
  assert.equal(images(game), 1, "a canvas page comes with a picture");
  assert.match(text(game), /Words are not enough on this page/);
});

test("L65/L75: a click answers with what changed (new control, new text) after the page calmed down; references stay", async () => {
  const page = text(await open("shop.html"));
  const add = refOf(page, "Add");
  const clicked = await tool("element_click").run({ ref: add }, ctx());
  const t = text(clicked);
  assert.equal(images(clicked), 0);
  assert.match(t, /^Clicked button “Add”\.\nPage: Shop/);
  assert.match(t, /What changed:\n\+ \[[0-9a-f]{4}\.\d+\] button "Undo"/);
  assert.match(t, /New text on the page: “Added to the basket”/);
  // Smart wait: the page keeps changing for a second after the click; the answer comes once it is calm.
  const slow = text(await tool("element_click").run({ ref: refOf(page, "Slow work") }, ctx()));
  assert.match(slow, /“All done”/, slow);
  // L74: the first look's references still work after more looks at the same page.
  await tool("element_snapshot").run({}, ctx());
  const again = await tool("element_click").run({ ref: add }, ctx());
  assert.ok(!again.isError, text(again));
  // Hover opens the menu without a click.
  const hover = text(await tool("element_hover").run({ ref: refOf(page, "Menu") }, ctx()));
  assert.match(hover, /^The mouse is over “Menu”\./);
  assert.match(hover, /\+ \[[0-9a-f]{4}\.\d+\] link "Settings" → \/shop\.html#s/);
});

test("L74: typing is read back — verified, NOT verified when the page cuts it, hidden for a password; a redrawn field is found again", async () => {
  const page = text(await open("shop.html"));
  const code = text(await tool("element_type").run({ ref: refOf(page, "Code"), text: "abcdef", clear: true }, ctx()));
  assert.match(code, /NOT verified: the field now reads “abc”/);
  const secret = text(await tool("element_type").run({ ref: refOf(page, "Secret"), text: "hunter2" }, ctx()));
  assert.match(secret, /verified \(the field holds it; its value is hidden\)/);
  assert.doesNotMatch(secret, /hunter2/);
  await tool("element_click").run({ ref: refOf(page, "Redraw") }, ctx());
  const nick = text(await tool("element_type").run({ ref: refOf(page, "Nickname"), text: "Zoé" }, ctx()));
  assert.match(nick, /found again by its role and name/);
  assert.match(nick, /verified: the field now reads “Zoé”/);
  assert.equal((await evalIn("({ v: document.querySelector('#box input').value })"))?.v, "Zoé");
});

test("L74: a click the page does not confirm is “sent, not confirmed” — not to be repeated blindly", async () => {
  const page = text(await open("shop.html"));
  const frozen = await tool("element_click").run({ ref: refOf(page, "Freeze") }, ctx());
  assert.ok(frozen.isError, text(frozen));
  assert.match(text(frozen), /^The click was sent, but the page did not confirm it: .*do not repeat it blindly/s);
  await new Promise((r) => setTimeout(r, 4000)); // the page's loop ends
});

test("L75: browser_wait — a text that appears, a text that goes, and a clear miss", async () => {
  const page = text(await open("shop.html"));
  await tool("element_click").run({ ref: refOf(page, "Save later") }, ctx());
  const t0 = Date.now();
  const waited = await tool("browser_wait").run({ text: "saved at last", gone: "Loading…", timeout: 10 }, ctx());
  assert.ok(!waited.isError, text(waited));
  assert.match(text(waited), /^Waited [\d.]+ s: done\./);
  assert.ok(Date.now() - t0 < 9000);
  const miss = await tool("browser_wait").run({ text: "never there", timeout: 2 }, ctx());
  assert.ok(miss.isError && /still not there \(the text “never there” is not there\)/.test(text(miss)), text(miss));
  const url = await tool("browser_wait").run({ url: "shop.html", load: true, timeout: 5 }, ctx());
  assert.ok(!url.isError, text(url));
});

test("L75: element_fill fills a form in one call, each field read back; a committing box is left for element_click; upload asks", async () => {
  const page = text(await open("form.html"));
  const fill = await tool("element_fill").run({ fields: [
    { ref: refOf(page, "First name"), value: "Zoé" }, { ref: refOf(page, "Town"), value: "lyon" },
    { ref: refOf(page, "Newsletter"), value: "true" }, { ref: refOf(page, "Subscribe to the paid plan"), value: "true" },
  ] }, ctx());
  const t = text(fill);
  assert.ok(!fill.isError, t);
  assert.match(t, /^Filled 3 of 4 fields \(nothing was sent/);
  assert.match(t, /1\. textbox “First name”: typed 3 characters — verified: the field now reads “Zoé”/);
  assert.match(t, /2\. combobox “Town”: chose “Lyon” — verified/);
  assert.match(t, /3\. checkbox “Newsletter”: ticked — verified/);
  assert.match(t, /4\. checkbox “Subscribe to the paid plan”: not ticked here — its words commit something/);
  const v = await evalIn("({ fn: document.getElementById('fn').value, town: document.getElementById('town').value, news: document.getElementById('news').checked, terms: document.getElementById('terms').checked })");
  assert.deepEqual(v, { fn: "Zoé", town: "Lyon", news: true, terms: false });
  // A file goes into a file field only after the user's yes, every time.
  const turn = await newTurn(bots.byId(B)!, user, 0, new AbortController().signal);
  const call = { type: "tool_use" as const, id: "u1", name: "element_upload", input: { ref: refOf(page, "CV"), file: "cv.txt" } as Record<string, unknown> };
  await bindCall(turn, call);
  const d = await authorize(turn, call);
  assert.equal(d.kind, "ask");
  assert.match((d as { title: string }).title, /attach the file cv\.txt on 127\.0\.0\.1/);
  const up = text(await tool("element_upload").run({ ref: refOf(page, "CV"), file: "cv.txt" }, ctx()));
  assert.match(up, /^Attached cv\.txt — verified: the field now holds it/);
  const bad = await tool("element_upload").run({ ref: refOf(page, "CV"), file: "../../etc/passwd" }, ctx());
  assert.ok(bad.isError);
});

test("L81: the console and the requests of the tab — errors, masked headers, a replaced old watcher", async () => {
  const n = containerName(B);
  // An older watcher (no version) is replaced by the helper the next time it runs.
  await docker(["exec", n, "sh", "-c", "pkill -f 'browser-watch' ; pkill -f 'Target.setDiscoverTargets'; rm -f /root/.sklubot/browser-watch.sock; true"]);
  const FAKE = "import json,os,socket\ns=socket.socket(socket.AF_UNIX)\ns.bind('/root/.sklubot/browser-watch.sock')\ns.listen(4)\nwhile True:\n  c,_=s.accept(); r=json.loads(c.recv(9999) or b'{}'); c.sendall((json.dumps({'ok':True,'pid':os.getpid()} if r.get('op')=='ping' else {'dialogs':{}})+'\\n').encode()); c.close()\n";
  await docker(["exec", "-d", n, "python3", "-c", FAKE]);
  await new Promise((r) => setTimeout(r, 600));
  await open("console.html");
  await tool("browser_wait").run({ text: "Hello", load: true, timeout: 5 }, ctx());
  const fakeLeft = (await docker(["exec", n, "sh", "-c", "ps -eo args | grep -c '^python3 -c import json,os,socket' || true"])).stdout.toString().trim();
  assert.equal(fakeLeft, "0", "the old watcher was replaced");
  await new Promise((r) => setTimeout(r, 800));
  const cons = text(await tool("browser_console").run({}, ctx()));
  assert.match(cons, /\[error\] boom from the page \(console\.html:\d+\)/);
  assert.match(cons, /\[error\] Uncaught TypeError: Cannot read properties of null/);
  assert.doesNotMatch(cons, /just saying/);
  assert.match(text(await tool("browser_console").run({ all: true }, ctx())), /\[log\] just saying/);
  const net = text(await tool("browser_network").run({ filter: "api.json" }, ctx()));
  const num = /#(\d+) GET 200 fetch http:\/\/127\.0\.0\.1:8021\/api\.json/.exec(net)?.[1];
  assert.ok(num, net);
  const detail = text(await tool("browser_network").run({ request: Number(num) }, ctx()));
  assert.match(detail, /authorization: \(masked\)/i);
  assert.match(detail, /x-trace: abc/i);
  assert.doesNotMatch(detail, /sk-fake-for-tests/, "no secret in the answer, headers or body");
  assert.match(detail, /Answer \(start, secrets masked\):\n\{"items":\[1,2,3\]/);
});

test("L56: page_publish renders the page at 390 and 1280 px, sends the picture back and reports what is wrong", async () => {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bakery</title><link rel="stylesheet" href="css/site.css"></head>
<body><h1>Pain</h1><p class="muted">Ouvert du lundi au samedi</p><img src="four.jpg"><div class="wide">Bandeau</div><script>window.missing();</script></body></html>`;
  const out = await tool("page_publish").run({ name: "bakery", title: "Bakery", html, visibility: "private", files: [{ path: "css/site.css", content: ".muted { color: #bbb; background: #fff } .wide { width: 1000px; height: 40px; background: #c33 }" }] }, ctx());
  const t = text(out);
  assert.ok(!out.isError, t);
  assert.equal(images(out), 1, `one picture with both widths: ${t}`);
  if (process.env.SAVE_SHOTS) writeFileSync(path.join(process.env.SAVE_SHOTS, "pagecheck.jpg"), Buffer.from((out.content as { type: string; data?: string }[]).find((b) => b.type === "image")!.data!, "base64")); // to look at it
  assert.match(t, /Automatic check of the page \(rendered at 390 and 1280 px/);
  assert.match(t, /Console: 1 error — “(Uncaught )?TypeError: window\.missing is not a function/);
  assert.match(t, /Failed loads: 1 — 404 four\.jpg/);
  assert.match(t, /At 390 px: the page is \d+ px wide at 390 px: it scrolls sideways/);
  assert.match(t, /At 390 and 1280 px: contrast 1\.\d+:1 \(needs 4\.5:1\) on p\.muted "Ouvert du lundi au samedi"/);
  assert.match(t, /1 image without alt text \(four\.jpg\)/);
  assert.doesNotMatch(t, /favicon/);
  const tabs = text(await tool("browser_tabs").run({}, ctx()));
  assert.doesNotMatch(tabs, /127\.0\.0\.1:\d+\/p\/check/, "the check's tab is closed");
});
