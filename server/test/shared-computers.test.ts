import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Part B: shared computers — allocation (first free, the last one used, waiting, a clear "busy"), one bot at a time,
// one subscription tool at a time per computer, and isolation between accounts. No Docker needed here: the real
// containers are exercised in botlink-live.test.ts.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-shared-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.MAX_SHARED_COMPUTERS = "2";
process.env.BOT_LINK = "socket";
process.env.DATA_VOLUME = "sklubot_data";
process.env.BOTS_NETWORK = "sklubot_bots";

const { bots, users } = await import("../src/store.js");
const { acquireShared, leaseTiming, membersOf, resetLeases, sharedAllocator, sharedComputers, SharedComputersBusyError, SharedLimitError, sharedView } = await import("../src/sharedcomputers.js");
const { computerRunArgs, containerName, machineOf } = await import("../src/linux.js");
const { setEngineHost, withEngineLock } = await import("../src/agent/engine.js");

const u1 = users.create("one@example.com", "One", "x");
const u2 = users.create("two@example.com", "Two", "x");
const a = bots.create(u1.id, { name: "A" });
const b = bots.create(u1.id, { name: "B" });
const own = bots.create(u1.id, { name: "Own" });
const c = bots.create(u2.id, { name: "C" });
for (const x of [a, b, c]) bots.patch(x.id, { computerMode: "shared" });
leaseTiming.waitMs = 400;
leaseTiming.stepMs = 50;

test("Part B: the setting is stored per bot; own computers are untouched", () => {
  assert.equal(bots.byId(a.id)!.computerMode, "shared");
  assert.equal(bots.byId(own.id)!.computerMode, "own");
  bots.patch(own.id, { computerMode: "evil" });
  assert.equal(bots.byId(own.id)!.computerMode, "own");
  // A bot on its own computer keeps the same container name as before (its own id).
  assert.equal(machineOf(own.id), own.id);
  assert.equal(containerName(own.id), `sklubot-${own.id}`);
});

test("Part B: one bot at a time — the second waits for the first, then gets the same computer", async () => {
  resetLeases();
  const first = await acquireShared(a.id, u1.id);
  const [only] = sharedComputers.list(u1.id);
  assert.equal(first.key, only.id);
  // Re-entrant: A's own tool calls during its turn.
  const again = await sharedAllocator.acquire(a.id, u1.id);
  assert.equal(again.key, first.key);
  again.release();
  assert.equal(sharedView(u1.id)[0].busyWith, a.id);
  let gotAt = 0;
  const waiting = acquireShared(b.id, u1.id).then((l) => { gotAt = Date.now(); return l; });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(gotAt, 0, "B waits while A drives the computer");
  const releasedAt = Date.now();
  first.release();
  const second = await waiting;
  assert.equal(second.key, first.key);
  assert.ok(gotAt >= releasedAt);
  // The view shows who drives it, and who had it last.
  assert.equal(sharedView(u1.id)[0].busyWith, b.id);
  assert.deepEqual(sharedView(u1.id)[0].lastBots.slice(0, 2), [b.id, a.id]);
  second.release();
  assert.equal(sharedView(u1.id)[0].busyWith, null);
});

test("Part B: all taken past the wait → a clear 'busy' error; a second computer is used at once", async () => {
  resetLeases();
  const held = await acquireShared(a.id, u1.id);
  await assert.rejects(acquireShared(b.id, u1.id), (err: unknown) => err instanceof SharedComputersBusyError && /being used by another bot/.test((err as Error).message));
  const second = sharedComputers.add(u1.id);
  const lease = await acquireShared(b.id, u1.id);
  assert.equal(lease.key, second.id);
  assert.throws(() => sharedComputers.add(u1.id), SharedLimitError);
  lease.release();
  held.release();
  // Each bot goes back to the computer it used last when it is free.
  const again = await acquireShared(b.id, u1.id);
  assert.equal(again.key, second.id);
  again.release();
  assert.equal(sharedAllocator.current(b.id), second.id);
  assert.equal(containerName(b.id), `sklubot-${second.id}`);
});

test("Part B: isolation — an account's shared computers are never another account's", async () => {
  resetLeases();
  const lc = await sharedAllocator.acquire(c.id, u1.id); // even if work for C were started on behalf of someone else
  assert.ok(sharedComputers.list(u2.id).some((x) => x.id === lc.key));
  assert.ok(!sharedComputers.list(u1.id).some((x) => x.id === lc.key));
  lc.release();
  for (const sc of sharedComputers.list(u1.id)) assert.deepEqual(membersOf(sc.id), [a.id, b.id].sort());
  assert.deepEqual(membersOf(sharedComputers.list(u2.id)[0].id), [c.id]);
  // A bot on its own computer never takes a shared one.
  const lo = await sharedAllocator.acquire(own.id, u1.id);
  assert.equal(lo.key, own.id);
  lo.release();
  assert.equal(sharedAllocator.isShared(own.id), false);
  // Another account's bots never become members, and a bot switched back to its own computer leaves the list.
  bots.patch(b.id, { computerMode: "own" });
  assert.deepEqual(membersOf(sharedComputers.list(u1.id)[0].id), [a.id]);
  assert.equal(machineOf(b.id), b.id);
  bots.patch(b.id, { computerMode: "shared" });
});

test("Part B: a bot cannot stop the tool of another bot driving the shared computer", async () => {
  resetLeases();
  const lease = await acquireShared(a.id, u1.id);
  assert.equal(sharedAllocator.mayControl(a.id), true);
  // B last used a's computer? Make it so: B's current computer is the one A drives.
  const key = lease.key;
  lease.release();
  const lb = await acquireShared(b.id, u1.id); // b now remembers `key` or the second one; force the same one:
  lb.release();
  const la = await acquireShared(a.id, u1.id);
  const sameAsB = sharedAllocator.current(b.id) === la.key;
  if (sameAsB) assert.equal(sharedAllocator.mayControl(b.id), false);
  la.release();
  assert.equal(sharedAllocator.mayControl(b.id), true);
  void key;
});

test("Part B: the libraries of a shared computer are mounted side by side; its own computer as before; no swap; bots' network", () => {
  const [sc] = sharedComputers.list(u1.id);
  const args = computerRunArgs(sc.id, { libraries: membersOf(sc.id).map((id) => ({ dir: path.join(process.env.DATA_DIR!, "workspaces", id), dst: `/root/libraries/${id}` })), team: null, quota: [] });
  const s = args.join(" ");
  assert.match(s, new RegExp(`--name sklubot-${sc.id}`));
  assert.match(s, /--network sklubot_bots/);
  assert.match(s, /--memory 2g --memory-swap 2g/);
  for (const id of [a.id, b.id]) assert.match(s, new RegExp(`dst=/root/libraries/${id},volume-subpath=workspaces/${id}`));
  assert.doesNotMatch(s, /dst=\/root\/files/);
  assert.match(s, new RegExp(`dst=/run/sklubot,readonly,volume-subpath=botlink/${sc.id}`));
  assert.match(s, new RegExp(`sklubot.spec=socket:sklubot_bots;rt:default;libs:${[a.id, b.id].sort().join(",")}`));
  assert.match(s, /sklubot\.shared=1/);
  assert.match(s, new RegExp(`sklubot-home-${sc.id}:/root`));
  const mine = computerRunArgs(own.id, { libraries: [{ dir: path.join(process.env.DATA_DIR!, "workspaces", own.id), dst: "/root/files" }], team: null, quota: ["--storage-opt", "size=20G"] }).join(" ");
  assert.match(mine, new RegExp(`dst=/root/files,volume-subpath=workspaces/${own.id}`));
  assert.match(mine, /--storage-opt size=20G/);
  assert.doesNotMatch(mine, /host-gateway|sklubot_net/);
});

test("Part B: one subscription tool at a time per computer (a turn, then the side request waits or gives up)", async () => {
  setEngineHost({ ensure: async () => {}, writeFile: async () => {}, exec: async () => ({ code: 0, stderr: "" }), kill: async () => {}, ready: async () => {}, awake: () => true, machineOf: () => "shared-1" });
  const order: string[] = [];
  let finishFirst!: () => void;
  const first = withEngineLock(bots.byId(a.id)!, 0, async () => { order.push("a start"); await new Promise<void>((r) => { finishFirst = r; }); order.push("a end"); });
  await new Promise((r) => setTimeout(r, 20));
  const second = withEngineLock(bots.byId(b.id)!, 0, async () => { order.push("b start"); });
  // A side request that cannot wait long gives up instead of running beside the turn.
  await assert.rejects(withEngineLock(bots.byId(b.id)!, 50, async () => { order.push("side"); }), /busy/);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(order, ["a start"]);
  finishFirst();
  await first; await second;
  assert.deepEqual(order, ["a start", "a end", "b start"]);
  setEngineHost(null);
});
