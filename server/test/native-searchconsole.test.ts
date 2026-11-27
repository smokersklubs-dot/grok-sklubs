import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L166 — the built-in « Search Console » app (native/searchconsole.ts): read-only Search Console with the owner's own
// Google OAuth client, PageSpeed with no token, and IndexNow as a write that asks. Against a local fake of the APIs.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-gsc-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.ALLOW_PRIVATE_FETCH = "1";

const seen: { method: string; url: string; auth: string; body: string }[] = [];
const fake = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    seen.push({ method: req.method!, url: req.url!, auth: String(req.headers.authorization ?? ""), body });
    const json = (status: number, j: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    if (req.url === "/webmasters/v3/sites") return json(200, { siteEntry: [{ siteUrl: "sc-domain:boutique.example", permissionLevel: "siteOwner" }] });
    if (req.url?.startsWith("/webmasters/v3/sites/sc-domain%3Aboutique.example/searchAnalytics/query")) return json(200, { rows: [{ keys: ["savon artisanal"], clicks: 42, impressions: 900, ctr: 0.0467, position: 7.3 }] });
    if (req.url?.endsWith("/sitemaps")) return json(200, { sitemap: [{ path: "https://boutique.example/sitemap.xml", lastSubmitted: "2026-11-01", lastDownloaded: "2026-11-20", errors: 0, warnings: 1 }] });
    if (req.url === "/v1/urlInspection/index:inspect") return json(200, { inspectionResult: { indexStatusResult: { verdict: "NEUTRAL", coverageState: "Discovered - currently not indexed", indexingState: "INDEXING_ALLOWED", robotsTxtState: "ALLOWED", pageFetchState: "SUCCESSFUL", lastCrawlTime: "2026-11-18T10:00:00Z", googleCanonical: "https://boutique.example/a" } } });
    if (req.url?.startsWith("/pagespeedonline/v5/runPagespeed")) return json(200, { lighthouseResult: { categories: { performance: { score: 0.91 }, accessibility: { score: 0.88 }, seo: { score: 1 } }, audits: { "largest-contentful-paint": { displayValue: "1.9 s" }, "cumulative-layout-shift": { displayValue: "0.02" }, "total-blocking-time": { displayValue: "80 ms" } } }, loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100, category: "FAST" } } } });
    if (req.url === "/indexnow") { res.writeHead(202); return res.end(); }
    res.writeHead(404); res.end();
  });
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
const base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
process.env.GOOGLE_API_URL = base;
process.env.INDEXNOW_API_URL = `${base}/indexnow`;

const sc = await import("../src/native/searchconsole.js");
const { accounts } = await import("../src/native/accounts.js");
const { appsFor, appOf } = await import("../src/native/vendors.js");
const { nativeToolsFor, runNativeTool, toolsOfApp } = await import("../src/native/tools.js");
const { users, bots } = await import("../src/store.js");
const { q } = await import("../src/db.js");
const { seal } = await import("../src/auth.js");

test("the app: Google vendor, read-only Search Console scope, in both languages, in the catalogue", () => {
  const app = appOf("searchconsole")!;
  assert.equal(app.vendor, "google");
  assert.deepEqual(app.scopes, ["https://www.googleapis.com/auth/webmasters.readonly", "openid", "email"]);
  assert.match(appsFor("fr").find((a) => a.id === "searchconsole")!.description, /avec ton accord/);
  const risks = Object.fromEntries(toolsOfApp("searchconsole").map((t) => [t.action, t.risk]));
  assert.deepEqual(risks, { sc_sites: "read", sc_search_analytics: "read", sc_sitemaps: "read", sc_inspect_url: "read", pagespeed: "read", indexnow_submit: "write" });
});

test("requests are cleaned: properties, dates (28 days ending 3 days ago), dimensions, IndexNow host rule", () => {
  assert.equal(sc.cleanProperty("sc-domain:Boutique.example"), "sc-domain:boutique.example");
  assert.equal(sc.cleanProperty("https://boutique.example"), "https://boutique.example/");
  assert.throws(() => sc.cleanProperty("ftp://x"));
  const b = sc.analyticsBody({ dimensions: ["page", "nope", "query"], limit: 5000 }, new Date("2026-11-22T12:00:00Z"));
  assert.deepEqual(b, { startDate: "2026-10-23", endDate: "2026-11-19", dimensions: ["page", "query"], rowLimit: 1000, type: "web" });
  assert.throws(() => sc.analyticsBody({ start_date: "2026-11-10", end_date: "2026-11-01" }));
  const ok = sc.indexNowBody({ urls: ["https://boutique.example/a", "https://boutique.example/a", "https://boutique.example/b"], key: "abcd1234efgh", key_location: "https://boutique.example/abcd1234efgh.txt" });
  assert.deepEqual(ok, { host: "boutique.example", key: "abcd1234efgh", keyLocation: "https://boutique.example/abcd1234efgh.txt", urlList: ["https://boutique.example/a", "https://boutique.example/b"] });
  assert.throws(() => sc.indexNowBody({ urls: ["https://other.example/a"], key: "abcd1234efgh", key_location: "https://boutique.example/k.txt" }), /not on boutique\.example/);
  assert.throws(() => sc.indexNowBody({ urls: ["https://boutique.example/a"], key: "short", key_location: "https://boutique.example/k.txt" }), /IndexNow key/);
});

test("a signed-in account: the bot reads sites, search data, sitemaps, inspection and PageSpeed; IndexNow sends only what was asked", async () => {
  const user = users.create("gsc@example.com", "GSC", "x", "fr");
  const bot = bots.create(user.id, { name: "Victor" });
  const acc = accounts.create(user.id, "searchconsole", "boutique");
  q.run("UPDATE native_accounts SET status = 'ready', tokens_enc = ? WHERE id = ?", seal(JSON.stringify({ access: "fake-access-token", expiresAt: Date.now() + 3_600_000 })), acc.id);
  const names = nativeToolsFor(user.id).filter((t) => t.accountId === acc.id).map((t) => t.spec.name);
  assert.ok(names.includes("searchconsole_boutique__sc_search_analytics"), names.join(", "));
  const run = (action: string, args: Record<string, unknown>) => runNativeTool(acc.id, action, args, { botId: bot.id });

  assert.match((await run("sc_sites", {})).text, /sc-domain:boutique\.example \(siteOwner\)/);
  const sa = await run("sc_search_analytics", { site: "sc-domain:boutique.example", start_date: "2026-10-01", end_date: "2026-10-28" });
  assert.match(sa.text, /savon artisanal · 42 clicks · 900 impressions · CTR 4\.7 % · position 7\.3/);
  const call = seen.find((s) => s.url.includes("searchAnalytics"))!;
  assert.equal(call.method, "POST"); assert.equal(call.auth, "Bearer fake-access-token");
  assert.deepEqual(JSON.parse(call.body), { startDate: "2026-10-01", endDate: "2026-10-28", dimensions: ["query"], rowLimit: 25, type: "web" });
  assert.match((await run("sc_sitemaps", { site: "sc-domain:boutique.example" })).text, /sitemap\.xml · submitted 2026-11-01 · read 2026-11-20 · 0 errors, 1 warnings/);
  const insp = await run("sc_inspect_url", { site: "sc-domain:boutique.example", url: "https://boutique.example/a" });
  assert.match(insp.text, /Discovered - currently not indexed/);

  const ps = await run("pagespeed", { url: "https://boutique.example/" });
  assert.match(ps.text, /performance 91 · accessibility 88 · SEO 100/);
  assert.match(ps.text, /LCP 2100 ms \(FAST\)/);
  const psCall = seen.find((s) => s.url.startsWith("/pagespeedonline"))!;
  assert.equal(psCall.auth, "", "no Google token goes to PageSpeed");
  assert.match(psCall.url, /strategy=mobile/);

  const ix = await run("indexnow_submit", { urls: ["https://boutique.example/a"], key: "abcd1234efgh", key_location: "https://boutique.example/abcd1234efgh.txt" });
  assert.match(ix.text, /accepted .* 1 page\(s\) of boutique\.example/);
  const ixCall = seen.find((s) => s.url === "/indexnow")!;
  assert.equal(ixCall.auth, "", "no Google token goes to IndexNow");
  assert.deepEqual(JSON.parse(ixCall.body).urlList, ["https://boutique.example/a"]);
  fake.close();
});
