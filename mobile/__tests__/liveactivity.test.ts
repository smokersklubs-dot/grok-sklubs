/**
 * L177 — iPhone Live Activity, app side (src/liveActivity.ts): off unless built with the flag on an iPhone AND enabled
 * on the server; start / update / end follow the bots' live state; push tokens go to the server (replacing the old one);
 * signing out ends everything. The native module is a fake: nothing here runs ActivityKit.
 */
import { createLiveActivities, liveActivityBuilt, plan, threadsOf, type LiveActivityNative } from "../src/liveActivity";
import { parseStopUrl, stopUrl } from "../../server/src/clientshared/taskactivity";

const label = (k: string) => `[${k}]`;
const texts = { stop: "Arrêter", running: "En cours", waiting: "A besoin de toi", label };
const running = (detail: string, startedAt = 1_700_000_000_000) => ({ running: true, activity: { kind: "reading", detail, since: startedAt }, awaiting: null, startedAt, queued: 0, steps: 2 });
const idle = { running: false, activity: null, awaiting: null, startedAt: null, queued: 0 };

function fakeNative() {
  const calls: string[] = [];
  let n = 0;
  let listener: ((e: { id: string; botId: string; thread: number; token: string }) => void) | null = null;
  const nat: LiveActivityNative = {
    areEnabled: () => true,
    list: () => [],
    start: async (attrs, state, withPush) => { calls.push(`start ${attrs.botId}:${attrs.thread} ${state.step} push=${withPush} ${attrs.stopUrl}`); return `act${++n}`; },
    update: async (id, state) => { calls.push(`update ${id} ${state.step}`); return true; },
    end: async (id) => { calls.push(`end ${id}`); return true; },
    addListener: (_name, fn) => { listener = fn; return { remove: () => { listener = null; } }; },
  };
  return { nat, calls, emit: (e: { id: string; botId: string; thread: number; token: string }) => listener?.(e) };
}

test("off by default: only an iPhone build with extra.liveActivity === true and the native module", () => {
  expect(liveActivityBuilt({ variant: "store" }, "ios", true)).toBe(false);
  expect(liveActivityBuilt({ liveActivity: true }, "android", true)).toBe(false);
  expect(liveActivityBuilt({ liveActivity: true }, "ios", false)).toBe(false);
  expect(liveActivityBuilt({ liveActivity: true }, "ios", true)).toBe(true);
});

test("plan: start new tasks, update changed ones, end finished ones, lanes by thread, at most 3", () => {
  const bots = { b1: { name: "Max" }, b2: { name: "Léa" } };
  expect(plan(new Map(), bots, { b1: running("Lit la page"), b2: idle }, label)).toEqual([
    { kind: "start", key: "b1:0", botId: "b1", thread: 0, botName: "Max", state: { step: "Lit la page", steps: 2, startedAt: 1_700_000_000, awaiting: false } },
  ]);
  const shown = new Map([["b1:0", { id: "a1", botId: "b1", thread: 0, state: { step: "Lit la page", steps: 2, startedAt: 1_700_000_000, awaiting: false } }]]);
  expect(plan(shown, bots, { b1: running("Lit la page") }, label)).toEqual([]);
  expect(plan(shown, bots, { b1: running("Ouvre le site") }, label).map((a) => a.kind)).toEqual(["update"]);
  expect(plan(shown, bots, { b1: idle }, label).map((a) => a.kind)).toEqual(["end"]);
  expect(plan(shown, {}, { b1: running("x") }, label).map((a) => a.kind)).toEqual(["end"]); // bot gone (signed out, removed)
  const lanes = { ...running("x"), tasks: [0, 4, 9, 12].map((thread, i) => ({ thread, running: true, activity: null, awaiting: null, startedAt: 1_700_000_000_000 + i * 1000 })) };
  expect(threadsOf(lanes)).toEqual([0, 4, 9, 12]);
  const many = plan(new Map(), bots, { b1: lanes }, label);
  expect(many.map((a) => a.key)).toEqual(["b1:12", "b1:9", "b1:4"]); // the three most recent
});

test("controller: nothing while the server has it off", async () => {
  const f = fakeNative();
  const la = createLiveActivities(f.nat, true);
  expect(await la.connect(async () => ({ enabled: false }) as never)).toBe(false);
  await la.sync({ b1: { name: "Max" } }, { b1: running("Lit") }, texts);
  expect(f.calls).toEqual([]);
});

test("controller: start with the stop link, push token to the server (replacing the old one), end and token removed", async () => {
  const f = fakeNative();
  const api: [string, string, unknown][] = [];
  const call = async (method: string, path: string, body?: unknown) => { api.push([method, path, body]); return { enabled: true } as never; };
  const la = createLiveActivities(f.nat, true);
  expect(await la.connect(call)).toBe(true);
  await la.sync({ b1: { name: "Max" } }, { b1: running("Lit la page") }, texts);
  expect(f.calls).toEqual([`start b1:0 Lit la page push=true ${stopUrl("b1", 0)}`]);
  f.emit({ id: "act1", botId: "b1", thread: 0, token: "aa".repeat(32) });
  f.emit({ id: "act1", botId: "b1", thread: 0, token: "bb".repeat(32) });
  await new Promise((r) => setTimeout(r, 0));
  expect(api.filter(([m]) => m === "POST")).toEqual([
    ["POST", "/bots/b1/live-activity", { token: "aa".repeat(32), thread: 0 }],
    ["POST", "/bots/b1/live-activity", { token: "bb".repeat(32), thread: 0, replaces: "aa".repeat(32) }],
  ]);
  await la.sync({ b1: { name: "Max" } }, { b1: running("Ouvre le site") }, texts);
  await la.sync({ b1: { name: "Max" } }, { b1: idle }, texts);
  expect(f.calls.slice(1)).toEqual(["update act1 Ouvre le site", "end act1"]);
  expect(api.at(-1)).toEqual(["DELETE", `/live-activity/${"bb".repeat(32)}`, undefined]);
  expect(la.shownCount()).toBe(0);
});

test("signing out ends every Live Activity", async () => {
  const f = fakeNative();
  const la = createLiveActivities(f.nat, true);
  await la.connect(async () => ({ enabled: true }) as never);
  await la.sync({ b1: { name: "Max" } }, { b1: running("Lit") }, texts);
  await la.reset();
  expect(f.calls.at(-1)).toBe("end act1");
  await la.sync({ b1: { name: "Max" } }, { b1: running("Lit") }, texts);
  expect(f.calls.length).toBe(2); // nothing after sign-out until the next connect
});

test("stop link: only sklubot://stop/<bot>?thread=<n>", () => {
  expect(parseStopUrl("sklubot://stop/bot_1?thread=3")).toEqual({ botId: "bot_1", thread: 3 });
  expect(parseStopUrl("sklubot://bot/bot_1")).toBeNull();
  expect(parseStopUrl("sklubot://stop/%2E%2E%2Fx")).toBeNull();
});
