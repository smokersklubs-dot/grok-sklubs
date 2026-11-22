import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { crc32 } from "node:zlib";
import { studioTechniques } from "../src/studiotechniques.js";

// « Bibliothèque de compétences » (skillslibrary.ts, skillsgithub.ts, docs/COMPETENCES.md): the bundled pack loads with
// its licence and notice, adding a skill is idempotent and stays in the account, and the GitHub import (against a fake
// GitHub) previews licences and flags, refuses other hosts, path tricks and oversize archives, imports drafts only, and
// follows the hosted-mode rules.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-skl-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "sklscript:s-1";
delete process.env.MAX_BOTS;
delete process.env.HOSTED_MODE;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { skills, bots } = await import("../src/store.js");
const lib = await import("../src/skillslibrary.js");
const gh = await import("../src/skillsgithub.js");
const hosted = await import("../src/hosted.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

registerProvider({
  id: "sklscript", label: "Script", models: ["s-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> { req.onText?.("ok"); return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "s-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } }; },
});
function client() {
  let cookie = "";
  return async (method: string, url: string, body?: unknown) => {
    const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: process.env.PUBLIC_URL!, host: "bots.example.test", ...(cookie ? { cookie } : {}) }, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set && set.startsWith("sklubot_session=")) cookie = set.split(";")[0];
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
}
const A = client(), B = client();
const ids: Record<string, string> = {};

/** A zip (stored entries) with these files, as GitHub's archives look: everything under "<repo>-<ref>/". */
function zip(files: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const n = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data); centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const APACHE = "                                 Apache License\n                           Version 2.0, January 2004\n";
const skillMd = (name: string, desc: string, body: string) => `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}\n`;
const REPO = zip({
  "kit-main/README.md": "# Kit\n",
  "kit-main/skills/alpha/SKILL.md": skillMd("alpha-skill", "Does alpha", "1. Do alpha."),
  "kit-main/skills/alpha/LICENSE.txt": APACHE,
  "kit-main/skills/alpha/scripts/run.sh": "#!/bin/sh\nrm -rf /\n",
  "kit-main/skills/alpha/logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]),
  "kit-main/skills/beta/SKILL.md": skillMd("beta", "Does beta", "Steps of beta."),
  "kit-main/skills/keyed/SKILL.md": skillMd("keyed", "Has a key", "Use OPENAI_API_KEY=sk-proj-AbCdEfGhIjKlMnOpQrStUvWx in the call."),
  "kit-main/skills/big/SKILL.md": skillMd("big", "Too long", "x".repeat(25_000)),
  "kit-main/skills/closed/SKILL.md": skillMd("closed", "Proprietary", "Secret method."),
  "kit-main/skills/closed/LICENSE.txt": "© 2025 Someone. All rights reserved.",
  "kit-main/../escape/SKILL.md": skillMd("escape", "Path trick", "Should never be read."),
  "/abs/SKILL.md": skillMd("abs", "Absolute", "Never read."),
});
let served: Record<string, { status: number; body?: Buffer; headers?: Record<string, string> }> = {};
const asked: string[] = [];
gh.setGithubFetch(async (url) => {
  asked.push(url);
  const r = served[url] ?? { status: 404 };
  return new Response(r.body ?? null, { status: r.status, headers: r.headers ?? {} });
});

test("the bundled pack loads each skill with its licence and notice and marks adapted skills", () => {
  const entries = lib.libraryEntries();
  assert.deepEqual(entries.map((e) => e.id).sort(), ["accessibilite-mesuree", "brouillon-email", "cahier-des-charges", "canvas-design", "cartes-de-suivi", "clarifier-avant-d-agir", "code-sobre", "colis-et-retours", "conseil-a-trois-voix", "contenus-par-reseau", "conversation-courte", "design-de-marque", "diagrammes", "ecrire-comme-un-humain", "ecrire-un-article-avec-toi", "entretien-de-marque", "etude-de-marche", "explique-simplement", "fiche-de-charte", "figure-explicative", "frontend-design", "guides-composants-web", "idee-tient-elle", "illustration-animee", "lecons-de-mon-travail", "methode-de-travail", "metier-du-design", "modeles-de-pages", "notes-obsidian", "opendesign-outil", "page-commerce-par-metier", "pages-soignees", "passation-et-bilan", "preciser-une-demande-de-page", "presentations", "professeur-particulier", "questionnaire-a-envoyer", "regles-de-mise-en-page", "relecture-de-code", "salons-avec-des-clients", "seo-boutique-et-comparatifs", "seo-contenu", "seo-donnees-structurees", "seo-local", "seo-methode-et-audit", "seo-surveillance", "seo-visibilite-ia", "site-en-plusieurs-passes", "sous-titres", "stocks-et-reassort", "studio-animation", "styles-de-base", "testeur-de-site", "theme-factory", "verifier-avant-de-livrer", "video-github", "visite-guidee-video"]);
  const dir = new URL("../skills-library/", import.meta.url);
  for (const e of entries) {
    const lic = readFileSync(new URL(`${e.id}/LICENSE.txt`, dir), "utf8");
    const notice = readFileSync(new URL(`${e.id}/NOTICE`, dir), "utf8");
    if (e.origin === "anthropic") {
      assert.match(lic, /Apache License\s+Version 2\.0/);
      assert.match(notice, /© Anthropic, PBC — Apache License 2\.0, from github\.com\/anthropics\/skills/);
      assert.match(notice, /Modified for Sklubot/);
      assert.match(e.text.en!.body, /^> .*© Anthropic, PBC — Apache License 2\.0.*Modified for Sklubot/);
      assert.equal(e.licence, "Apache-2.0");
      assert.match(e.source, /^https:\/\/github\.com\/anthropics\/skills\/tree\/[0-9a-f]{40}\/skills\//);
    } else if (e.origin === "hermes") {
      assert.equal(e.licence, "MIT");
      assert.match(lic, /Copyright \(c\) 2026 Thomas Bekkers/);
      assert.match(notice, /Modified for Sklubot/);
      assert.match(e.source, /^https:\/\/github\.com\/thomasbek3\/hermes-bot-kit\/tree\/[0-9a-f]{40}\//);
      assert.ok(e.text.fr && e.text.en);
    } else if (e.origin === "opendesign") {
      assert.match(lic, /Apache License\s+Version 2\.0/);
      assert.match(lic, /Copyright 2026 Open Design contributors/, "the repository's licence, unchanged");
      assert.ok(e.notice.startsWith(`${e.id} — `), e.notice);
      for (const part of ["© 2026 Open Design contributors", "Apache License 2.0", "github.com/nexu-io/open-design", "commit 0725880"]) assert.ok(e.notice.includes(part), `${e.id}: ${part}`);
      assert.match(notice, /tree\/07258801b9e4ae80553816bb1606af7aa9a63dff/, "pinned to one commit");
      assert.match(notice, /Modified for Sklubot \(2026-11-18\)/);
      assert.equal(e.licence, "Apache-2.0");
      assert.match(e.source, /^https:\/\/github\.com\/nexu-io\/open-design\/tree\/07258801b9e4ae80553816bb1606af7aa9a63dff(\/|$)/);
      assert.ok(e.text.fr && e.text.en, `${e.id} has French and English`);
      for (const t of Object.values(e.text)) assert.match(t!.body, /^> .*© 2026 Open Design contributors.*Apache License 2\.0.*commit 0725880.*Modified for Sklubot/);
    } else if (e.origin === "community") {
      // Adapted from another open-source repository: its licence text(s) unchanged, the holder, the source pinned to one
      // commit, the changes, and the first line of each text saying where it comes from and that it was modified.
      for (const part of e.licence.split(" AND ")) assert.ok(["MIT", "Apache-2.0", "CC-BY-4.0"].includes(part), `${e.id}: ${e.licence}`);
      if (e.licence.includes("MIT")) assert.match(lic, /Permission is hereby granted, free of charge/, e.id);
      if (e.licence.includes("Apache-2.0")) assert.match(lic, /Apache License\s+Version 2\.0/, e.id);
      if (e.licence.includes("CC-BY-4.0")) assert.match(lic, /Creative Commons Attribution 4\.0[\s\S]*creativecommons\.org\/licenses\/by\/4\.0/, e.id);
      assert.ok(e.notice.startsWith(`${e.id} — adapted from `) && e.notice.includes("©"), e.notice);
      assert.match(notice, /Modified for Sklubot \(2026-11-22\): /);
      assert.match(e.source, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/tree\/[0-9a-f]{40}(\/|$)/, e.id);
      for (const url of notice.match(/https:\/\/github\.com\/\S+/g) ?? []) assert.match(url, /\/tree\/[0-9a-f]{40}/, `${e.id}: ${url}`);
      assert.ok(e.text.fr && e.text.en, `${e.id} has French and English`);
      assert.match(e.text.en!.body, /^> Adapted from .*©.*Modified for Sklubot \(2026-11-22\)/, e.id);
      assert.match(e.text.fr!.body, /^> Adaptée d(?:e |es |u |').*©.*Modifiée pour Sklubot \(22\/11\/2026\)/, e.id);
      // No source product's name as a title, and nothing that sends the owner's data to a third-party service.
      for (const t of [e.title.fr, e.title.en]) assert.doesNotMatch(t, /stitch|ponytail|hallmark|claude|anatomy|noodle|spec kit|google|vercel|alibaba|flow|mattpocock|ECC|CLI-Anything|stick-scene/i, `${e.id}: ${t}`);
      for (const t of Object.values(e.text)) assert.doesNotMatch(t!.body, /CLAUDE_PLUGIN_ROOT|mermaid\.ink\/|pip install|DataForSEO MCP|Powered by|cookies? (?:from|of) (?:the|your) browser/i, e.id);
    } else {
      assert.match(lic, /^MIT License/);
      assert.match(notice, /original Sklubot skill/);
      assert.ok(e.text.fr && e.text.en, `${e.id} has French and English`);
    }
    for (const t of Object.values(e.text)) {
      assert.ok(t!.body.length <= 20_000 && t!.body.length > 500, e.id);
      assert.doesNotMatch(t!.body, /claude\.ai|Grok|xAI|theme-showcase\.pdf|canvas-fonts|templates\/viewer/);
    }
  }
  // No executable, font, picture or PDF is bundled: only texts.
  for (const e of entries) for (const f of ["scripts", "canvas-fonts", "theme-showcase.pdf", "themes"]) assert.equal(existsSync(new URL(`${e.id}/${f}`, dir)), false);
  // OpenDesign: the MIT notice of the work its craft rules came from travels with them; no brand look-alike is bundled.
  assert.match(readFileSync(new URL("metier-du-design/LICENSE.txt", dir), "utf8"), /Copyright \(c\) Refero Design[\s\S]*Permission is hereby granted, free of charge/);
  for (const e of entries.filter((x) => x.origin === "opendesign")) {
    for (const t of Object.values(e.text)) {
      // Real companies' design systems shipped by OpenDesign may only be named as what not to use.
      for (const line of t!.body.split("\n").filter((l) => /\b(stripe|airbnb|spotify|tesla|linear-app|notion)\b/i.test(l))) assert.match(line, /never|jamais|imitate|imitent/i, `${e.id}: ${line}`);
      assert.doesNotMatch(t!.body, /data-od-id|<artifact|DESIGN\.md injected|lorem ipsum dolor/i);
    }
    for (const f of ["tokens.css", "components.html", "example.html", "assets", "preview", "manifest.json"]) assert.equal(existsSync(new URL(`${e.id}/${f}`, dir)), false);
  }
  const deck = entries.find((e) => e.id === "presentations")!;
  for (const t of [deck.text.en!, deck.text.fr!]) {
    assert.match(t.body, /```html\n<!doctype html>[\s\S]*\.slide-no\{[\s\S]*@media print[\s\S]*location\.hash[\s\S]*<\/html>\n```/, "the deck frame: numbers, print, #N addresses");
    assert.doesNotMatch(t.body, /localStorage\.(get|set)Item/, "pages cannot use storage");
    assert.match(t.body, /page_publish/);
  }
  assert.match(entries.find((e) => e.id === "opendesign-outil")!.text.en!.body, /git rev-parse HEAD[^\n]*07258801b9e4ae80553816bb1606af7aa9a63dff/);

  // The working method (the owner's extra request) is there in both languages.
  const m = entries.find((e) => e.id === "methode-de-travail")!;
  assert.match(m.text.fr!.body, /Vérifier avant de dire « c'est fait »/);
  assert.match(m.text.en!.body, /Check before saying "done"/);
});

test("community skills: licence check refuses other licences, unpinned sources and missing changes; every skill has a theme and passes the safety check", async () => {
  const MIT = "MIT License\n\nPermission is hereby granted, free of charge, to any person";
  const ok = { notice: "x — adapted from y (© z)\nhttps://github.com/o/r/tree/0123456789abcdef0123456789abcdef01234567\nModified for Sklubot (2026-11-22): condensed.", source: "https://github.com/o/r/tree/0123456789abcdef0123456789abcdef01234567/skills/x" };
  assert.equal(lib.licenceOk("MIT", MIT, ok.notice, ok.source), true);
  assert.equal(lib.licenceOk("MIT AND Apache-2.0", MIT, ok.notice, ok.source), false, "the Apache text is missing");
  assert.equal(lib.licenceOk("GPL-3.0", "GNU GENERAL PUBLIC LICENSE", ok.notice, ok.source), false);
  assert.equal(lib.licenceOk("CC-BY-NC-4.0", "Creative Commons Attribution-NonCommercial 4.0", ok.notice, ok.source), false);
  assert.equal(lib.licenceOk("MIT", MIT, ok.notice, "https://github.com/o/r/tree/main/skills/x"), false, "a moving branch is not a pinned source");
  assert.equal(lib.licenceOk("MIT", MIT, ok.notice.replace("Modified for Sklubot (2026-11-22)", "Copied"), ok.source), false, "the changes must be stated");
  const { scanSkill } = await import("../src/skillscan.js");
  const { LIBRARY_CATEGORIES } = await import("../src/skillstypes.js");
  for (const e of lib.libraryEntries()) {
    assert.ok(LIBRARY_CATEGORIES.includes(e.category), `${e.id}: ${e.category}`);
    for (const t of Object.values(e.text)) assert.notEqual(scanSkill({ name: e.title.en, description: t!.description, body: t!.body }).worst, "danger", e.id);
  }
  const by = (c: string) => lib.libraryEntries().filter((e) => e.category === c).map((e) => e.id);
  assert.ok(by("seo").includes("seo-local") && by("method").includes("clarifier-avant-d-agir") && by("animation").includes("illustration-animee") && by("tools").includes("diagrammes"));
  // The brand sheet the brand interview writes is what "Brand design" reads first.
  const brand = lib.libraryEntries().find((e) => e.id === "design-de-marque")!;
  assert.match(brand.text.en!.body, /~\/team\/charte\.md/); assert.match(brand.text.fr!.body, /~\/team\/charte\.md/);
  assert.match(lib.libraryEntries().find((e) => e.id === "entretien-de-marque")!.text.en!.body, /~\/team\/charte\.md/);
  // Tools fetched on demand are pinned to one commit, checked after checkout.
  assert.match(lib.libraryEntries().find((e) => e.id === "illustration-animee")!.text.en!.body, /git checkout ca84311177a020c2dff7dfd9cb2e7b786288c1ab && git rev-parse HEAD/);
  assert.match(lib.libraryEntries().find((e) => e.id === "figure-explicative")!.text.en!.body, /git checkout 1482e8469b0a9e0d8cc18ea2740a01423d29ae80 && git rev-parse HEAD/);
});

test("adding from the library: in the account's language, idempotent, on its own bots only", async () => {
  ids.a = (await A("POST", "/auth/signup", { email: "a@example.com", name: "Alice", password: "password123", locale: "fr", acceptTerms: true })).json.user.id;
  ids.b = (await B("POST", "/auth/signup", { email: "b@example.com", name: "Bob", password: "password123", acceptTerms: true })).json.user.id;
  ids.a2 = (await A("POST", "/bots", { name: "Capucine" })).json.bot.id;
  ids.bBot = bots.list(ids.b).find((x) => x.kind === "agent")!.id;
  const list = await A("GET", "/skills-library");
  assert.equal(list.status, 200, list.text);
  assert.equal(list.json.skills.length, lib.libraryEntries().length);
  const animation = list.json.skills.find((s: any) => s.id === "studio-animation");
  assert.ok(list.json.skills.every((s: any) => typeof s.category === "string" && s.category), "every card has a theme");
  const clar = list.json.skills.find((s: any) => s.id === "clarifier-avant-d-agir");
  assert.equal(clar.origin, "community"); assert.equal(clar.category, "method"); assert.equal(clar.title, "Clarifier avant d'agir"); assert.equal(clar.language, "fr");
  assert.match(clar.notice, /^clarifier-avant-d-agir — adapted from agent-skills/);
  const addedClar = await A("POST", "/skills-library/clarifier-avant-d-agir/add", { target: ids.a2 });
  assert.equal(addedClar.status, 200, addedClar.text);
  assert.equal(skills.list(ids.a2).find((k) => k.name === "Clarifier avant d'agir")?.draft, false, "a bundled adapted skill passes the safety check");
  for (const id of ["brouillon-email", "cartes-de-suivi", "conversation-courte"]) {
    const card = list.json.skills.find((s: any) => s.id === id);
    assert.equal(card.origin, "hermes");
    assert.equal(card.language, "fr");
    const added = await A("POST", `/skills-library/${id}/add`, { target: ids.a2 });
    assert.equal(added.status, 200, added.text);
    assert.equal(added.json.report.added.length, 1);
    assert.equal(skills.list(ids.a2).find(s => s.name === card.title && !s.draft)?.body, card.body);
    assert.equal((await A("POST", `/skills-library/${id}/add`, { target: ids.a2 })).json.report.already.length, 1);
    assert.equal((await B("POST", `/skills-library/${id}/add`, { target: ids.a2 })).status, 404);
  }
  assert.equal(animation.title, "Animation vidéo");
  assert.equal(animation.language, "fr");
  for (const technique of studioTechniques) assert.ok(animation.body.includes(technique));
  const meth = list.json.skills.find((s: any) => s.id === "methode-de-travail");
  assert.equal(meth.title, "Méthode de travail");
  assert.equal(meth.language, "fr");
  assert.equal(list.json.github, true);
  const agents = bots.list(ids.a).filter((x) => x.kind === "agent");
  assert.equal(meth.botCount, agents.length);
  assert.equal(meth.addedTo, 0);

  const first = await A("POST", "/skills-library/methode-de-travail/add", { target: "all" });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.json.report.added.length, agents.length);
  const again = await A("POST", "/skills-library/methode-de-travail/add", { target: "all" });
  assert.equal(again.json.report.added.length, 0);
  assert.equal(again.json.report.already.length, agents.length);
  for (const b of agents) {
    const own = skills.list(b.id).filter((k) => k.name === "Méthode de travail");
    assert.equal(own.length, 1, "exactly one copy");
    assert.equal(own[0].draft, false);
    assert.match(own[0].body, /Comprendre le but/);
  }
  // English account: the English text; one bot only.
  const en = await B("POST", "/skills-library/frontend-design/add", { target: ids.bBot });
  assert.equal(en.status, 200, en.text);
  const k = skills.list(ids.bBot).find((s) => s.name === "Frontend design")!;
  assert.match(k.body, /Apache License 2\.0/);
  // Nothing crossed accounts: B has no "Méthode de travail", A cannot add to B's bot, B cannot add to A's.
  assert.equal(skills.list(ids.bBot).some((s) => s.name === "Méthode de travail" || s.name === "Working method"), false);
  assert.equal((await A("POST", "/skills-library/pages-soignees/add", { target: ids.bBot })).status, 404);
  assert.equal((await B("POST", "/skills-library/pages-soignees/add", { target: ids.a2 })).status, 404);
  assert.equal(skills.list(ids.a2).some((s) => s.name === "Polished pages" || s.name === "Pages soignées"), false);
  assert.equal((await A("POST", "/skills-library/../../etc/add", { target: "all" })).status, 404);
  assert.equal((await A("POST", "/skills-library/nope/add", { target: "all" })).status, 404);
});

test("GitHub addresses: only public github.com repositories and their folders", () => {
  assert.deepEqual(gh.parseGithubUrl("https://github.com/anthropics/skills"), { owner: "anthropics", repo: "skills", ref: "", path: "" });
  assert.deepEqual(gh.parseGithubUrl("github.com/o/r.git"), { owner: "o", repo: "r", ref: "", path: "" });
  assert.deepEqual(gh.parseGithubUrl("https://github.com/o/r/tree/main/skills/x"), { owner: "o", repo: "r", ref: "main", path: "skills/x" });
  assert.deepEqual(gh.parseGithubUrl("https://github.com/o/r/blob/v1.2/skills/x/SKILL.md"), { owner: "o", repo: "r", ref: "v1.2", path: "skills/x" });
  for (const bad of ["https://gitlab.com/o/r", "http://github.com/o/r", "https://github.com.evil.test/o/r", "https://evil.test/github.com/o/r", "https://user:pw@github.com/o/r",
    "https://github.com:8443/o/r", "https://github.com/o", "https://github.com/o/r/tree/main/../../x", "https://github.com/o/r/tree/main/%2e%2e/x", "https://github.com/o/r/issues/3", "file:///etc/passwd", "https://raw.githubusercontent.com/o/r/main/SKILL.md", "https://127.0.0.1/o/r"])
    assert.throws(() => gh.parseGithubUrl(bad), gh.GithubError, bad);
});

test("GitHub preview: licences, flags, path tricks left out; import as drafts; another account cannot use the preview", async () => {
  served = { "https://github.com/acme/kit/archive/HEAD.zip": { status: 302, headers: { location: "https://codeload.github.com/acme/kit/zip/refs/heads/main" } }, "https://codeload.github.com/acme/kit/zip/refs/heads/main": { status: 200, body: REPO, headers: { "content-type": "application/zip" } } };
  const p = await A("POST", "/skills-library/github/preview", { url: "https://github.com/acme/kit" });
  assert.equal(p.status, 200, p.text);
  const by = Object.fromEntries(p.json.preview.skills.map((s: any) => [s.name, s]));
  assert.deepEqual(Object.keys(by).sort(), ["alpha skill", "beta", "big", "closed", "keyed"]);
  assert.equal(by["alpha skill"].licence, "Apache-2.0"); assert.equal(by["alpha skill"].licenceFrom, "skill"); assert.equal(by["alpha skill"].permissive, true);
  assert.equal(by["alpha skill"].ignoredFiles, 2, "the script and the picture are left out");
  assert.equal(by.beta.licence, "none"); assert.equal(by.beta.permissive, false);
  assert.equal(by.closed.licence, "restrictive"); assert.equal(by.closed.permissive, false);
  assert.equal(by.keyed.mentionsKey, true);
  assert.equal(by.big.tooLarge, true);
  assert.equal(JSON.stringify(p.json).includes("rm -rf"), false);
  assert.equal(JSON.stringify(p.json).includes("Should never be read"), false);
  // The body is not sent in the preview; B cannot commit A's preview.
  assert.equal((await B("POST", "/skills-library/github/commit", { previewId: p.json.preview.previewId, paths: ["skills/beta/SKILL.md"], target: "all" })).status, 400);
  const c = await A("POST", "/skills-library/github/commit", { previewId: p.json.preview.previewId, paths: ["skills/alpha/SKILL.md", "skills/big/SKILL.md", "../escape/SKILL.md"], target: ids.a2 });
  assert.equal(c.status, 200, c.text);
  assert.deepEqual(c.json.report.imported, ["alpha skill"]);
  assert.deepEqual(c.json.report.skipped, ["big"]);
  const imported = skills.list(ids.a2).find((s) => s.name === "alpha skill")!;
  assert.equal(imported.draft, true, "pending the owner's review");
  assert.equal(imported.outside, true);
  assert.match(imported.body, /Source: https:\/\/github\.com\/acme\/kit\/tree\/HEAD\/skills\/alpha — licence: Apache-2\.0/);
  assert.equal(skills.usable(ids.a2).some((s) => s.name === "alpha skill"), false, "a draft is not given to the bot");
  // The preview is single use.
  assert.equal((await A("POST", "/skills-library/github/commit", { previewId: p.json.preview.previewId, paths: ["skills/beta/SKILL.md"] })).status, 400);
});

test("GitHub download: other hosts refused, private/missing repositories, oversize archives, a folder of a repository", async () => {
  served = { "https://github.com/acme/evil/archive/HEAD.zip": { status: 302, headers: { location: "https://evil.test/x.zip" } } };
  const r1 = await A("POST", "/skills-library/github/preview", { url: "https://github.com/acme/evil" });
  assert.equal(r1.status, 502); assert.match(r1.json.error, /ailleurs|refus/);
  assert.equal(asked.includes("https://evil.test/x.zip"), false, "never fetched");
  served = {};
  const r2 = await A("POST", "/skills-library/github/preview", { url: "https://github.com/acme/private" });
  assert.equal(r2.status, 404); assert.match(r2.json.error, /privé|introuvable/);
  served = { "https://github.com/acme/huge/archive/HEAD.zip": { status: 200, body: Buffer.alloc(10), headers: { "content-length": String(gh.MAX_ARCHIVE + 1) } } };
  assert.equal((await A("POST", "/skills-library/github/preview", { url: "https://github.com/acme/huge" })).status, 413);
  served = { "https://github.com/acme/huge2/archive/HEAD.zip": { status: 200, body: Buffer.alloc(gh.MAX_ARCHIVE + 10) } };
  assert.equal((await A("POST", "/skills-library/github/preview", { url: "https://github.com/acme/huge2" })).status, 413);
  assert.equal((await A("POST", "/skills-library/github/preview", { url: "https://gitlab.com/acme/kit" })).status, 400);
  // A folder: only the skills under it; the branch is tried as refs/heads first.
  served = { "https://github.com/acme/kit/archive/refs/heads/main.zip": { status: 200, body: REPO } };
  const r3 = await A("POST", "/skills-library/github/preview", { url: "https://github.com/acme/kit/tree/main/skills/beta" });
  assert.equal(r3.status, 200, r3.text);
  assert.deepEqual(r3.json.preview.skills.map((s: any) => s.name), ["beta"]);
  // A repository-level licence applies to skills without their own; a README licence line too.
  served = { "https://github.com/acme/mit/archive/HEAD.zip": { status: 200, body: zip({ "mit-main/LICENSE": "MIT License\n\nPermission is hereby granted, free of charge, to any person", "mit-main/x/SKILL.md": skillMd("x", "d", "steps") }) } };
  const r4 = await A("POST", "/skills-library/github/preview", { url: "https://github.com/acme/mit" });
  assert.equal(r4.json.preview.skills[0].licence, "MIT"); assert.equal(r4.json.preview.skills[0].licenceFrom, "repository");
  served = { "https://github.com/acme/none/archive/HEAD.zip": { status: 200, body: zip({ "none-main/README.md": "# Nothing\n" }) } };
  assert.equal((await A("POST", "/skills-library/github/preview", { url: "https://github.com/acme/none" })).status, 404);
});

test("GitHub import: files a skill cites are either joined as annexes (small texts of its folder) or named as not imported; size said", async () => {
  const refsBody = "Read [the format](./MISSION-FORMAT.md) first, then `references/eeat.md`.\nRun `scripts/check.py` and see references/missing.md.\nIgnore https://example.com/guide.md and ../outside.md.";
  served = { "https://github.com/acme/refs/archive/HEAD.zip": { status: 200, body: zip({
    "refs-main/LICENSE": "MIT License\n\nPermission is hereby granted, free of charge, to any person",
    "refs-main/teach/SKILL.md": skillMd("teach", "Teaches", refsBody),
    "refs-main/teach/MISSION-FORMAT.md": "# Mission format\nWhy, for whom, by when.",
    "refs-main/teach/references/eeat.md": "# E-E-A-T\nExperience, expertise.",
    "refs-main/teach/scripts/check.py": "print('x')",
    "refs-main/long/SKILL.md": skillMd("long", "Long", "y".repeat(21_000)),
  }) } };
  const p = await A("POST", "/skills-library/github/preview", { url: "https://github.com/acme/refs" });
  assert.equal(p.status, 200, p.text);
  const by = Object.fromEntries(p.json.preview.skills.map((s: any) => [s.name, s]));
  assert.deepEqual(by.teach.annexes, ["MISSION-FORMAT.md", "references/eeat.md"]);
  assert.deepEqual(by.teach.referencedFiles, ["scripts/check.py", "references/missing.md"]);
  assert.equal(by.long.tooLarge, true);
  assert.ok(by.long.chars > 20_000, "the size is given so the card can say by how much");
  const c = await A("POST", "/skills-library/github/commit", { previewId: p.json.preview.previewId, paths: ["teach/SKILL.md"], target: ids.a2 });
  assert.equal(c.status, 200, c.text);
  const k = skills.list(ids.a2).find((s) => s.name === "teach")!;
  assert.match(k.body, /## Annex: MISSION-FORMAT\.md\n+# Mission format/);
  assert.match(k.body, /## Annex: references\/eeat\.md/);
  assert.match(k.body, /not imported[^\n]*scripts\/check\.py, references\/missing\.md/);
});

test("licence detection", () => {
  assert.equal(gh.classifyLicence(APACHE), "Apache-2.0");
  assert.equal(gh.classifyLicence("GNU GENERAL PUBLIC LICENSE\nVersion 3"), "GPL");
  assert.equal(gh.classifyLicence("Creative Commons Attribution-NonCommercial 4.0"), "restrictive");
  assert.equal(gh.classifyLicence("Creative Commons Attribution 4.0 International"), "CC-BY");
  assert.equal(gh.classifyLicence("MIT"), "MIT");
  assert.equal(gh.classifyLicence("whatever"), "unknown");
  assert.equal(gh.isPermissive("GPL"), false);
  assert.equal(gh.isPermissive("BSD"), true);
});

test("hosted mode: operators and paid plans may import from GitHub, a free plan may not (the library stays open to all)", async () => {
  process.env.HOSTED_MODE = "1";
  try {
    if (!hosted.plans.get("free")) hosted.plans.save({ id: "free", kind: "free", nameFr: "Gratuit", nameEn: "Free" }, ids.a);
    if (!hosted.plans.get("pro-test")) hosted.plans.save({ id: "pro-test", kind: "included", nameFr: "Pro", nameEn: "Pro" }, ids.a);
    assert.equal(gh.githubImportAllowed(ids.a), true, "the owner is an operator");
    hosted.subscriptions.ensure(ids.b);
    hosted.subscriptions.update(ids.b, { planId: "free", status: "active" });
    assert.equal(gh.githubImportAllowed(ids.b), false);
    const r = await B("POST", "/skills-library/github/preview", { url: "https://github.com/acme/kit" });
    assert.equal(r.status, 403);
    assert.equal((await B("GET", "/skills-library")).json.github, false);
    assert.equal((await B("POST", "/skills-library/theme-factory/add", { target: "all" })).status, 200, "bundled skills: every plan");
    hosted.subscriptions.update(ids.b, { planId: "pro-test", status: "active" });
    assert.equal(gh.githubImportAllowed(ids.b), true);
  } finally { delete process.env.HOSTED_MODE; }
});
