import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L23: Craft Anything's questions relayed to the owner live. The guard (docker/desktop/install-craft.sh) gives a rebuild
// without --unattended a named pipe for its answers; the server reads the question waiting at the end of the kept output
// (agent/craft-relay.ts) and writes back the OWNER's own answer. The guard runs here against a FAKE official binary that
// asks like craft-anything-cli 0.6.1 (rebuild_cmd.rs prompt_answer), in temporary folders; nothing is downloaded.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-cr-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";

const { parsePendingAsk, answerLine, relayedRebuild, relayText, QUESTION_PROMPT, APPROVAL_PROMPT } = await import("../src/agent/craft-relay.js");
const { craftCommandRefusal } = await import("../src/agent/craft-run.js");
const SCRIPT = new URL("../../docker/desktop/install-craft.sh", import.meta.url).pathname;

/** What the CLI prints for a question without --unattended (prompt_answer), then the line it read. */
const ASK = `Studying the request …\n\n? Which colour scheme should the build use?\n  The reference uses a light theme.\n  1) Keep the original light theme\n  2) A dark theme\n${QUESTION_PROMPT}`;

function fakeOfficial(file: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh
if [ "$1" = --version ]; then echo "craft-anything-cli 0.6.1"; exit 0; fi
echo "ARGS: $*"
if [ "$2" = rebuild ]; then
  printf '%s' '${ASK.replace(/'/g, "")}'
  read answer
  echo "GOT: $answer"
  echo "Done. app/index.html is ready."
fi
exit 0
`);
  chmodSync(file, 0o755);
}

test("the question waiting at the end of the output is read: title, detail, numbered choices; approvals too; nothing when not waiting", () => {
  assert.deepEqual(parsePendingAsk(ASK), { kind: "question", title: "Which colour scheme should the build use?", detail: ["The reference uses a light theme."], choices: ["Keep the original light theme", "A dark theme"] });
  assert.deepEqual(parsePendingAsk(`x\n\n? Run npm install outside the project?\n  npm install in /root\n${APPROVAL_PROMPT}`), { kind: "approval", title: "Run npm install outside the project?", detail: ["npm install in /root"], choices: [] });
  assert.equal(parsePendingAsk(ASK + "2\nGOT: 2\n"), null, "already answered");
  assert.equal(parsePendingAsk("? Which colour → Keep (unattended)\n"), null, "an unattended line is not a question");
  assert.equal(parsePendingAsk(QUESTION_PROMPT), null, "no title");
});

test("the owner's words become the answer line: a named choice → its number, else their words; an approval only on a clear yes", () => {
  const q = parsePendingAsk(ASK)!;
  assert.equal(answerLine(q, "A dark theme"), "2");
  assert.equal(answerLine(q, "1"), "1");
  assert.equal(answerLine(q, "plutôt a dark theme stp"), "2");
  assert.equal(answerLine(q, "Mets du vert, comme mon logo"), "Mets du vert, comme mon logo");
  assert.equal(answerLine(q, "9"), "9", "a number that is not a choice is sent as text");
  const a = parsePendingAsk(`\n? Run npm install outside the project?\n${APPROVAL_PROMPT}`)!;
  assert.equal(answerLine(a, "Oui, autoriser"), "y");
  assert.equal(answerLine(a, "ok vas-y"), "y");
  assert.equal(answerLine(a, "Non"), "n");
  assert.equal(answerLine(a, "oui mais pas maintenant"), "n", "a doubtful yes refuses");
  assert.equal(answerLine(a, "toujours"), "n", "« always » is never sent");
});

test("which rebuilds are relayed, and the bot is told to ask the owner, never to answer itself", () => {
  assert.equal(relayedRebuild("craft-anything-cli rebuild --backend Codex --rounds 0 --project-folder /root/files/x -- - 'a page'"), true);
  assert.equal(relayedRebuild("craft-anything-cli rebuild --rounds 0 --unattended -- - 'a page'"), false);
  assert.equal(relayedRebuild("craft-anything-cli triage /tmp/x"), false);
  const text = relayText(parsePendingAsk(ASK)!);
  assert.match(text, /ask_user/);
  assert.match(text, /do not answer it yourself/);
  assert.match(text, /1\) Keep the original light theme\n {2}2\) A dark theme/);
  assert.match(text, /relay_answer: true/);
  assert.match(relayText(parsePendingAsk(`\n? Delete /root/old?\n${APPROVAL_PROMPT}`)!), /never decide it yourself/);
  // The deep-mode refusal is unchanged.
  assert.match(craftCommandRefusal("craft-anything-cli rebuild --deep - x")!, /clean-room mode only/);
});

test("the guard: a rebuild without --unattended waits on its answer pipe; the answer written there reaches the builder", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "sklubot-craftrelay-"));
  const env = { ...process.env, CRAFT_BIN_DIR: path.join(root, "bin"), CRAFT_LIB_DIR: path.join(root, "lib"), CRAFT_LOG_DIR: path.join(root, "runs") };
  fakeOfficial(path.join(root, "lib", "craft-anything-cli"));
  assert.equal(spawnSync("sh", [SCRIPT], { env, encoding: "utf8" }).status, 0);
  const child = spawn(path.join(root, "bin", "craft-anything-cli"), ["rebuild", "--rounds", "0", "--", "-", "a page"], { env });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  const done = new Promise<number>((r) => child.on("close", (code) => r(code ?? -1)));
  // Wait for the question at the end of the kept output.
  let log = "";
  for (let i = 0; i < 200 && !log; i++) {
    const f = existsSync(env.CRAFT_LOG_DIR) ? readdirSync(env.CRAFT_LOG_DIR).find((n) => n.endsWith(".log")) : undefined;
    if (f && readFileSync(path.join(env.CRAFT_LOG_DIR, f), "utf8").endsWith(QUESTION_PROMPT)) log = path.join(env.CRAFT_LOG_DIR, f);
    else await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(log, "the question reached the kept output");
  assert.ok(statSync(`${log}.in`).isFIFO(), "an answer pipe next to it");
  const ask = parsePendingAsk(readFileSync(log, "utf8"))!;
  assert.equal(ask.choices.length, 2);
  writeFileSync(`${log}.in`, answerLine(ask, "A dark theme") + "\n");
  assert.equal(await done, 0, "exit status passed on");
  assert.match(out, /ARGS: --clean-room rebuild --rounds 0/);
  assert.match(readFileSync(log, "utf8"), /GOT: 2\nDone\./);
  assert.equal(existsSync(`${log}.in`), false, "the pipe is removed at the end");
});

test("the guard: with --unattended, no pipe (the after-the-fact list stays for work no one watches)", () => {
  const root = mkdtempSync(path.join(tmpdir(), "sklubot-craftrelay-"));
  const env = { ...process.env, CRAFT_BIN_DIR: path.join(root, "bin"), CRAFT_LIB_DIR: path.join(root, "lib"), CRAFT_LOG_DIR: path.join(root, "runs") };
  fakeOfficial(path.join(root, "lib", "craft-anything-cli"));
  assert.equal(spawnSync("sh", [SCRIPT], { env, encoding: "utf8" }).status, 0);
  const r = spawnSync(path.join(root, "bin", "craft-anything-cli"), ["rebuild", "--unattended", "--", "-", "x"], { env, encoding: "utf8", input: "1\n" });
  assert.equal(r.status, 0);
  const files = readdirSync(env.CRAFT_LOG_DIR);
  assert.equal(files.filter((f) => f.endsWith(".in")).length, 0);
  assert.equal(files.filter((f) => f.endsWith(".log")).length, 1);
});
