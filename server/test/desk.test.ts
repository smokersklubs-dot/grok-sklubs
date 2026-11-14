import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// The desk test (B-10) and the screen check before a turn (B-2), on real bot computers (Docker and the desktop image).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-desk-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "linux";
process.env.MAX_DESKTOPS = "4";

const { initComputer, screen, workspaceOf } = await import("../src/computer.js");
const { runDeskTest } = await import("../src/desktest.js");
const { containerName, docker, linuxScreen, setLookOverride } = await import("../src/linux.js");
await initComputer();

const R = "bot_ready_probe";
after(async () => { setLookOverride(R, null); await linuxScreen.destroy(R).catch(() => {}); });

test("B-10: the desk test passes every check on real computers, keeps pictures and cleans up after itself", async () => {
  const shots = mkdtempSync(path.join(tmpdir(), "sklubot-desk-shots-"));
  const seen: string[] = [];
  const run = await runDeskTest({ shotsDir: shots, prefix: "desk_unit", onCheck: (c) => seen.push(`${c.ok ? "ok" : "FAILED"} ${c.id}: ${c.detail}`) });
  assert.equal(run.status, "passed", seen.join("\n"));
  assert.deepEqual(run.checks.map((c) => c.id), ["create", "screen", "dress", "browser", "greeting", "redress", "rename", "read", "click", "typing", "files", "reset", "sleep"]);
  assert.ok(run.checks.find((c) => c.id === "redress")!.ms < 3000);
  assert.ok(run.shots.length >= 6 && run.shots.every((s) => existsSync(path.join(shots, s))));
  const left = await docker(["ps", "-a", "--filter", "name=desk_unit", "--format", "{{.Names}}"]);
  assert.equal(left.stdout.toString().trim(), "", "the test computers were removed");
});

test("B-2: the screen check wakes the computer, applies the look and (re)starts a browser that does not answer", async () => {
  setLookOverride(R, { name: "Probe", label: "", color: "teal", locale: "en", owner: "" });
  await screen.ready(R, "usr_probe");
  assert.equal(await waitBrowser(), true, "a browser was started");
  // The browser dies: the next check notices within 1.5 s and starts it again.
  await docker(["exec", containerName(R), "sh", "-c", "pkill -9 -f sklubot-browser; sleep 1"]);
  assert.equal(await screen.browserAnswers(R), false);
  const t0 = Date.now();
  await screen.ready(R, "usr_probe");
  assert.ok(Date.now() - t0 < 15_000);
  assert.equal(await waitBrowser(), true);
  workspaceOf(R);
});

async function waitBrowser(): Promise<boolean> {
  for (let i = 0; i < 30; i++) { if (await screen.browserAnswers(R)) return true; await new Promise((r) => setTimeout(r, 500)); }
  return false;
}
