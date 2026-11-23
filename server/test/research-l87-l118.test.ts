import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// L118 OpenAlex / PubMed en accès direct (fixtures locales de leurs JSON publics), L87 « ce qui a changé », veille,
// recherche dans les rapports passés et flux Atom privé. Aucun réseau réel, aucun modèle.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sklubot-research-l118-"));
process.env.DB_PATH = ":memory:";
process.env.NO_SCHEDULER = "1";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.HOSTED_MODE = "0";
process.env.SESSION_SECRET = "research-l118-isolated-secret-00000";

const seen: string[] = [];
let pubmedDown = false;
const fixture = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  seen.push(url.pathname + url.search);
  const json = (v: unknown, status = 200) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(v));
  if (url.pathname === "/works")
    return json({ results: [
      { id: "https://openalex.org/W123", doi: "https://doi.org/10.1000/xyz", display_name: "Sleep and memory consolidation", publication_date: "2025-05-02", cited_by_count: 87,
        abstract_inverted_index: { Sleep: [0], helps: [1], memory: [2] }, primary_location: { source: { display_name: "Nature" } }, authorships: [{ author: { display_name: "A. Martin" } }] },
      { id: "not-an-openalex-id", display_name: "No link" },
    ] });
  if (url.pathname === "/esearch.fcgi") return pubmedDown ? json({}, 429) : json({ esearchresult: { idlist: ["3901", "x"] } });
  if (url.pathname === "/esummary.fcgi") return json({ result: { uids: ["3901"], "3901": { title: "Sleep deprivation in nurses", pubdate: "2024 Mar", sortpubdate: "2024/03/01 00:00", fulljournalname: "J Sleep Res", authors: [{ name: "Dupont J" }] } } });
  res.writeHead(404).end();
});
await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
after(() => fixture.close());
const addr = fixture.address();
assert(addr && typeof addr !== "string");
process.env.RESEARCH_OPENALEX_BASE = `http://127.0.0.1:${addr.port}`;
process.env.RESEARCH_PUBMED_BASE = `http://127.0.0.1:${addr.port}`;

const { users, bots } = await import("../src/store.js");
const { q } = await import("../src/db.js");
const { abstractText, searchOpenAlex, searchPubMed, scholarTool } = await import("../src/researchscholar.js");
const { changesBlock, previousReport, setWatch, watchOf, runDueWatches, searchPastReports, newFeedToken, atomFor, dropFeed } = await import("../src/researchwatch.js");
const { reportMessage } = await import("../src/researchsection.js");
const { briefFrom } = await import("../src/researchevidence.js");
const { createReport } = await import("../src/researchreports.js");
const { builtinTools } = await import("../src/agent/tools.js");
const owner = users.create("research-l118@test.local", "A", "unused", "fr");
const other = users.create("research-l118-b@test.local", "B", "unused", "fr");
const bot = bots.create(owner.id, { name: "Chercheur" });
const stranger = bots.create(other.id, { name: "Autre" });

test("L118 OpenAlex: works with DOI, date, citations and the abstract put back in order; the window becomes a filter", async () => {
  assert.equal(abstractText({ memory: [2], Sleep: [0], helps: [1] }), "Sleep helps memory");
  const o = await searchOpenAlex("sleep memory", "year", AbortSignal.timeout(5000));
  assert.equal(o.state.state, "ok");
  assert.equal(o.items.length, 1, "a work without a link is dropped");
  assert.equal(o.items[0].url, "https://doi.org/10.1000/xyz");
  assert.equal(o.items[0].published, "2025-05-02");
  assert.equal(o.items[0].engagement?.score, 87);
  assert.match(o.items[0].text, /Sleep helps memory/);
  const call = seen.find((s) => s.startsWith("/works"))!;
  assert.match(call, /search=sleep\+memory/);
  assert.match(call, /filter=from_publication_date%3A\d{4}-\d{2}-\d{2}%2Cto_publication_date/);
  assert.doesNotMatch(call, /api_key|mailto/, "no key and no e-mail address are sent");
});

test("L118 PubMed: ESearch then ESummary, bad ids ignored, a failure is a state (never « nothing exists »)", async () => {
  const o = await searchPubMed("sleep nurses", "any", AbortSignal.timeout(5000));
  assert.equal(o.state.state, "ok");
  assert.deepEqual(o.items.map((i) => i.url), ["https://pubmed.ncbi.nlm.nih.gov/3901/"]);
  assert.equal(o.items[0].published, "2024-03-01");
  assert.ok(seen.some((s) => s.startsWith("/esearch.fcgi") && /db=pubmed/.test(s) && /tool=sklubot/.test(s) && !/email|api_key/.test(s)));
  pubmedDown = true;
  const down = await searchPubMed("sleep", "any", AbortSignal.timeout(5000));
  assert.equal(down.state.state, "rate_limited");
  const tool = builtinTools({}).find((t) => t.spec.name === "scholar_search");
  assert.ok(tool, "scholar_search is offered to bots");
  const r = await scholarTool.run({ query: "sleep", sources: ["pubmed", "openalex"] }, { bot, user: owner, signal: AbortSignal.timeout(5000) } as any);
  assert.match(r.content, /PubMed: not reachable \(rate_limited\) — do not conclude/);
  assert.match(r.content, /OpenAlex: 1 results/);
  assert.ok(!r.isError);
  pubmedDown = false;
  assert.ok(briefFrom({ subject: "S", plan: ["Q ?"], extras: ["openalex", "pubmed"] }).extras?.includes("pubmed"), "both are research report sources too");
});

const section = (urls: string[]) => [{ question: "Q ?", findings: urls.map((u) => ({ claim: "Le sommeil aide la mémoire", quote: "sleep helps memory", url: u, title: `Titre ${u}` })), read: 1, attempted: 1, notes: [], synthesis: false, at: 0 }];
const doneReport = (b: typeof bot, subject: string, urls: string[], updated: number) => {
  const r = createReport(b, { subject, plan: ["Q ?"], locale: "fr" }, `req-${Math.random().toString(36).slice(2, 12)}`);
  q.run("UPDATE research_reports SET state='done', sections=?, updated=? WHERE id=?", JSON.stringify(section(urls)), updated, r.id);
  return r.id;
};

test("L87 « ce qui a changé »: new and dropped sources against the last report on the same subject", () => {
  const first = doneReport(bot, "Sommeil et mémoire", ["https://a.test/1", "https://a.test/2"], Date.parse("2026-11-01"));
  const brief = briefFrom({ subject: "sommeil ET mémoire", plan: ["Q ?"], locale: "fr" });
  const prev = previousReport(bot.id, brief.subject, "none");
  assert.equal(prev?.id, first, "same subject once folded");
  const block = changesBlock(brief, section(["https://a.test/2", "https://a.test/3"]) as any, prev);
  assert.match(block, /Ce qui a changé depuis le rapport du 2026-11-01/);
  assert.match(block, /1 source\(s\) nouvelle\(s\)/);
  assert.match(block, /Titre https:\/\/a\.test\/3/);
  assert.match(block, /1 source\(s\) plus citée\(s\)/);
  assert.equal(changesBlock(brief, [] as any, null), "", "no earlier report: nothing added");
  assert.match(changesBlock(brief, section(["https://a.test/1", "https://a.test/2"]) as any, prev), /Rien de nouveau/);
});

test("L87 veille: a watched report runs again when due, with the same brief and thread; off removes it", () => {
  const id = doneReport(bot, "Veille marché vélo", ["https://v.test/1"], Date.now() - 1000);
  assert.throws(() => setWatch(stranger, id, "week"), /introuvable/);
  const w = setWatch(bot, id, "week", 1000);
  assert.equal(w.nextAt, 1000 + 7 * 86400_000);
  const made: string[] = [];
  assert.equal(runDueWatches((b, brief, request) => { made.push(`${b.id}|${brief.subject}|${request}`); return null; }, 1000), 0, "not yet due");
  assert.equal(runDueWatches((b, brief, request) => { made.push(`${b.id}|${brief.subject}|${request}`); return null; }, 1000 + 8 * 86400_000), 1);
  assert.match(made[0], new RegExp(`^${bot.id}\\|Veille marché vélo\\|watch-`));
  assert.ok(/^[a-z\d-]{8,100}$/i.test(made[0].split("|")[2]), "the request id is valid for createReport");
  assert.equal(watchOf(id, bot.id)?.every, "week");
  assert.equal(watchOf(id, stranger.id), null, "another bot never reads this report's veille");
  setWatch(bot, id, null);
  assert.equal(runDueWatches(() => { throw new Error("must not run"); }, Date.now() + 365 * 86400_000), 0);
});

test("L87 rapports passés: ranked by words, only the account's own reports", () => {
  doneReport(stranger, "Sommeil chez les pilotes", ["https://s.test/1"], Date.now());
  const hits = searchPastReports(owner.id, "sommeil mémoire");
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].subject, "Sommeil et mémoire");
  assert.ok(hits.every((h) => h.botId === bot.id), "never another account's report");
  assert.deepEqual(searchPastReports(owner.id, "tomates jardin"), []);
});

test("L87 flux Atom: valid XML at a secret address, escaped, unknown or revoked token refused", () => {
  doneReport(bot, "A <b>&</b> \"test\"", ["https://x.test/1"], Date.now());
  const token = newFeedToken(owner.id);
  const doc = atomFor(token, reportMessage as any)!;
  assert.match(doc, /^<\?xml version="1.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www.w3.org\/2005\/Atom">/);
  assert.match(doc, /<title>A &lt;b&gt;&amp;&lt;\/b&gt; &quot;test&quot;<\/title>/);
  assert.equal((doc.match(/<entry>/g) ?? []).length >= 3, true);
  assert.doesNotMatch(doc, /pilotes/, "another account's reports never appear");
  assert.equal(atomFor("x".repeat(32), reportMessage as any), null);
  const again = newFeedToken(owner.id);
  assert.equal(atomFor(token, reportMessage as any), null, "a new address revokes the old one");
  dropFeed(owner.id);
  assert.equal(atomFor(again, reportMessage as any), null);
});

test("L87 flux Atom: the public route answers without a session, 404 for a bad token", async () => {
  const { api } = await import("../src/routes.js");
  const token = newFeedToken(owner.id);
  const ok = await api.request(`/research-feed/${token}.atom`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("content-type") ?? "", /application\/atom\+xml/);
  assert.match(await ok.text(), /Sommeil et mémoire/);
  assert.equal((await api.request(`/research-feed/${"y".repeat(32)}.atom`)).status, 404);
  assert.equal((await api.request(`/research/search?q=sommeil`)).status, 401, "the search itself needs a session");
});
