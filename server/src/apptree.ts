/**
 * L164 « lecteur d'applis par accessibilité » — the apps of the bot's OWN Linux computer (docker/desktop) read through
 * their accessibility tree (AT-SPI 2), the Linux counterpart of my_ui_tree / my_ui_act (myui.ts, the user's Mac or PC).
 * Our own code; ideas from vercel-labs/agent-desktop's Linux notes (Apache-2.0: the accessibility bus is not the session
 * bus, an app started before the bus never registers and must be reopened), no code copied.
 *
 * APP_TREE_PY runs inside the computer (`python3 -c`, the request as JSON on standard input, one JSON answer on standard
 * output), with the Debian bookworm packages at-spi2-core (the bus launcher and registry), gir1.2-atspi-2.0 and
 * python3-gi added to the image (docker/desktop/Dockerfile). API used, libatspi 2.46 as documented at
 * https://docs.gtk.org/atspi2/ (Python names through PyGObject introspection, https://pygobject.gnome.org/):
 *  - Atspi.get_desktop(0), Accessible.get_child_count / get_child_at_index / get_role_name / get_name /
 *    get_state_set (StateSet.contains with Atspi.StateType) / get_process_id / get_index_in_parent;
 *  - Accessible.get_action_iface → Action.get_n_actions / get_action_name / do_action;
 *  - Accessible.get_component_iface → Component.grab_focus / get_extents(Atspi.CoordType.SCREEN);
 *  - Accessible.get_text_iface → Text.get_character_count / get_text; get_editable_text_iface →
 *    EditableText.set_text_contents; Accessible.get_value_iface → Value.get_current_value;
 *  - Atspi.set_timeout(ms, startup_ms): a frozen app answers "timeout" instead of blocking the call.
 * The bus: libatspi finds it through the AT_SPI_BUS property of the X screen, which at-spi-bus-launcher sets on start
 * (start-desktop.sh starts it, with a private session bus, before any app). On a computer started from an older image the
 * script starts it itself and says so: the apps opened before cannot be read until they are reopened.
 *
 * Ops: {op:"windows"} lists the apps and their windows; {op:"tree", app?, limit?} reads the controls of the app in front
 * (or the named one) — each with a path of child indices from the app, its role, name, states, a text field's text
 * (never a password field's), and its centre on the screen; {op:"act", pid, path, role, name, action, text?} finds the
 * same control again (same app, same path, same role and name, else "stale": nothing is done) and does click / focus /
 * set_text. A password field is never filled or read. The server keeps the readings and the gates (agent/tools-apptree.ts).
 */
export const APP_TREE_PY = String.raw`
import json, os, subprocess, sys, time, warnings
warnings.filterwarnings("ignore")
def out(o):
    sys.stdout.write(json.dumps(o)); sys.stdout.flush(); os._exit(0)
try:
    req = json.loads(sys.stdin.read() or "{}")
except Exception:
    out({"error": "bad_request"})
try:
    import gi
    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi
except Exception:
    out({"error": "no_atspi"})

LAUNCHER = "/usr/libexec/at-spi-bus-launcher"
def bus_running():
    try:
        return subprocess.run(["pgrep", "-f", LAUNCHER], capture_output=True).returncode == 0
    except Exception:
        return False
started = False
if not os.environ.get("AT_SPI_BUS_ADDRESS") and not bus_running() and os.path.exists(LAUNCHER):
    # An older computer: a private session bus, then the launcher, which puts the bus address on the X screen.
    try:
        addr = subprocess.run(["dbus-daemon", "--session", "--fork", "--print-address"], capture_output=True, text=True, timeout=10).stdout.strip()
        env = dict(os.environ, DBUS_SESSION_BUS_ADDRESS=addr)
        subprocess.Popen([LAUNCHER, "--launch-immediately"], env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        time.sleep(1.5)
        started = True
    except Exception:
        pass
try:
    Atspi.set_timeout(3000, 15000)
except Exception:
    pass

INTERACTIVE = {"push button", "toggle button", "check box", "radio button", "menu item", "check menu item", "radio menu item", "menu",
    "text", "entry", "password text", "combo box", "list item", "page tab", "link", "spin button", "slider", "tree item",
    "table cell", "icon", "editbar", "terminal", "document text", "paragraph", "toolbar button", "split button", "date editor"}
QUIET = {"icon", "table cell", "list item", "page tab", "paragraph"}
CONTEXT = {"label", "heading", "alert", "dialog", "status bar", "notification", "tooltip"}
WINDOW_ROLES = {"frame", "window", "dialog", "alert", "file chooser", "color chooser", "font chooser"}
S = Atspi.StateType

def safe(fn, default=None):
    try:
        v = fn()
        return default if v is None else v
    except Exception:
        return default
def states(a):
    st = safe(a.get_state_set)
    has = lambda s: bool(st and safe(lambda: st.contains(s), False))
    return {"active": has(S.ACTIVE), "focused": has(S.FOCUSED), "enabled": has(S.ENABLED) or has(S.SENSITIVE),
        "showing": has(S.SHOWING), "checked": has(S.CHECKED), "editable": has(S.EDITABLE), "selected": has(S.SELECTED),
        "expanded": has(S.EXPANDED), "modal": has(S.MODAL), "checkable": has(S.CHECKABLE)}
def children(a):
    n = safe(a.get_child_count, 0)
    for i in range(min(n, 400)):
        c = safe(lambda: a.get_child_at_index(i))
        if c is not None:
            yield i, c
def apps():
    d = Atspi.get_desktop(0)
    for i, a in children(d):
        yield a
def app_info(a):
    wins = []
    for i, w in children(a):
        role = safe(w.get_role_name, "")
        if role not in WINDOW_ROLES:
            continue
        st = states(w)
        wins.append({"index": i, "role": role, "title": safe(w.get_name, "")[:200], "active": st["active"], "modal": st["modal"], "showing": st["showing"]})
    return {"app": safe(a.get_name, "")[:100], "pid": safe(a.get_process_id, 0), "windows": wins}
def front(name):
    listed = [(a, app_info(a)) for a in apps()]
    listed = [(a, i) for a, i in listed if i["windows"]]
    if name:
        low = name.strip().lower()
        hit = [x for x in listed if x[1]["app"].lower() == low] or [x for x in listed if low in x[1]["app"].lower()] \
            or [x for x in listed if any(low in w["title"].lower() for w in x[1]["windows"])]
        return hit[0] if hit else (None, None)
    act = [x for x in listed if any(w["active"] for w in x[1]["windows"])]
    if act:
        return act[0]
    return listed[-1] if listed else (None, None)
def text_of(a, cap=400):
    t = safe(a.get_text_iface)
    if not t:
        return None
    n = safe(t.get_character_count, 0)
    return safe(lambda: t.get_text(0, min(n, cap)), "")
def centre(a):
    c = safe(a.get_component_iface)
    e = c and safe(lambda: c.get_extents(Atspi.CoordType.SCREEN))
    if not e or e.width <= 0 or e.height <= 0:
        return None
    return [int(e.x + e.width / 2), int(e.y + e.height / 2)]

def op_windows():
    return {"ok": True, "started": started, "apps": [i for i in (app_info(a) for a in apps()) if i["windows"]]}

def op_tree():
    limit = max(1, min(int(req.get("limit") or 150), 300))
    a, info = front(req.get("app"))
    if a is None:
        return {"ok": False, "error": "not_found" if req.get("app") else "no_app", "started": started}
    els, seen = [], [0]
    def walk(node, path, depth, window):
        if len(els) >= limit or seen[0] > 4000 or depth > 40:
            return
        seen[0] += 1
        role = safe(node.get_role_name, "")
        name = (safe(node.get_name, "") or "").strip()
        st = states(node)
        if role in WINDOW_ROLES and len(path) == 1:
            window = name or role
        if path and not st["showing"] and role not in WINDOW_ROLES:
            return
        keep = (role in INTERACTIVE and (name or role not in QUIET or st["focused"])) or (role in CONTEXT and name) or (role in WINDOW_ROLES and len(path) == 1)
        if keep and path:
            e = {"path": path, "role": role, "name": name[:160], "window": window[:120]}
            secure = role == "password text"
            if secure:
                e["secure"] = True
            elif st["editable"] or role in ("text", "entry", "spin button", "combo box"):
                v = text_of(node)
                if v is not None:
                    e["value"] = v
            for k in ("focused", "checked", "selected", "expanded", "editable"):
                if st[k]:
                    e[k] = True
            if not st["enabled"]:
                e["disabled"] = True
            if st["modal"]:
                e["modal"] = True
            c = centre(node)
            if c:
                e["at"] = c
            els.append(e)
        kids = list(children(node))
        if not path:
            # The window in front (an open dialog box) first, so its controls are never cut off by the limit.
            kids.sort(key=lambda x: 0 if states(x[1])["active"] else 1)
        for i, ch in kids:
            walk(ch, path + [i], depth + 1, window)
    walk(a, [], 0, "")
    return {"ok": True, "started": started, "app": info["app"], "pid": info["pid"], "windows": info["windows"], "elements": els, "truncated": len(els) >= limit}

CLICK_NAMES = ["click", "press", "activate", "jump", "toggle", "select", "open"]
def op_act():
    pid = int(req.get("pid") or 0)
    target = next((a for a in apps() if safe(a.get_process_id, 0) == pid), None)
    if target is None:
        return {"ok": False, "stale": "the app is closed"}
    node = target
    for i in req.get("path") or []:
        node = safe(lambda: node.get_child_at_index(int(i)))
        if node is None:
            return {"ok": False, "stale": "the control is gone"}
    role, name = safe(node.get_role_name, ""), (safe(node.get_name, "") or "").strip()[:160]
    if role != req.get("role") or name != req.get("name"):
        return {"ok": False, "stale": "the control changed (now %s \"%s\")" % (role, name[:60])}
    action = req.get("action")
    st = states(node)
    if action in ("click", "set_text") and not st["enabled"]:
        return {"ok": False, "error": "disabled"}
    if action == "focus":
        c = safe(node.get_component_iface)
        ok = bool(c and safe(c.grab_focus, False))
        return {"ok": ok, "error": None if ok else "no_focus"}
    if action == "set_text":
        if role == "password text":
            return {"ok": False, "error": "password"}
        ed = safe(node.get_editable_text_iface)
        if not ed:
            return {"ok": False, "error": "not_editable"}
        text = str(req.get("text") or "")
        if not safe(lambda: ed.set_text_contents(text), False):
            return {"ok": False, "error": "refused"}
        time.sleep(0.2)
        got = text_of(node, len(text) + 50)
        return {"ok": True, "verified": got == text if got is not None else None}
    if action == "click":
        ac = safe(node.get_action_iface)
        n = safe(ac.get_n_actions, 0) if ac else 0
        names = [(safe(lambda: ac.get_action_name(i), "") or "").lower() for i in range(n)]
        pick = next((names.index(w) for w in CLICK_NAMES if w in names), 0 if n else -1)
        if pick < 0:
            return {"ok": False, "error": "no_action", "at": centre(node)}
        if not safe(lambda: ac.do_action(pick), False):
            return {"ok": False, "error": "refused", "at": centre(node)}
        time.sleep(0.3)
        return {"ok": True, "did": names[pick] or "action"}
    return {"ok": False, "error": "bad_action"}

try:
    o = req.get("op")
    out(op_windows() if o == "windows" else op_tree() if o == "tree" else op_act() if o == "act" else {"error": "bad_op"})
except Exception as e:
    msg = str(e)
    out({"error": "timeout" if "timed out" in msg.lower() or "timeout" in msg.lower() else "failed", "detail": msg[:200]})
`;

export interface AppWindow { index: number; role: string; title: string; active: boolean; modal: boolean; showing: boolean }
export interface AppElement { path: number[]; role: string; name: string; window: string; value?: string; secure?: boolean; focused?: boolean; checked?: boolean; selected?: boolean; expanded?: boolean; editable?: boolean; disabled?: boolean; modal?: boolean; at?: [number, number] }
export interface AppTreeAnswer { ok?: boolean; error?: string; detail?: string; started?: boolean; app?: string; pid?: number; windows?: AppWindow[]; elements?: AppElement[]; truncated?: boolean; apps?: { app: string; pid: number; windows: AppWindow[] }[]; stale?: string; verified?: boolean | null; did?: string; at?: [number, number] | null }
