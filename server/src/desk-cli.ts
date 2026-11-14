/**
 * The desk test from the command line, on the server (B-10):
 *   npm run desk:test                       (development: from the project folder)
 *   node server/dist/desk-cli.js [--keep] [--shots <folder>]
 *   docker compose -f docker-compose.vps.yml exec sklubot node server/dist/desk-cli.js   (on a VPS install)
 * It starts two computers of invented bots, checks each step and prints "ok" or "FAILED" per check with its time.
 * Exit code: 0 = everything passed, 1 = at least one check failed, 2 = stopped on an error.
 * --keep leaves the two test computers in place (asleep) instead of deleting them.
 */
import { tmpdir } from "node:os";
import path from "node:path";
import { initComputer } from "./computer.js";
import { runDeskTest } from "./desktest.js";

const args = process.argv.slice(2);
const shotsAt = args.indexOf("--shots");
const shotsDir = shotsAt >= 0 && args[shotsAt + 1] ? path.resolve(args[shotsAt + 1]) : path.join(tmpdir(), `sklubot-desk-${Date.now()}`);
try {
  console.log(await initComputer());
  console.log(`Pictures: ${shotsDir}\n`);
  const run = await runDeskTest({
    shotsDir, prefix: "desk_cli", clean: !args.includes("--keep"),
    onCheck: (c) => console.log(`${c.ok ? "  ok    " : "  FAILED"}  ${c.label.padEnd(62)} ${String(c.ms).padStart(6)} ms  ${c.ok ? "" : "— "}${c.detail}`),
  });
  console.log("");
  if (run.status === "error") { console.error(`Stopped: ${run.error}`); process.exit(2); }
  const failed = run.checks.filter((c) => !c.ok).length;
  console.log(failed ? `${failed} check(s) failed.` : `Everything passed (${run.checks.length} checks, ${Math.round(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000)} s).`);
  process.exit(failed ? 1 : 0);
} catch (err) {
  console.error(`Stopped: ${(err as Error)?.message ?? err}`);
  process.exit(2);
}
