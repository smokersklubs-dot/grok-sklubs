import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L95: a separate cap on computer hours per account and month, and computers no bot owns stopped (never removed).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-chours-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
const ch = await import("../src/computerhours.js");
const { bots, users, rows } = await import("../src/store.js");

const lea = users.create("hours@example.com", "Léa", "x", "fr");
const bot = bots.create(lea.id, { name: "Horace", autonomy: "balanced" });
type M = Parameters<typeof ch.tickComputerHours>[1][number];
const machine = (key: string, userId: string, busy = 0, power = "running"): M => ({ key, userId, busy, power, lastUsedAt: 0 } as unknown as M);
const H = 3_600_000;

test("L95: each awake computer's minutes go to its account's month; asleep ones count nothing", async () => {
  const t0 = Date.UTC(2026, 10, 23, 10, 0);
  await ch.tickComputerHours(t0, [machine(bot.id, lea.id), machine("other", lea.id, 0, "asleep")], async () => undefined);
  await ch.tickComputerHours(t0 + 60_000, [machine(bot.id, lea.id)], async () => undefined);
  assert.equal(ch.usedMs(lea.id, "2026-11"), 120_000, "two counts of one minute");
  await ch.tickComputerHours(t0 + 60_000 + 30 * 60_000, [machine(bot.id, lea.id)], async () => undefined);
  assert.equal(ch.usedMs(lea.id, "2026-11"), 240_000, "a long gap (server stopped) counts 2 minutes at most");
  assert.equal(ch.hoursView(lea.id).capHours, null, "no cap by default");
  assert.equal(ch.wakeRefusal(lea.id), null);
});

test("L95: the owner's cap — set, refused when out of range, cleared with 0", () => {
  assert.equal(ch.setOwnCap(lea.id, 40).ownCapHours, 40);
  assert.throws(() => ch.setOwnCap(lea.id, 800), RangeError);
  assert.throws(() => ch.setOwnCap(lea.id, "abc"), RangeError);
  assert.equal(ch.setOwnCap(lea.id, 0).ownCapHours, null);
  assert.equal(ch.setOwnCap(lea.id, 0.1).ownCapHours, 0.5, "half an hour at least");
});

test("L95: past the cap — wake refused with the way forward, idle computers put to sleep, busy ones kept, one notice a month", async () => {
  const month = ch.monthOf();
  const now = Date.now();
  ch.setOwnCap(lea.id, 0.5);
  const slept: string[] = [];
  // 31 minutes in this month: over half an hour.
  for (let i = 0; i < 31; i++) await ch.tickComputerHours(now + i * 60_000, [machine(bot.id, lea.id, 1)], async (k) => { slept.push(k); });
  assert.ok(ch.usedMs(lea.id, month) >= 0.5 * H);
  assert.deepEqual(slept, [], "a busy computer is never stopped");
  await ch.tickComputerHours(now + 32 * 60_000, [machine(bot.id, lea.id, 0), machine("idle2", lea.id, 0)], async (k) => { slept.push(k); });
  assert.deepEqual(slept, [bot.id, "idle2"], "idle ones go to sleep");
  const err = ch.wakeRefusal(lea.id, "fr");
  assert.match(err?.message ?? "", /^Les heures d'ordinateur du mois sont épuisées \(\d+(\.\d)? h sur 0\.5 h\)\. Relève le plafond \(Réglages → Usage → Heures d'ordinateur\)/);
  assert.match(ch.wakeRefusal(lea.id, "en")?.message ?? "", /Raise the cap \(Settings → Usage → Computer hours\) or wait for the 1st of next month/);
  assert.equal(ch.hoursView(lea.id).reached, true);
  await ch.tickComputerHours(now + 33 * 60_000, [machine(bot.id, lea.id, 1)], async () => undefined);
  const notices = rows.all(bot.id, bot.generation).filter((r) => r.body.kind === "notice" && /Heures d'ordinateur épuisées/.test((r.body as { text: string }).text));
  assert.equal(notices.length, 1, "one notice for the month, not one per count");
  ch.setOwnCap(lea.id, 0);
  assert.equal(ch.wakeRefusal(lea.id), null, "no cap: wakes again");
});

test("L95: hosted mode — the operator's cap applies to customers (the lower of the two counts), never to operators", async () => {
  const { isOperator } = await import("../src/hosted.js");
  const cust = users.create("cust@example.com", "Cust", "x", "en");
  process.env.HOSTED_MODE = "1";
  process.env.COMPUTER_HOURS_MONTH = "10";
  try {
    assert.ok(isOperator(lea.id), "the oldest account is the operator");
    assert.equal(ch.capOf(lea.id), null, "operator: not capped by COMPUTER_HOURS_MONTH");
    assert.equal(ch.capOf(cust.id), 10);
    ch.setOwnCap(cust.id, 4);
    assert.equal(ch.capOf(cust.id), 4, "the lower one");
    ch.setOwnCap(cust.id, 20);
    assert.equal(ch.capOf(cust.id), 10);
  } finally { delete process.env.HOSTED_MODE; delete process.env.COMPUTER_HOURS_MONTH; }
  assert.equal(ch.capOf(cust.id), 20, "self-hosted: the owner's own cap only");
});

test("L95: running computers no bot owns are stopped (never removed), after an hour; known and stopped ones are left", async () => {
  const known = ch.knownComputerNames();
  assert.ok(known.has(`sklubot-${bot.id}`) && known.has(`sklubot-fc-${bot.id}`), "a bot's own and free computer");
  const calls: string[][] = [];
  const at = Date.UTC(2026, 10, 23, 12, 0);
  const fake = (async (args: string[]) => {
    calls.push(args);
    if (args[0] === "ps") return { code: 0, stdout: Buffer.from(`sklubot-${bot.id}\trunning\nsklubot-gone1\trunning\nsklubot-gone2\texited\nsklubot-young\trunning\n`), stderr: "" };
    if (args[0] === "inspect") return { code: 0, stdout: Buffer.from(args.at(-1) === "sklubot-young" ? new Date(at - 10 * 60_000).toISOString() : new Date(at - 5 * H).toISOString()), stderr: "" };
    return { code: 0, stdout: Buffer.alloc(0), stderr: "" };
  }) as unknown as Parameters<typeof ch.stopOrphanComputers>[1];
  const stopped = await ch.stopOrphanComputers(known, fake, at);
  assert.deepEqual(stopped, ["sklubot-gone1"]);
  assert.ok(!calls.some((c) => c[0] === "rm"), "never removed");
  assert.deepEqual(calls.filter((c) => c[0] === "stop").map((c) => c.at(-1)), ["sklubot-gone1"]);
});

const { docker } = await import("../src/linux.js");
const dockerUp = (await docker(["info"], { timeoutMs: 8000 }).catch(() => ({ code: 1 }))).code === 0;
test("L95: on a Linux computer, a bot past its account's hours gets the error instead of a computer (nothing made)", { skip: !dockerUp && "Docker is not running" }, async () => {
  process.env.COMPUTER = "linux";
  const { initComputer, screen } = await import("../src/computer.js");
  const { containerName } = await import("../src/linux.js");
  await initComputer();
  const late = bots.create(lea.id, { name: "Tardif", autonomy: "balanced" });
  ch.setOwnCap(lea.id, 0.5);
  await assert.rejects(screen.wake(late.id, lea.id), /Les heures d'ordinateur du mois sont épuisées/);
  assert.notEqual((await docker(["inspect", containerName(late.id)], { timeoutMs: 8000 })).code, 0, "no container was made");
  ch.setOwnCap(lea.id, 0);
});
