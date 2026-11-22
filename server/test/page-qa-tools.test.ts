import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Page checks for the bots: L117 web_fetch « tags » (seotags.ts), L109 guide_search (agent/guidesearch.ts), L114 the
// contact sheet (contactsheet.ts, browser mode with a real Chromium when Playwright is installed), L116 the template
// « Contrôle qualité des pages » (server/templates/controle-qualite-pages.md).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-pqa-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.ALLOW_PRIVATE_FETCH = "1"; // the test page is served on this machine
process.env.DEFAULT_MODEL = "pqascript:s-1";

const sharp = (await import("sharp")).default;
const { extractSeoTags, seoTagsReport } = await import("../src/seotags.js");
const { searchWebGuides, webGuideEntries } = await import("../src/agent/guidesearch.js");
const cs = await import("../src/contactsheet.js");
const { initComputer, browserAvailable, closeAllDesktops } = await import("../src/computer.js");
const { builtinTemplates } = await import("../src/teamfile.js");
const { builtinTools } = await import("../src/agent/tools.js");
const { users, bots } = await import("../src/store.js");

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Boulangerie Martin &amp; fils — Lyon</title>
<meta name="description" content="Pain au levain cuit chaque matin à Lyon 3e.">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="https://martin.example/">
<link rel="alternate" hreflang="en" href="https://martin.example/en/"><meta property="og:title" content="Boulangerie Martin">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Bakery","name":"Martin"},{"@type":"WebSite"}]}</script>
<script type="application/ld+json">{ broken</script></head>
<body style="margin:0;font-family:sans-serif"><h1>Notre pain</h1><h2>Horaires</h2><img src="a.jpg"><img src="b.jpg" alt="Le four">
<a href="/contact">Contact</a><a href="https://other.example/" rel="nofollow">Ailleurs</a><a href="#top">Haut</a>
<div style="width:1000px;background:#c33;height:300px">Bandeau trop large</div></body></html>`;

test("L117: the tags of a page, facts only, missing ones said", () => {
  const t = extractSeoTags(PAGE, "https://martin.example/");
  assert.equal(t.title, "Boulangerie Martin & fils — Lyon");
  assert.equal(t.description, "Pain au levain cuit chaque matin à Lyon 3e.");
  assert.deepEqual([t.canonical, t.lang, t.robots], ["https://martin.example/", "fr", null]);
  assert.deepEqual(t.hreflang, [{ lang: "en", href: "https://martin.example/en/" }]);
  assert.deepEqual(t.headings, [{ level: 1, text: "Notre pain" }, { level: 2, text: "Horaires" }]);
  assert.deepEqual([t.jsonLd, t.jsonLdErrors], [["Bakery", "WebSite"], 1]);
  assert.deepEqual([t.images, t.imagesWithoutAlt], [2, 1]);
  assert.deepEqual(t.links, { internal: 1, external: 1, nofollow: 1 });
  const r = seoTagsReport(t);
  assert.match(r, /title: "Boulangerie Martin & fils — Lyon" \(32 characters\)/);
  assert.match(r, /H1: 1 \("Notre pain"\)/);
  assert.match(r, /before any script ran/);
  assert.doesNotMatch(r, /score/i);
  assert.match(seoTagsReport(extractSeoTags("<html><body>x</body></html>", "https://x.example/")), /title: MISSING.*\n.*description: MISSING/);
});

test("L109: guide_search finds the right entry, with its browser-support status", async () => {
  assert.ok(webGuideEntries().length >= 15, `${webGuideEntries().length} entries`);
  const dialog = searchWebGuides("fenêtre de dialogue modale", "fr");
  assert.ok(dialog.length >= 1);
  assert.match(dialog[0].text, /<dialog>/);
  assert.equal(dialog[0].recent, true, "the dialog entry mentions a recent feature");
  const en = searchWebGuides("tabs", "en");
  assert.equal(en[0].lang, "en");
  assert.deepEqual(searchWebGuides("zzz qqq", "fr"), []);
  const tool = builtinTools().find((t) => t.spec.name === "guide_search")!;
  const ctx = { user: { locale: "fr" }, bot: {} } as any;
  const out = await tool.run({ query: "dialogue" }, ctx);
  assert.match(String(out.content), /Browser support: uses a RECENT feature/);
  assert.match(String(out.content), /CC BY 4\.0/);
  assert.match(String((await tool.run({ query: "xylophone" }, ctx)).content), /No web guide entry matches/);
});

test("L114: widths are cleaned; the sheet puts the shots side by side, labelled, at one height", async () => {
  assert.deepEqual(cs.sheetWidths(undefined), [390, 768, 1280]);
  assert.deepEqual(cs.sheetWidths([100, 5000, 390, 390, 700, 800, 900]), [320, 1920, 390, 700]);
  const shot = async (w: number) => (await sharp({ create: { width: w, height: 900, channels: 3, background: "#3366cc" } }).jpeg().toBuffer()).toString("base64");
  const img = await cs.composeSheet([{ width: 390, data: await shot(390) }, { width: 1280, data: await shot(1280) }]);
  const m = await sharp(img).metadata();
  assert.equal(m.format, "jpeg");
  assert.equal(m.height, cs.SHEET_HEIGHT + 28 + 32);
  const w390 = Math.round(390 * cs.SHEET_HEIGHT / 900), w1280 = Math.round(1280 * cs.SHEET_HEIGHT / 900);
  assert.ok(Math.abs((m.width ?? 0) - (w390 + w1280 + 48)) <= 2, `${m.width}`);
});

test("L114: page_contact_sheet photographs a real page at 3 widths (browser mode)", async (t) => {
  await initComputer();
  if (!browserAvailable()) { t.skip("no browser engine installed"); return; }
  const server = createServer((_q, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  try {
    const tool = builtinTools().find((x) => x.spec.name === "page_contact_sheet")!;
    assert.ok(tool, "offered where bots have a browser");
    const user = users.create("pqa@example.com", "PQA", "x", "fr");
    const bot = bots.create(user.id, { name: "Suzanne" });
    const ctx = { bot, user, tainted: false, depth: 0, signal: new AbortController().signal } as any;
    assert.equal((await tool.run({ url: "file:///etc/passwd" }, ctx)).isError, true);
    const out = await tool.run({ url }, ctx);
    assert.ok(!out.isError, JSON.stringify(out).slice(0, 300));
    const blocks = out.content as any[];
    assert.match(blocks[0].text, /390, 768, 1280 px/);
    assert.match(blocks[0].text, /at 390 px the page is 1000 px wide \(sideways scroll\); at 768 px the page is 1000 px wide/, "the too-wide banner is measured");
    const m = await sharp(Buffer.from(blocks[1].data, "base64")).metadata();
    assert.equal(m.height, cs.SHEET_HEIGHT + 60);
    assert.ok((m.width ?? 0) > 1500, `${m.width}`);
  } finally {
    server.close();
    await closeAllDesktops();
  }
});

test("L116: the « Contrôle qualité des pages » template uses the page tools and asks before anything that commits", () => {
  const tpl = builtinTemplates().find((x) => x.id === "controle-qualite-pages");
  assert.ok(tpl, "the template parses");
  const p = tpl!.parsed;
  assert.deepEqual([p.removed, p.masked, p.warnings], [[], [], []]);
  const b = p.bots[0];
  for (const w of ["page_contact_sheet", "tags", "guide_search", "Testeur de site", "sans mon accord"]) assert.ok(b.instructions.includes(w), w);
  assert.equal(b.skills[0].name, "Contrôler une page");
  assert.equal(b.routines[0].timezone, "Europe/Paris");
});
