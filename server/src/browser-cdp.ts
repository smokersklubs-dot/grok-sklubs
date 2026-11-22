import { clip } from "./store.js";
import { ELEMENT_OPS_PY, type PageDialog, type TabContext } from "./screen-elements.js";
import { DEVTOOLS_PY } from "./browser-devtools.js";
import { DOWNLOADS_OPS_PY, DOWNLOADS_WATCH_PY } from "./browser-downloads.js";

/**
 * The browser helper of a bot's Linux computer: one Python program, passed with `python3 -c` (so computers made from an
 * older image have it too), that reads and acts on the bot's ACTIVE tab through the Chrome DevTools Protocol of its
 * Chromium (port 9222). Its request (and any text to type, which may be a password) travels on standard input, never in
 * a process list. Ideas from the audits of chrome-devtools-mcp and agent-browser (docs/audits); the snapshot's hints
 * and link addresses reuse agent-browser code (screen-elements.ts, Apache-2.0, see THIRD_PARTY_NOTICES.md).
 *
 *  - The active tab: the one shown in front of the browser window (document.visibilityState), so a link that opens a
 *    new tab, or a tab the user or the bot switched to, is followed; every read and action uses that same tab, never
 *    "the first of the list" (which Chrome orders as it likes).
 *  - Opening an address reuses the running browser (Page.navigate, or PUT /json/new for a new tab): never a second
 *    Chromium on the same profile, which used to read one page while the screen showed another.
 *  - JavaScript dialogs: a small watcher process (WATCH_PY) stays attached to every tab and sees each dialog open, since
 *    only the session that saw it can answer it later. A tab with an open dialog is never waited on: the bot is told
 *    what it says, and answers with browser_dialog.
 *  - Secrets (vault_type, email_code_type) are typed by Input.insertText into the active tab after checking, on that same
 *    tab just before, that the page and each frame down to the focused field are on the wanted site; pixel actions bound
 *    to an approval (a committing click, a card field) are checked on the active tab right before xdotool runs.
 *  - After an action, the helper waits for a page load that started and for the network to be quiet, within a cap,
 *    instead of a fixed pause.
 */
const CORE_PY = String.raw`import json, os, socket, subprocess, sys, time, urllib.parse, urllib.request
from websocket import create_connection, WebSocketTimeoutException

# The browser helper of the bot's computer: reads and acts on the tab in front of the bot's Chromium through the Chrome
# DevTools Protocol (port 9222). Methods used, all documented at https://chromedevtools.github.io/devtools-protocol/ :
#   HTTP endpoints /json/version, /json/list, /json/new (PUT), /json/activate/<id>, /json/close/<id> (…/#endpoints)
#   Page.enable, Page.navigate, Page.getFrameTree, Page.createIsolatedWorld, events Page.loadEventFired,
#     Page.frameStartedLoading, Page.javascriptDialogOpening / Closed (Page domain)
#   Network.enable, events Network.requestWillBeSent / loadingFinished / loadingFailed (Network domain: quiet network)
#   Runtime.evaluate, Runtime.callFunctionOn (Runtime domain)
#   Input.insertText (Input domain)
# One JSON request on standard input (text to type never appears in a process list), one JSON answer on standard output.
BASE = "http://127.0.0.1:9222"
HOME = "/root/.sklubot"
STATE = HOME + "/browser-tab.json"
WATCH_SOCK = HOME + "/browser-watch.sock"
WATCH_VERSION = 3

class Fail(Exception):
    pass

class DialogOpen(Exception):
    def __init__(self, info):
        Exception.__init__(self, "dialog")
        self.info = info

def out(obj):
    print(json.dumps(obj))
    sys.stdout.flush()
    sys.exit(0)

def http(path, method="GET", timeout=5):
    return json.load(urllib.request.urlopen(urllib.request.Request(BASE + path, method=method), timeout=timeout))

def alive():
    try:
        http("/json/version", timeout=1.5)
        return True
    except Exception:
        return False

def all_pages():
    try:
        tabs = http("/json/list")
    except Exception:
        return None
    return [t for t in tabs if t.get("type") == "page" and not t.get("url", "").startswith("devtools:")]

def load_state():
    try:
        with open(STATE) as f:
            s = json.load(f)
        return s if isinstance(s, dict) else {}
    except Exception:
        return {}

def save_state(s):
    try:
        os.makedirs(HOME, exist_ok=True)
        with open(STATE + ".tmp", "w") as f:
            json.dump(s, f)
        os.replace(STATE + ".tmp", STATE)
    except Exception:
        pass

def watch_ask(req, timeout=5):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    s.connect(WATCH_SOCK)
    s.sendall((json.dumps(req) + "\n").encode())
    data = b""
    while not data.endswith(b"\n"):
        chunk = s.recv(65536)
        if not chunk:
            break
        data += chunk
    s.close()
    return json.loads(data or b"{}")

def ensure_watch():
    try:
        ping = watch_ask({"op": "ping"}, 1)
        if ping.get("ok") and ping.get("v") == WATCH_VERSION:
            return True
        # An older watcher (from before the console and requests were kept, L81): replaced, unless a dialog is open,
        # which only that watcher can answer.
        if ping.get("ok") and not (watch_ask({"op": "state"}, 2).get("dialogs") or {}):
            try:
                os.kill(int(ping.get("pid")), 15)
            except Exception:
                pass
            time.sleep(0.3)
            try:
                os.unlink(WATCH_SOCK)
            except OSError:
                pass
        elif ping.get("ok"):
            return True
    except Exception:
        pass
    if not alive():
        return False
    subprocess.Popen([sys.executable, "-c", WATCH], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, start_new_session=True, cwd="/")
    for _ in range(40):
        time.sleep(0.1)
        try:
            if watch_ask({"op": "ping"}, 1).get("ok"):
                time.sleep(0.3)
                return True
        except Exception:
            pass
    return False

def watched():
    try:
        return watch_ask({"op": "state"}, 3)
    except Exception:
        return {}

class Tab:
    def __init__(self, info, timeout=15):
        self.info = info
        self.id = info["id"]
        self.timeout = timeout
        self.seq = 0
        self.dialog = None
        self.events = []
        self.ws = create_connection(info["webSocketDebuggerUrl"], timeout=timeout, origin=BASE)

    def _take(self, msg):
        m = msg.get("method")
        if m == "Page.javascriptDialogOpening":
            self.dialog = {k: (msg.get("params") or {}).get(k) for k in ("type", "message", "url", "defaultPrompt")}
        elif m == "Page.javascriptDialogClosed":
            self.dialog = None
        elif m:
            self.events.append(msg)

    def call(self, method, _wait=None, _dialog_ok=False, **params):
        self.seq += 1
        mid = self.seq
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        wait = _wait or self.timeout
        deadline = time.time() + wait
        while True:
            left = deadline - time.time()
            try:
                if left <= 0:
                    raise WebSocketTimeoutException("late")
                self.ws.settimeout(left)
                msg = json.loads(self.ws.recv())
            except WebSocketTimeoutException:
                if self.dialog is not None:
                    raise DialogOpen(self.dialog)
                raise Fail("the page did not answer within %d s" % wait)
            if msg.get("id") == mid:
                if "error" in msg:
                    raise Fail(msg["error"].get("message", "error"))
                return msg.get("result", {})
            self._take(msg)
            if self.dialog is not None and not _dialog_ok:
                raise DialogOpen(self.dialog)

    def pump(self, until):
        """Reads events until the time "until" (seconds since the epoch)."""
        while True:
            left = until - time.time()
            if left <= 0:
                return
            try:
                self.ws.settimeout(left)
                self._take(json.loads(self.ws.recv()))
            except WebSocketTimeoutException:
                return
            if self.dialog is not None:
                raise DialogOpen(self.dialog)

    def value(self, expression, wait=None):
        r = self.call("Runtime.evaluate", _wait=wait, expression=expression, returnByValue=True)
        return (r.get("result") or {}).get("value")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass

def open_tab(info, enable=True):
    t = Tab(info)
    if enable:
        t.call("Page.enable", _wait=4)
    return t

def peek_visible(info):
    """The tab opened on a short leash, and whether it is the one shown in the window (document.visibilityState)."""
    try:
        t = Tab(info, timeout=3)
    except Exception:
        return None, False
    try:
        return t, t.value("document.visibilityState", wait=2.5) == "visible"
    except Exception:
        t.close()
        return None, False

def front(enable=True):
    """The bot's active tab: the one shown in front of the browser window (a tab opened by a link in a new tab, or
    switched to by the user or by browser_tab, is followed), else the last one the bot used. Returns (tab session or
    None when it shows a dialog, its info, the tabs, what the watcher knows)."""
    pgs = all_pages()
    if pgs is None:
        out({"error": "The browser is not open. Open a page first."})
    if not pgs:
        out({"error": "No page is open in the browser."})
    ensure_watch()
    w = watched()
    dl = w.get("dialogs") or {}
    st = load_state()
    order = sorted(pgs, key=lambda p: 0 if p["id"] == st.get("active") else 1)
    chosen, session = None, None
    for p in order:
        if p["id"] in dl:
            continue
        t, shown = peek_visible(p)
        if shown:
            chosen, session = p, t
            break
        if t:
            t.close()
    if not chosen:
        with_dialog = [p for p in pgs if p["id"] in dl]
        chosen = next((p for p in with_dialog if p["id"] == st.get("active")), None) or (with_dialog[0] if with_dialog else None) \
            or next((p for p in pgs if p["id"] == st.get("active")), None) or pgs[0]
    known = st.get("known") or []
    new = [p for p in pgs if known and p["id"] not in known]
    save_state({"active": chosen["id"], "known": [p["id"] for p in pgs]})
    ctx = {"tabs": len(pgs), "new": [{"title": p.get("title", ""), "url": p.get("url", "")} for p in new][:5],
           "dialogs": dl, "id": chosen["id"]}
    if chosen["id"] in dl:
        if session:
            session.close()
        return None, chosen, ctx
    if session is None:
        session = Tab(chosen)
    if enable:
        session.call("Page.enable", _wait=4)
    return session, chosen, ctx

def need(session, ctx):
    """A tab that shows a dialog cannot be read or acted on: the bot is told what it says."""
    if session is None:
        out({"dialog": ctx["dialogs"].get(ctx["id"]), "tab": ctx["id"]})
    return session

def here(t):
    """The tab's own address and title, read in the page itself (not the browser's list, which can lag)."""
    v = t.value("[location.href, document.title]") or ["", ""]
    return v[0], v[1]

def settle(t, cap=8.0, quiet=0.5):
    """After an action: wait for a page load that started to end, then for the network to be quiet (at most two
    requests still open for "quiet" seconds), within "cap" seconds. Network.enable must have been called before."""
    start = time.time()
    inflight, loading, last = set(), False, time.time()
    seen = 0
    while time.time() - start < cap:
        for msg in t.events[seen:]:
            m, p = msg.get("method"), msg.get("params") or {}
            if m == "Page.frameStartedLoading" and p.get("frameId") == t.id:
                loading = True
            elif m == "Page.loadEventFired":
                loading = False
            elif m == "Network.requestWillBeSent":
                inflight.add(p.get("requestId"))
                last = time.time()
            elif m in ("Network.loadingFinished", "Network.loadingFailed"):
                inflight.discard(p.get("requestId"))
                last = time.time()
        seen = len(t.events)
        if not loading and len(inflight) <= 2 and time.time() - last >= quiet:
            return round(time.time() - start, 2)
        t.pump(min(start + cap, time.time() + 0.1))
    return round(time.time() - start, 2)

def host_of(url):
    try:
        h = (urllib.parse.urlsplit(url).hostname or "").lower()
    except Exception:
        return ""
    return h[4:] if h.startswith("www.") else h

def same_site(h, wanted):
    return bool(h) and bool(wanted) and (h == wanted or h.endswith("." + wanted))

def bring_front(tab_id):
    try:
        urllib.request.urlopen(BASE + "/json/activate/" + tab_id, timeout=5).read()
    except Exception:
        pass
    subprocess.run(["wmctrl", "-x", "-a", "SklubotBrowser"], env=dict(os.environ, DISPLAY=":1"),
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
`;

/** The tab watcher (started by the helper when it is not running; see CORE_PY ensure_watch). */
const WATCH_PY = String.raw`import json, os, socket, threading, time, urllib.request
from websocket import create_connection

# The tab watcher: one small process per computer, started by the browser helper when it is not running. It stays
# attached to every tab of the bot's Chromium (port 9222), so it sees each JavaScript dialog (alert, confirm, prompt,
# beforeunload) when it opens and can answer it later: Chrome only lets the session that saw a dialog open answer it.
# It answers the helper on a Unix socket in the bot's home, and ends by itself when the browser goes away.
# Methods used, documented at https://chromedevtools.github.io/devtools-protocol/tot/ :
#   Target.setDiscoverTargets, Target.attachToTarget (flatten), events Target.targetCreated / targetDestroyed /
#   attachedToTarget / detachedFromTarget (Target domain);
#   Page.enable, Page.handleJavaScriptDialog, events Page.javascriptDialogOpening / javascriptDialogClosed,
#     Page.frameNavigated (Page domain);
#   L81 — Runtime.enable, events Runtime.consoleAPICalled / Runtime.exceptionThrown (Runtime domain); Log.enable, event
#     Log.entryAdded (Log domain); Network.enable, events Network.requestWillBeSent / responseReceived / loadingFinished /
#     loadingFailed, Network.getResponseBody (Network domain): each tab's console and requests, kept for its last 3
#     pages (as chrome-devtools-mcp keeps 3 navigations), at most 300 messages and 400 requests a tab.
BASE = "http://127.0.0.1:9222"
SOCK = "/root/.sklubot/browser-watch.sock"
VERSION = 3
KEEP_NAVS = 3

def already():
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(1)
        s.connect(SOCK)
        s.close()
        return True
    except Exception:
        return False

if already():
    os._exit(0)
version = json.load(urllib.request.urlopen(BASE + "/json/version", timeout=3))
ws = create_connection(version["webSocketDebuggerUrl"], origin=BASE)
lock = threading.Lock()
seq = [0]
pending = {}
sessions = {}
targets = {}
dialogs = {}
created = []
logs = {}
nets = {}
navs = {}

def remember(store, tid, item, cap):
    items = store.setdefault(tid, [])
    item["nav"] = navs.get(tid, 0)
    items.append(item)
    floor = navs.get(tid, 0) - (KEEP_NAVS - 1)
    if len(items) > cap or (items and items[0].get("nav", 0) < floor):
        store[tid] = [x for x in items if x.get("nav", 0) >= floor][-cap:]

def arg_text(a):
    if "value" in a:
        v = a["value"]
        return v if isinstance(v, str) else json.dumps(v)[:300]
    return a.get("description") or a.get("unserializableValue") or a.get("type", "")

def send(method, params=None, session=None):
    with lock:
        seq[0] += 1
        mid = seq[0]
        pending[mid] = [threading.Event(), None]
        msg = {"id": mid, "method": method, "params": params or {}}
        if session:
            msg["sessionId"] = session
        ws.send(json.dumps(msg))
    return mid

def call(method, params=None, session=None, wait=5):
    mid = send(method, params, session)
    pending[mid][0].wait(wait)
    return (pending.pop(mid, [None, None])[1]) or {"error": {"message": "no answer"}}

def reader():
    while True:
        try:
            msg = json.loads(ws.recv())
        except Exception:
            try:
                os.unlink(SOCK)
            except OSError:
                pass
            os._exit(0)
        if "id" in msg:
            p = pending.get(msg["id"])
            if p:
                p[1] = msg
                p[0].set()
            continue
        m, prm, sid = msg.get("method"), msg.get("params") or {}, msg.get("sessionId")
        if m == "Target.targetCreated" and prm.get("targetInfo", {}).get("type") == "page":
            tid = prm["targetInfo"]["targetId"]
            if tid not in created:
                created.append(tid)
            send("Target.attachToTarget", {"targetId": tid, "flatten": True})
        elif m == "Target.attachedToTarget" and prm.get("targetInfo", {}).get("type") == "page":
            sessions[prm["sessionId"]] = prm["targetInfo"]["targetId"]
            targets[prm["targetInfo"]["targetId"]] = prm["sessionId"]
            send("Page.enable", None, prm["sessionId"])
            for domain in ("Runtime.enable", "Log.enable", "Network.enable"):
                send(domain, None, prm["sessionId"])
        elif m == "Target.targetDestroyed":
            tid = prm.get("targetId")
            dialogs.pop(tid, None)
            targets.pop(tid, None)
            logs.pop(tid, None)
            nets.pop(tid, None)
            navs.pop(tid, None)
            if tid in created:
                created.remove(tid)
        elif m == "Target.detachedFromTarget":
            tid = sessions.pop(prm.get("sessionId"), None)
            if tid and targets.get(tid) == prm.get("sessionId"):
                targets.pop(tid, None)
        elif m == "Page.javascriptDialogOpening" and sid in sessions:
            d = {k: prm.get(k) for k in ("type", "message", "url", "defaultPrompt")}
            d["at"] = time.time()
            dialogs[sessions[sid]] = d
        elif m in ("Browser.downloadWillBegin", "Browser.downloadProgress"):
            dl_event(m, prm)
        elif m == "Page.javascriptDialogClosed" and sid in sessions:
            dialogs.pop(sessions[sid], None)
        elif sid in sessions:
            take(sessions[sid], m, prm)

def take(tid, m, prm):
    # L81: what a tab writes to its console, its errors, and its requests.
    now = time.time()
    if m == "Page.frameNavigated" and not (prm.get("frame") or {}).get("parentId"):
        navs[tid] = navs.get(tid, 0) + 1
    elif m == "Runtime.consoleAPICalled":
        frame = ((prm.get("stackTrace") or {}).get("callFrames") or [{}])[0]
        remember(logs, tid, {"level": {"warning": "warning", "error": "error", "assert": "error"}.get(prm.get("type"), "log" if prm.get("type") in ("log", "info", "debug") else prm.get("type", "log")),
                             "text": " ".join(arg_text(a) for a in prm.get("args") or [])[:1000], "url": frame.get("url", ""), "line": frame.get("lineNumber", -1) + 1, "at": now}, 300)
    elif m == "Runtime.exceptionThrown":
        d = prm.get("exceptionDetails") or {}
        frame = ((d.get("stackTrace") or {}).get("callFrames") or [{}])[0]
        text = ((d.get("exception") or {}).get("description") or d.get("text") or "error").split("\n")[0]
        remember(logs, tid, {"level": "error", "text": ("Uncaught " if not text.startswith("Uncaught") else "") + text[:1000], "url": d.get("url") or frame.get("url", ""), "line": (d.get("lineNumber") if d.get("lineNumber") is not None else frame.get("lineNumber", -1)) + 1, "at": now}, 300)
    elif m == "Log.entryAdded":
        e = prm.get("entry") or {}
        if e.get("level") in ("error", "warning"):
            remember(logs, tid, {"level": e.get("level"), "text": str(e.get("text", ""))[:1000], "url": e.get("url", ""), "line": e.get("lineNumber", -1) + 1, "source": e.get("source", ""), "at": now}, 300)
    elif m == "Network.requestWillBeSent":
        q = prm.get("request") or {}
        remember(nets, tid, {"id": prm.get("requestId"), "method": q.get("method", ""), "url": q.get("url", "")[:2000], "type": prm.get("type", ""),
                             "reqHeaders": q.get("headers") or {}, "at": now}, 400)
    elif m in ("Network.responseReceived", "Network.loadingFinished", "Network.loadingFailed"):
        for r in reversed(nets.get(tid, [])):
            if r.get("id") == prm.get("requestId"):
                if m == "Network.responseReceived":
                    rs = prm.get("response") or {}
                    r.update({"status": rs.get("status"), "mime": rs.get("mimeType", ""), "resHeaders": rs.get("headers") or {}, "type": prm.get("type", r.get("type"))})
                elif m == "Network.loadingFinished":
                    r.update({"done": True, "size": prm.get("encodedDataLength", 0)})
                else:
                    r.update({"done": True, "failed": prm.get("errorText", "failed"), "blocked": prm.get("blockedReason", "")})
                break

${DOWNLOADS_WATCH_PY}
def serve(conn):
    try:
        conn.settimeout(10)
        data = b""
        while not data.endswith(b"\n"):
            chunk = conn.recv(65536)
            if not chunk:
                break
            data += chunk
        req = json.loads(data or b"{}")
        op = req.get("op")
        if op == "ping":
            ans = {"ok": True, "pid": os.getpid(), "v": VERSION}
        elif op == "state":
            ans = {"dialogs": dialogs, "created": created}
        elif op == "console":
            tid = req.get("target")
            ans = {"messages": list(logs.get(tid, [])), "nav": navs.get(tid, 0), "watched": tid in targets}
        elif op == "network":
            tid = req.get("target")
            ans = {"requests": list(nets.get(tid, [])), "nav": navs.get(tid, 0), "watched": tid in targets}
        elif op == "body":
            tid = req.get("target")
            if tid not in targets:
                ans = {"error": "that tab is not watched"}
            else:
                r = call("Network.getResponseBody", {"requestId": req.get("id")}, targets[tid])
                ans = {"error": r["error"].get("message", "no body")} if "error" in r else r.get("result", {})
        elif op == "answer":
            tid = req.get("target")
            if tid not in dialogs or tid not in targets:
                ans = {"error": "no dialog is open on that tab"}
            else:
                params = {"accept": bool(req.get("accept"))}
                if req.get("text") is not None:
                    params["promptText"] = str(req.get("text"))
                r = call("Page.handleJavaScriptDialog", params, targets[tid])
                if "error" in r:
                    ans = {"error": r["error"].get("message", "refused")}
                else:
                    dialogs.pop(tid, None)
                    ans = {"ok": True}
        elif op in ("downloads", "release", "discard"):
            ans = dl_op(req)
        else:
            ans = {"error": "unknown request"}
        conn.sendall((json.dumps(ans) + "\n").encode())
    except Exception as e:
        try:
            conn.sendall((json.dumps({"error": str(e)}) + "\n").encode())
        except Exception:
            pass
    finally:
        conn.close()

threading.Thread(target=reader, daemon=True).start()
send("Target.setDiscoverTargets", {"discover": True})
# DS-Bot item 10 (browser-downloads.ts): every download lands in the held folder, under its guid, until approved.
dl_prepare()
send("Browser.setDownloadBehavior", {"behavior": "allowAndName", "downloadPath": HELD, "eventsEnabled": True})
try:
    os.unlink(SOCK)
except OSError:
    pass
os.makedirs(os.path.dirname(SOCK), exist_ok=True)
server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
server.bind(SOCK)
os.chmod(SOCK, 0o600)
server.listen(16)
while True:
    c, _ = server.accept()
    threading.Thread(target=serve, args=(c,), daemon=True).start()
`;

const OPS_PY = String.raw`
# ── Reading, opening, tabs, dialogs and guarded input ────────────────────────────────────────────────────────────────
def tab_line(p, active, dl):
    return {"tab": p["id"][:6].lower(), "title": p.get("title", "")[:120], "url": p.get("url", "")[:300],
            "active": p["id"] == active, "dialog": (dl.get(p["id"]) or {}).get("type")}

def find_tab(prefix):
    pgs = all_pages() or []
    want = str(prefix or "").strip().lower()
    hits = [p for p in pgs if want and p["id"].lower().startswith(want)]
    if len(hits) != 1:
        out({"error": "No tab is called \"%s\". List the tabs with browser_tabs." % want[:12] if not hits else "Several tabs start with \"%s\": give more of it." % want[:12]})
    return hits[0], pgs

def op_read(req):
    t, info, ctx = front()
    need(t, ctx)
    url, title = here(t)
    if req.get("op") == "where":
        out({"url": url, "title": title, "ctx": ctx})
    text = t.value("document.body ? document.body.innerText : ''") or ""
    out({"url": url, "title": title, "text": text, "ctx": ctx})

def op_target(req):
    t, info, ctx = front()
    need(t, ctx)
    url, _ = here(t)
    v = t.value(req.get("expression", "null"), wait=8)
    out({"url": url, "target": v if isinstance(v, dict) else None, "tab": info["id"]})

def op_open(req):
    url = str(req.get("url", ""))
    if not alive():
        # No browser answers: start it on that address (open-browser.sh), and wait for its first page.
        subprocess.Popen(["/opt/sklubot/open-browser.sh", url], env=dict(os.environ, DISPLAY=":1"), stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, cwd="/root")
        for _ in range(80):
            time.sleep(0.25)
            if alive() and all_pages():
                break
        else:
            out({"error": "The browser did not start."})
        t, info, ctx = front()
        need(t, ctx)
        t.call("Network.enable", _wait=4)
        waited = smart(t, cap=10.0)
        u, title = here(t)
        finish({"ok": True, "url": u, "title": title, "started": True, "waited": waited, "ctx": ctx}, req)
    if req.get("newTab"):
        made = http("/json/new?" + urllib.parse.quote(url, safe=""), method="PUT")
        bring_front(made["id"])
        st = load_state()
        save_state({"active": made["id"], "known": (st.get("known") or []) + [made["id"]]})
        t = open_tab(made)
        t.call("Network.enable", _wait=4)
        waited = smart(t, cap=10.0)
        u, title = here(t)
        finish({"ok": True, "url": u, "title": title, "waited": waited, "newTab": True}, req)
    t, info, ctx = front()
    need(t, ctx)
    bring_front(info["id"])
    t.call("Network.enable", _wait=4)
    r = t.call("Page.navigate", _wait=20, url=url)
    if r.get("errorText"):
        out({"error": "The page could not be opened: %s" % r["errorText"]})
    waited = smart(t, cap=10.0)
    u, title = here(t)
    finish({"ok": True, "url": u, "title": title, "waited": waited, "ctx": ctx}, req)

def op_tabs(req):
    pgs = all_pages()
    if pgs is None:
        out({"error": "The browser is not open. Open a page first."})
    t, info, ctx = front(enable=False)
    if t:
        t.close()
    out({"tabs": [tab_line(p, info["id"], ctx["dialogs"]) for p in pgs], "active": info["id"][:6].lower()})

def op_tab_switch(req):
    p, pgs = find_tab(req.get("tab"))
    bring_front(p["id"])
    st = load_state()
    save_state({"active": p["id"], "known": st.get("known") or [x["id"] for x in pgs]})
    time.sleep(0.3)
    out({"ok": True, "url": p.get("url", ""), "title": p.get("title", "")})

def op_tab_close(req):
    p, pgs = find_tab(req.get("tab"))
    if len(pgs) < 2:
        out({"error": "That is your only tab: open another page instead of closing it."})
    try:
        urllib.request.urlopen(BASE + "/json/close/" + p["id"], timeout=5).read()
    except Exception as e:
        out({"error": "The tab could not be closed: %s" % e})
    time.sleep(0.4)
    out({"ok": True, "closed": {"title": p.get("title", ""), "url": p.get("url", "")}})

def op_dialog_info(req):
    t, info, ctx = front(enable=False)
    if t:
        t.close()
    d = ctx["dialogs"].get(info["id"])
    url = info.get("url", "")
    out({"dialog": d, "url": (d or {}).get("url") or url, "tab": info["id"]})

def op_dialog_answer(req):
    t, info, ctx = front(enable=False)
    if t:
        t.close()
    d = ctx["dialogs"].get(info["id"])
    if not d:
        out({"error": "No dialog is open on the page in front."})
    want = req.get("expect")
    if want is not None and (not isinstance(want, dict) or want.get("type") != d.get("type") or want.get("message") != (d.get("message") or "")[:500]):
        out({"error": "The dialog changed since this answer was checked. Nothing was answered: look at it again."})
    r = watch_ask({"op": "answer", "target": info["id"], "accept": bool(req.get("accept")), "text": req.get("text")}, 8)
    if r.get("error"):
        out({"error": "The dialog could not be answered: %s" % r["error"]})
    waited = 0
    try:
        t = open_tab(info)
        t.call("Network.enable", _wait=4)
        waited = settle(t, cap=6.0)
        u, title = here(t)
    except DialogOpen as e:
        out({"ok": True, "dialog": e.info})
    except Exception:
        u, title = info.get("url", ""), info.get("title", "")
    out({"ok": True, "url": u, "title": title, "waited": waited})

FOCUSED = """(() => {
  let doc = document, el = doc.activeElement; const chain = [location.href];
  while (el && (el.tagName === 'IFRAME' || el.tagName === 'FRAME')) {
    let inner = null; try { inner = el.contentDocument; } catch (e) { inner = null; }
    if (!inner) return { crossFrame: true, chain };
    chain.push(inner.location.href); doc = inner; el = inner.activeElement;
  }
  if (!el || el === doc.body || el === doc.documentElement) return { none: true, chain };
  const r = el.getBoundingClientRect(), s = getComputedStyle(el);
  return { tag: el.tagName.toLowerCase(), type: (el.getAttribute('type') || '').toLowerCase(), editable: !!el.isContentEditable,
    disabled: !!el.disabled, readOnly: !!el.readOnly, shown: r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none',
    chain, visible: document.visibilityState, focus: document.hasFocus() };
})()"""
TEXTISH = ("", "text", "email", "tel", "number", "search", "url", "password")

def op_secret_type(req):
    """Types a secret (a saved login, an emailed code) into the focused field of the bot's active tab, after checking,
    on that same tab and just before typing, that the page and every frame down to the field are on the wanted site."""
    t, info, ctx = front()
    need(t, ctx)
    wanted = str(req.get("host", "")).lower()
    f = t.value(FOCUSED, wait=5) or {}
    chain = f.get("chain") or []
    hosts = [host_of(u) for u in chain]
    if not hosts or not same_site(hosts[0], wanted):
        out({"refused": "site", "here": hosts[0] if hosts else ""})
    if f.get("crossFrame"):
        out({"refused": "frame", "here": hosts[0]})
    if any(not same_site(h, wanted) for h in hosts):
        out({"refused": "frame", "here": next(h for h in hosts if not same_site(h, wanted))})
    if f.get("none") or not f.get("shown"):
        out({"refused": "nofield", "here": hosts[0]})
    if f.get("disabled") or f.get("readOnly") or not (f.get("editable") or f.get("tag") == "textarea" or (f.get("tag") == "input" and f.get("type") in TEXTISH)):
        out({"refused": "notext", "here": hosts[0], "tag": f.get("tag"), "type": f.get("type")})
    if req.get("field") == "password" and f.get("type") != "password":
        out({"refused": "notpassword", "here": hosts[0]})
    if f.get("visible") != "visible":
        out({"refused": "hidden", "here": hosts[0]})
    t.call("Network.enable", _wait=4)
    t.call("Input.insertText", text=str(req.get("text", "")))
    waited = settle(t, cap=3.0, quiet=0.3)
    out({"ok": True, "host": hosts[0], "waited": waited})

def xdo(*args):
    r = subprocess.run(["xdotool"] + list(args), env=dict(os.environ, DISPLAY=":1"), capture_output=True)
    if r.returncode != 0:
        out({"error": "screen action failed: %s" % r.stderr.decode("utf-8", "replace")[:200]})

def op_click(req):
    """A pixel click bound to what was approved: checked on the active tab right before xdotool clicks."""
    t, info, ctx = front()
    need(t, ctx)
    expect = req.get("expect") or {}
    url, _ = here(t)
    state = t.value("[document.visibilityState, document.hasFocus()]") or ["", False]
    if state[0] != "visible" or not state[1]:
        out({"refused": "hidden", "here": host_of(url)})
    if "host" in expect and host_of(url) != str(expect.get("host") or ""):
        out({"refused": "site", "here": host_of(url)})
    if "label" in expect:
        now = t.value(req.get("probe") or "null", wait=5)
        label = (now or {}).get("label") if isinstance(now, dict) else None
        if label is None or label[:120] != str(expect.get("label") or "")[:120]:
            out({"refused": "changed", "here": host_of(url), "label": label})
    t.call("Network.enable", _wait=4)
    x, y = str(int(round(float(req.get("x", 0))))), str(int(round(float(req.get("y", 0)))))
    button = {"right": "3", "middle": "2"}.get(req.get("button"), "1")
    xdo("mousemove", x, y, "click", *(["--repeat", "2", "--delay", "80"] if req.get("double") else []), button)
    try:
        waited = settle(t, cap=6.0)
    except DialogOpen as e:
        out({"ok": True, "dialog": e.info})
    out({"ok": True, "waited": waited})

def op_keys(req):
    """Types with the keyboard (xdotool, for fields inside another site's frame, like card forms) after checking, on
    the active tab just before, that it is shown, has the keyboard, and is on the expected site."""
    t, info, ctx = front()
    need(t, ctx)
    url, _ = here(t)
    state = t.value("[document.visibilityState, document.hasFocus()]") or ["", False]
    if state[0] != "visible" or not state[1]:
        out({"refused": "hidden", "here": host_of(url)})
    if host_of(url) != str(req.get("host") or "") or not req.get("host"):
        out({"refused": "site", "here": host_of(url)})
    r = subprocess.run([sys.executable, "-c", req.get("typer", "")], input=str(req.get("text", "")).encode("utf-8"),
                       env=dict(os.environ, DISPLAY=":1"), capture_output=True)
    if r.returncode != 0:
        out({"error": "typing failed: %s" % r.stderr.decode("utf-8", "replace")[:200]})
    out({"ok": True, "host": host_of(url)})
`;

// L114 — page_contact_sheet: the same address in a temporary tab at several widths, one screenshot each, then the tab
// is closed. Chrome DevTools Protocol methods used as documented (https://chromedevtools.github.io/devtools-protocol/):
// Emulation.setDeviceMetricsOverride (width, height, deviceScaleFactor, mobile), Page.navigate, Page.captureScreenshot
// (format, quality); the tab is made and closed with the /json/new and /json/close endpoints already used above.
const SHEET_PY = String.raw`
def op_sheet(req):
    url = str(req.get("url", ""))
    if not alive():
        out({"error": "The browser is not open. Open a page first with browser_open."})
    made = http("/json/new?about:blank", method="PUT")
    shots = []
    try:
        t = open_tab(made)
        moments = sorted(set(max(0, min(10000, int(m))) for m in list(req.get("moments") or [])[:6]))
        if moments:  # L114: one page at N moments (milliseconds after it starts loading), at the first width
            w = max(320, min(1920, int((list(req.get("widths") or [1280]))[0])))
            t.call("Emulation.setDeviceMetricsOverride", _wait=5, width=w, height=int(req.get("height", 900)), deviceScaleFactor=1, mobile=w < 600)
            start = time.time()
            r = t.call("Page.navigate", _wait=20, url=url)
            if r.get("errorText"):
                out({"error": "The page could not be opened: %s" % r["errorText"]})
            for m in moments:
                wait = start + m / 1000.0 - time.time()
                if wait > 0:
                    time.sleep(wait)
                shot = t.call("Page.captureScreenshot", _wait=15, format="jpeg", quality=60)
                shots.append({"width": w, "at": m, "data": shot.get("data", "")})
        for w in ([] if moments else list(req.get("widths") or [390, 768, 1280])[:4]):
            w = max(320, min(1920, int(w)))
            t.call("Emulation.setDeviceMetricsOverride", _wait=5, width=w, height=int(req.get("height", 900)), deviceScaleFactor=1, mobile=w < 600)
            r = t.call("Page.navigate", _wait=20, url=url)
            if r.get("errorText"):
                out({"error": "The page could not be opened: %s" % r["errorText"]})
            settle(t, cap=8.0)
            shot = t.call("Page.captureScreenshot", _wait=15, format="jpeg", quality=60)
            sw = t.call("Runtime.evaluate", _wait=5, expression="document.documentElement.scrollWidth", returnByValue=True)
            shots.append({"width": w, "data": shot.get("data", ""), "scrollWidth": ((sw.get("result") or {}).get("value") or 0)})
        t.close()
    finally:
        try:
            urllib.request.urlopen(BASE + "/json/close/" + made["id"], timeout=5).read()
        except Exception:
            pass
    out({"ok": True, "shots": shots})
`;

const DISPATCH_PY = String.raw`
OPS = {"read": op_read, "where": op_read, "target": op_target, "open": op_open, "tabs": op_tabs, "tab_switch": op_tab_switch,
       "tab_close": op_tab_close, "dialog_info": op_dialog_info, "dialog_answer": op_dialog_answer, "secret_type": op_secret_type,
       "click": op_click, "keys": op_keys, "snapshot": op_snapshot, "layout": op_layout, "sheet": op_sheet,
       "fill": op_fill, "wait": op_wait, "console": op_console, "network": op_network, "body": op_body, "pagecheck": op_pagecheck,
       "downloads": op_downloads, "download": op_download}
req = json.loads(sys.stdin.read() or "{}")
try:
    OPS.get(req.get("op"), act)(req)
except DialogOpen as e:
    out({"dialog": e.info})
except Fail as e:
    out({"error": "the browser refused: %s" % e})
except SystemExit:
    raise
except Exception as e:
    out({"error": "the browser could not be reached: %s" % (str(e)[:200] or type(e).__name__)})
`;

export const BROWSER_PY = `${CORE_PY}\nWATCH = r"""${WATCH_PY}"""\n${ELEMENT_OPS_PY}${OPS_PY}${SHEET_PY}${DEVTOOLS_PY}${DOWNLOADS_OPS_PY}${DISPATCH_PY}`;

/** One line of browser_tabs: a short stable id (the start of Chrome's target id), what it shows, and its state. */
export interface TabLine { tab: string; title: string; url: string; active: boolean; dialog: string | null }
/** A pixel click bound to an approval: `expect.host` the site, `expect.label` the control's words under the point (read with `probe`). */
export interface GuardedClick { x: number; y: number; button?: "left" | "right" | "middle"; double?: boolean; expect: { host?: string; label?: string }; probe?: string }
/** Whatever the helper answers (each operation fills some of these). */
export interface BrowserAnswer {
  ok?: boolean; error?: string; dialog?: PageDialog | null; refused?: string; here?: string; label?: string | null; tag?: string; type?: string;
  url?: string; title?: string; text?: string; ctx?: TabContext; covered?: string; waited?: number; tabs?: TabLine[]; active?: string;
  closed?: { title: string; url: string }; target?: unknown; tab?: string; host?: string; started?: boolean; newTab?: boolean;
}

const DIALOG_KIND: Record<string, string> = { alert: "an alert", confirm: "a confirmation", prompt: "a question (prompt)", beforeunload: "a “leave this page?”" };
/** What the bot is told about an open dialog: its words, and how to answer it. */
export function dialogWords(d: PageDialog): string {
  const accept = d.type === "beforeunload" ? "accept (leave the page)" : d.type === "alert" ? "accept (OK)" : "accept (OK — the user is asked first)";
  return `The page shows ${DIALOG_KIND[d.type] ?? "a"} dialog: “${clip(String(d.message ?? "").replace(/\s+/g, " "), 300)}”${d.type === "prompt" && d.defaultPrompt ? ` (suggested answer: “${clip(d.defaultPrompt, 80)}”)` : ""}. Nothing else can be read or done on this page until it is answered: use browser_dialog with "dismiss" (always safe) or "${accept.split(" ")[0]}" — ${accept}.`;
}

/** A line about the tabs: a tab that opened by itself since the bot last looked (it is now the active one), or how many are open. */
export function tabNote(ctx: TabContext | undefined): string | undefined {
  if (!ctx) return undefined;
  const opened = ctx.new.at(-1);
  if (opened) return `A new tab opened (“${clip(opened.title || "untitled", 80)}” — ${clip(opened.url, 120)}) and is now in front: you are working in it. ${ctx.tabs} tabs are open (browser_tabs lists them).`;
  return ctx.tabs > 1 ? `${ctx.tabs} tabs are open; you are working in the one in front (browser_tabs lists them).` : undefined;
}

/** The helper's problem in plain words (a dialog in the way, an error, a page that does not answer), or null. */
export function browserTrouble(a: BrowserAnswer): string | null {
  if (a.dialog) return dialogWords(a.dialog);
  if (a.error) return /did not answer within/.test(a.error) ? `${a.error.replace(/^the browser refused: /, "")}. A dialog or a busy page may be in the way: look at the screen (screen_view); Escape (screen_key) closes most dialogs.` : a.error;
  return null;
}
