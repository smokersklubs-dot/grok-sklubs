import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sklubot-issues-"));
process.env.DB_PATH = join(process.env.DATA_DIR, "test.sqlite");
process.env.SESSION_SECRET = "local-test-secret-standalone-github";
process.env.NO_SCHEDULER = "1";
process.env.HOSTED_MODE = "0";
const { q } = await import("../src/db.js");
const { bots, users, rows } = await import("../src/store.js");
const { seal } = await import("../src/auth.js");
const { registerProvider } = await import("../src/llm/index.js");
const { createIssueJob, registerGithubIssueRoutes, runGithubIssueOnce } = await import("../src/githubissues.js");
const { checkCI, openDraft, prepareChange, GitHubError } = await import("../src/githubissuegit.js");
const { githubWriteToken } = await import("../src/connectors.js");
const { GITHUB_WRITE_URL, GITHUB_READ_URL } = await import("../src/githubapp.js");

const owner = users.create("owner@example.test", "Owner", "unused", "fr");
const guest = users.create("guest@example.test", "Guest", "unused", "en");
const author = bots.create(owner.id, { name: "Jiren", model: "githubtest:author" });
const peer = bots.create(owner.id, { name: "Design", model: "githubtest:reviewer" });
const stranger = bots.create(guest.id, { name: "Guest", model: "githubtest:reviewer" });
for (const [id, who, url] of [
  ["write", owner.id, GITHUB_WRITE_URL],
  ["read", owner.id, GITHUB_READ_URL],
  ["guestwrite", guest.id, GITHUB_WRITE_URL],
]) {
  q.run(
    "INSERT INTO connectors(id,user_id,name,url,token_enc,auth,created_at) VALUES(?,?,?,?,?,'token',?)",
    id,
    who,
    id,
    url,
    seal("test-only-" + id),
    Date.now(),
  );
}
function app(as: typeof owner) {
  const api = new Hono<any>();
  api.use("*", async (c, next) => {
    c.set("user", as);
    await next();
  });
  registerGithubIssueRoutes(api, () => {});
  return api;
}
const base = "/bots/" + author.id + "/github-issues";
const post = (api: Hono<any>, data: object) =>
  api.request(base, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
const full = "demo/repo",
  url = "https://github.com/" + full + "/issues/7";
const A = "a".repeat(40),
  B = "b".repeat(40),
  C = "c".repeat(40),
  D = "d".repeat(40),
  E = "e".repeat(40);
const orig = "export const n=1;\n",
  after = "export const n=2;\n";
let calls = 0;
registerProvider({
  id: "githubtest",
  label: "test",
  available: () => true,
  models: ["author", "reviewer"],
  async runTurn(r) {
    assert.equal(r.tools.length, 0);
    calls++;
    let reply: object;
    if (r.system.includes("Select 1")) {
      assert.equal(r.model, "author");
      reply = { paths: ["src/n.ts"] };
    } else if (r.system.includes("Implement")) {
      assert.equal(r.model, "author");
      assert.match(JSON.stringify(r.messages), /const n=1/);
      reply = { files: [{ path: "src/n.ts", content: after }] };
    } else {
      assert.equal(r.model, "reviewer");
      assert.match(JSON.stringify(r.messages), /const n=2/);
      reply = { verdict: "approved", reason: "Reviewed the exact change. CI pending." };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(reply) }],
      stopReason: "end",
      model: r.model,
      usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
    };
  },
});
test("owner-only issue → two selected models → human-approved draft → offline Actions notification exactly once after a process restart", async () => {
  const mine = app(owner),
    other = app(guest);
  assert.equal((await other.request(base)).status, 404);
  await assert.rejects(githubWriteToken(guest.id, "write"));
  await assert.rejects(githubWriteToken(owner.id, "read"));
  const cfg = (await (await mine.request(base)).json()) as any;
  assert.deepEqual(
    cfg.accounts.map((a: any) => a.id),
    ["write"],
  );
  assert.deepEqual(
    cfg.reviewers.map((a: any) => a.id),
    [peer.id],
  );
  const payload = { url, reviewer: peer.id, connector: "write" };
  for (const bad of [
    { ...payload, reviewer: stranger.id },
    { ...payload, reviewer: author.id },
    { ...payload, connector: "read" },
    { ...payload, connector: "guestwrite" },
    { ...payload, url: "https://git.example/issues/7" },
  ])
    assert.equal((await post(mine, bad)).status, 422);
  const start = await post(mine, payload);
  assert.equal(start.status, 200);
  const job = (await start.json()) as { id: string; thread: number };
  assert.ok(job.thread >= 0);
  assert.deepEqual(await (await post(mine, payload)).json(), job);
  const state = () => q.get<any>("SELECT * FROM github_issue_jobs WHERE id=?", job.id)!;
  const messages = () =>
    rows
      .list(author.id, author.generation, 100, undefined, job.thread)
      .map((r) => r.body)
      .filter((b) => b.kind === "message")
      .map((b) => b.text);
  const detail = async () => (await (await mine.request(base + "?job=" + job.id)).json()) as any;
  const original = globalThis.fetch,
    writes: string[] = [];
  let branch = "",
    lost = true;
  globalThis.fetch = async (input, init) => {
    const u = new URL(String(input)),
      prefix = "/repos/" + full;
    assert.equal(u.origin, "https://api.github.com");
    assert.ok(u.pathname.startsWith(prefix));
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-only-write");
    assert.equal(init?.redirect, "error");
    const path = u.pathname.slice(prefix.length),
      body = init?.body ? JSON.parse(String(init.body)) : null;
    if (body) writes.push(path);
    const resp = (data: object, status = 200) => Response.json(data, { status });
    if (path === "/issues/7")
      return resp({ state: "open", title: "Update n", body: "Please change src/n.ts to n=2" });
    if (!path) return resp({ default_branch: "main" });
    if (path === "/git/ref/heads/main") return resp({ object: { sha: A } });
    if (path === "/git/commits/" + A) return resp({ tree: { sha: B } });
    if (path === "/git/trees/" + B)
      return resp({ tree: [{ path: "src/n.ts", mode: "100644", type: "blob", sha: C, size: orig.length }] });
    if (path === "/git/blobs/" + C)
      return resp({ encoding: "base64", content: Buffer.from(orig).toString("base64") });
    if (path === "/git/trees") {
      assert.deepEqual(body, {
        base_tree: B,
        tree: [{ path: "src/n.ts", mode: "100644", type: "blob", content: after }],
      });
      return resp({ sha: D }, 201);
    }
    if (path === "/git/commits") {
      assert.deepEqual(body.parents, [A]);
      assert.equal(body.tree, D);
      return resp({ sha: E }, 201);
    }
    if (path.startsWith("/git/ref/heads/sklubot/")) return branch ? resp({ object: { sha: E } }) : resp({}, 404);
    if (path === "/git/refs") {
      assert.equal(body.sha, E);
      assert.match(body.ref, /^refs\/heads\/sklubot\/issue-7-/);
      branch = body.ref.slice("refs/heads/".length);
      return resp({}, 201);
    }
    if (path === "/pulls" && !body) return resp([]);
    if (path === "/pulls") {
      assert.equal(body.draft, true);
      assert.equal(body.base, "main");
      assert.equal(body.head, branch);
      if (lost) {
        lost = false;
        throw new TypeError("response lost after remote write");
      }
    }
    if (path === "/actions/runs") {
      assert.equal(u.searchParams.get("head_sha"), E);
      return resp({
        total_count: 1,
        workflow_runs: [{ head_sha: E, status: "completed", conclusion: "failure", name: "Integration tests" }],
      });
    }
    throw Error("Unexpected GitHub call " + path);
  };
  try {
    await Promise.all([runGithubIssueOnce(), runGithubIssueOnce()]);
    assert.equal(state().phase, "review", state().note);
    await runGithubIssueOnce();
    assert.equal(state().phase, "approval", state().note);
    assert.deepEqual(writes, []);
    const result = await detail();
    assert.equal(result.changes[0].before, orig);
    assert.equal(result.changes[0].after, after);
    assert.equal((await post(mine, { job: job.id, decision: "approve", revision: "old" })).status, 422);
    assert.equal((await post(other, { job: job.id, decision: "approve", revision: result.revision })).status, 404);
    assert.equal(await runGithubIssueOnce(), false);
    assert.equal((await post(mine, { job: job.id, decision: "approve", revision: result.revision })).status, 200);
    assert.equal((await post(mine, { job: job.id, decision: "approve", revision: result.revision })).status, 422);
    await runGithubIssueOnce();
    assert.equal(state().phase, "publish", state().note);
    assert.equal(state().commit_sha, E);
    await runGithubIssueOnce();
    assert.equal(state().phase, "publish");
    assert.equal(state().failures, 1);
    q.run("UPDATE github_issue_jobs SET next=0,lease='expired-worker',expires=1 WHERE id=?", job.id);
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", fileURLToPath(new URL("./fixtures/github-issue-resume.ts", import.meta.url))],
      { encoding: "utf8", timeout: 60000, windowsHide: true },
    );
    assert.equal(child.status, 0, String(child.stderr) + " " + String(child.stdout));
    assert.equal(state().phase, "ci");
    q.run("UPDATE github_issue_jobs SET next=0 WHERE id=?", job.id);
    await runGithubIssueOnce();
    assert.equal(state().phase, "done", state().note);
    assert.deepEqual(writes, ["/git/trees", "/git/commits", "/git/refs", "/pulls"]);
    assert.equal(calls, 3);
    assert.equal(messages().filter((m) => m.includes("Integration tests · failure")).length, 1);
    assert.equal(messages().filter((m) => m.startsWith("Pull request en brouillon")).length, 1);
    assert.equal(await runGithubIssueOnce(), false);
  } finally {
    globalThis.fetch = original;
  }
});
test("no workflow is never reported as a pass and another writer's branch is preserved", async () => {
  const none = async () => ({ total_count: 0, workflow_runs: [] });
  assert.equal(await checkCI(none, A, Date.now()), null);
  assert.match((await checkCI(none, A, Date.now() - 20 * 60000)) ?? "", /Tests non vérifiés/);
  const requests: string[] = [];
  await assert.rejects(
    openDraft(
      async (p, b) => {
        assert.equal(b, undefined);
        requests.push(p);
        return { object: { sha: B } };
      },
      full,
      { title: "Title", body: "", sha: A, tree: B, base: "main" },
      1,
      "sklubot/test",
      C,
    ),
    /branche a changé/,
  );
  assert.ok(requests.every((p) => p.startsWith("/git/ref/")));
});
test("output file must be one of the inspected regular text files; a hidden or truncated path cannot masquerade as new", async () => {
  const ctx = { title: "Work", body: "", base: "main", sha: A, tree: B };
  const list = async (p: string) => (p.includes("?recursive") ? { tree: [], truncated: true } : { type: "file" });
  for (const file of [".github/workflows/build.yml", "secret.pem", "../out", "existing.txt"])
    await assert.rejects(
      prepareChange(
        list,
        ctx,
        async () => ({ paths: [file] }),
        (s) => s,
      ),
    );
  const get = async (p: string) => {
    if (p.includes("?recursive")) return { tree: [], truncated: true };
    throw new GitHubError(404);
  };
  await assert.rejects(
    prepareChange(
      get,
      ctx,
      async (s) => (s.includes("Select") ? { paths: ["ok.ts"] } : { files: [{ path: "other.ts", content: "x" }] }),
      (s) => s,
    ),
    /hors/,
  );
});
