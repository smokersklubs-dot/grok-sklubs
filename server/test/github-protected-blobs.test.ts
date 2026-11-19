import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { findSecrets, maskSecrets } from "../src/shared.js";
import {
  gitBlobSha,
  protectGithubText,
  restoreGithubText,
  verifyProtectedLines,
  privateValues,
} from "../src/githubprotected.js";
import {
  makeCommit,
  materializeGithubChange,
  prepareChange,
  type Context,
  type GitRequest,
} from "../src/githubissuegit.js";

const clean = (text: string) => maskSecrets(text, "[redacted]").text;
const path = "server/test/backup-drill.test.ts",
  workflow = ".github/workflows/ci.yml";
const commit = "a".repeat(40),
  tree = "b".repeat(40);
const context = (): Context => ({
  title: "Restore CI comment",
  body: "Check " + workflow,
  base: "main",
  sha: commit,
  tree,
});
test("actual backup drill and CI are reviewed as public text and only the approved comment differs in the same-repository commit", async () => {
  const file = readFileSync(new URL("../../" + path, import.meta.url), "utf8");
  const yaml = readFileSync(new URL("../../" + workflow, import.meta.url), "utf8");
  const values = privateValues([file, yaml]);
  assert.ok(values.length > 0, "real test fixture must exercise the redactor");
  const sourceHash = gitBlobSha(file),
    yamlHash = gitBlobSha(yaml);
  const from =
    file.split(/\r?\n/).find((l) => l.includes("the CI builds only")) ??
    file.split(/\r?\n/).find((l) => l.startsWith("// SK-P0-04"))!;
  const to = "// CI builds the server image for the restore drill.";
  const expectedHash = gitBlobSha(file.replace(from, to));
  const secretFree = (value: unknown) => values.every((v) => !JSON.stringify(value).includes(v));
  let blobWrites = 0,
    treeWrites = 0;
  const get: GitRequest = async (route, body: any) => {
    if (route === "/git/trees/" + tree + "?recursive=1")
      return {
        tree: [
          { path, sha: sourceHash, size: Buffer.byteLength(file), type: "blob", mode: "100644" },
          { path: workflow, sha: yamlHash, size: Buffer.byteLength(yaml), type: "blob", mode: "100644" },
        ],
      };
    if (route.startsWith("/git/blobs/")) {
      const raw = route.endsWith(sourceHash) ? file : route.endsWith(yamlHash) ? yaml : null;
      assert.ok(raw !== null);
      return { encoding: "base64", content: Buffer.from(raw!).toString("base64") };
    }
    if (route === "/contents/" + path + "?ref=" + commit) return { type: "file", path, sha: sourceHash };
    if (route === "/git/blobs" && body) {
      blobWrites++;
      assert.equal(body.encoding, "base64");
      const hash = gitBlobSha(Buffer.from(body.content, "base64").toString("utf8"));
      assert.ok(hash === expectedHash, "only the approved comment may change");
      return { sha: hash };
    }
    if (route === "/git/trees" && body) {
      treeWrites++;
      assert.ok(secretFree(body));
      assert.deepEqual(body.tree, [{ path, mode: "100644", type: "blob", sha: expectedHash }]);
      return { sha: tree };
    }
    if (route === "/git/commits" && body) {
      assert.ok(secretFree(body));
      return { sha: commit };
    }
    throw Error("Unexpected fixture operation");
  };
  const ctx = context();
  const patch = await prepareChange(
    get,
    ctx,
    async (system, data: any) => {
      assert.ok(secretFree(data), "the author must receive only masked files");
      if (system.startsWith("Select")) return { paths: [path, workflow] };
      assert.ok(data.files.find((f: any) => f.path === path).before.includes("[[SKLUBOT_PROTECTED_"));
      return { files: [{ path, edits: [{ oldText: from, newText: to }] }] };
    },
    clean,
  );
  assert.ok(secretFree({ ctx, patch }), "the persisted proposal and independent review contain only masked text");
  assert.equal(patch.length, 1);
  assert.ok(patch[0].protectedLines?.lines.length);
  assert.ok(gitBlobSha(await materializeGithubChange(get, ctx, patch[0])) === expectedHash);
  assert.equal(await makeCommit(get, ctx, 3, patch), commit);
  assert.equal(blobWrites, 1);
  assert.equal(treeWrites, 1);
  await assert.rejects(
    materializeGithubChange(async () => ({ type: "file", path: "elsewhere", sha: sourceHash }), ctx, patch[0]),
    /chemin/,
  );
  await assert.rejects(
    materializeGithubChange(
      async (p) =>
        p.startsWith("/contents/")
          ? { type: "file", path, sha: sourceHash }
          : { encoding: "base64", content: Buffer.from("different file").toString("base64") },
      ctx,
      patch[0],
    ),
    /version relue/,
  );
});
test("markers stay unique on the same complete original line across moves, duplicates, deletions, forgeries, copies and CRLF", () => {
  const value = "local-fixture-sensitive";
  const src =
    "\uFEFFstart\r\nbefore\r\nconst password = '" +
    value +
    "';\r\nmiddle\r\nrepeat(" +
    JSON.stringify(value) +
    ");\r\nend\r\n";
  const projection = protectGithubText(src, gitBlobSha(src), clean, privateValues([src]));
  const { before, protectedLines } = projection;
  assert.ok(protectedLines);
  const masked = before.split("\n");
  assert.deepEqual(protectedLines.lines, [2, 4]);
  assert.ok(!before.includes(value));
  const edited = before.replace("before", "updated");
  assert.ok(
    gitBlobSha(restoreGithubText(src, before, edited, protectedLines)) ===
      gitBlobSha(src.replace("before", "updated")),
  );
  for (const bad of [
    before.replace(masked[2], "REDACTED"),
    before.replace(masked[2], masked[4]),
    before + "\n" + masked[2],
    before.replace(masked[2], masked[2] + "x"),
    "new\n" + before,
    before.replace(masked[2], ""),
    before.replace(masked[2], masked[2].trimEnd()),
  ])
    assert.throws(() => verifyProtectedLines(before, bad, protectedLines), /protégée/);
  assert.throws(() => verifyProtectedLines("another", masked[2]), /protégée/);
  assert.throws(() => protectGithubText("literal " + masked[2], gitBlobSha("x"), clean, []), /réservé/);
  assert.throws(() => protectGithubText(src, "1".repeat(40), clean, privateValues([src])), /blob/);
});
test("a multi-line account secret remains concealed, even when it crosses a line split", () => {
  const raw = "public\nup\nleft\nright\ndown\nend";
  const vault = (s: string) => s.replaceAll("left\nright", "[hidden]");
  const masked = protectGithubText(raw, gitBlobSha(raw), vault, []);
  assert.ok(!masked.before.includes("left") && !masked.before.includes("right"));
  assert.ok(masked.protectedLines);
  assert.deepEqual(masked.protectedLines.lines,[2,3]);
  assert.ok(masked.before.startsWith("public\nup\n"));
  assert.ok(restoreGithubText(raw, masked.before, masked.before, masked.protectedLines) === raw);
});
test("a repeated credential in another selected file is also hidden", () => {
  const sample = "password = 'for-tests-only-82752'";
  const value = findSecrets(sample)[0].value,
    other = "log(" + JSON.stringify(value) + ")\npublic";
  const p = protectGithubText(other, gitBlobSha(other), clean, privateValues([sample, other]));
  assert.ok(!p.before.includes(value));
  assert.ok(p.protectedLines);
});
