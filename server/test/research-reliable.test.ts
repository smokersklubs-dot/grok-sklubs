import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// L87 « Recherche approfondie fiable »: publication date and time window, relevance floor, per-source state (never
// « nobody talks about it » when a source failed), engagement ranking, Hacker News and Polymarket (local fixtures of
// their public JSON), Reddit and YouTube through a scripted Agent Reach. No model, no real network.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sklubot-research-l87-"));
process.env.DB_PATH = ":memory:";
process.env.NO_SCHEDULER = "1";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.HOSTED_MODE = "0";
process.env.SESSION_SECRET = "research-l87-isolated-secret-000000";
process.env.X_BEARER_TOKEN = "";
process.env.XAI_API_KEY = "";

const DAY = 86400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
const unix = (daysAgo: number) => Math.floor((Date.now() - daysAgo * DAY) / 1000);
const hnQueries: string[] = [];
let hnDown = false;
const page = (title: string, date: string | null, body: string) =>
  `<html><head><title>${title}</title>${date ? `<meta property="article:published_time" content="${date}">` : ""}</head><body><p>${body}</p></body></html>`;
const fixture = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const json = (v: unknown, status = 200) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(v));
  if (url.pathname === "/api/v1/search") {
    hnQueries.push(url.search);
    if (hnDown) return json({ message: "slow down" }, 429);
    return json({
      hits: [
        { objectID: "101", title: "Bun 2 runtime ships a faster bundler for TypeScript projects", points: 412, num_comments: 96, created_at_i: unix(3) },
        { objectID: "102", title: "Bun runtime bundler question with one vote only here", points: 1, num_comments: 0, created_at_i: unix(2) },
      ],
    });
  }
  if (url.pathname === "/public-search")
    return json({
      events: [
        { id: "e1", slug: "bun-2-release", title: "Bun runtime release", closed: false, markets: [{ question: "Will the Bun runtime bundler reach version 2 before 2027?", outcomes: '["Yes","No"]', outcomePrices: '["0.62","0.38"]', volumeNum: 120000, active: true, closed: false }] },
        { id: "e2", slug: "closed", title: "Closed", closed: true, markets: [] },
      ],
    });
  if (url.pathname === "/fresh") return res.writeHead(200, { "Content-Type": "text/html" }).end(page("Bun runtime news", iso(5), "The Bun runtime bundler now compiles TypeScript projects twice as fast as before."));
  if (url.pathname === "/old") return res.writeHead(200, { "Content-Type": "text/html" }).end(page("Bun runtime in 2021", "2021-03-04T10:00:00Z", "The Bun runtime bundler is an early experiment for TypeScript projects."));
  if (url.pathname === "/undated") return res.writeHead(200, { "Content-Type": "text/html" }).end(page("Bun notes", null, "Notes on the Bun runtime bundler for TypeScript projects and their builds."));
  if (url.pathname === "/offtopic") return res.writeHead(200, { "Content-Type": "text/html" }).end(page("Gardening", iso(1), "Tomatoes need sunlight and regular watering during the summer months."));
  res.writeHead(404).end();
});
await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
after(() => fixture.close());
const addr = fixture.address();
assert(addr && typeof addr !== "string");
const site = "http://127.0.0.1:" + addr.port;
process.env.RESEARCH_HN_BASE = site;
process.env.RESEARCH_POLYMARKET_BASE = site;

const { users, bots } = await import("../src/store.js");
const { browseSection } = await import("../src/researchreports.js");
const { reportMessage } = await import("../src/researchsection.js");
const { briefFrom } = await import("../src/researchevidence.js");
const { relevance, windowFromText, publishedDate, inWindow, rankScore, RELEVANCE_FLOOR, isoDay } = await import("../src/researchsignals.js");
const { setReachRunner } = await import("../src/reach.js");
const owner = users.create("research-l87@test.local", "A", "unused", "fr");
const bot = bots.create(owner.id, { name: "Chercheur" });
const reach = (channel: string) =>
  channel === "reddit"
    ? { ok: false, channel, error: { code: "RATE_LIMITED", message: "429" } }
    : { ok: true, channel, items: [{ title: "Bun runtime bundler review for TypeScript projects", url: "https://www.youtube.com/watch?v=abc", text: "A review of the Bun runtime bundler for TypeScript projects in practice.", published_at: iso(4), view_count: 52000 }] };
setReachRunner(async (_b, _u, argv) => ({ code: 0, stdout: JSON.stringify(reach(argv[0])), stderr: "", timedOut: false }));
after(() => setReachRunner(null));

test("signals: relevance floor, window words, publication dates, ranking by engagement", () => {
  assert.ok(relevance("Bun runtime bundler", "The Bun runtime bundler is fast") > 0.5);
  assert.ok(relevance("Bun runtime bundler", "Tomatoes need sunlight") < RELEVANCE_FLOOR);
  assert.ok(relevance("dernières nouvelles de Bun", "les dernières nouvelles du jour") <= 0.24, "generic words alone stay under the usual threshold");
  assert.equal(windowFromText("Quoi de neuf ce mois-ci sur Bun ?"), "month");
  assert.equal(windowFromText("Ce qui a changé cette semaine"), "week");
  assert.equal(windowFromText("Histoire de Bun"), "any");
  assert.equal(publishedDate('<meta property="article:published_time" content="2026-11-03T08:00:00+01:00">'), "2026-11-03");
  assert.equal(publishedDate('<script type="application/ld+json">{"datePublished":"2025-06-01"}</script>'), "2025-06-01");
  assert.equal(publishedDate('<time datetime="2024-02-10">10 février</time>'), "2024-02-10");
  assert.equal(publishedDate("<p>pas de date</p>"), undefined);
  assert.equal(isoDay("20261103"), "2026-11-03");
  assert.equal(inWindow(isoDay(iso(5)), "month"), true);
  assert.equal(inWindow("2021-03-04", "month"), false);
  assert.equal(inWindow(undefined, "month"), null);
  assert.equal(inWindow("2021-03-04", "any"), true);
  const d = isoDay(iso(3));
  assert.ok(rankScore(0.6, d, { points: 400, comments: 90 }, "month") > rankScore(0.6, d, { points: 1 }, "month"));
  assert.ok(rankScore(0.6, d, undefined, "month") > rankScore(0.6, "2021-01-01", undefined, "month"));
});

test("brief: « ce mois-ci » sets the window, unknown sources are dropped, an explicit window wins", () => {
  const b = briefFrom({ subject: "Bun", plan: ["Quoi de neuf ce mois-ci ?"], extras: ["hn", "tiktok" as any, "hn"], discover: true });
  assert.equal(b.window, "month");
  assert.deepEqual(b.extras, ["hn"]);
  assert.equal(briefFrom({ subject: "Bun ce mois-ci", plan: ["Q ?"], window: "year" }).window, "year");
  assert.equal(briefFrom({ subject: "Bun", plan: ["Q ?"] }).window, "any");
  assert.doesNotThrow(() => briefFrom({ subject: "Bun", plan: ["Q ?"], discover: false, extras: ["polymarket"] }));
});

test("one question: old and off-topic pages set aside, per-source states, dates and engagement on findings", async () => {
  const brief = briefFrom({
    subject: "Bun runtime bundler",
    plan: ["What changed for TypeScript projects this month?"],
    seeds: [site + "/fresh", site + "/old", site + "/offtopic", site + "/undated", site + "/missing"],
    discover: false,
    extras: ["hn", "polymarket", "reddit", "youtube"],
    locale: "fr",
  });
  assert.equal(brief.window, "month");
  const s = await browseSection(bot, brief, brief.plan[0]);
  const state = Object.fromEntries((s.sources ?? []).map((x) => [x.source, x.state]));
  assert.deepEqual(state, { web: "ok", hn: "ok", polymarket: "ok", reddit: "rate_limited", youtube: "ok" });
  assert.equal(s.sources!.find((x) => x.source === "hn")!.count, 1, "the 1-point story is filtered like upstream MIN_STORY_POINTS");
  assert.match(hnQueries[0], /numericFilters=created_at_i/);
  assert.equal(s.outOfWindow, 1);
  assert.ok((s.offTopic ?? 0) >= 1);
  assert.equal(s.undated, 1);
  const urls = s.findings.map((f) => f.url);
  assert.ok(!urls.includes(site + "/old"), "a 2021 page is never presented as current");
  assert.ok(!urls.includes(site + "/offtopic"));
  assert.ok(urls.length > 4 || urls.length >= 3, "several sources contribute");
  const hn = s.findings.find((f) => f.url.includes("news.ycombinator.com"));
  assert.ok(hn, "the Hacker News story is cited");
  assert.match(hn!.engagement ?? "", /412 points/);
  assert.ok(hn!.published);
  assert.equal(s.findings[0].url, hn!.url, "most discussed and relevant first");
  const pm = s.findings.find((f) => f.url.includes("polymarket.com/event/bun-2-release"));
  assert.ok(pm, "the open market is cited");
  assert.match(pm!.quote + pm!.engagement, /parieurs|misés/);
  const text = reportMessage(brief, [s]);
  assert.match(text, /Période : 30 derniers jours/);
  assert.match(text, /publié le \d{4}-\d{2}-\d{2}/);
  assert.match(text, /Reddit limite de débit/);
  assert.match(text, /publiée\(s\) avant la période/);
});

test("honest empty: a failed source forbids « personne n'en parle »; all answered and nothing recent says so", async () => {
  hnDown = true;
  const brief = briefFrom({ subject: "Zyxwv quantum teapot", plan: ["Who uses the zyxwv teapot this week?"], discover: false, extras: ["hn"], locale: "fr" });
  const down = await browseSection(bot, brief, brief.plan[0]);
  assert.equal(down.findings.length, 0);
  assert.deepEqual(down.sources, [{ source: "hn", state: "rate_limited", count: 0 }]);
  assert.ok(down.notes.some((n) => /Impossible de dire que personne n’en parle/.test(n)));
  hnDown = false;
  const quiet = await browseSection(bot, { ...brief, extras: ["youtube"] }, "Zyxwv teapot thermal behaviour?");
  assert.equal(quiet.findings.length, 0);
  assert.ok(quiet.notes.some((n) => /Rien de solide sur la période \(7 derniers jours\)/.test(n)), quiet.notes.join(" | "));
  assert.ok(!quiet.notes.some((n) => /Impossible de dire/.test(n)));
});
