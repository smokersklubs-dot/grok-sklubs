import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelOutputLimit } from "../src/llm/types.js";
import { structuredGithubReplies } from "../src/githubreplies.js";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sklubot-structured-"));
process.env.NO_SCHEDULER = "1";
const { collectSideReply } = await import("../src/agent/sidereply.js");

test("extracts a single wrapped patch with quotes, braces and brackets preserved verbatim", async () => {
  const proposal = { files: [{ path: "src/test.ts", edits: [{ oldText: 'call("{")', newText: 'call("[\\"]")' }] }] };
  const call = structuredGithubReplies(async () => "\uFEFFVoici la proposition :\n\x60\x60\x60json\n" + JSON.stringify(proposal) + "\n\x60\x60\x60\nFin.");
  assert.deepEqual(await call("patch", "Implement", {}), proposal);
});
test("never uses a partial, wrong-shaped or conflicting proposal and never sends its raw output for repair", async () => {
  for (const bad of ['{"files":[{"paths":["private-first-output"]}', '{"paths":["private-first-output"]} {"paths":["other"]}', '{"unrelated":"private-first-output"}', 'private-first-output', '']) {
    const systems: string[] = [], data = { files: ["ok"] };
    const call = structuredGithubReplies(async (system, payload) => {
      systems.push(system);
      assert.equal(payload, data);
      return systems.length === 1 ? bad : '{"paths":["ok"]}';
    });
    assert.deepEqual(await call("selection", "Select", data), { paths: ["ok"] });
    assert.equal(systems.length, 2);
    assert.doesNotMatch(systems[1], /private-first-output/);
  }
});
test("limits repairs across the entire preparation and identifies the stage without logging output", async () => {
  const replies = ["scratch-sensitive", '{"paths":["src/a"]}', '{"files":[{"secret":"scratch-sensitive"}'];
  const run = structuredGithubReplies(async () => replies.shift()!);
  await run("selection", "Select", {});
  await assert.rejects(run("patch", "Implement", {}), (error: Error) => {
    assert.match(error.message, /préparation du correctif.*interrompu/);
    assert.doesNotMatch(error.message, /scratch-sensitive/);
    return true;
  });
  assert.equal(replies.length, 0);
});
test("a provider-declared output limit requests a shorter fresh answer", async () => {
  let calls = 0;
  const run = structuredGithubReplies(async () => {
    if (!calls++) throw new ModelOutputLimit("limite de sortie");
    return '{"paths":["test.ts"]}';
  });
  assert.deepEqual(await run("selection", "Select", {}), { paths: ["test.ts"] });
  assert.equal(calls, 2);
});
test("an invalid review cannot be treated as approval and a failed engine is not called again", async () => {
  let calls = 0;
  const badReview = structuredGithubReplies(async () => { calls++; return '{"verdict":"approved","reason":""}'; });
  await assert.rejects(badReview("review", "Review", {}), /relecture.*structure inattendue/);
  assert.equal(calls, 2);
  const transport = structuredGithubReplies(async () => { throw Error("Quota garanti"); });
  await assert.rejects(transport("selection", "Select", {}), /Quota garanti/);
});
test("Codex terminal failure takes precedence over an earlier message and does not expose stderr", () => {
  const r = collectSideReply("codex");
  r.line(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '{"paths":["a"]}' } }));
  r.line(JSON.stringify({ type: "turn.failed", error: { message: "You've hit your usage limit private-marker" } }));
  assert.throws(() => r.finish({ code: 1, stderr: "private-marker" }, false), (error: Error) => {
    assert.match(error.message, /Quota.*ChatGPT/);
    assert.doesNotMatch(error.message, /private-marker/);
    return true;
  });
});
test("Codex recovered warnings, incomplete streams, connection failures and timeouts stay distinct", () => {
  const r = collectSideReply("codex");
  r.line('{"type":"error","message":"401 Unauthorized"}');
  r.line('{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}');
  r.line('{"type":"turn.completed"}');
  assert.equal(r.finish({ code: 0, stderr: "" }, false), "OK");
  const fail = collectSideReply("codex");
  assert.throws(() => fail.finish({ code: 1, stderr: "401 Unauthorized private-marker" }, false), /connexion ChatGPT/);
  assert.throws(() => fail.finish({ code: 1, stderr: "" }, true), /délai/);
  assert.throws(() => fail.finish({ code: 0, stderr: "" }, false), /interrompu/);
});
test("Claude rejected limits and terminal errors stay distinct from allowed warnings", () => {
  const limit = collectSideReply("claude-code");
  limit.line('{"type":"rate_limit_event","rate_limit_info":{"status":"rejected"}}');
  limit.line('{"type":"result","is_error":true,"subtype":"error_during_execution","errors":["private-marker"]}');
  assert.throws(() => limit.finish({ code: 1, stderr: "" }, false), /Quota.*Claude/);
  const ok = collectSideReply("claude-code");
  ok.line('{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning"}}');
  ok.line('{"type":"result","is_error":false,"result":"  OK  "}');
  assert.equal(ok.finish({ code: 0, stderr: "" }, false), "OK");
});
