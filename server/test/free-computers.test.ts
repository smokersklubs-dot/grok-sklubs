import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// The free plan's computers (freecomputers.ts): in hosted mode an account on a "free" plan has no personal computer; its
// bots borrow a disposable one from a pool capped by FREE_COMPUTERS_MAX (default 1), wait while it is busy, get a clear
// "busy" error past the wait, and never use a subscription tool. Paid plans and operators keep their own computers.
// (No Docker here: the pool's bookkeeping is tested; making and wiping containers is linux.ts's, tested in wave7-linux.)
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-freepc-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.HOSTED_MODE = "1";
process.env.OPEN_SIGNUP = "1";
process.env.DOCKER_HOST = "unix:///nonexistent/docker.sock";
for (const k of ["FREE_COMPUTERS_MAX", "FREE_PLAN_COMPUTER", "FREE_COMPUTER_GRACE_SEC", "SETUP_CODE", "SKLUBOT_SETUP_CODE"]) delete process.env[k];

const { api } = await import("../src/routes.js");
const { users, bots } = await import("../src/store.js");
const hosted = await import("../src/hosted.js");
const { machineOf, machineMembers, computerRunArgs } = await import("../src/linux.js");
const fc = await import("../src/freecomputers.js");
fc.freeTiming.waitMs = 300;
fc.freeTiming.stepMs = 20;

const owner = users.create("owner@example.test", "Owner", "x", "fr");
const freeUser = users.create("free@example.test", "Free", "x", "fr");
const free2 = users.create("free2@example.test", "Free 2", "x", "fr");
const paid = users.create("paid@example.test", "Paid", "x", "fr");
hosted.subscriptions.start(freeUser.id, "free");
hosted.subscriptions.start(free2.id, "free");
hosted.subscriptions.start(paid.id, "included");
const fBot = bots.create(freeUser.id, { name: "Libre", primary: true });
const fBot2 = bots.create(free2.id, { name: "Libre 2", primary: true });
const pBot = bots.create(paid.id, { name: "Payant", primary: true });
const oBot = bots.create(owner.id, { name: "Proprio", primary: true });

test("free plan: a disposable free computer (its own key, its own library); paid and operator: their own computer", () => {
  assert.equal(machineOf(fBot.id), `fc-${fBot.id}`);
  assert.deepEqual(machineMembers(`fc-${fBot.id}`), [fBot.id], "the bot's own library and socket");
  assert.equal(machineOf(pBot.id), pBot.id);
  assert.equal(machineOf(oBot.id), oBot.id);
  // Smaller than a personal computer; same hardening.
  const args = computerRunArgs(`fc-${fBot.id}`, { libraries: [], team: null, quota: [] }).join(" ");
  assert.match(args, /--memory 1g --memory-swap 1g --cpus 1 /);
  assert.match(args, /--cap-drop ALL/);
  assert.match(args, /--security-opt no-new-privileges/);
  assert.match(computerRunArgs(pBot.id, { libraries: [], team: null, quota: [] }).join(" "), /--memory 2g/);
  // No subscription tool on a free computer (its sign-in would not survive).
  assert.equal(hosted.engineBlock(freeUser.id, false), "engines");
  assert.equal(hosted.engineBlock(paid.id, false), null);
  assert.equal(hosted.subscriptionEnginesFor(freeUser.id), false);
});

test("the pool: FREE_COMPUTERS_MAX at once; another bot waits, then gets a clear busy error; a slot idle past the grace is handed over", async () => {
  fc._resetFree();
  assert.equal(await fc.acquireFree(fBot.id, freeUser.id), `fc-${fBot.id}`);
  assert.equal(await fc.acquireFree(fBot.id, freeUser.id), `fc-${fBot.id}`, "re-entrant");
  const t0 = Date.now();
  await assert.rejects(fc.acquireFree(fBot2.id, free2.id), (e: Error) => e.name === "FreeComputersBusyError" && /all in use/.test(e.message));
  assert.ok(Date.now() - t0 >= 250, "it waited first");
  // The first slot's computer never came up and is old: it may go to the waiting bot (and is wiped).
  fc._freeSlots.get(`fc-${fBot.id}`)!.at = Date.now() - 10 * 60_000;
  assert.equal(await fc.acquireFree(fBot2.id, free2.id), `fc-${fBot2.id}`);
  assert.deepEqual([...fc._freeSlots.keys()], [`fc-${fBot2.id}`]);
  // Two at a time when the operator allows it.
  process.env.FREE_COMPUTERS_MAX = "2";
  assert.equal(await fc.acquireFree(fBot.id, freeUser.id), `fc-${fBot.id}`);
  assert.equal(fc._freeSlots.size, 2);
  // Sweep: slots whose computer is gone are freed.
  for (const s of fc._freeSlots.values()) s.at = 0;
  assert.equal(await fc.sweepFreeComputers(), 2);
  assert.equal(fc._freeSlots.size, 0);
  delete process.env.FREE_COMPUTERS_MAX;
});

test("FREE_COMPUTERS_MAX=0: no computer at all on the free plan; FREE_PLAN_COMPUTER=personal: the earlier personal computer", async () => {
  fc._resetFree();
  process.env.FREE_COMPUTERS_MAX = "0";
  await assert.rejects(fc.acquireFree(fBot.id, freeUser.id), (e: Error) => e.name === "NoFreeComputerError");
  const landing = await api.request("/public/landing");
  assert.equal((await landing.json()).hosted.freeComputers, "none");
  delete process.env.FREE_COMPUTERS_MAX;
  assert.equal((await (await api.request("/public/landing")).json()).hosted.freeComputers, "pool");
  process.env.FREE_PLAN_COMPUTER = "personal";
  assert.equal(machineOf(fBot.id), fBot.id);
  assert.equal(hosted.engineBlock(freeUser.id, false), null);
  delete process.env.FREE_PLAN_COMPUTER;
  // A customer moved to a paid plan gets their own computer back at once.
  hosted.subscriptions.update(freeUser.id, { planId: "included" });
  assert.equal(machineOf(fBot.id), fBot.id);
});
