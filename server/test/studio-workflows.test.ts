import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { Card } from "../src/shared.js";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sklubot-workflows-"));
process.env.DB_PATH = ":memory:";
process.env.SESSION_SECRET = "workflow-tests-local-secret-000000";
process.env.NO_SCHEDULER = "1";
process.env.HOSTED_MODE = "0";
process.env.DEFAULT_MODEL = "workflow-test:review";
const { users, bots, rows } = await import("../src/store.js");
const { q } = await import("../src/db.js");
const { claimExport, enqueueExport, drainExports, ownedExport } = await import("../src/studioqueue.js");
const { storeBytes } = await import("../src/computer.js");
const { storyFor } = await import("../src/videostudio.js");
const { reviewChanges, parseReview } = await import("../src/peerreview.js");
const { registerProvider } = await import("../src/llm/index.js");
const { snapRunner } = await import("../src/snapshots.js");
const { registerGithubActivity } = await import("../src/githubactivity.js");
const { githubActionsRead } = await import("../src/connectors.js");
const owner = users.create("workflow@example.test", "User", "unused", "fr");
const bot = bots.create(owner.id, { name: "Author", model: "workflow-test:review" });
const peer = bots.create(owner.id, { name: "Reviewer", model: "workflow-test:review" });
const other = users.create("other@example.test", "Other", "unused", "en");
const story = {
  title: "T",
  aspect: "wide",
  audio: "",
  muted: false,
  offset: 0,
  scenes: [{ text: "Hello", style: "type", seconds: 1, media: "" }],
};
let reviewPrompt = "";
registerProvider({
  id: "workflow-test",
  label: "test",
  available: () => true,
  models: ["review"],
  async runTurn(req) {
    if (req.system.includes("Independently review")) {
      assert.equal(req.tools.length, 0);
      reviewPrompt = JSON.stringify(req.messages);
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ verdict: "approved", reason: "Observed diff." }) }],
      stopReason: "end",
      model: "review",
      usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
    };
  },
});

test("interrupted exports are reclaimed, deduplicated and delivered once", async () => {
  const put = () => enqueueExport(bot, "artifact", 1, 0, false, "fr", "fr", story);
  const first = put();
  assert.equal(put().id, first.id);
  assert.equal(ownedExport(peer, first.id), null);
  const dead = claimExport();
  assert.equal(dead?.id, first.id);
  assert.equal(claimExport(), undefined);
  q.run("UPDATE studio_exports SET expires=0 WHERE id=?", first.id);
  let calls = 0;
  drainExports(async () => {
    calls++;
    return storeBytes(bot.id, "exports", "test.mp4", Buffer.from("test"));
  });
  for (let i = 0; i < 100 && ownedExport(bot, first.id)?.state !== "ready"; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 1);
  assert.equal(put().state, "ready");
  assert.equal(q.get<{ n: number }>("SELECT attempts n FROM studio_exports WHERE id=?", first.id)?.n, 2);
  assert.equal(
    rows.list(bot.id, bot.generation).filter((r) => r.body.kind === "message" && r.body.attachments?.length)
      .length,
    1,
  );
});
test("a replaced line belongs only to its speaker and its desktop", () => {
  const line = (speaker: string) => ({
    speaker,
    text: speaker,
    voice: "",
    path: storeBytes(bot.id, "audio", speaker + ".wav", Buffer.alloc(50)).path,
  });
  const one = line("Alice"),
    two = line("Bob"),
    next = line("Alice2");
  const cut = {
    ...story,
    scenes: [
      { ...story.scenes[0], speech: one },
      { ...story.scenes[0], speech: two },
    ],
  };
  assert.equal(storyFor(peer.id, cut), null);
  const mixed = storyFor(bot.id, cut)!;
  assert.equal(mixed.scenes[1].speech?.path, two.path);
  mixed.scenes[0].speech = next;
  assert.equal(storyFor(bot.id, mixed)?.scenes[1].speech?.path, two.path);
  assert.equal(
    storyFor(bot.id, {
      ...cut,
      scenes: [{ ...cut.scenes[0], speech: { ...one, path: "audio/../secret.wav" } }],
    }),
    null,
  );
});
test("an independent bot sees a bounded diff and test evidence, with a verdict on the source card", async (t) => {
  const card: Extract<Card, { type: "files" }> = {
    type: "files",
    baseId: "before",
    snapId: "after",
    status: "available",
    more: 0,
    files: [
      { path: "changed.ts", change: "modified", added: 1, removed: 0, binary: false, oldSize: 8, newSize: 12 },
    ],
  };
  rows.append(bot, {
    kind: "step",
    callId: "test",
    tool: "run",
    label: "test",
    status: "done",
    args: { command: "npm test" },
    summary: "15 tests passed",
  });
  const row = rows.append(bot, { kind: "card", card });
  t.mock.method(snapRunner, "any", async () => ({
    code: 0,
    stdout: Buffer.from("+const answer = 42;"),
    stderr: "",
  }));
  const review = await reviewChanges(bot, peer, row, card, "fr");
  assert.equal(review.verdict, "approved");
  assert.match(reviewPrompt, /answer = 42/);
  assert.match(reviewPrompt, /15 tests passed/);
  const { startPeerReview, peerReviewStatus } = await import("../src/peerreviewstore.js");
  startPeerReview(bot, peer, row, card, "fr");
  for (let i = 0; i < 50 && peerReviewStatus(bot, row.seq).state === "working"; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(peerReviewStatus(bot, row.seq).review?.verdict, "approved");
  assert.equal(peerReviewStatus(peer, row.seq).state, "none");
  assert.doesNotMatch(JSON.stringify(rows.get(bot.id, row.generation, row.seq)), /Observed diff/);
  await assert.rejects(reviewChanges(bot, bot, row, card, "fr"));
  assert.equal(parseReview('{"verdict":"approved","reason":"ok"}', true).verdict, "inconclusive");
  assert.throws(() => parseReview("ok", false));
});
test("account-scoped GitHub watches open the same thread with the specific failing job and step", async (t) => {
  const app = new Hono<any>();
  let who = owner;
  app.use("*", async (c, next) => {
    c.set("user", who);
    await next();
  });
  registerGithubActivity(app, () => {});
  const seen: string[] = [];
  const run = {
    id: 17,
    name: "CI",
    head_branch: "feature",
    head_sha: "a".repeat(40),
    conclusion: "failure",
    updated_at: "2026-10-01",
    run_attempt: 1,
    pull_requests: [{ number: 3 }],
  };
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(new URL(url).origin, "https://api.github.com");
    assert.equal(new Headers(init.headers).has("authorization"), false);
    seen.push(url);
    return Response.json(
      url.includes("/jobs?")
        ? {
            jobs: [
              { name: "linux", conclusion: "failure", steps: [{ name: "unit tests", conclusion: "failure" }] },
            ],
          }
        : url.endsWith("/17")
          ? run
          : { workflow_runs: [run] },
    );
  });
  const base = "/bots/" + bot.id + "/github-activity";
  const call = (p: string, body?: unknown) =>
    app.request(
      base + p,
      body
        ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        : {},
    );
  assert.equal((await call("", { repo: "https://github.com/Example/App" })).status, 200);
  const feed = await (await call("/events")).json();
  assert.equal(feed.results[0].events[0].pr, 3);
  const first = await (await call("/explain", { repo: "example/app", run: 17 })).json();
  assert.ok(first.seq);
  assert.deepEqual(await (await call("/explain", { repo: "example/app", run: 17 })).json(), first);
  assert.ok(seen.some((s) => s.endsWith("/attempts/1/jobs?per_page=100")));
  assert.equal((await call("", { repo: "example/app", connector: "another-account" })).status, 400);
  await assert.rejects(githubActionsRead(other.id, "foreign", "example/app", "runs?per_page=1"));
  who = other;
  assert.equal((await call("/events")).status, 404);
  who = owner;
  await call("", { repo: "example/app", remove: true });
  assert.equal((await call("/explain", { repo: "example/app", run: 17 })).status, 404);
});

test("private Actions uses only the owning account's official connection and observes disconnect", async (t) => {
  const { seal } = await import("../src/auth.js");
  const { GITHUB_READ_URL } = await import("../src/githubapp.js");
  q.run(
    "INSERT INTO connectors(id,user_id,name,url,token_enc,auth,created_at) VALUES(?,?,?,?,?,?,?)",
    "github-test-connector",
    owner.id,
    "GitHub test",
    GITHUB_READ_URL,
    seal("synthetic-owner-credential"),
    "token",
    Date.now(),
  );
  let n = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    ++n;
    assert.equal(url, "https://api.github.com/repos/example/private/actions/runs?per_page=1");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer synthetic-owner-credential");
    assert.equal(init.redirect, "error");
    return Response.json({ workflow_runs: [] });
  });
  await assert.rejects(
    githubActionsRead(other.id, "github-test-connector", "example/private", "runs?per_page=1"),
  );
  await githubActionsRead(owner.id, "github-test-connector", "example/private", "runs?per_page=1");
  q.run("DELETE FROM connectors WHERE id=?", "github-test-connector");
  await assert.rejects(
    githubActionsRead(owner.id, "github-test-connector", "example/private", "runs?per_page=1"),
  );
  assert.equal(n, 1);
});
