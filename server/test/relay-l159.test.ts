import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L159 (agent/mycomputerplus.ts): another screen of the computer, for looking only (an old Relais is said honestly),
// and waiting for a window by its title (once a second, at most 60 s, keep-out windows never named). The relay calls
// are replaced: no device.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-l159-"));
process.env.SESSION_SECRET = "l159-secret-l159-secret-l159-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
for (const k of ["HOSTED_MODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const { builtinTools } = await import("../src/agent/tools.js"); // first, as the server loads it (myui.ts needs mycomputer.ts loaded)
const { myComputerPlusTools, relayCalls, setWaitSleep, WAIT_MAX_S } = await import("../src/agent/mycomputerplus.js");
const { users, bots } = await import("../src/store.js");

const owner = users.create("l159@test.local", "A", "unused", "fr");
const bot = bots.create(owner.id, { name: "Relais" });
const ctx = { bot, user: owner, depth: 0, signal: AbortSignal.timeout(5000), thread: 0, origin: "user" } as any;
const target = { id: "dev1", name: "portable", label: "portable de Léa", kind: "computer", platform: "linux" };
const sent: { op: string; args: any }[] = [];
let answers: any[] = [];
relayCalls.inSession = (async (_c: any, _a: any, _n: any, _r: any, fn: any) => fn(target)) as any;
relayCalls.act = (async (_c: any, _t: any, op: string, args: any) => { sent.push({ op, args }); const a = answers.shift(); return a ?? { ok: true, result: { windows: [] } }; }) as any;
let waited = 0;
setWaitSleep(async () => { waited++; });
const tool = (n: string) => myComputerPlusTools.find((t) => t.spec.name === n)!;

test("L159 the tools are offered with the user's computer tools, read-only ones", () => {
  const names = builtinTools({}).map((t) => t.spec.name);
  assert.ok(names.includes("my_screen_other") && names.includes("my_window_wait"));
});

test("L159 another screen: asks screen.capture with display n-1, says it is for looking only", async () => {
  sent.length = 0;
  answers = [{ ok: true, result: { format: "jpeg", width: 1280, height: 720, data: "AAAA", displayIndex: 1, displays: 2 } }];
  const out = await tool("my_screen_other").run({ screen: 2 }, ctx);
  assert.deepEqual(sent[0], { op: "screen.capture", args: { format: "jpeg", maxWidth: 1280, quality: 70, display: 1 } });
  assert.match((out.content as any)[0].text, /^Screen 2 of 2 of portable de Léa: 1280×720 pixels\. For looking only/);
  assert.equal((out.content as any)[1].type, "image");
  answers = [{ ok: true, result: { format: "jpeg", width: 1280, height: 720, data: "AAAA" } }];
  const old = await tool("my_screen_other").run({ screen: 2 }, ctx);
  assert.match((old.content as any)[0].text, /too old to show another screen: this is the MAIN screen/);
  assert.equal((await tool("my_screen_other").run({ screen: 0 }, ctx)).isError, true);
});

test("L159 window wait: found after a few polls, accents and case ignored; not found says so; at most 60 s", async () => {
  sent.length = 0; waited = 0;
  answers = [{ ok: true, result: { windows: [{ title: "Terminal" }] } }, { ok: true, result: { windows: [{ title: "Terminal" }] } }, { ok: true, result: { windows: [{ title: "Téléchargement terminé — Firefox" }] } }];
  const out = await tool("my_window_wait").run({ title: "telechargement", seconds: 10 }, ctx);
  assert.equal(out.content, 'The window "Téléchargement terminé — Firefox" is open (after 2 s).');
  assert.equal(sent.filter((s) => s.op === "window.list").length, 3);
  assert.equal(waited, 2);
  sent.length = 0; waited = 0; answers = [];
  const none = await tool("my_window_wait").run({ title: "Facture", seconds: 999 }, ctx);
  assert.equal(none.content, `No window with "Facture" in its title appeared within ${WAIT_MAX_S} s.`);
  assert.equal(sent.length, WAIT_MAX_S + 1, "never more than 60 s");
});
