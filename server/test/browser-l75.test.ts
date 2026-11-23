import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

// L75 (rest): repair of malformed tool arguments, web_fetch in Markdown / llms.txt / .md copy, browser_back and the
// capture with reference numbers (the last two on a real bot computer, when Docker runs).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-l75-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.DEFAULT_MODEL = "demo:demo";

const { repairJson } = await import("../src/llm/jsonrepair.js");
const md = await import("../src/agent/webfetchmd.js");

test("L75: almost-JSON tool arguments are repaired; anything else stays invalid", () => {
  assert.deepEqual(repairJson('```json\n{"url": "https://a.example", "tags": true,}\n```'), { url: "https://a.example", tags: true }, "fence and trailing comma");
  assert.deepEqual(repairJson("{'ref': '3f9a.12', 'double': True}"), { ref: "3f9a.12", double: true }, "single quotes, Python literal");
  assert.deepEqual(repairJson('{ref: "3f9a.1", limit: 20, extra: None}'), { ref: "3f9a.1", limit: 20, extra: null }, "unquoted keys");
  assert.deepEqual(repairJson('{"text": "line one\nline two\ttab"}'), { text: "line one\nline two\ttab" }, "raw line break in a string");
  assert.deepEqual(repairJson('{"fields": [{"ref": "a.1", "value": "Léa"}, {"ref": "a.2", "value": "Mar'), { fields: [{ ref: "a.1", value: "Léa" }, { ref: "a.2", value: "Mar" }] }, "cut short: closed");
  assert.deepEqual(repairJson('Here you go: {"q": "it\'s"} thanks'), { q: "it's" }, "words around");
  assert.deepEqual(repairJson("{'say': 'he said \"hi\"'}"), { say: 'he said "hi"' });
  assert.equal(repairJson("not json at all"), null);
  assert.equal(repairJson("[1, 2]"), null, "only an object");
  assert.equal(repairJson(""), null);
});

test("L75: HTML becomes light Markdown — headings, links with absolute addresses, lists, emphasis, code", () => {
  const out = md.htmlToMarkdown(`<html><head><title>T</title><script>x()</script></head><body><h1>Guide &amp; tips</h1><p>Read <a href="/docs/start">the <b>start</b></a> and <a href="#top">top</a>.</p><ul><li>One</li><li><em>Two</em></li></ul><pre><code>npm i
npm test</code></pre><p>Use <code>--fast</code>.</p></body></html>`, "https://site.example/page");
  assert.match(out, /^# Guide & tips$/m);
  assert.match(out, /Read \[the start\]\(https:\/\/site\.example\/docs\/start\) and top\./);
  assert.match(out, /^- One$/m);
  assert.match(out, /^- \*Two\*$/m);
  assert.match(out, /```\nnpm i\nnpm test\n```/);
  assert.match(out, /Use `--fast`\./);
  assert.doesNotMatch(out, /x\(\)/, "no script");
  assert.equal(md.markdownCopyOf("https://site.example/docs/start?x=1#h"), "https://site.example/docs/start.md?x=1");
  assert.equal(md.markdownCopyOf("https://site.example/docs/"), "https://site.example/docs/index.html.md");
  assert.equal(md.llmsTxtOf("https://site.example/a/b"), "https://site.example/llms.txt");
});

// A local site: Markdown on request, an llms.txt, a page's .md copy, and a plain HTML page.
const hits: { path: string; accept: string }[] = [];
const site = createServer((req, res) => {
  const p = req.url ?? "/";
  hits.push({ path: p, accept: String(req.headers.accept ?? "") });
  if (p === "/llms.txt") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("# Site\n> For AI\n- [Docs](/docs)"); }
  if (p === "/docs/intro.md") { res.writeHead(200, { "content-type": "text/markdown" }); return res.end("# Intro (md copy)\nHello."); }
  if (p === "/negotiated" && /text\/markdown/.test(String(req.headers.accept))) { res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" }); return res.end("# Served as Markdown"); }
  res.writeHead(p === "/missing.md" || p === "/page.md" ? 404 : 200, { "content-type": "text/html" });
  res.end(`<h2>Page ${p}</h2><p>See <a href="/x">x</a></p>`);
});
await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
const origin = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
after(() => site.close());

const { builtinTools } = await import("../src/agent/tools.js");
const { bots, users } = await import("../src/store.js");
const owner = users.create("l75@example.com", "Léa", "x", "en");
const reader = bots.create(owner.id, { name: "Reader", autonomy: "balanced" });
const fetchTool = () => builtinTools().find((t) => t.spec.name === "web_fetch")!;
const ctx = () => ({ bot: bots.byId(reader.id)!, user: owner, depth: 0, signal: new AbortController().signal }) as never;
const text = (o: { content: unknown }) => (typeof o.content === "string" ? o.content : JSON.stringify(o.content));

test("L75: web_fetch asks for Markdown, keeps a Markdown answer, turns HTML into Markdown", async () => {
  const neg = await fetchTool().run({ url: `${origin}/negotiated` }, ctx());
  assert.match(text(neg), /^Status 200 \(the site served Markdown\)\n\n# Served as Markdown$/);
  assert.match(hits.at(-1)!.accept, /^text\/markdown/);
  const html = await fetchTool().run({ url: `${origin}/page` }, ctx());
  assert.match(text(html), /## Page \/page/);
  assert.match(text(html), new RegExp(`See \\[x\\]\\(${origin.replace(/\./g, "\\.")}/x\\)`));
});

test("L75: web_fetch with llms: true reads the site's llms.txt first; markdown_copy: true takes the page's .md copy", async () => {
  const r = await fetchTool().run({ url: `${origin}/page`, llms: true }, ctx());
  assert.match(text(r), new RegExp(`llms\\.txt of this site \\(${origin.replace(/\./g, "\\.")}/llms\\.txt\\):\\n# Site\\n> For AI`));
  assert.match(text(r), /## Page \/page/, "then the page");
  const copy = await fetchTool().run({ url: `${origin}/docs/intro`, markdown_copy: true }, ctx());
  assert.match(text(copy), /^Status 200 \(the page's own Markdown copy: .*\/docs\/intro\.md\)\n\n# Intro \(md copy\)/);
  const none = await fetchTool().run({ url: `${origin}/page`, markdown_copy: true }, ctx());
  assert.match(text(none), /## Page \/page/, "no copy: the page as usual");
});

// On a real bot computer.
const { docker } = await import("../src/linux.js");
const dockerUp = (await docker(["info"], { timeoutMs: 8000 }).catch(() => ({ code: 1 }))).code === 0;
test("L75: browser_back goes back and forward in the tab; the annotated picture shows the reference numbers", { skip: !dockerUp && "Docker is not running" }, async () => {
  process.env.COMPUTER = "linux";
  process.env.MAX_DESKTOPS = "4";
  const { initComputer, screen, workspaceOf } = await import("../src/computer.js");
  const { containerName, linuxScreen } = await import("../src/linux.js");
  const sharp = (await import("sharp")).default;
  await initComputer();
  const bot = bots.create(owner.id, { name: "Backy", autonomy: "balanced" });
  after(async () => { await linuxScreen.destroy(bot.id).catch(() => {}); });
  const tool = (n: string) => builtinTools().find((t) => t.spec.name === n)!;
  const c = () => ({ bot: bots.byId(bot.id)!, user: owner, depth: 0, signal: new AbortController().signal }) as never;
  writeFileSync(path.join(workspaceOf(bot.id), "one.html"), `<!doctype html><title>One</title><body style="margin:0;background:#fff"><a href="two.html" style="position:absolute;left:100px;top:100px;font-size:30px">Go to two</a></body>`);
  writeFileSync(path.join(workspaceOf(bot.id), "two.html"), `<!doctype html><title>Two</title><body style="margin:0;background:#fff"><button style="position:absolute;left:300px;top:200px;width:120px;height:60px">Big button</button></body>`);
  await screen.wake(bot.id, owner.id);
  const n = containerName(bot.id);
  await docker(["exec", n, "sh", "-c", "pkill -f sklubot-browser; sleep 1; true"]);
  await docker(["exec", "-d", "-w", "/root/files", n, "python3", "-m", "http.server", "8051", "--bind", "127.0.0.1"]);
  await new Promise((r) => setTimeout(r, 800));
  await tool("browser_open").run({ url: "http://127.0.0.1:8051/one.html" }, c());
  const nothing = await tool("browser_back").run({ forward: true }, c());
  assert.ok(nothing.isError && /no later page/.test(text(nothing)), text(nothing));
  await tool("browser_open").run({ url: "http://127.0.0.1:8051/two.html" }, c());
  const back = await tool("browser_back").run({}, c());
  assert.ok(!back.isError, text(back));
  assert.match(text(back), /^Went back to One/);
  assert.match(text(back), /link "Go to two"/, "the page in words");
  const fwd = await tool("browser_back").run({ forward: true }, c());
  assert.match(text(fwd), /^Went forward to Two/);
  const snap = await tool("element_snapshot").run({ picture: true }, c());
  const blocks = snap.content as { type: string; text?: string; data?: string }[];
  assert.ok(Array.isArray(blocks) && blocks[1]?.type === "image", text(snap));
  const ref = /\[([0-9a-f]{4})\.(\d+)\] button "Big button"/.exec(blocks[0].text ?? "");
  assert.ok(ref, blocks[0].text);
  assert.match(blocks[0].text ?? "", new RegExp(`each pink number N is the reference ${ref![1]}\\.N`));
  // The pink label sits at the button's centre (360, 230 in the page): its colour is there in the picture.
  if (process.env.L75_SHOT) writeFileSync(process.env.L75_SHOT, Buffer.from(blocks[1].data!, "base64")); // to look at it
  const img = sharp(Buffer.from(blocks[1].data!, "base64"));
  const { width } = await img.metadata();
  const scale = (width ?? 1280) / 1280;
  const { data, info } = await img.extract({ left: Math.round(350 * scale), top: Math.round(222 * scale), width: Math.max(4, Math.round(20 * scale)), height: Math.max(4, Math.round(16 * scale)) }).raw().toBuffer({ resolveWithObject: true });
  let pink = 0;
  for (let i = 0; i < data.length; i += info.channels) if (data[i] > 150 && data[i + 1] < 90 && data[i + 2] > 60 && data[i + 2] < 150) pink++;
  assert.ok(pink > 3, `the pink number is drawn on the button (${pink} pink pixels)`);
  const after2 = await linuxScreen.targetAt(bot.id, "({ left: !!document.getElementById('__sklubot_marks') })");
  assert.equal((after2?.target as { left: boolean } | null)?.left, false, "the numbers are gone from the page");
});
