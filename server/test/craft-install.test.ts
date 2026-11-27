import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L23: Craft Anything stays in clean-room mode. docker/desktop/install-craft.sh pins and checks the release and puts a
// guard in front of it; shell_run refuses the same things; check rounds only for the owner's own site; what the builder
// decided on its own (--unattended) is read back for the owner. The install script runs here against a FAKE official
// binary (never downloaded, never the real one), in temporary folders.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-ci-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";

const { craftCommandRefusal, craftRounds, craftRunNotice, parseCraftRun, CRAFT_REAL_DIR } = await import("../src/agent/craft-run.js");
const SCRIPT = new URL("../../docker/desktop/install-craft.sh", import.meta.url).pathname;
const source = readFileSync(SCRIPT, "utf8");

/** What craft-anything-cli 0.6.1 prints in an unattended rebuild (rebuild_cmd.rs auto_answer, Checked, Finished). */
const RUN_OUTPUT = [
  "Studying https://example.com …",
  "? Which colour scheme should the build use? → Keep the original light theme (unattended)",
  "? Allow running npm install outside the project? → refused (unattended)",
  "[Check 1] 71% alike — headings missing: Pricing",
  "[Check 2] 86% alike — close",
  "Done. app/index.html is ready.",
].join("\n");

function fakeOfficial(file: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\nif [ "$1" = --version ]; then echo "craft-anything-cli 0.6.1"; exit 0; fi\necho "ARGS: $*"\nif [ "$2" = rebuild ]; then cat <<'OUT'\n${RUN_OUTPUT}\nOUT\nexit 3; fi\nexit 0\n`);
  chmodSync(file, 0o755);
}
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "sklubot-craft-"));
  const env = { ...process.env, CRAFT_BIN_DIR: path.join(root, "bin"), CRAFT_LIB_DIR: path.join(root, "lib"), CRAFT_LOG_DIR: path.join(root, "runs") };
  return { root, env, program: path.join(root, "bin", "craft-anything-cli"), real: path.join(root, "lib", "craft-anything-cli") };
}
const run = (file: string, args: string[], env: NodeJS.ProcessEnv) => spawnSync(file, args, { env, encoding: "utf8" });

test("install-craft.sh: release pinned, both architectures' SHA-256 present, https only, checksum checked before unpacking", () => {
  assert.match(source, /^version=0\.6\.1$/m);
  assert.match(source, /x86_64\) arch=x86_64; digest=[0-9a-f]{64} ;;/);
  assert.match(source, /aarch64\|arm64\) arch=aarch64; digest=[0-9a-f]{64} ;;/);
  assert.match(source, /--proto '=https' --proto-redir '=https'/);
  assert.ok(source.indexOf("sha256sum -c") > 0 && source.indexOf("sha256sum -c") < source.indexOf("tar -xOzf"), "checked before unpacking");
  assert.match(source, /\[ "\$\("\$dir\/program" --version\)" = "craft-anything-cli \$version" \]/, "the unpacked program's version is checked");
  for (const n of ["LICENSE-MIT", "LICENSE-APACHE", "NOTICE"]) assert.ok(source.includes(n), `licence file ${n} copied`);
  assert.equal(spawnSync("sh", ["-n", SCRIPT]).status, 0, "valid sh");
});

test("an installed release gets the guard: clean-room forced, --deep / deep_mode refused, --version passes through", () => {
  const s = setup();
  fakeOfficial(s.real);
  const r = run("sh", [SCRIPT], s.env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(s.program, "utf8"), /sklubot-craft-guard/);
  assert.equal(run(s.program, ["--version"], s.env).stdout.trim(), "craft-anything-cli 0.6.1");
  assert.equal(run(s.program, ["triage", "/tmp/x"], s.env).stdout.trim(), "ARGS: --clean-room triage /tmp/x", "every run is clean-room");
  for (const bad of [["rebuild", "--deep", "https://example.com", "copy"], ["--deep=true", "commands"], ["call", "settings_set", '{"key":"deep_mode","value":true}'], ["commands", "--deep-mode"]]) {
    const b = run(s.program, bad, s.env);
    assert.equal(b.status, 64, bad.join(" "));
    assert.match(b.stderr, /clean-room mode only/);
    assert.equal(b.stdout, "", "the official program never ran");
  }
});

test("a rebuild's output is kept (with the exit status passed on) for the owner's report", () => {
  const s = setup();
  fakeOfficial(s.real);
  assert.equal(run("sh", [SCRIPT], s.env).status, 0);
  const r = run(s.program, ["rebuild", "--unattended", "--", "https://example.com", "my page"], s.env);
  assert.equal(r.status, 3, "the official program's exit status");
  assert.match(r.stdout, /ARGS: --clean-room rebuild --unattended/);
  const logs = readdirSync(s.env.CRAFT_LOG_DIR!);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /\.log$/);
  const kept = readFileSync(path.join(s.env.CRAFT_LOG_DIR!, logs[0]), "utf8");
  assert.match(kept, /refused \(unattended\)/);
});

test("an older desktop (official binary where the guard goes) is moved behind the guard, without downloading", () => {
  const s = setup();
  fakeOfficial(s.program);
  const r = run("sh", [SCRIPT], s.env);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(s.real), "moved behind the guard");
  assert.match(readFileSync(s.program, "utf8"), /sklubot-craft-guard/);
  assert.equal(run("sh", [SCRIPT], s.env).status, 0, "running it again changes nothing");
  assert.match(readFileSync(s.program, "utf8"), /sklubot-craft-guard/);
});

test("shell_run refuses Craft Anything in Deep mode and the program behind the guard; other commands pass", () => {
  assert.match(craftCommandRefusal("craft-anything-cli rebuild --deep https://x.fr 'copy'")!, /clean-room mode only/);
  assert.match(craftCommandRefusal("craft-anything-cli call settings_set '{\"key\":\"deep_mode\",\"value\":true}'")!, /clean-room/);
  assert.match(craftCommandRefusal(`${CRAFT_REAL_DIR}/craft-anything-cli rebuild https://x.fr y`)!, /never the program behind it/);
  assert.equal(craftCommandRefusal("craft-anything-cli rebuild --rounds 0 --unattended -- https://x.fr 'deep blue page'"), null, "a request that says 'deep' is fine");
  assert.equal(craftCommandRefusal("ls -la --deep"), null, "not Craft Anything");
});

test("check rounds: only when the owner's own words say the reference is their site", () => {
  const words = [{ seq: 1, text: "Refais la page d'accueil de mon site boulangerie-dupont.fr en plus moderne", at: Date.now() }];
  assert.equal(craftRounds("https://www.boulangerie-dupont.fr/", "mon site boulangerie-dupont.fr", words).rounds, 2);
  assert.equal(craftRounds("https://concurrent.fr/", "mon site boulangerie-dupont.fr", words).rounds, 0, "the quote names another site");
  assert.equal(craftRounds("https://www.boulangerie-dupont.fr/", "c'est mon site à moi", words).rounds, 0, "words the owner never wrote");
  assert.equal(craftRounds("https://www.boulangerie-dupont.fr/", "", words).rounds, 0, "no quote");
  assert.equal(craftRounds(undefined, "mon site boulangerie-dupont.fr", words).rounds, 0, "no reference");
  assert.equal(craftRounds("file:///etc/passwd", "mon site boulangerie-dupont.fr", words).rounds, 0);
});

test("the unattended choices and the resemblance are read back and told to the owner, in French", () => {
  const parsed = parseCraftRun(RUN_OUTPUT);
  assert.deepEqual(parsed.answered, [{ question: "Which colour scheme should the build use?", answer: "Keep the original light theme" }]);
  assert.deepEqual(parsed.refused, ["Allow running npm install outside the project?"]);
  assert.deepEqual(parsed.checks.map((c) => c.similarity), [71, 86]);
  assert.equal(parsed.end, "Done. app/index.html is ready.");
  const fr = craftRunNotice(parsed, "fr");
  assert.match(fr, /Craft Anything a répondu seul à ces questions/);
  assert.match(fr, /• Which colour scheme should the build use\? → Keep the original light theme/);
  assert.match(fr, /Il a refusé seul ces demandes/);
  assert.match(fr, /Ressemblance avec ton site après le contrôle 2 : 86 %/);
  assert.equal(craftRunNotice(parseCraftRun("Done. nothing asked"), "fr"), "", "nothing decided: nothing to say");
});
