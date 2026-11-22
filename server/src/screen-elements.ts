/**
 * The interactive elements of the page in front of a bot's browser, by reference (wave 8, item 6), and actions on one of
 * them — for the bot's own Linux computer. This is the elements part of the browser helper (browser-cdp.ts), a Python
 * program run inside the computer that talks to its Chromium through the Chrome DevTools Protocol on the debugging port
 * the desktop already opens (9222, see open-browser.sh), with the python3-websocket package already in the image.
 *
 * CDP methods used, as documented at https://chromedevtools.github.io/devtools-protocol/tot/ :
 *  - Accessibility.getFullAXTree (also with a frameId, for a frame of the page) / getPartialAXTree (…/tot/Accessibility/):
 *    roles, accessible names, states, and each node's backendDOMNodeId (stable for the document's life);
 *  - DOM.getBoxModel, DOM.scrollIntoViewIfNeeded, DOM.focus, DOM.resolveNode (…/tot/DOM/); before a click, the page's
 *    own document.elementFromPoint tells what really receives it, so a click on a control covered by a cookie banner or
 *    a dialog box is refused and the answer names what covers it;
 *  - Page.getFrameTree (…/tot/Page/): the main frame's loaderId, which changes with every new document, and the frames;
 *  - Input.dispatchMouseEvent, Input.insertText, Input.dispatchKeyEvent (…/tot/Input/);
 *  - Runtime.evaluate, Runtime.callFunctionOn (…/tot/Runtime/).
 * A reference is checked before each action: same tab (the bot's active tab, browser-cdp.ts), same document (loaderId),
 * the node still there with the same role and name — otherwise nothing is done and the answer says it is stale. A
 * committing click that was approved also carries what was approved (`expect`: label and site), checked again on that
 * same tab just before the click.
 */
export const ELEMENT_OPS_PY = String.raw`
# ── Element references (wave 8): the interactive elements of the active tab, and actions on one of them ──────────────
# Methods used (https://chromedevtools.github.io/devtools-protocol/tot/): Accessibility.getFullAXTree (with frameId for
# a frame of the page), Accessibility.getPartialAXTree; DOM.getBoxModel, DOM.scrollIntoViewIfNeeded, DOM.focus,
# DOM.resolveNode, and document.elementFromPoint (what is really under the click point); Page.getFrameTree (documents and
# frames); Input.dispatchMouseEvent, Input.insertText, Input.dispatchKeyEvent; Runtime.evaluate, Runtime.callFunctionOn.
INTERACTIVE = {"button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "menuitem", "menuitemcheckbox",
               "menuitemradio", "tab", "switch", "slider", "spinbutton", "option", "listbox", "treeitem", "textarea", "PopUpButton"}
T = [None]

def call(method, **params):
    return T[0].call(method, **params)

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

def frames_of(tree, depth=0, acc=None):
    acc = [] if acc is None else acc
    for child in tree.get("childFrames", []) or []:
        f = child.get("frame", {})
        acc.append({"id": f.get("id"), "url": f.get("url", ""), "name": f.get("name", ""), "depth": depth + 1})
        frames_of(child, depth + 1, acc)
    return acc

def collect(nodes, frame, size, found, seen):
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
        if frame:
            e["frame"] = frame
        v = val(n, "value")
        if isinstance(v, (str, int, float)) and str(v) != "" and role not in ("button", "link"):
            e["value"] = str(v)[:80]
        for k in ("disabled", "checked", "expanded", "selected", "required"):
            if p.get(k) not in (None, False, "false"):
                e[k] = p.get(k)
        found.append(e)
        if len(found) >= 400:
            return

def snapshot(limit, info):
    size = call("Runtime.evaluate", expression="[innerWidth, innerHeight]", returnByValue=True)["result"]["value"]
    tree = call("Page.getFrameTree")["frameTree"]
    found, seen = [], set()
    collect(call("Accessibility.getFullAXTree").get("nodes", []), None, size, found, seen)
    # Frames of the page (an embedded form, a cookie banner, a payment box): each one read on its own and labelled with
    # its site; one the browser keeps in another process (another site) cannot be read from here and is only named.
    frames = []
    top = host_of(tree["frame"].get("url", ""))
    for f in frames_of(tree):
        label = host_of(f["url"]) or f["name"] or "frame"
        entry = {"label": label, "url": f["url"][:200], "sameSite": host_of(f["url"]) == top}
        before = len(found)
        try:
            collect(call("Accessibility.getFullAXTree", frameId=f["id"]).get("nodes", []), label, size, found, seen)
            entry["readable"] = True
            entry["elements"] = len(found) - before
        except Fail:
            entry["readable"] = False
        frames.append(entry)
        if len(frames) >= 20:
            break
    # A frame of another site runs in its own process: it is not in this page's frame tree, so it is found in the page
    # (its <iframe> element) and only named.
    try:
        listed = set(f["url"] for f in frames_of(tree))
        doc = call("Runtime.evaluate", expression="[...document.querySelectorAll('iframe, frame')].slice(0, 20).map((f) => f.src || '')", returnByValue=True)["result"].get("value") or []
        for src in doc:
            if src and src not in listed and len(frames) < 20:
                frames.append({"label": host_of(src) or "frame", "url": src[:200], "sameSite": host_of(src) == top, "readable": False})
    except Fail:
        pass
    found.sort(key=lambda e: (not e["visible"], e["y"], e["x"]))
    for e in found:
        del e["x"], e["y"]
    url, title = here(T[0])
    return {"url": url, "title": title, "target": info["id"], "loader": loader(),
            "elements": found[:limit], "more": max(0, len(found) - limit), "frames": frames}

INFO = """function () {
  const form = this.form || (this.closest && this.closest('form'));
  return { tag: (this.tagName || '').toLowerCase(), type: (this.getAttribute && this.getAttribute('type') || '').toLowerCase(),
    role: (this.getAttribute && this.getAttribute('role')) || '', formAction: form ? String(form.action || '') : '',
    formMethod: form ? String(form.method || 'get') : '', url: location.href, top: (function () { try { return top.location.href; } catch (e) { return ''; } })() };
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
# What really receives a click at (x, y) of the window (document.elementFromPoint, followed into same-site frames and
# shadow roots): this element, something inside it, or its label — otherwise what covers it. (DOM.getNodeForLocation was
# tried first, but its coordinates are not those of Input.dispatchMouseEvent once the page is scrolled.)
HIT = """function (x, y) {
  let doc; try { doc = top.document; } catch (e) { doc = document; }
  let el = doc.elementFromPoint(x, y);
  for (let i = 0; el && i < 10; i++) {
    if (el.shadowRoot) { const inner = el.shadowRoot.elementFromPoint(x, y); if (!inner || inner === el) break; el = inner; continue; }
    if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
      let d = null; try { d = el.contentDocument; } catch (e) { d = null; }
      if (!d) break;
      const r = el.getBoundingClientRect(); x -= r.left + el.clientLeft; y -= r.top + el.clientTop; el = d.elementFromPoint(x, y); continue;
    }
    break;
  }
  if (el && (this === el || this.contains(el))) return { ok: true };
  if (el && this.labels && [...this.labels].some((l) => l === el || l.contains(el))) return { ok: true };
  if (!el) return { ok: false, by: 'nothing (the point is outside the window)' };
  const words = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('alt') || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  const box = el.closest('[role=dialog], dialog, [aria-modal=true]');
  const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\\s+/)[0] || '';
  return { ok: false, by: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '') + (words ? ' "' + words + '"' : '') + (box && box !== el ? ' (inside a dialog box)' : '') };
}"""

def on(backend, fn, *args):
    obj = call("DOM.resolveNode", backendNodeId=backend)["object"]["objectId"]
    r = call("Runtime.callFunctionOn", objectId=obj, functionDeclaration=fn, arguments=[{"value": a} for a in args], returnByValue=True)
    return (r.get("result") or {}).get("value")

def hit_test(backend, x, y):
    """What would really receive a click at (x, y) (window coordinates, as Input.dispatchMouseEvent): the HIT check."""
    return on(backend, HIT, x, y) or {"ok": False, "by": "?"}

def key(name, code, vk, text=None):
    base = {"key": name, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk}
    call("Input.dispatchKeyEvent", type="keyDown", **base, **({"text": text} if text else {}))
    call("Input.dispatchKeyEvent", type="keyUp", **base)

def act(r):
    t, info, ctx = front()
    need(t, ctx)
    T[0] = t
    # Stale checks: the same tab, the same document, the element still there with the same role and name.
    if r.get("target") != info["id"]:
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
        # The site is the tab's own page; a control inside a frame also tells its frame's address.
        i["frameUrl"] = i.get("url", "")
        i["url"] = here(t)[0]
        out({"info": i, "url": i["url"]})
    if props(me).get("disabled") not in (None, False, "false"):
        out({"error": "that element is disabled"})
    t.call("Network.enable", _wait=4)
    if what == "click":
        # A committing click was approved for one control on one site: checked again here, on this very tab, just before.
        expect = r.get("expect")
        if isinstance(expect, dict):
            if host_of(here(t)[0]) != str(expect.get("host") or "") or name[:120] != str(expect.get("label") or "")[:120]:
                out({"stale": "the page changed since this click was approved (now \"%s\" on %s)" % (name, host_of(here(t)[0]) or "?")})
        try:
            call("DOM.scrollIntoViewIfNeeded", backendNodeId=backend)
        except Fail:
            pass
        x, y, _, _ = center(backend)
        h = hit_test(backend, x, y)
        if not h.get("ok"):
            out({"covered": h.get("by") or "?"})
        call("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y)
        try:
            call("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="left", buttons=1, clickCount=1)
            call("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button="left", buttons=0, clickCount=1)
            waited = settle(t)
        except DialogOpen as e:
            out({"ok": True, "dialog": e.info})
        out({"ok": True, "waited": waited})
    if what == "type":
        try:
            call("DOM.scrollIntoViewIfNeeded", backendNodeId=backend)
        except Fail:
            pass
        call("DOM.focus", backendNodeId=backend)
        text = str(r.get("text", ""))
        try:
            if r.get("clear"):
                on(backend, SELECT_ALL)
                if not text:
                    key("Backspace", "Backspace", 8)
            if text:
                call("Input.insertText", text=text)
            if r.get("submit"):
                key("Enter", "Enter", 13, "\r")
            waited = settle(t, cap=8.0 if r.get("submit") else 2.0, quiet=0.5 if r.get("submit") else 0.2)
        except DialogOpen as e:
            out({"ok": True, "dialog": e.info})
        out({"ok": True, "waited": waited})
    if what == "select":
        res = on(backend, CHOOSE, str(r.get("value", ""))) or {}
        if res.get("error") == "not a list":
            out({"error": "that element is not a drop-down list (<select>): click it, then click the option"})
        if res.get("error"):
            out({"error": "no option matches", "options": res.get("options", [])})
        try:
            settle(t, cap=3.0, quiet=0.3)
        except DialogOpen as e:
            out({"ok": True, "chosen": res.get("chosen", ""), "dialog": e.info})
        out({"ok": True, "chosen": res.get("chosen", "")})
    out({"error": "unknown action"})

def op_snapshot(req):
    t, info, ctx = front()
    need(t, ctx)
    T[0] = t
    s = snapshot(max(1, min(300, int(req.get("limit", 150)))), info)
    s["ctx"] = ctx
    out(s)

def op_layout(req):
    t, info, ctx = front()
    need(t, ctx)
    T[0] = t
    frame = call("Page.getFrameTree")["frameTree"]["frame"]["id"]
    world = call("Page.createIsolatedWorld", frameId=frame, worldName="sklubot-layout")
    r = call("Runtime.evaluate", expression=req["expression"], contextId=world["executionContextId"], returnByValue=True, timeout=5000)
    out(r["result"].get("value") or {"error": "The layout could not be measured."})
`;

/** A frame of the page: `readable` false when the browser keeps it in another process (another site). */
export interface PageFrame { label: string; url: string; sameSite: boolean; readable: boolean; elements?: number }
export interface PageElement { node: number; role: string; name: string; visible: boolean; frame?: string; value?: string; disabled?: unknown; checked?: unknown; expanded?: unknown; selected?: unknown; required?: unknown }
export interface ElementSnapshot { url: string; title: string; target: string; loader: string; elements: PageElement[]; more: number; frames?: PageFrame[]; ctx?: TabContext }
/** What an action asks for: the element as the snapshot saw it, and where. `expect`: an approved committing click. */
export interface ElementRequest { action: "click" | "type" | "select" | "info"; node: number; role: string; name: string; target: string; loader: string; text?: string; clear?: boolean; submit?: boolean; value?: string; expect?: { label: string; host: string } }
export interface ElementAnswer { ok?: boolean; stale?: string; error?: string; covered?: string; dialog?: PageDialog | null; options?: string[]; chosen?: string; info?: { label: string; tag: string; role: string; type: string; formAction: string; formMethod: string; url: string; frameUrl?: string }; url?: string; waited?: number }
/** A JavaScript dialog a page shows (alert, confirm, prompt, beforeunload), as the browser reported it. */
export interface PageDialog { type: string; message: string; url?: string; defaultPrompt?: string }
/** The bot's tabs as the helper saw them: how many, the ones that opened since it last looked, open dialogs, the active one. */
export interface TabContext { tabs: number; new: { title: string; url: string }[]; dialogs: Record<string, PageDialog>; id: string }
