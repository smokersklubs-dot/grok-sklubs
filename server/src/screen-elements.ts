/**
 * The interactive elements of the page in front of a bot's browser, by reference (wave 8, item 6), and actions on one of
 * them — for the bot's own Linux computer. A Python program run inside the computer talks to its Chromium through the
 * Chrome DevTools Protocol on the debugging port the desktop already opens (9222, see open-browser.sh and page-text.py),
 * with the python3-websocket package already in the image. It is passed with `python3 -c` (as the typing helper in
 * linux.ts), so computers made from an older image have it too; the request (and any text to type) travels on standard
 * input, never in a process list.
 *
 * CDP methods used, as documented at https://chromedevtools.github.io/devtools-protocol/tot/ :
 *  - Accessibility.getFullAXTree / getPartialAXTree (…/tot/Accessibility/): roles, accessible names, states, and each
 *    node's backendDOMNodeId (stable for the document's life);
 *  - DOM.getBoxModel, DOM.scrollIntoViewIfNeeded, DOM.focus, DOM.resolveNode (…/tot/DOM/);
 *  - Page.getFrameTree (…/tot/Page/): the main frame's loaderId, which changes with every new document;
 *  - Input.dispatchMouseEvent, Input.insertText, Input.dispatchKeyEvent (…/tot/Input/);
 *  - Runtime.evaluate, Runtime.callFunctionOn (…/tot/Runtime/).
 * A reference is checked before each action: same tab, same document (loaderId), the node still there with the same
 * role and name — otherwise nothing is done and the answer says it is stale.
 */
export const ELEMENTS_PY = String.raw`
import json, sys, urllib.request
from websocket import create_connection

# The interactive elements of the browser's front tab, and actions on one of them, through the Chrome DevTools Protocol
# of the bot's Chromium (port 9222, as page-text.py). Methods used, all documented at
# https://chromedevtools.github.io/devtools-protocol/tot/ :
#   Accessibility.getFullAXTree, Accessibility.getPartialAXTree (Accessibility domain)
#   DOM.getBoxModel, DOM.scrollIntoViewIfNeeded, DOM.focus, DOM.resolveNode (DOM domain)
#   Page.getFrameTree (Page domain: the main frame's loaderId tells a new document from the same one)
#   Input.dispatchMouseEvent, Input.insertText, Input.dispatchKeyEvent (Input domain)
#   Runtime.evaluate, Runtime.callFunctionOn (Runtime domain)
# Reads one JSON request on standard input (text to type never appears in a process list), prints one JSON answer.
INTERACTIVE = {"button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "menuitem", "menuitemcheckbox",
               "menuitemradio", "tab", "switch", "slider", "spinbutton", "option", "listbox", "treeitem", "textarea", "PopUpButton"}

class Fail(Exception):
    pass

def out(obj):
    print(json.dumps(obj))
    sys.exit(0)

req = json.loads(sys.stdin.read() or "{}")
try:
    tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=5))
except Exception:
    out({"error": "The browser is not open. Open a page first."})
pages = [t for t in tabs if t.get("type") == "page" and not t.get("url", "").startswith("devtools:")]
if not pages:
    out({"error": "No page is open in the browser."})
tab = pages[0]
ws = create_connection(tab["webSocketDebuggerUrl"], timeout=15, origin="http://127.0.0.1:9222")
seq = [0]

def call(method, **params):
    seq[0] += 1
    mid = seq[0]
    ws.send(json.dumps({"id": mid, "method": method, "params": params}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == mid:
            if "error" in msg:
                raise Fail(msg["error"].get("message", "error"))
            return msg.get("result", {})

def val(node, key):
    v = node.get(key) or {}
    return v.get("value", "") if isinstance(v, dict) else ""

def props(node):
    p = {}
    for x in node.get("properties", []) or []:
        p[x.get("name")] = (x.get("value") or {}).get("value")
    return p

def loader():
    return call("Page.getFrameTree")["frameTree"]["frame"].get("loaderId", "")

def center(backend):
    q = call("DOM.getBoxModel", backendNodeId=backend)["model"]["content"]
    xs, ys = q[0::2], q[1::2]
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, max(xs) - min(xs), max(ys) - min(ys)

def snapshot(limit):
    size = call("Runtime.evaluate", expression="[innerWidth, innerHeight]", returnByValue=True)["result"]["value"]
    nodes = call("Accessibility.getFullAXTree").get("nodes", [])
    found, seen = [], set()
    for n in nodes:
        role = val(n, "role")
        backend = n.get("backendDOMNodeId")
        if n.get("ignored") or role not in INTERACTIVE or not backend or backend in seen:
            continue
        seen.add(backend)
        p = props(n)
        try:
            x, y, w, h = center(backend)
        except Fail:
            continue
        if w <= 0 or h <= 0:
            continue
        e = {"node": backend, "role": role, "name": " ".join(val(n, "name").split())[:120],
             "visible": 0 <= x < size[0] and 0 <= y < size[1], "y": round(y), "x": round(x)}
        v = val(n, "value")
        if isinstance(v, (str, int, float)) and str(v) != "" and role not in ("button", "link"):
            e["value"] = str(v)[:80]
        for k in ("disabled", "checked", "expanded", "selected", "required"):
            if p.get(k) not in (None, False, "false"):
                e[k] = p.get(k)
        found.append(e)
        if len(found) >= 400:
            break
    # On the screen first, then in reading order (top to bottom, left to right).
    found.sort(key=lambda e: (not e["visible"], e["y"], e["x"]))
    for e in found:
        del e["x"], e["y"]
    return {"url": tab.get("url", ""), "title": tab.get("title", ""), "target": tab.get("id", ""), "loader": loader(),
            "elements": found[:limit], "more": max(0, len(found) - limit)}

INFO = """function () {
  const form = this.form || (this.closest && this.closest('form'));
  return { tag: (this.tagName || '').toLowerCase(), type: (this.getAttribute && this.getAttribute('type') || '').toLowerCase(),
    role: (this.getAttribute && this.getAttribute('role')) || '', formAction: form ? String(form.action || '') : '',
    formMethod: form ? String(form.method || 'get') : '', url: location.href };
}"""
SELECT_ALL = """function () {
  if (typeof this.select === 'function' && 'value' in this) { this.select(); return true; }
  const r = document.createRange(); r.selectNodeContents(this); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true;
}"""
CHOOSE = """function (want) {
  if (this.tagName !== 'SELECT') return { error: 'not a list' };
  const opts = [...this.options];
  const w = String(want).trim().toLowerCase();
  const o = opts.find((x) => x.value === want) || opts.find((x) => x.label.trim().toLowerCase() === w) || opts.find((x) => x.label.trim().toLowerCase().includes(w));
  if (!o) return { error: 'no option', options: opts.map((x) => x.label.trim()).slice(0, 40) };
  this.value = o.value; o.selected = true;
  this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true }));
  return { chosen: o.label.trim() };
}"""

def on(backend, fn, *args):
    obj = call("DOM.resolveNode", backendNodeId=backend)["object"]["objectId"]
    r = call("Runtime.callFunctionOn", objectId=obj, functionDeclaration=fn, arguments=[{"value": a} for a in args], returnByValue=True)
    return (r.get("result") or {}).get("value")

def key(name, code, vk, text=None):
    base = {"key": name, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk}
    call("Input.dispatchKeyEvent", type="keyDown", **base, **({"text": text} if text else {}))
    call("Input.dispatchKeyEvent", type="keyUp", **base)

def act(r):
    # Stale checks: the same tab, the same document, the element still there with the same role and name.
    if r.get("target") != tab.get("id"):
        out({"stale": "another tab is in front now"})
    if r.get("loader") != loader():
        out({"stale": "the page changed (a new page was loaded)"})
    backend = int(r.get("node", 0))
    try:
        part = call("Accessibility.getPartialAXTree", backendNodeId=backend, fetchRelatives=False).get("nodes", [])
    except Fail:
        out({"stale": "that element is no longer on the page"})
    me = next((n for n in part if n.get("backendDOMNodeId") == backend), part[0] if part else None)
    if not me:
        out({"stale": "that element is no longer on the page"})
    name = " ".join(val(me, "name").split())[:120]
    if val(me, "role") != r.get("role") or name != r.get("name"):
        out({"stale": "that element changed (now %s \"%s\")" % (val(me, "role"), name)})
    what = r.get("action")
    if what == "info":
        i = on(backend, INFO) or {}
        i["label"] = name
        out({"info": i, "url": tab.get("url", "")})
    if props(me).get("disabled") not in (None, False, "false"):
        out({"error": "that element is disabled"})
    if what == "click":
        try:
            call("DOM.scrollIntoViewIfNeeded", backendNodeId=backend)
        except Fail:
            pass
        x, y, _, _ = center(backend)
        call("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y)
        call("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="left", buttons=1, clickCount=1)
        call("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button="left", buttons=0, clickCount=1)
        out({"ok": True})
    if what == "type":
        try:
            call("DOM.scrollIntoViewIfNeeded", backendNodeId=backend)
        except Fail:
            pass
        call("DOM.focus", backendNodeId=backend)
        text = str(r.get("text", ""))
        if r.get("clear"):
            on(backend, SELECT_ALL)
            if not text:
                key("Backspace", "Backspace", 8)
        if text:
            call("Input.insertText", text=text)
        if r.get("submit"):
            key("Enter", "Enter", 13, "\r")
        out({"ok": True})
    if what == "select":
        res = on(backend, CHOOSE, str(r.get("value", ""))) or {}
        if res.get("error") == "not a list":
            out({"error": "that element is not a drop-down list (<select>): click it, then click the option"})
        if res.get("error"):
            out({"error": "no option matches", "options": res.get("options", [])})
        out({"ok": True, "chosen": res.get("chosen", "")})
    out({"error": "unknown action"})

try:
    if req.get("op") == "snapshot":
        out(snapshot(max(1, min(300, int(req.get("limit", 150))))))
    act(req)
except Fail as e:
    out({"error": "the browser refused: %s" % e})
`;

export interface PageElement { node: number; role: string; name: string; visible: boolean; value?: string; disabled?: unknown; checked?: unknown; expanded?: unknown; selected?: unknown; required?: unknown }
export interface ElementSnapshot { url: string; title: string; target: string; loader: string; elements: PageElement[]; more: number }
/** What an action asks for: the element as the snapshot saw it, and where. */
export interface ElementRequest { action: "click" | "type" | "select" | "info"; node: number; role: string; name: string; target: string; loader: string; text?: string; clear?: boolean; submit?: boolean; value?: string }
export interface ElementAnswer { ok?: boolean; stale?: string; error?: string; options?: string[]; chosen?: string; info?: { label: string; tag: string; role: string; type: string; formAction: string; formMethod: string; url: string }; url?: string }
