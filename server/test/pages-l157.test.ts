import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L157 « Pages » — the parts still missing on 23/11: « rien de perdu » à la refonte, journal de design par compte,
// photothèque Wikimedia Commons avec crédit automatique, WebGL vérifié. Contracts first, one test each.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-l157-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "demo:demo";
delete process.env.HOSTED_MODE;

const { api, site } = await import("../src/routes.js");
const { builtinTools } = await import("../src/agent/tools.js");
const { bots, users, rows, pages } = await import("../src/store.js");
const { lostParts, pageParts } = await import("../src/pagekeep.js");
const { designJournal, journalColoursMissing } = await import("../src/designjournal.js");
const { commonsNet, commonsFile, freeLicence, withCommonsCredits, COMMONS_API, COMMONS_UA } = await import("../src/commonsphotos.js");
const { usesWebgl, withWebglFallback, rulesFor, webglLine, FALLBACK_MARK } = await import("../src/pagewebgl.js");
const { PAGE_RULES_JS, CHECK_SIZES } = await import("../src/pagecheck.js");
const { browserPageCheck } = await import("../src/pagecheck-browser.js");
const { pageHeaders } = await import("../src/pagefiles.js");

let cookie = "";
async function call(method: string, url: string, body?: unknown, jar?: { cookie: string }) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jar ? jar.cookie : cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) { if (jar) jar.cookie = set.split(";")[0]; else cookie = set.split(";")[0]; }
  let json: any = null; const text = await res.text(); try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const other = { cookie: "" };
let userId = "";
const tool = (name: string) => builtinTools().find((t) => t.spec.name === name)!;

const V1 = `<!doctype html><html lang="fr"><head><title>Boulangerie</title></head><body>
<header id="haut"><h1>Boulangerie Martin</h1><nav aria-label="Menu principal"><a href="#tarifs">Tarifs</a> <a href="https://example.com/commander">Commander en ligne</a></nav></header>
<section id="tarifs"><h2>Nos tarifs</h2><p>La baguette tradition est à 1,30 € et le pain de campagne à 3,90 € le kilo.</p></section>
<section id="horaires"><h2>Horaires</h2><p>Ouvert du mardi au dimanche, de 7 heures à 19 heures 30, sans interruption.</p>
<img src="four.jpg" alt="Le four à bois"></section>
<footer><p>12 rue des Lilas, 35000 Rennes — téléphone 02 99 00 00 00.</p></footer></body></html>`;
// The redone page: « Horaires » (its heading, its text, its photo) and the order link are gone; the address moved, re-wrapped.
const V2 = `<!doctype html><html lang="fr"><head><title>Boulangerie</title></head><body>
<header id="haut"><h1>Boulangerie   Martin</h1><nav aria-label="Menu principal"><a href="#tarifs">Tarifs</a></nav></header>
<section id="tarifs"><h2>Nos tarifs</h2><p>La baguette tradition est à 1,30 € et le pain de campagne à 3,90 € le kilo.</p></section>
<footer><div>12 rue des Lilas,
 35000 Rennes — téléphone 02 99 00 00 00.</div></footer></body></html>`;

test("setup", async () => {
  assert.equal((await call("POST", "/auth/signup", { email: "l157@example.com", password: "password-1", locale: "fr" })).status, 200);
  userId = users.byEmail("l157@example.com")!.id;
  assert.equal((await call("POST", "/auth/signup", { email: "l157-other@example.com", password: "password-1", locale: "fr" }, other)).status, 200);
});

// ── 1. « Rien de perdu » ──
test("L157 nothing lost: sections, links, images and text blocks that disappeared are listed; moved or re-wrapped text is not", () => {
  const p = pageParts(V1);
  assert.deepEqual(p.sections.slice(0, 3), ["Boulangerie Martin", "Nos tarifs", "Horaires"]);
  assert.ok(p.sections.includes("section « horaires »") && p.sections.includes("nav « Menu principal »"));
  const lost = lostParts(V1, V2, ["css/site.css", "app.js"], ["app.js"]);
  const by = (k: string) => lost.filter((l) => l.kind === k).map((l) => l.text);
  assert.deepEqual(by("section").sort(), ["Horaires", "section « horaires »"].sort());
  assert.deepEqual(lost.filter((l) => l.kind === "link").map((l) => l.detail), ["https://example.com/commander"]);
  assert.deepEqual(by("image"), ["Le four à bois"]);
  assert.deepEqual(by("text"), ["Ouvert du mardi au dimanche, de 7 heures à 19 heures 30, sans interruption."], "the address (moved into a div, re-wrapped) is not lost");
  assert.deepEqual(by("file"), ["css/site.css"]);
  assert.deepEqual(lostParts(V1, V1), [], "the same page loses nothing");
  assert.deepEqual(lostParts(V1, V1.replace("Nos tarifs", "NOS TARIFS")), [], "case and spaces do not count");
});

test("L157 nothing lost: publishing again posts a card, the bot is told, the owner keeps or restores; a stranger cannot", async () => {
  const user = users.byId(userId)!;
  const bot = bots.create(userId, { name: "Pages", autonomy: "balanced" });
  const ctx = { bot, user, depth: 0, signal: new AbortController().signal } as never;
  const first = await tool("page_publish").run({ name: "boulangerie", title: "Boulangerie", html: V1, visibility: "private" }, ctx);
  assert.doesNotMatch(String(first.content), /Nothing-lost check/, "a new page has nothing to compare with");
  const second = await tool("page_publish").run({ name: "boulangerie", title: "Boulangerie", html: V2, visibility: "private" }, ctx);
  assert.match(String(second.content), /Nothing-lost check: this version no longer has 2 sections, 1 image, 1 link, 1 text block/);
  const cards = () => rows.all(bot.id, bots.byId(bot.id)!.generation).filter((r) => r.body.kind === "card" && r.body.card.type === "pageloss");
  assert.equal(cards().length, 1);
  const row = cards()[0];
  const card = (row.body as any).card;
  assert.equal(card.status, "pending");
  assert.equal(card.total, 5);
  assert.equal(card.lost[0].kind, "section", "the most visible first");
  // A stranger cannot answer it; a wrong choice is refused.
  assert.equal((await call("POST", `/bots/${bot.id}/rows/${row.seq}/pageloss`, { choice: "restore" }, other)).status, 404);
  assert.equal((await call("POST", `/bots/${bot.id}/rows/${row.seq}/pageloss`, { choice: "maybe" })).status, 400);
  const restored = await call("POST", `/bots/${bot.id}/rows/${row.seq}/pageloss`, { choice: "restore" });
  assert.equal(restored.status, 200, restored.text);
  assert.equal(restored.json.card.status, "restored");
  const page = pages.forPath(bot.id, "pages/boulangerie.html", "https://x.test")!;
  const versions = (await call("GET", `/pages/${page.token}/versions`)).json.versions;
  assert.equal(versions.length, 3, "published, published again, restored");
  assert.equal(versions[0].note, "restored version 1");
  assert.match((await call("GET", `/pages/${page.token}/diff?from=${versions[2].id}&to=current`)).text, /"added":0,"removed":0/, "the page is the first version again");
  assert.equal((await call("POST", `/bots/${bot.id}/rows/${row.seq}/pageloss`, { choice: "keep" })).status, 409, "answered once");
  // page_edit that drops a paragraph posts a second card; « Garder » keeps the new version.
  const edit = await tool("page_edit").run({ name: "boulangerie", edits: [{ find: "<p>Ouvert du mardi au dimanche, de 7 heures à 19 heures 30, sans interruption.</p>", replace: "" }] }, ctx);
  assert.match(String(edit.content), /no longer has 1 text block/);
  const second2 = cards()[1];
  assert.equal((await call("POST", `/bots/${bot.id}/rows/${second2.seq}/pageloss`, { choice: "keep" })).json.card.status, "kept");
  // An edit that only adds loses nothing: no card.
  await tool("page_edit").run({ name: "boulangerie", edits: [{ find: "<h2>Nos tarifs</h2>", replace: "<h2>Nos tarifs</h2><p>Nouveau : la brioche du dimanche.</p>" }] }, ctx);
  assert.equal(cards().length, 2);
});

// ── 2. Journal de design ──
test("L157 design journal: one per account, written by bot and owner, given back for every new page with a colour warning", async () => {
  const user = users.byId(userId)!;
  const bot = bots.create(userId, { name: "Designer", autonomy: "balanced" });
  const ctx = { bot, user, depth: 0, signal: new AbortController().signal } as never;
  const dj = tool("design_journal");
  assert.match(String((await dj.run({}, ctx)).content), /design journal is empty/);
  const added = await dj.run({ action: "add", topic: "colors", decision: "Bleu nuit #1E3A5F pour les titres, fond crème #faf7f0", why: "le client aime le calme" }, ctx);
  assert.match(String(added.content), /^Noted in the design journal \(colors\)/);
  assert.equal((await dj.run({ action: "add", topic: "bad", decision: "x y" }, ctx)).isError, true);
  assert.equal((await call("POST", "/design-journal", { topic: "fonts", decision: "Titres en Fraunces, texte en Inter" })).status, 200);
  assert.equal((await call("POST", "/design-journal", { topic: "fonts", decision: "" })).json.error, "Écris la décision (quelques mots au moins).");
  const list = (await call("GET", "/design-journal")).json.decisions;
  assert.deepEqual(list.map((d: any) => [d.topic, d.by]), [["fonts", "user"], ["colors", "bot"]]);
  // Another account sees none of it and cannot remove it.
  assert.deepEqual((await call("GET", "/design-journal", undefined, other)).json.decisions, []);
  assert.equal((await call("DELETE", `/design-journal/${list[0].id}`, undefined, other)).status, 404);
  // A second bot of the same account gets the journal on its next NEW page, with a warning when no colour is used.
  const bot2 = bots.create(userId, { name: "Autre", autonomy: "balanced" });
  const ctx2 = { bot: bot2, user, depth: 0, signal: new AbortController().signal } as never;
  const off = await tool("page_publish").run({ name: "promo", title: "Promo", html: "<html lang=fr><body><h1 style='color:#ff0000'>Promo</h1></body></html>", visibility: "private" }, ctx2);
  assert.match(String(off.content), /Design journal of this account[\s\S]*Colours: Bleu nuit #1E3A5F[\s\S]*Fonts: Titres en Fraunces/);
  assert.match(String(off.content), /uses none of the journal's colours \(#1e3a5f, #faf7f0\)/);
  const on = await tool("page_publish").run({ name: "promo2", title: "Promo 2", html: "<html lang=fr><body><h1 style='color:#1e3a5f'>Promo</h1></body></html>", visibility: "private" }, ctx2);
  assert.doesNotMatch(String(on.content), /uses none of the journal's colours/);
  const again = await tool("page_publish").run({ name: "promo2", title: "Promo 2", html: "<html lang=fr><body><h1 style='color:#1e3a5f'>Promo</h1></body></html>", visibility: "private" }, ctx2);
  assert.doesNotMatch(String(again.content), /Design journal/, "only for a new page");
  assert.deepEqual(journalColoursMissing(designJournal.list(userId), "body{color:#1E3A5F}"), []);
  assert.equal((await call("DELETE", `/design-journal/${list[0].id}`)).status, 200);
  assert.equal(designJournal.list(userId).length, 1);
});

// ── 3. Wikimedia Commons ──
const commonsPage = (title: string, licence: string, licenceUrl: string, artist: string, extra: Record<string, unknown> = {}) => ({
  title, index: 1, imageinfo: [{ url: `https://upload.wikimedia.org/wikipedia/commons/0/0d/${title.slice(5).replace(/ /g, "_")}?utm_source=commons.wikimedia.org`, thumburl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0d/${title.slice(5).replace(/ /g, "_")}/1280px-${title.slice(5).replace(/ /g, "_")}?utm_source=x`, thumbwidth: 1280, thumbheight: 850, descriptionurl: `https://commons.wikimedia.org/wiki/${title.replace(/ /g, "_")}`, mime: "image/jpeg",
    extmetadata: { ObjectName: { value: title.slice(5).replace(/\.jpg$/, "") }, Artist: { value: `<a href="//commons.wikimedia.org/wiki/User:${artist}">${artist}</a>` }, LicenseShortName: { value: licence }, LicenseUrl: { value: licenceUrl }, ...extra } }],
});
test("L157 Commons: only free licences, the official API with a User-Agent, and the credit added to the page automatically", async () => {
  assert.equal(freeLicence("CC BY-SA 3.0 ee"), true);
  assert.equal(freeLicence("Public domain"), true);
  assert.equal(freeLicence("CC0"), true);
  assert.equal(freeLicence("CC BY-NC 2.0"), false);
  assert.equal(freeLicence("CC BY-ND 4.0"), false);
  assert.equal(freeLicence(""), false);
  assert.equal(commonsFile("https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0d/Phare_du_Petit_Minou.jpg/1280px-Phare_du_Petit_Minou.jpg"), "Phare_du_Petit_Minou.jpg");
  assert.equal(commonsFile("https://upload.wikimedia.org/wikipedia/commons/0/0d/Phare%20Minou.jpg"), "Phare_Minou.jpg");
  assert.equal(commonsFile("https://example.com/a.jpg"), null);
  const asked: { url: string }[] = [];
  commonsNet.fetch = async (url) => {
    asked.push({ url });
    if (/generator=search/.test(url)) return Response.json({ query: { pages: [
      commonsPage("File:Phare du Petit Minou.jpg", "CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0", "Jean_Dupont"),
      commonsPage("File:Phare interdit.jpg", "CC BY-NC 2.0", "https://creativecommons.org/licenses/by-nc/2.0", "X"),
    ] } });
    return Response.json({ query: { pages: [commonsPage("File:Ile de Batz.jpg", "Public domain", "", ""), { title: "File:Absent.jpg", missing: true }] } });
  };
  const user = users.byId(userId)!;
  const bot = bots.create(userId, { name: "Photos", autonomy: "balanced" });
  const ctx = { bot, user, depth: 0, signal: new AbortController().signal } as never;
  const found = await tool("photo_search").run({ query: "phare bretagne" }, ctx);
  assert.match(String(found.content), /^1 free photo from Wikimedia Commons/);
  assert.match(String(found.content), /Jean_Dupont — CC BY-SA 4\.0\n   src: https:\/\/thumb\.wikimedia\.org\/wikipedia\/commons\/thumb\/0\/0d\/Phare_du_Petit_Minou\.jpg\/1280px-Phare_du_Petit_Minou\.jpg\n/);
  assert.doesNotMatch(String(found.content), /interdit/, "a non-commercial licence is never offered");
  assert.ok(asked[0].url.startsWith(`${COMMONS_API}?action=query&format=json&formatversion=2&generator=search&gsrnamespace=6`));
  assert.match(asked[0].url, /gsrsearch=phare%20bretagne%20filetype%3Abitmap/);
  assert.match(COMMONS_UA, /^Sklubot\/[\d.]+ \(/);
  // Published with that photo and one never looked up: both credited at the end, in French; a missing one is reported.
  const html = `<!doctype html><html lang="fr"><body><h1>Phares</h1><img alt="Le phare" src="https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0d/Phare_du_Petit_Minou.jpg/1280px-Phare_du_Petit_Minou.jpg"><img alt="Batz" src="https://upload.wikimedia.org/wikipedia/commons/1/1a/Ile_de_Batz.jpg"><img alt="?" src="https://upload.wikimedia.org/wikipedia/commons/2/2b/Absent.jpg"></body></html>`;
  const out = await tool("page_publish").run({ name: "phares", title: "Phares", html, visibility: "private" }, ctx);
  assert.match(String(out.content), /Photo credits: 2 Wikimedia Commons credits/);
  assert.match(String(out.content), /Absent\.jpg: not found on Wikimedia Commons/);
  assert.match(asked[1].url, /titles=File%3AIle_de_Batz\.jpg%7CFile%3AAbsent\.jpg/, "looked up by name, both at once");
  const page = pages.forPath(bot.id, "pages/phares.html", "https://x.test")!;
  const saved = (await call("GET", `/pages/${page.token}/standalone`)).text;
  assert.match(saved, /<aside data-sklubot-credits[^>]*><p[^>]*>Crédits photo<\/p><ul[^>]*><li><a href="https:\/\/commons\.wikimedia\.org\/wiki\/File:Phare_du_Petit_Minou\.jpg"[^>]*>Phare du Petit Minou<\/a> par Jean_Dupont, <a href="https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0" rel="license[^"]*"[^>]*>CC BY-SA 4\.0<\/a>, via Wikimedia Commons<\/li>/);
  assert.match(saved, /Ile de Batz<\/a>, Public domain, via Wikimedia Commons/);
  assert.match(saved, /<\/aside>\n<\/body>/);
  // Saved again: one credits block, not two; without Commons images, no block.
  const again = await withCommonsCredits(bot, saved);
  assert.equal(again.html.match(/data-sklubot-credits/g)?.length, 1);
  assert.equal((await withCommonsCredits(bot, "<p>rien</p>")).html, "<p>rien</p>");
  // The search is refused under a network policy that blocks Commons? (no policy here: allowed) — and the API error is said plainly.
  commonsNet.fetch = async () => new Response("busy", { status: 429 });
  const failed = await tool("photo_search").run({ query: "x" }, ctx);
  assert.equal(failed.isError, true);
  assert.match(String(failed.content), /Wikimedia Commons could not be searched: Wikimedia Commons answered 429/);
});

// ── 4. WebGL vérifié ──
const SPIN = `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>3D</title><style>canvas{width:100%;height:300px;display:block}</style></head><body><h1>Cube</h1><canvas id="scene"></canvas>
<script>const c=document.getElementById('scene');const gl=c.getContext('webgl');function f(){gl.clearColor(0.2,0.5,0.9,1);gl.clear(gl.COLOR_BUFFER_BIT);requestAnimationFrame(f)}if(gl)f();</script></body></html>`;
const EMPTY = SPIN.replace("gl.clearColor(0.2,0.5,0.9,1);gl.clear(gl.COLOR_BUFFER_BIT);", "");
test("L157 WebGL: detected in the page or its scripts; the visitors' fallback is added when such a page is served", async () => {
  assert.equal(usesWebgl(SPIN), true);
  assert.equal(usesWebgl("<script src='https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js'></script>"), true);
  assert.equal(usesWebgl("<p>2D</p>", [{ path: "app.js", content: "new THREE.WebGLRenderer({ antialias: true })" }]), true);
  assert.equal(usesWebgl("<canvas></canvas><script>c.getContext('2d')</script>"), false);
  assert.equal(withWebglFallback("<p>2D</p>"), "<p>2D</p>");
  const once = withWebglFallback(SPIN);
  assert.match(once, /<head><script data-sklubot-webgl-fallback-script>/);
  assert.equal(withWebglFallback(once), once, "added once");
  const user = users.byId(userId)!;
  const bot = bots.create(userId, { name: "3D", autonomy: "balanced" });
  const ctx = { bot, user, depth: 0, signal: new AbortController().signal } as never;
  const out = await tool("page_publish").run({ name: "cube", title: "Cube", html: SPIN, visibility: "link" }, ctx);
  assert.match(String(out.content), /WebGL: the page uses WebGL but could not be rendered/, "no browser in this test: said, not hidden");
  const page = pages.forPath(bot.id, "pages/cube.html", "https://x.test")!;
  const served = await (await site.request(`/p/${page.token}`)).text();
  assert.match(served, /data-sklubot-webgl-fallback-script/);
  assert.match(served, /Cette page affiche de la 3D \(WebGL\)/);
});

const require = createRequire(import.meta.url);
let chromium: { launch(o: Record<string, unknown>): Promise<any> } | null = null;
try { chromium = (require("playwright") as { chromium: typeof chromium }).chromium; } catch { /* no browser */ }
test("L157 WebGL: rendered in headless Chromium — drawn, empty, and no WebGL at all (the fallback message shows)", { skip: !chromium && "Playwright is not installed" }, async () => {
  const check = async (html: string, args: string[] = []) => {
    const browser = await chromium!.launch({ headless: true, args: ["--disable-dev-shm-usage", ...args] });
    try {
      const context = await browser.newContext();
      return await browserPageCheck(context, { html: withWebglFallback(html), files: [], headers: pageHeaders(), sizes: CHECK_SIZES, rules: rulesFor(PAGE_RULES_JS, true) });
    } finally { await browser.close(); }
  };
  const drawn = await check(SPIN);
  assert.equal(drawn.ok, true);
  const line = webglLine(drawn, true);
  assert.match(line, /^WebGL: verified at 390 and 1280 px — WebGL rendered: canvas#scene 300×150 drew pixels/);
  assert.ok(Object.values(drawn.rules ?? {}).every((f) => !f.some((x) => x.rule.startsWith("webgl"))), "the positive results are not left as problems");
  const empty = await check(EMPTY);
  assert.match(JSON.stringify(empty.rules), /the WebGL canvas canvas#scene 300×150 shows nothing/);
  assert.match(webglLine(empty, true), /^WebGL: problems below/);
  const none = await check(SPIN, ["--disable-webgl", "--disable-3d-apis"]);
  assert.match(webglLine(none, true), /^WebGL: the check's browser has no WebGL, so the 3D could not be verified; visitors in that case see the fallback message\. Do not call the 3D verified\.$/);
  // What a visitor without WebGL sees: the message, in French for a French page.
  const browser = await chromium!.launch({ headless: true, args: ["--disable-webgl", "--disable-3d-apis"] });
  try {
    const p = await browser.newPage();
    await p.setContent(withWebglFallback(SPIN));
    const msg = await p.locator(`[${FALLBACK_MARK}]`).textContent();
    assert.match(String(msg), /^Cette page affiche de la 3D \(WebGL\) que ce navigateur ne peut pas afficher\./);
    assert.equal(await p.locator(`[${FALLBACK_MARK}]`).getAttribute("role"), "alert");
  } finally { await browser.close(); }
});
