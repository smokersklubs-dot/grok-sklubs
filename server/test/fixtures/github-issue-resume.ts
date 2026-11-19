// A fresh server process opens the first process's SQLite file after a PR was created remotely.
import assert from "node:assert/strict";
const { runGithubIssueOnce } = await import("../../src/githubissues.js");
const { q } = await import("../../src/db.js");
const job = q.get<{ id: string; branch: string; commit_sha: string; repo: string }>(
  "SELECT * FROM github_issue_jobs WHERE phase='publish'",
)!;
assert.ok(job);
let reads = 0;
globalThis.fetch = async (input, init) => {
  assert.equal(init?.method, "GET");
  const url = new URL(String(input));
  assert.equal(url.origin, "https://api.github.com");
  reads++;
  if (url.pathname.includes("/git/ref/heads/")) return Response.json({ object: { sha: job.commit_sha } });
  if (url.pathname.endsWith("/pulls"))
    return Response.json([
      {
        number: 12,
        head: { ref: job.branch, sha: job.commit_sha, repo: { full_name: job.repo } },
        base: { ref: "main" },
      },
    ]);
  throw Error("Unexpected GitHub read " + url.pathname);
};
assert.equal(await runGithubIssueOnce(), true);
assert.equal(q.get("SELECT phase FROM github_issue_jobs WHERE id=?", job.id)?.phase, "ci");
assert.ok(reads >= 2);
