import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { computerKind, removeWorkspace, workspaceOf } from "./computer.js";
import { config } from "./config.js";
import { containerName, docker, ensureDressed, linuxScreen, powerOf, setLookOverride, type Look } from "./linux.js";
import type { DeskCheck, DeskTestRun } from "./shared.js";

/**
 * The desk test (B-10): an end-to-end run on real bot computers, separate from the unit tests. It starts two computers
 * for invented bots (never a real bot's, never touching user data), checks each step a bot relies on — the computer
 * starts, the screen draws, the look is applied, the browser answers on its own debugging port with its own profile,
 * the home page greets the right bot, a second dressing is cheap and keeps the browser, a rename shows without a reload,
 * a page can be read, clicked and typed into, files go both ways, a reset closes a stray window and brings the home page
 * back, and the computer goes to sleep — and reports each check as passed or failed, with its time and pictures.
 *
 * Run it from Settings → Computer, or on the server: npm run desk:test (exit 0 = all passed, 1 = a check failed,
 * 2 = stopped on an error).
 */

/** A small debugging-protocol client dropped on the computer (run with python3 -, mode and arguments after it). */
const CDP_CLIENT = String.raw`
import json, sys, urllib.request
from websocket import create_connection
mode = sys.argv[1]
def tabs():
    return [t for t in json.load(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=5)) if t.get("type") == "page"]
def call(tab, method, params):
    ws = create_connection(tab["webSocketDebuggerUrl"], timeout=15, origin="http://127.0.0.1:9222")
    ws.send(json.dumps({"id": 1, "method": method, "params": params}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == 1:
            ws.close()
            return m.get("result", {})
def value(tab, expr):
    return call(tab, "Runtime.evaluate", {"expression": expr, "returnByValue": True}).get("result", {}).get("value")
try:
    if mode == "home":
        home = [t for t in tabs() if t.get("url", "").startswith("http://127.0.0.1:7391")]
        if not home:
            print(json.dumps({"error": "no tab shows the home page"}))
        else:
            print(value(home[0], "JSON.stringify({hello:(document.querySelector('.hello b')||{}).innerText||'',role:(document.querySelector('.role')||{}).innerText||'',tiles:document.querySelectorAll('.tile').length})"))
    elif mode == "goto":
        call(tabs()[0], "Page.navigate", {"url": sys.argv[2]})
        print("{}")
    elif mode == "eval":
        print(json.dumps({"value": value(tabs()[0], sys.argv[2])}))
except Exception as err:
    print(json.dumps({"error": str(err)}))
`;

/** A page with one big button (it gives focus to a field) and the field, for the click and typing checks. */
const TEST_PAGE = "data:text/html," + encodeURIComponent(
  `<title>desk</title><body style="margin:0;font:20px sans-serif"><input id="f" style="position:fixed;left:20px;top:20px;width:400px;font-size:20px">` +
  `<button onclick="document.title='clicked';document.getElementById('f').focus()" style="position:fixed;left:0;top:90px;width:100vw;height:calc(100vh - 90px);font-size:30px">Click</button></body>`);

export interface DeskOptions {
  /** Where pictures go (default: a folder in the data folder). */
  shotsDir?: string;
  /** Prefix of the invented bots' ids (letters, digits, _). */
  prefix?: string;
  /** Delete the test computers at the end (they are the desk test's own; default true). */
  clean?: boolean;
  onCheck?: (c: DeskCheck, run: DeskTestRun) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runDeskTest(opts: DeskOptions = {}): Promise<DeskTestRun> {
  const run: DeskTestRun = { id: `desk_${randomUUID().slice(0, 8)}`, status: "running", startedAt: Date.now(), finishedAt: null, checks: [], shots: [], error: null };
  const dir = opts.shotsDir ?? path.join(config.dataDir, "desk-test", run.id);
  mkdirSync(dir, { recursive: true });
  const prefix = (opts.prefix ?? "desk").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 24);
  const A = `${prefix}_a`, B = `${prefix}_b`;
  const USER = "desk-test";
  const looks: Record<string, Look> = {
    [A]: { name: "Orla", label: "Desk test · research", color: "moss", locale: "fr", owner: "", kind: "mascot" },
    [B]: { name: "Pim", label: "Desk test · writing", color: "ember", locale: "en", owner: "", kind: "dots" },
  };
  const renamed: Look = { name: "Quill", label: "Desk test · renamed", color: "sky", locale: "en", owner: "", kind: "muse" };
  for (const id of [A, B]) setLookOverride(id, looks[id]);

  const check = async (id: string, label: string, fn: () => Promise<string | void>) => {
    const t0 = Date.now();
    let c: DeskCheck;
    try { c = { id, label, ok: true, detail: (await fn()) || "ok", ms: Date.now() - t0 }; }
    catch (err) { c = { id, label, ok: false, detail: String((err as Error)?.message ?? err).slice(0, 300), ms: Date.now() - t0 }; }
    run.checks.push(c);
    opts.onCheck?.(c, run);
    return c.ok;
  };
  const exec = async (botId: string, args: string[], input?: string, timeoutMs = 20_000) => {
    const r = await docker(["exec", ...(input !== undefined ? ["-i"] : []), containerName(botId), ...args], { timeoutMs, input });
    return { code: r.code, out: r.stdout.toString("utf8").trim(), err: r.stderr.trim() };
  };
  const cdp = async (botId: string, ...args: string[]) => {
    const r = await exec(botId, ["python3", "-", ...args], CDP_CLIENT);
    try { return JSON.parse(r.out || "{}"); } catch { return { error: r.out || r.err || "no answer" }; }
  };
  const browserPid = async (botId: string) => (await exec(botId, ["sh", "-c", "pgrep -o -f 'user-data-dir=/root/.config/sklubot-browser' || true"])).out;
  const shot = async (botId: string, name: string) => {
    const s = await linuxScreen.view(botId, USER, workspaceOf(botId));
    const file = `${String(run.shots.length + 1).padStart(2, "0")}-${name}.jpg`;
    writeFileSync(path.join(dir, file), Buffer.from(s.data, "base64"));
    run.shots.push(file);
    return Buffer.from(s.data, "base64").length;
  };
  const greets = async (botId: string, name: string, within = 12_000) => {
    const until = Date.now() + within;
    let last: any = {};
    while (Date.now() < until) {
      last = await cdp(botId, "home");
      if (last.hello === name) return last;
      await sleep(700);
    }
    throw new Error(`the home page says ${JSON.stringify(last.hello ?? last.error ?? "")}, expected ${name}`);
  };

  try {
    if (computerKind() !== "linux") throw new Error("The desk test needs the bots' Linux computers (Docker and the desktop image) on this server.");
    const ws = (id: string) => workspaceOf(id);

    await check("create", "Computers start (two invented bots)", async () => {
      await Promise.all([A, B].map((id) => linuxScreen.wake(id, USER, ws(id))));
      const p = await Promise.all([A, B].map(powerOf));
      if (p.some((x) => x !== "running")) throw new Error(`power: ${p.join(", ")}`);
      return "both running";
    });
    await check("screen", "The screen draws at its size", async () => {
      const g = await exec(A, ["xdotool", "getdisplaygeometry"]);
      const [w, h] = config.desktopResolution.split("x");
      if (g.out !== `${w} ${h}`) throw new Error(`screen is ${g.out || g.err}, expected ${w} ${h}`);
      const bytes = await shot(A, "screen");
      if (bytes < 3000) throw new Error("the picture is empty");
      return `${g.out.replace(" ", "×")}`;
    });
    await check("dress", "The look is applied (wallpaper, dock, home page)", async () => {
      await Promise.all([A, B].map((id) => ensureDressed(id, true)));
      for (const id of [A, B]) {
        const look = JSON.parse((await exec(id, ["cat", "/root/.sklubot/look.json"])).out || "{}");
        if (look.name !== looks[id].name) throw new Error(`${id}: the look names ${look.name}`);
        const wall = await exec(id, ["sh", "-c", "ls /root/.sklubot/wallpaper-*.png"]);
        if (wall.code !== 0) throw new Error(`${id}: no wallpaper drawn`);
      }
      // The desktop shows the drawing (a flat colour would have a handful of colours, the wallpaper thousands).
      const colours = Number((await exec(A, ["sh", "-c", "import -silent -window root png:- | convert - -format %k info:"])).out);
      if (!(colours > 200)) throw new Error(`the desktop shows ${colours} colours: the wallpaper is not painted`);
      await shot(A, "wallpaper");
      return `both dressed, ${colours} colours on the desktop`;
    });
    await check("browser", "Each browser answers on its own debugging port and profile", async () => {
      await Promise.all([A, B].map((id) => linuxScreen.ready(id, USER, ws(id))));
      const out: string[] = [];
      for (const id of [A, B]) {
        let ok = false;
        for (let i = 0; i < 20 && !ok; i++) { ok = await linuxScreen.browserAnswers(id); if (!ok) await sleep(500); }
        if (!ok) throw new Error(`${id}: the browser does not answer on port 9222`);
        const pid = await browserPid(id);
        if (!pid) throw new Error(`${id}: no browser on the bot's profile`);
        out.push(`${looks[id].name}: pid ${pid}`);
      }
      return out.join(" · ");
    });
    await check("greeting", "Each home page greets its own bot", async () => {
      const a = await greets(A, looks[A].name);
      await greets(B, looks[B].name);
      await shot(A, "home-page");
      return `${looks[A].name} and ${looks[B].name}, ${a.tiles} app tiles`;
    });
    await check("redress", "Dressing again is fast and keeps the same browser", async () => {
      const before = await browserPid(A);
      const t0 = Date.now();
      await ensureDressed(A, true);
      const ms = Date.now() - t0;
      const after = await browserPid(A);
      if (ms >= 3000) throw new Error(`took ${ms} ms (limit 3000)`);
      if (before !== after) throw new Error(`the browser was restarted (${before} → ${after})`);
      return `${ms} ms, same browser`;
    });
    await check("rename", "A rename and a new colour show without reloading", async () => {
      setLookOverride(B, renamed);
      await ensureDressed(B);
      await greets(B, renamed.name, 15_000);
      const look = JSON.parse((await exec(B, ["cat", "/root/.sklubot/look.json"])).out || "{}");
      const accent = String(look.palette?.accent ?? "");
      const [r, , b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
      if (!(b > r)) throw new Error(`the accent ${accent} is not blue`);
      await shot(B, "renamed");
      return `${renamed.name}, accent ${accent}`;
    });
    await check("read", "A page can be read", async () => {
      const page = await linuxScreen.read(A, USER, ws(A));
      if (!page.text.includes(looks[A].name)) throw new Error(`the page text does not name ${looks[A].name}`);
      return page.url;
    });
    await check("click", "A click lands where it is aimed", async () => {
      await cdp(A, "goto", TEST_PAGE);
      await sleep(1200);
      const [w, h] = config.desktopResolution.split("x").map(Number);
      await linuxScreen.click(A, USER, ws(A), Math.round(w / 2), Math.round(h * 0.7));
      const r = await cdp(A, "eval", "document.title");
      if (r.value !== "clicked") throw new Error(`the page title is ${JSON.stringify(r.value ?? r.error)}`);
      return "button pressed";
    });
    await check("typing", "Typed text arrives exactly", async () => {
      const text = `Desk ok 42 "é" & $HOME`;
      await linuxScreen.type(A, USER, ws(A), text);
      const r = await cdp(A, "eval", "document.getElementById('f').value");
      if (r.value !== text) throw new Error(`the field holds ${JSON.stringify(r.value ?? r.error)}`);
      await shot(A, "typed");
      return "exact";
    });
    await check("files", "Files go both ways (library ↔ ~/files)", async () => {
      writeFileSync(path.join(ws(A), "desk-in.txt"), "from the server");
      const seen = await exec(A, ["sh", "-c", "cat /root/files/desk-in.txt && echo from-the-computer > /root/files/desk-out.txt"]);
      if (seen.out !== "from the server") throw new Error(`the computer reads ${JSON.stringify(seen.out || seen.err)}`);
      const back = readFileSync(path.join(ws(A), "desk-out.txt"), "utf8").trim();
      if (back !== "from-the-computer") throw new Error(`the server reads ${JSON.stringify(back)}`);
      return "both ways";
    });
    await check("reset", "A reset closes a stray window and brings the home page back", async () => {
      await exec(A, ["sh", "-c", "setsid xterm -T desk-terminal -e 'echo desk test; sleep 600' >/dev/null 2>&1 &"]);
      let found = false;
      for (let i = 0; i < 12 && !found; i++) { found = (await exec(A, ["sh", "-c", "wmctrl -l | grep -c desk-terminal || true"])).out !== "0"; if (!found) await sleep(500); }
      if (!found) throw new Error("the terminal window never appeared");
      await shot(A, "before-reset");
      await linuxScreen.tidy(A, USER, ws(A));
      await sleep(1500);
      const left = (await exec(A, ["sh", "-c", "wmctrl -l | grep -c desk-terminal || true"])).out;
      if (left !== "0") throw new Error("the terminal is still open");
      await greets(A, looks[A].name);
      await shot(A, "after-reset");
      return "terminal closed, home page back";
    });
    await check("sleep", "The computers go to sleep", async () => {
      await Promise.all([A, B].map((id) => linuxScreen.sleep(id)));
      const p = await Promise.all([A, B].map(powerOf));
      if (p.some((x) => x !== "asleep")) throw new Error(`power: ${p.join(", ")}`);
      return "both asleep";
    });
    run.status = run.checks.every((c) => c.ok) ? "passed" : "failed";
  } catch (err) {
    run.status = "error";
    run.error = String((err as Error)?.message ?? err).slice(0, 300);
  } finally {
    for (const id of [A, B]) setLookOverride(id, null);
    if (opts.clean !== false) for (const id of [A, B]) { await linuxScreen.destroy(id).catch(() => {}); removeWorkspace(id); }
    run.finishedAt = Date.now();
  }
  return run;
}

// ── From Settings → Computer: one run at a time per server, the latest result kept in memory ──
let current: DeskTestRun | null = null;
let currentDir = "";
export const deskRun = () => current;
export function startDeskTest(userId: string): DeskTestRun {
  if (current?.status === "running") return current;
  const prefix = `desk_${createHash("sha256").update(userId).digest("hex").slice(0, 8)}`;
  if (currentDir) rmSync(currentDir, { recursive: true, force: true });
  const placeholder: DeskTestRun = { id: `desk_${randomUUID().slice(0, 8)}`, status: "running", startedAt: Date.now(), finishedAt: null, checks: [], shots: [], error: null };
  current = placeholder;
  currentDir = path.join(config.dataDir, "desk-test", placeholder.id);
  void runDeskTest({ shotsDir: currentDir, prefix, onCheck: (_c, r) => { if (current === placeholder) { placeholder.checks = r.checks; placeholder.shots = r.shots; } } })
    .then((r) => { if (current === placeholder) Object.assign(placeholder, { ...r, id: placeholder.id }); })
    .catch((err) => { Object.assign(placeholder, { status: "error", error: String(err?.message ?? err), finishedAt: Date.now() }); });
  return placeholder;
}
/** A picture of the latest run (its name only, no path). */
export function deskShot(name: string): Buffer | null {
  if (!current || !/^[0-9]{2}-[a-z-]+\.jpg$/.test(name) || !current.shots.includes(name)) return null;
  try { return readFileSync(path.join(currentDir, name)); } catch { return null; }
}
