import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Hono } from "hono";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sklubot-research-"));
process.env.DB_PATH = ":memory:";
process.env.NO_SCHEDULER = "1";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.HOSTED_MODE = "0";
process.env.SESSION_SECRET = "research-test-isolated-secret-000000";
process.env.X_BEARER_TOKEN = "";
process.env.XAI_API_KEY = "";
const fixture = createServer((req, res) => {
  if (req.url?.startsWith("/2/tweets/")) {
    assert.equal(req.headers.authorization, "Bearer x-fake-bearer-1234");
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(
        JSON.stringify({
          data: [{ id: "1", text: "A lunar telescope measures lunar dust.", author_id: "1" }],
          includes: { users: [{ id: "1", username: "test" }] },
        }),
      );
    return;
  }
  if (req.url === "/none") {
    res.writeHead(404).end();
    return;
  }
  res
    .writeHead(200, { "Content-Type": "text/html" })
    .end(
      "<title>Lunar mission</title><p>A lunar telescope measures the dust from the surface. The orbital vehicle carries the lunar telescope into space.</p>",
    );
});
await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
after(() => fixture.close());
const addr = fixture.address();
assert(addr && typeof addr !== "string");
const site = "http://127.0.0.1:" + addr.port;
process.env.X_API_BASE_URL = site;
const { users, bots, rows } = await import("../src/store.js");
const { q } = await import("../src/db.js");
const { registerResearch } = await import("../src/researchroutes.js");
const { nextResearchSection, browseSection } = await import("../src/researchreports.js");
const { checkedFindings, extractEvidence } = await import("../src/researchevidence.js");
const { xSearch } = await import("../src/xsearch.js");
const owner = users.create("research@test.local", "A", "unused", "en"),
  other = users.create("research2@test.local", "B", "unused", "en");
const bot = bots.create(owner.id, { name: "Researcher" });
const app = new Hono<any>();
app.use("*", async (c, next) => {
  c.set("user", c.req.header("identity") === "other" ? other : owner);
  await next();
});
registerResearch(app);
const call = (method: string, path: string, body?: unknown, identity = "owner") =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json", identity },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const path = "/bots/" + bot.id + "/research";

test("verified quotes reject invented evidence and out-of-range sources", () => {
  const page = {
    url: "https://example.org/lunar",
    title: "Research",
    text: "The lunar telescope measures dust.",
  };
  const candidate = (source: number, quote: string) => ({ source, claim: "It measures dust.", quote });
  const r = checkedFindings(
    JSON.stringify([
      candidate(1, "lunar telescope measures dust."),
      candidate(2, page.text),
      candidate(1, "The telescope measures gravity."),
    ]),
    [page],
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].url, page.url);
});
test("a generic sentence that shares only a product name and the word support is not evidence", () => {
  const q = "Can SQLite support multiple simultaneous read transactions and write transactions?";
  assert.deepEqual(
    extractEvidence(q, [
      { url: "https://example.org/sql", title: "SQL", text: "SQLite does not support this." },
    ]),
    [],
  );
});
test("report checkpoints survive connection loss and worker interruption, and publish one sourced report", async () => {
  const brief = {
    subject: "Lunar telescope",
    plan: ["What does the lunar telescope measure?", "Unicorn meteorologists?"],
    seeds: [site + "/page", site + "/none"],
    model: false,
    discover: false,
    requestId: "request-1234",
  };
  assert.equal((await call("POST", path, brief, "other")).status, 404);
  const first = await call("POST", path, brief);
  assert.equal(first.status, 201);
  const id = ((await first.json()) as any).id;
  assert.equal(((await (await call("POST", path, brief)).json()) as any).id, id);
  assert.equal(await nextResearchSection(), true);
  assert.equal(
    await nextResearchSection(async () => {
      throw new Error("worker interrupted");
    }),
    true,
  );
  const partial = ((await (await call("GET", path)).json()) as any).reports[0];
  assert.equal(partial.state, "interrupted");
  assert.equal(partial.sections.length, 1);
  assert.equal(partial.sections[0].findings[0].url, site + "/page");
  assert.ok(partial.sections[0].notes.some((s: string) => s.includes("inaccessible")));
  assert.equal((await call("POST", path + "/" + id + "/continue", undefined, "other")).status, 404);
  assert.equal((await call("POST", path + "/" + id + "/continue")).status, 200);
  q.run("UPDATE research_reports SET lease='abandoned',expires=1 WHERE id=?", id);
  let runs = 0;
  await Promise.all([
    nextResearchSection(async (...args) => {
      runs++;
      return browseSection(...args);
    }),
    nextResearchSection(async (...args) => {
      runs++;
      return browseSection(...args);
    }),
  ]);
  assert.equal(runs, 1);
  const final = ((await (await call("GET", path)).json()) as any).reports[0];
  assert.equal(final.state, "done");
  assert.equal(final.sections.length, 2);
  assert.equal(final.sections[1].findings.length, 0);
  assert.equal(final.sections[0].at, partial.sections[0].at);
  const messages = rows
    .list(bot.id, bot.generation, 100)
    .filter((r) => r.body.kind === "message" && r.body.text.includes("1/2 questions"));
  assert.equal(messages.length, 1);
  assert.equal((await call("GET", path, undefined, "other")).status, 404);
});
test("account-specific X settings are encrypted, can be revoked and never returned as credentials", async () => {
  assert.equal((await call("PUT", "/research/x-account", { token: "x-fake-bearer-1234" })).status, 200);
  const status = await (await call("GET", "/research/x-account")).json();
  assert.deepEqual(status, { personal: true, provider: "x" });
  assert.deepEqual(await (await call("GET", "/research/x-account", undefined, "other")).json(), {
    personal: false,
    provider: null,
  });
  assert.ok(!JSON.stringify(q.get("SELECT * FROM research_x_accounts")).includes("x-fake-bearer-1234"));
  assert.equal(
    (await xSearch({ query: "lunar" }, AbortSignal.timeout(1000), owner.id)).posts[0].author,
    "test",
  );
  await call("DELETE", "/research/x-account");
  assert.deepEqual(await (await call("GET", "/research/x-account")).json(), {
    personal: false,
    provider: null,
  });
});
