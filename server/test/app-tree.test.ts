import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// L164 — the app reader by accessibility on the bot's own Linux computer (apptree.ts, agent/tools-apptree.ts).
// Unit part: a fake computer. Live part (only with SKLUBOT_A11Y_IMAGE, a desktop image built from docker/desktop): a real
// GTK app (Mousepad) read and used through AT-SPI inside the image.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-apptree-"));

const { APP_TREE_PY } = await import("../src/apptree.js");
const T = await import("../src/agent/tools-apptree.js");
const { resourcesOf } = await import("../src/agent/turnlocks.js");
import type { AppTreeAnswer } from "../src/apptree.js";
import type { ToolContext } from "../src/agent/tools.js";

const tool = (name: string) => T.appTreeTools.find((t) => t.spec.name === name)!;
const ctx = { bot: { id: "bot-a", name: "Zoé" }, user: { id: "user-a", locale: "fr" }, depth: 0, signal: new AbortController().signal } as unknown as ToolContext;
const text = (o: { content: unknown }) => (typeof o.content === "string" ? o.content : JSON.stringify(o.content));

const TREE: AppTreeAnswer = {
  ok: true, app: "mousepad", pid: 71,
  windows: [{ index: 1, role: "dialog", title: "Envoyer le document", active: true, modal: true, showing: true }, { index: 0, role: "frame", title: "Notes - Mousepad", active: false, modal: false, showing: true }],
  elements: [
    { path: [1], role: "dialog", name: "Envoyer le document", window: "Envoyer le document" },
    { path: [1, 0, 0], role: "text", name: "Adresse", window: "Envoyer le document", value: "paul@example.com", editable: true, focused: true },
    { path: [1, 0, 1], role: "password text", name: "Mot de passe", window: "Envoyer le document", secure: true, value: "should-never-show" },
    { path: [1, 0, 2], role: "push button", name: "Envoyer", window: "Envoyer le document" },
    { path: [1, 0, 3], role: "push button", name: "Annuler", window: "Envoyer le document" },
    { path: [0, 0, 0], role: "menu", name: "File", window: "Notes - Mousepad" },
  ],
};
let calls: Record<string, any>[] = [];
let next: AppTreeAnswer | ((req: Record<string, any>) => AppTreeAnswer) = TREE;
T.setAppTreeRunner(async (_c, req) => { calls.push(req as Record<string, any>); return typeof next === "function" ? next(req as Record<string, any>) : next; });
after(() => T.setAppTreeRunner(null));

async function read(): Promise<string> {
  next = TREE; calls = [];
  const out = await tool("app_tree").run({}, ctx);
  const ref = /\[(x[0-9a-f]{4})\.1\]/.exec(text(out))?.[1];
  assert.ok(ref, text(out));
  return ref!;
}

test("app_tree lists the dialog box first, with references, a field's text, and never a password field's text", async () => {
  next = TREE; calls = [];
  const out = await tool("app_tree").run({ limit: 999 }, ctx);
  const s = text(out);
  assert.equal(calls[0].op, "tree");
  assert.equal(calls[0].limit, 300, "the limit is capped at 300");
  assert.match(s, /window in front: “Envoyer le document” \(a dialog box: answer it first\)/);
  assert.match(s, /\[x[0-9a-f]{4}\.2\] text "Adresse" value="paul@example\.com" \(focused\)/);
  assert.match(s, /\[x[0-9a-f]{4}\.3\] password text "Mot de passe" \(password field: never read or filled\)/);
  assert.doesNotMatch(s, /should-never-show/);
  assert.equal((s.match(/^— window /gm) ?? []).length, 2, "one heading per window");
  assert.equal(out.summary, "6 · mousepad");
});

test("app_act: unknown, old or malformed references are refused and nothing reaches the computer", async () => {
  const id = await read();
  calls = [];
  for (const ref of ["3f9a.2", "x0000.2", `${id}.99`]) {
    const out = await tool("app_act").run({ ref, action: "click" }, ctx);
    assert.equal(out.isError, true, ref);
  }
  assert.match(text(await tool("app_act").run({ ref: "x0000.2", action: "click" }, ctx)), /older reading/);
  assert.equal(calls.length, 0);
});

test("app_act never fills a password field", async () => {
  const id = await read();
  calls = [];
  const out = await tool("app_act").run({ ref: `${id}.3`, action: "set_text", text: "secret" }, ctx);
  assert.equal(out.isError, true);
  assert.match(text(out), /password field/);
  assert.equal(calls.length, 0);
});

test("app_act sends the control's place, role and name as read; the computer's answer is said in words", async () => {
  const id = await read();
  calls = []; next = { ok: true, verified: true };
  const out = await tool("app_act").run({ ref: `${id}.2`, action: "set_text", text: "zoe@example.com" }, ctx);
  assert.deepEqual(calls[0], { op: "act", pid: 71, path: [1, 0, 0], role: "text", name: "Adresse", action: "set_text", text: "zoe@example.com" });
  assert.match(text(out), /Put 15 characters into text “Adresse” in mousepad — verified/);
  next = { ok: false, stale: "the control changed (now push button \"OK\")" };
  const stale = await tool("app_act").run({ ref: `${id}.4`, action: "click" }, ctx);
  assert.equal(stale.isError, true);
  assert.match(text(stale), /out of date: the control changed.*Nothing was done/);
  next = { ok: false, error: "no_action", at: [400, 300] };
  assert.match(text(await tool("app_act").run({ ref: `${id}.5`, action: "click" }, ctx)), /x=400, y=300.*screen_click/);
});

test("clicking a control whose words commit something asks the owner on a single-use card; other actions do not", async () => {
  const id = await read();
  const gate = tool("app_act").gate!;
  const g = gate({ ref: `${id}.4`, action: "click" }, { botId: "bot-a", tainted: false });
  assert.ok(g, "« Envoyer » commits something");
  assert.equal(g!.strict, true);
  assert.equal(g!.once, true);
  assert.deepEqual(g!.vars, { label: "Envoyer", app: "mousepad" });
  assert.equal(gate({ ref: `${id}.5`, action: "click" }, { botId: "bot-a", tainted: false }), null, "« Annuler » only closes");
  assert.equal(gate({ ref: `${id}.4`, action: "focus" }, { botId: "bot-a", tainted: false }), null);
  assert.equal(gate({ ref: `${id}.2`, action: "set_text" }, { botId: "bot-a", tainted: false }), null);
  // The words come from the computer's reading, never from the bot: another bot has no reading, so nothing to judge.
  assert.equal(gate({ ref: `${id}.4`, action: "click" }, { botId: "bot-b", tainted: false }), null);
});

test("an older computer without AT-SPI, a frozen app and a just-started reader are said plainly", async () => {
  next = { error: "no_atspi" };
  assert.match(text(await tool("app_tree").run({}, ctx)), /older image without the accessibility reader/);
  next = { error: "timeout" };
  assert.match(text(await tool("app_windows").run({}, ctx)), /did not answer in time/);
  next = { ok: true, started: true, apps: [] };
  assert.match(text(await tool("app_windows").run({}, ctx)), /just switched on.*reopen/);
  next = { ok: false, error: "not_found" };
  assert.match(text(await tool("app_tree").run({ app: "gimp" }, ctx)), /No open app called "gimp"/);
});

test("the app tools take the screen like the other screen tools", () => {
  for (const n of ["app_windows", "app_tree", "app_act"]) assert.deepEqual(resourcesOf(n, {}), ["screen"], n);
});

test("the helper is valid Python", { skip: spawnSync("python3", ["--version"]).status !== 0 && "no python3 here" }, () => {
  const r = spawnSync("python3", ["-c", "import ast, sys; ast.parse(sys.stdin.read())"], { input: APP_TREE_PY, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

// ── Live: a real GTK app in the desktop image ─────────────────────────────────────────────────────────────────────
const IMAGE = process.env.SKLUBOT_A11Y_IMAGE;
const docker = (args: string[], input?: string) => spawnSync("docker", args, { input, encoding: "utf8", timeout: 60_000 });
test("live: Mousepad in the desktop image is read and used by reference through AT-SPI", { skip: !IMAGE && "set SKLUBOT_A11Y_IMAGE to a desktop image built from docker/desktop", timeout: 120_000 }, async () => {
  const name = `sklubot-apptree-${process.pid}`;
  assert.equal(docker(["run", "-d", "--name", name, IMAGE!]).status, 0);
  try {
    await new Promise((r) => setTimeout(r, 4000));
    // The bus was started by start-desktop.sh before any app: the reader does not have to start it.
    T.setAppTreeRunner(async (_c, req) => {
      const r = docker(["exec", "-i", name, "python3", "-c", APP_TREE_PY], JSON.stringify(req));
      return JSON.parse(r.stdout) as AppTreeAnswer;
    });
    assert.equal(docker(["exec", "-d", name, "mousepad"]).status, 0);
    let windows = "";
    for (let i = 0; i < 20 && !/mousepad/.test(windows); i++) { await new Promise((r) => setTimeout(r, 500)); windows = text(await tool("app_windows").run({}, ctx)); }
    assert.match(windows, /- mousepad: “Untitled 1 - Mousepad” \(in front\)/);
    assert.doesNotMatch(windows, /just switched on/, "start-desktop.sh had started the bus");
    const tree = text(await tool("app_tree").run({}, ctx));
    const field = new RegExp(String.raw`\[(x[0-9a-f]{4}\.\d+)\] text "" value="" \(focused\)`).exec(tree)?.[1];
    const file = /\[(x[0-9a-f]{4}\.\d+)\] menu "File"/.exec(tree)?.[1];
    assert.ok(field && file, tree);
    assert.match(text(await tool("app_act").run({ ref: field, action: "set_text", text: "Bonjour depuis l'arbre" }, ctx)), /— verified/);
    assert.match(text(await tool("app_act").run({ ref: file, action: "click" }, ctx)), /Clicked menu “File”/);
    const menu = text(await tool("app_tree").run({}, ctx));
    assert.match(menu, /menu item "Save As\.\.\."/);
    assert.match(menu, /value="Bonjour depuis l'arbre"/);
    const saveAs = /\[(x[0-9a-f]{4}\.\d+)\] menu item "Save As\.\.\."/.exec(menu)![1];
    await tool("app_act").run({ ref: saveAs, action: "click" }, ctx);
    await new Promise((r) => setTimeout(r, 1500));
    const dialog = text(await tool("app_tree").run({}, ctx));
    assert.match(dialog, /window in front: “Save As” \(a dialog box: answer it first\)/);
    assert.ok(dialog.indexOf("push button \"Cancel\"") < dialog.indexOf("menu \"File\""), "the dialog box is listed first");
    // A reference from the reading before the dialog box opened is refused: references belong to one reading.
    const stale = text(await tool("app_act").run({ ref: saveAs, action: "click" }, ctx));
    assert.match(stale, /older reading/);
  } finally {
    docker(["rm", "-f", name]);
    T.setAppTreeRunner(null);
  }
});
