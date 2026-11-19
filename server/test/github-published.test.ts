import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import type { GitRequest, Context, Change } from "../src/githubissuegit.js";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sklubot-published-"));
process.env.DB_PATH = ":memory:";
process.env.NO_SCHEDULER = "1";
process.env.SESSION_SECRET = "synthetic-github-adoption-test-secret";
process.env.HOSTED_MODE = "0";
const { verifyPublishedDraft, draftNumber } = await import("../src/githubpublished.js");
const { gitBlobSha, protectGithubText } = await import("../src/githubprotected.js");
const repo = "example/project";
const root = (n: number) => n.toString(16).padStart(40, "0");
const ctx: Context = { title: "A", body: "B", sha: root(1), tree: root(2), base: "main" };
const head = root(3), headTree = root(4);
const fullBefore = "trace=fixture-line\nmode=ancien\n", fullAfter = "trace=fixture-line\nmode=été\n";
const file = (path: string, sha: string, mode = "100644") => ({ type: "blob", path, mode, sha });
const dir = (path: string, sha: string) => ({ type: "tree", path, mode: "040000", sha });

function fixture(branch: string) {
  const protectedText = protectGithubText(fullBefore, gitBlobSha(fullBefore), s => s, ["fixture-line"]);
  const patch: Change[] = [
    { path: "src/main.ts", mode: "100755", ...protectedText, after: protectedText.before.replace("ancien", "été") },
    { path: "docs/readme.md", mode: "100644", before: null, after: "édition\n" },
  ];
  const metadata = { full_name: repo, id: 12, private: false };
  const pr = { number: 7, commits: 1, state: "open", merged: false, draft: true,
    head: { ref: branch, sha: head, repo: metadata }, base: { ref: ctx.base, sha: ctx.sha, repo: metadata } };
  const lookup = new Map<string, any>([["", metadata], ["/pulls/7", pr],
    ["/git/commits/" + head, { sha: head, tree: { sha: headTree }, parents: [{ sha: ctx.sha }] }],
    ["/contents/src/main.ts?ref=" + ctx.sha, { type: "file", path: "src/main.ts", sha: gitBlobSha(fullBefore) }],
    ["/git/blobs/" + gitBlobSha(fullBefore), { sha: gitBlobSha(fullBefore), encoding: "base64", content: Buffer.from(fullBefore).toString("base64") }],
  ]);
  const tree = (id: string, items: object[]) => lookup.set("/git/trees/" + id, { sha: id, truncated: false, tree: items });
  const shared = dir("untouched", root(9));
  tree(ctx.tree, [dir("src",root(5)), shared]); tree(headTree, [dir("src",root(6)), dir("docs",root(7)),shared]);
  tree(root(5), [file("main.ts", gitBlobSha(fullBefore), "100755")]);
  tree(root(6), [file("main.ts", gitBlobSha(fullAfter), "100755")]);
  tree(root(7), [file("readme.md", gitBlobSha(patch[1].after))]);
  const get: GitRequest = async (path, body) => { assert.equal(body, undefined); assert.ok(lookup.has(path), path); return lookup.get(path); };
  return { patch, pr, lookup, get };
}

test("only the exact public draft and full reviewed tree are accepted, including protected content and modes", async () => {
  const branch = "sklubot/issue-4-candidate";
  assert.equal(draftNumber(repo, "https://github.com/EXAMPLE/project/pull/7"), 7);
  for (const value of [0, -1, "", "1e2", "https://github.com/other/project/pull/7", "https://evil.test/example/project/pull/7"])
    assert.throws(() => draftNumber(repo,value));
  const valid = fixture(branch);
  assert.equal(await verifyPublishedDraft(valid.get, repo, branch, 7, ctx, valid.patch), head);
  const invalid: ((f: ReturnType<typeof fixture>) => void)[] = [
    f => { f.lookup.get("").private = true; },
    f => { f.pr.draft = false; }, f => { f.pr.state = "closed"; }, f => { f.pr.commits = 2; },
    f => { f.pr.head.repo = { ...f.pr.head.repo, full_name: "fork/project", id: 11 }; },
    f => { f.pr.base.ref = "release"; }, f => { f.pr.head.ref = "another"; }, f => { f.pr.base.sha = root(19); },
    f => { f.lookup.get("/git/commits/"+head).parents = [{sha:ctx.sha},{sha:root(11)}]; },
    f => { f.lookup.get("/git/commits/"+head).parents = [{sha:root(11)}]; },
    f => { f.lookup.get("/git/trees/"+root(6)).tree[0].mode = "100644"; },
    f => { f.lookup.get("/git/trees/"+root(6)).tree[0].sha = gitBlobSha(f.patch[0].after); },
    f => { f.lookup.get("/git/trees/"+headTree).tree.push(file("unreviewed.txt",root(11))); },
    f => { f.lookup.get("/git/trees/"+headTree).tree.pop(); },
    f => { f.lookup.get("/git/trees/"+headTree).truncated = true; },
    f => { f.lookup.get("/git/trees/"+root(7)).tree = []; },
  ];
  for (const mutate of invalid) {
    const f = fixture(branch); mutate(f);
    await assert.rejects(verifyPublishedDraft(f.get, repo, branch, 7, ctx, f.patch));
  }
  let reads=0;
  await assert.rejects(verifyPublishedDraft(async path => {
    if(path === "/pulls/7" && ++reads === 2) return {...valid.pr, head: {...valid.pr.head, sha:root(12)}};
    return valid.get(path);
  }, repo, branch, 7, ctx, valid.patch), /changé/);
});

test("only the owner may adopt a reviewed revision, and its original chat receives CI via anonymous GETs", async () => {
  const { users, bots, rows } = await import("../src/store.js");
  const { q } = await import("../src/db.js");
  const { createIssueJob, registerGithubIssueRoutes, runGithubIssueOnce } = await import("../src/githubissues.js");
  const owner=users.create("one@sample.test","One","unused","fr"), outsider=users.create("two@sample.test","Two","unused","fr");
  const author=bots.create(owner.id,{name:"Writer"}), reviewer=bots.create(owner.id,{name:"Reviewer"});
  const job=createIssueJob(author,reviewer.id,repo,4,""), f=fixture(job.branch);
  const review="Reviewer · approved\nCorrectif relu.", patch=JSON.stringify(f.patch), context=JSON.stringify(ctx);
  const revision=createHash("sha256").update(JSON.stringify([job.id,job.branch,context,patch,review,""])).digest("hex");
  q.run("UPDATE github_issue_jobs SET phase='connect',context=?,patch=?,review=?,revision=? WHERE id=?",context,patch,review,revision,job.id);
  const post=(user: typeof owner, rev=revision) => {
    const app=new Hono<any>();
    app.use("*",async(c,next)=>{c.set("user",user);await next();});
    registerGithubIssueRoutes(app,()=>{});
    return app.request("/bots/"+author.id+"/github-issues",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({decision:"follow-published",job:job.id,pr:7,revision:rev})});
  };
  const original=globalThis.fetch;
  let reads=0;
  globalThis.fetch=async (input,init) => {
    const url=new URL(String(input)), prefix="/repos/"+repo;
    assert.equal(url.origin,"https://api.github.com"); assert.ok(url.pathname.startsWith(prefix));
    assert.equal(init?.method,"GET"); assert.equal(new Headers(init?.headers).get("authorization"),null);
    reads++;
    if(url.pathname===prefix+"/actions/runs") {
      assert.equal(url.searchParams.get("head_sha"),head);
      return Response.json({total_count:1,workflow_runs:[{id:11,name:"suite",head_sha:head,status:"completed",conclusion:"success"}]});
    }
    return Response.json(await f.get(url.pathname.slice(prefix.length)+url.search));
  };
  try {
    assert.equal((await post(outsider)).status,404); assert.equal((await post(owner,"stale")).status,422);
    assert.equal(reads,0);
    q.run("UPDATE github_issue_jobs SET phase='review' WHERE id=?",job.id);
    assert.equal((await post(owner)).status,422);assert.equal(reads,0);
    q.run("UPDATE github_issue_jobs SET phase='connect' WHERE id=?",job.id);
    const linked=await post(owner); assert.equal(linked.status,200,await linked.text());
    assert.equal(q.get("SELECT phase FROM github_issue_jobs WHERE id=?",job.id)?.phase,"ci");
    assert.equal(await runGithubIssueOnce(),true);
    assert.equal(q.get("SELECT phase FROM github_issue_jobs WHERE id=?",job.id)?.phase,"done");
    const messages=rows.list(author.id,author.generation,50,undefined,job.thread).map(r=>r.body)
      .filter(r=>r.kind==="message").map(r=>r.text).join("\n");
    assert.match(messages,/PR brouillon vérifiée/); assert.match(messages,/suite · success/);
  } finally { globalThis.fetch=original; }
});
