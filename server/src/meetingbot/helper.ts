import { workspaceOf } from "../computer.js";
import { linuxExec } from "../linux.js";
import { LISTEN_SCRIPT } from "../media.js";
import { MEETING_PAGE_JS, type FindTarget, type PageFind, type PageLook } from "./driver.js";

/**
 * L177 — the meeting bot's hands on its own Linux computer: one small Python program (passed with `python3 -c`, its
 * request as JSON on standard input) that drives ONE tab of the computer's Chromium through the Chrome DevTools
 * Protocol on port 9222, the same browser the bot and its owner see on the bot's screen. Methods used, all documented
 * at https://chromedevtools.github.io/devtools-protocol/ :
 *   HTTP endpoints /json/version, /json/list, /json/new (PUT), /json/activate/<id>, /json/close/<id>
 *   Browser.setPermission (Browser domain): microphone and camera DENIED for the meeting's site, so the bot can never
 *     be heard or seen (the computer's only sound source is the monitor of its own speakers). Chromium drops such an
 *     override when the DevTools connection that set it closes (seen on Chromium 156): a keeper process stays connected
 *     while the meeting tab is open;
 *   Runtime.evaluate (returnByValue): the page driver (driver.ts);
 *   Input.dispatchMouseEvent (mousePressed / mouseReleased), Input.insertText, Input.dispatchKeyEvent (Enter).
 * Recording uses the computer's virtual sound card exactly like listen_screen (media.ts LISTEN_SCRIPT: ffmpeg -f pulse
 * -i sklubot.monitor, 16 kHz mono WAV): what the meeting tab plays, nothing from the room or from the owner.
 */
export const MEETING_PY = String.raw`import json, os, subprocess, sys, time, urllib.parse, urllib.request
from websocket import create_connection
BASE = "http://127.0.0.1:9222"
req = json.loads(sys.stdin.read() or "{}")
def out(o):
    print(json.dumps(o)); sys.stdout.flush(); sys.exit(0)
def http(path, method="GET", timeout=5):
    return json.load(urllib.request.urlopen(urllib.request.Request(BASE + path, method=method), timeout=timeout))
def alive():
    try:
        http("/json/version", timeout=1.5); return True
    except Exception:
        return False
class Ws:
    def __init__(self, url):
        self.ws = create_connection(url, timeout=20, origin=BASE); self.n = 0
    def call(self, method, **params):
        self.n += 1; me = self.n
        self.ws.send(json.dumps({"id": me, "method": method, "params": params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == me:
                if "error" in m:
                    raise Exception("%s: %s" % (method, m["error"].get("message", "")))
                return m.get("result", {})
def tab(tid):
    for t in http("/json/list"):
        if t.get("id") == tid and t.get("type") == "page":
            return Ws(t["webSocketDebuggerUrl"])
    out({"gone": True})
def evaluate(w, expr):
    r = w.call("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
    if r.get("exceptionDetails"):
        out({"error": "page script failed"})
    return (r.get("result") or {}).get("value")
def click(w, x, y):
    for kind in ("mousePressed", "mouseReleased"):
        w.call("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=1)
KEEPER = r"""
import json, os, sys, time, urllib.request
from websocket import create_connection
BASE = "http://127.0.0.1:9222"
origin, mark = sys.argv[1], sys.argv[2]
ws = create_connection(json.load(urllib.request.urlopen(BASE + "/json/version", timeout=5))["webSocketDebuggerUrl"], timeout=20, origin=BASE)
for i, name in enumerate(("microphone", "camera")):
    ws.send(json.dumps({"id": i + 1, "method": "Browser.setPermission", "params": {"permission": {"name": name}, "setting": "denied", "origin": origin}}))
    while json.loads(ws.recv()).get("id") != i + 1:
        pass
open(mark + ".ready", "w").close()
end = time.time() + 6 * 3600
tab = None
while time.time() < end:
    time.sleep(3)
    try:
        if tab is None and os.path.exists(mark + ".tab"):
            tab = open(mark + ".tab").read().strip()
        if tab and not any(t.get("id") == tab for t in json.load(urllib.request.urlopen(BASE + "/json/list", timeout=5))):
            break
    except Exception:
        break
for ext in (".ready", ".tab"):
    try:
        os.remove(mark + ext)
    except OSError:
        pass
"""
op = req.get("op")
if op == "open":
    if not alive():
        subprocess.Popen(["/opt/sklubot/open-browser.sh", "about:blank"], env=dict(os.environ, DISPLAY=":1"), stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, cwd="/root")
        for _ in range(80):
            time.sleep(0.25)
            if alive():
                break
        else:
            out({"error": "The browser did not start."})
    # The browser forgets a permission set through DevTools when that connection closes: a small keeper process stays
    # connected (and keeps microphone and camera refused) for as long as the meeting tab is open, at most 6 hours.
    mark = "/root/.sklubot/meeting-%d" % os.getpid()
    os.makedirs("/root/.sklubot", exist_ok=True)
    subprocess.Popen([sys.executable, "-c", KEEPER, req["origin"], mark], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, start_new_session=True, cwd="/root")
    for _ in range(50):
        if os.path.exists(mark + ".ready"):
            break
        time.sleep(0.1)
    else:
        out({"error": "The browser did not accept to keep the microphone off."})
    made = http("/json/new?" + urllib.parse.quote(req["url"], safe=""), method="PUT")
    with open(mark + ".tab", "w") as f:
        f.write(made["id"])
    try:
        urllib.request.urlopen(BASE + "/json/activate/" + made["id"], timeout=5).read()
    except Exception:
        pass
    out({"ok": True, "tab": made["id"]})
if op == "close":
    try:
        urllib.request.urlopen(BASE + "/json/close/" + str(req.get("tab", "")), timeout=5).read()
    except Exception:
        pass
    out({"ok": True})
w = tab(str(req.get("tab", "")))
if op == "look":
    out({"look": evaluate(w, "(%s)({op: 'look'})" % req["driver"])})
if op == "click" or op == "type" or op == "send":
    f = evaluate(w, "(%s)({op: 'find', what: %s})" % (req["driver"], json.dumps(req.get("what", ""))))
    if not f or not f.get("found"):
        out({"found": False})
    click(w, f["x"], f["y"])
    if op != "click":
        time.sleep(0.2)
        evaluate(w, "(%s)({op: 'find', what: %s})" % (req["driver"], json.dumps(req.get("what", ""))))
        w.call("Input.insertText", text=str(req.get("text", "")))
    if op == "send":
        for kind in ("keyDown", "keyUp"):
            w.call("Input.dispatchKeyEvent", type=kind, key="Enter", code="Enter", windowsVirtualKeyCode=13, nativeVirtualKeyCode=13, **({"text": "\r"} if kind == "keyDown" else {}))
    out({"found": True, "label": f.get("label", "")})
out({"error": "unknown request"})
`;

export interface MeetingHands {
  open(url: string, origin: string): Promise<{ tab: string } | { error: string }>;
  look(tab: string): Promise<PageLook | null>;
  /** Clicks a control; "type" also types text into it; "send" types and presses Enter. False: not on the page. */
  act(tab: string, op: "click" | "type" | "send", what: FindTarget, text?: string): Promise<boolean>;
  close(tab: string): Promise<void>;
  /** `seconds` of what the computer plays, as a 16 kHz mono WAV (empty buffer: nothing recorded). */
  record(seconds: number, signal?: AbortSignal): Promise<Buffer>;
}

/** The real hands: the bot's own computer (docker exec through linuxExec; every value travels on standard input). */
export function computerHands(botId: string, userId: string): MeetingHands {
  const run = async (request: object, timeoutSec = 40): Promise<any> => {
    const r = await linuxExec(botId, userId, workspaceOf(botId), ["python3", "-c", MEETING_PY], timeoutSec, { input: JSON.stringify(request), maxBytes: 400_000 });
    try { return JSON.parse(r.stdout); } catch { return { error: r.timedOut ? "the browser did not answer in time" : `the browser could not be reached (exit ${r.code})` }; }
  };
  return {
    async open(url, origin) { const a = await run({ op: "open", url, origin }, 60); return a.tab ? { tab: String(a.tab) } : { error: String(a.error ?? "the meeting could not be opened") }; },
    async look(tab) { const a = await run({ op: "look", tab, driver: MEETING_PAGE_JS }); return a.look ?? null; },
    async act(tab, op, what, text) { const a = await run({ op, tab, what, text, driver: MEETING_PAGE_JS }); return a.found === true; },
    async close(tab) { await run({ op: "close", tab }, 20); },
    async record(seconds, signal) {
      const r = await linuxExec(botId, userId, workspaceOf(botId), ["bash", "-c", LISTEN_SCRIPT, "listen", String(seconds)], seconds + 30, { signal, binary: true, maxBytes: seconds * 32_000 + 256_000 });
      return r.code === 0 ? r.raw : Buffer.alloc(0);
    },
  };
}

export type { PageFind };
