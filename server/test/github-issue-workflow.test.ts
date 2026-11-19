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
const { registerGithubIssueRoutes, runGithubIssueOnce } = await import("../src/githubissues.js");
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
      const payload = JSON.parse((r.messages[0].content[0] as {text: string}).text);
      assert.equal(payload.stage, "independent_review_before_publication");
      assert.equal(payload.origin.defaultBranch, "main");
      assert.equal(payload.origin.commit, A);
      assert.equal(payload.origin.tree, B);
      assert.ok(payload.origin.repository.includes("/"));
      assert.match(r.system, /before|precedes human approval/);
      reply = { verdict: "approved", reason: "Reviewed the exact change. CI pending." };
    }
    return {
      content: [{ type: "text", text: "Voici le résultat.\n```json\n" + JSON.stringify(reply) + "\n```" }],
      stopReason: "end",
      model: r.model,
      usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
    };
  },
});
test(
  "owner-only issue → two selected models → human-approved draft → offline Actions notification exactly once after a process restart",
  { timeout: 660_000 },
  async () => {
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
          workflow_runs: [
            { id: 71, head_sha: E, status: "completed", conclusion: "failure", name: "Integration tests" },
          ],
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
      assert.equal(
        (await post(other, { job: job.id, decision: "approve", revision: result.revision })).status,
        404,
      );
      assert.equal(await runGithubIssueOnce(), false);
      assert.equal(
        (await post(mine, { job: job.id, decision: "approve", revision: result.revision })).status,
        200,
      );
      assert.equal(
        (await post(mine, { job: job.id, decision: "approve", revision: result.revision })).status,
        422,
      );
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
        { encoding: "utf8", timeout: 600_000, windowsHide: true },
      );
      assert.equal(child.status, 0, [child.error?.message, child.stderr, child.stdout].filter(Boolean).join(" "));
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
  },
);
test("no workflow is never reported as a pass and another writer's branch is preserved", async () => {
  const none = async () => ({ total_count: 0, workflow_runs: [] });
  assert.equal((await checkCI(none, A, Date.now())).text, null);
  assert.match((await checkCI(none, A, Date.now() - 20 * 60000)).text ?? "", /Tests non vérifiés/);
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

test("public ticket is reviewed in its original thread without credentials, then explicitly bound and approved again", async () => {
  const mine = app(owner),
    repo = "demo/public",
    original = globalThis.fetch;
  const root = rows.append(author, { kind: "message", role: "user", text: "Can you fix this ticket?" }, 0);
  const submit = (suffix: string) =>
    post(mine, { url: "https://github.com/demo/" + suffix + "/issues/8", reviewer: peer.id, thread: root.seq });
  let allow = false,
    authorizedReads = 0,
    writes = 0,
    privateReads = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)),
      auth = new Headers(init?.headers).get("authorization");
    assert.equal(url.origin, "https://api.github.com");
    if (init?.method !== "GET") {
      writes++;
      throw Error("No writes during review or binding");
    }
    if (url.pathname.startsWith("/repos/demo/private")) {
      assert.equal(auth, null);
      privateReads++;
      return Response.json({ message: "Not found" }, { status: 404 });
    }
    const path = url.pathname.slice(("/repos/" + repo).length);
    if (auth !== null) {
      assert.equal(auth, "Bearer test-only-write");
      authorizedReads++;
      assert.equal(path, "");
      return Response.json({ full_name: repo, permissions: { push: allow } });
    }
    if (!path) return Response.json({ default_branch: "main", private: false });
    if (path === "/issues/8")
      return Response.json({ state: "open", title: "Update", body: "Please change src/n.ts" });
    if (path.startsWith("/git/ref/")) return Response.json({ object: { sha: A } });
    if (path.startsWith("/git/commits/")) return Response.json({ tree: { sha: B } });
    if (path.startsWith("/git/trees/"))
      return Response.json({
        tree: [{ path: "src/n.ts", mode: "100644", type: "blob", sha: C, size: orig.length }],
      });
    if (path.startsWith("/git/blobs/"))
      return Response.json({ encoding: "base64", content: Buffer.from(orig).toString("base64") });
    throw Error(path);
  };
  try {
    const job = (await (await submit("public")).json()) as { id: string; thread: number };
    assert.equal(job.thread, root.seq);
    const latest = () => q.get<any>("SELECT phase,revision,connector FROM github_issue_jobs WHERE id=?", job.id)!;
    await runGithubIssueOnce();
    await runGithubIssueOnce();
    assert.equal(latest().phase, "connect");
    const old = latest().revision;
    const thread = () =>
      rows
        .list(author.id, author.generation, 100, undefined, root.seq)
        .map((r) => r.body)
        .filter((b) => b.kind === "message")
        .map((b) => b.text)
        .join("\n");
    assert.match(thread(), /src\/n\.ts/);
    assert.ok(thread().includes(old.slice(0, 12)));
    assert.equal(authorizedReads, 0);
    const decision = (d: string, revision: string, connector?: string) =>
      post(mine, { job: job.id, decision: d, revision, connector });
    assert.equal((await decision("approve", old)).status, 422);
    assert.equal((await decision("connect", old, "read")).status, 422);
    assert.equal((await decision("connect", old, "guestwrite")).status, 422);
    assert.equal((await decision("connect", old, "write")).status, 422);
    assert.equal(latest().phase, "connect");
    allow = true;
    assert.equal((await decision("connect", old, "write")).status, 200);
    const fresh = latest();
    assert.equal(fresh.phase, "approval");
    assert.equal(fresh.connector, "write");
    assert.notEqual(fresh.revision, old);
    assert.ok(thread().includes(fresh.revision.slice(0, 12)));
    assert.equal((await decision("approve", old)).status, 422);
    assert.equal((await decision("decline", fresh.revision)).status, 200);
    const privateJob = (await (await submit("private")).json()) as any;
    await runGithubIssueOnce();
    assert.equal(q.get("SELECT phase FROM github_issue_jobs WHERE id=?", privateJob.id)?.phase, "error");
    assert.equal(privateReads, 1);
    assert.equal(authorizedReads, 2);
    assert.equal(writes, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("GitHub Code OAuth verifies that its installation includes the selected repository before binding", async () => {
  const { verifyIssueRepository } = await import("../src/githubissuegit.js");
  const oauth = { id: "app-write", auth: "oauth" };
  q.run(
    "INSERT INTO connectors(id,user_id,name,url,oauth_enc,auth,created_at) VALUES(?,?,?,?,?,'oauth',?)",
    oauth.id,
    owner.id,
    "GitHub Code",
    GITHUB_WRITE_URL,
    seal(JSON.stringify({ tokens: { access_token: "local-oauth-placeholder" } })),
    Date.now(),
  );
  const saved = globalThis.fetch;
  let selected = false;
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.method, "GET");
    const u = new URL(String(input));
    assert.equal(u.origin, "https://api.github.com");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer local-oauth-placeholder");
    if (u.pathname === "/repos/demo/public")
      return Response.json({ id: 42, owner: { id: 10 }, full_name: "demo/public", permissions: { push: true } });
    if (u.pathname === "/user/installations")
      return Response.json({
        installations: [
          {
            id: 16,
            account: { id: 10 },
            repository_selection: "selected",
            permissions: { contents: "write", pull_requests: "write" },
          },
        ],
      });
    if (u.pathname === "/user/installations/16/repositories")
      return Response.json({ repositories: [{ id: selected ? 42 : 999 }] });
    throw Error(u.pathname);
  };
  try {
    await assert.rejects(verifyIssueRepository(owner.id, oauth, "demo/public"), /Autorise ce dépôt/);
    selected = true;
    await verifyIssueRepository(owner.id, oauth, "demo/public");
  } finally {
    globalThis.fetch = saved;
  }
});

test("a workflow still running at three hours is polled slowly until its real conclusion", async () => {
  const start = await post(app(owner), {
    url: "https://github.com/demo/slow/issues/9",
    reviewer: peer.id,
    connector: "write",
  });
  assert.equal(start.status, 200);
  const { id, thread } = (await start.json()) as { id: string; thread: number };
  const beginning = Date.now() - 3 * 60 * 60 * 1000;
  q.run("UPDATE github_issue_jobs SET phase='ci', ci_since=?,commit_sha=?,pr=19 WHERE id=?", beginning, E, id);
  const state = () => q.get<any>("SELECT phase,next,context,note FROM github_issue_jobs WHERE id=?", id)!;
  let visible = true,
    finished = false,
    details = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const u = new URL(String(input));
    assert.equal(init?.method, "GET");
    const run = {
      id: 7135,
      head_sha: E,
      name: "Long integration test",
      status: finished ? "completed" : "in_progress",
      conclusion: finished ? "failure" : null,
    };
    if (u.pathname.endsWith("/actions/runs/7135")) {
      details++;
      return Response.json(run);
    }
    assert.equal(u.pathname, "/repos/demo/slow/actions/runs");
    assert.equal(u.searchParams.get("head_sha"), E);
    return Response.json({ total_count: visible ? 1 : 0, workflow_runs: visible ? [run] : [] });
  };
  try {
    const from = Date.now();
    await runGithubIssueOnce();
    assert.equal(state().phase, "ci");
    assert.ok(state().next >= from + 300000);
    assert.deepEqual(JSON.parse(state().context).workflowRuns, [7135]);
    assert.equal(await runGithubIssueOnce(), false);
    visible = false;
    q.run("UPDATE github_issue_jobs SET next=0 WHERE id=?", id);
    await runGithubIssueOnce();
    assert.equal(state().phase, "ci");
    finished = true;
    q.run("UPDATE github_issue_jobs SET next=0 WHERE id=?", id);
    await runGithubIssueOnce();
    assert.equal(state().phase, "done");
    assert.equal(details, 2);
    assert.match(state().note, /Long integration test · failure/);
    const outcomes = rows
      .list(author.id, author.generation, 100, undefined, thread)
      .map((r) => r.body)
      .filter((b) => b.kind === "message" && b.text.includes("Long integration test"));
    assert.equal(outcomes.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});
