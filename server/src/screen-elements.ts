// Portions adapted from vercel-labs/agent-browser (https://github.com/vercel-labs/agent-browser, commit
// d2dfc782ccdd79d25a9b4f0acced9321789cecb8), Copyright 2025 Vercel Inc., Apache License 2.0: HINT (its HINT_FUNCTION,
// cli/src/native/snapshot.rs, unchanged) and HREF; modified for Sklubot: called from our Python helper, shown in our own
// snapshot lines. See THIRD_PARTY_NOTICES.md.
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
 *
 * L65/L74/L75 (audits of agent-browser and chrome-devtools-mcp): an action can send a fresh snapshot back (`after`) so
 * the bot reads what changed instead of a screenshot; a control with no name (or a shared one) gets a hint, a link its
 * address (HINT and HREF from agent-browser, Apache-2.0, see THIRD_PARTY_NOTICES.md); typing is read back ("verified");
 * an element the page redrew is found again by its role and name when that is unique (never for a committing click);
 * a click or typing the page did not confirm is reported as "sent, not confirmed"; after an action the helper also waits
 * for the page's own changes to calm down; several fields are filled in one call (op_fill), a file is put in a file
 * field (DOM.setFileInputFiles, only from /root/files), and op_wait waits for a text, an address or the end of a load.
 * Further CDP methods used: DOM.setFileInputFiles (…/tot/DOM/#method-setFileInputFiles), Runtime.evaluate with
 * awaitPromise (…/tot/Runtime/#method-evaluate).
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
    # A frame of another site runs in its own process: it is not in this page's frame tree. L14: it is read through its
    # own target session (screen-frames.ts); one that cannot be (or a CAPTCHA) is found in the page and only named.
    try:
        listed = set(f["url"] for f in frames_of(tree))
        listed |= cross_site_frames(info["id"], size, found, frames, top, listed)
        doc = call("Runtime.evaluate", expression="[...document.querySelectorAll('iframe, frame')].slice(0, 20).map((f) => f.src || '')", returnByValue=True)["result"].get("value") or []
        for src in doc:
            if src and src not in listed and len(frames) < 20:
                frames.append({"label": host_of(src) or "frame", "url": src[:200], "sameSite": host_of(src) == top, "readable": False})
    except Fail:
        pass
    found.sort(key=lambda e: (not e["visible"], e["y"], e["x"]))
    for e in found:
        x, y = e.pop("x"), e.pop("y")
        if e["visible"]:
            e["at"] = [x, y]  # L75: where the annotated capture draws its number
    kept = found[:limit]
    hints(kept)
    url, title = here(T[0])
    try:
        outline = call("Runtime.evaluate", expression=OUTLINE, returnByValue=True)["result"].get("value") or {}
    except Fail:
        outline = {}
    return {"url": url, "title": title, "target": info["id"], "loader": loader(),
            "elements": kept, "more": max(0, len(found) - limit), "frames": frames, "outline": outline}

# L74 — a hint for a control with no name, or with the same role and name as another (an icon button, "Delete" on each
# row): its icon, picture, stable attribute and the words of its row. HINT is agent-browser's HINT_FUNCTION
# (vercel-labs/agent-browser, cli/src/native/snapshot.rs, Apache-2.0), unchanged; the address of each link likewise
# (its "-u" option). Both are read with DOM.resolveNode + Runtime.callFunctionOn, as agent-browser does.
HINT = """function() {
    const tail = (s, sep) => (s || '').split(sep).pop();
    const use = this.querySelector('svg use');
    const svg = this.querySelector('svg[id], svg[data-icon]');
    const mark = this.querySelector('svg[class], i[class]');
    const img = this.querySelector('img[src]:not([src^="data:"])');
    const icon = use ? tail(use.getAttribute('href') || use.getAttribute('xlink:href'), '#')
        : svg ? svg.id || svg.dataset.icon
        : mark ? mark.getAttribute('class').split(/\\s+/).filter((c) => /^(lucide|fa|bi|mdi|ri|ti|icon)-/.test(c)).join(' ')
        : '';
    const file = img ? tail(img.getAttribute('src').split(/[?#]/)[0], '/').replace(/\\.\\w+$/, '') : '';
    const key = ['data-testid', 'name', 'id'].find((k) => /^(?!.*\\d{3})[a-z][\\w-]*$/i.test(this.getAttribute(k) || ''));
    const row = this.closest('tr, li, article, [role=row], [role=listitem]');
    const near = row ? row.innerText.replace(this.innerText, '').replace(/\\s+/g, ' ').trim() : '';
    return [icon && 'icon:' + icon, file && 'img:' + file, key && key + ':' + this.getAttribute(key), near && 'in:' + near]
        .filter(Boolean).map((s) => s.slice(0, 48)).join('; ');
}"""
HREF = "function() { return this.href ? String(this.href) : ''; }"

def hints(found):
    counts = {}
    for e in found:
        counts[(e["role"], e["name"])] = counts.get((e["role"], e["name"]), 0) + 1
    asked, links = 0, 0
    for e in found:
        if e.get("frameTarget"):
            continue  # L14: its node belongs to another frame's session, not this page's
        try:
            if e["role"] == "link" and links < 150:
                links += 1
                h = on(e["node"], HREF)
                if h:
                    e["href"] = str(h)[:300]
            if (not e["name"] or counts[(e["role"], e["name"])] > 1) and asked < 80:
                asked += 1
                h = on(e["node"], HINT)
                if h:
                    e["hint"] = str(h)[:160]
        except Fail:
            continue

# L65 — the page's structure for a text result: its headings, its visible text as lines (to tell what text appeared
# after an action), and how much of the screen a canvas, video or embed covers (then words are not enough).
OUTLINE = """(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const heads = [...document.querySelectorAll('h1, h2, h3, [role=heading]')].filter(vis).slice(0, 30)
    .map((h) => ({ level: Number((h.tagName.match(/^H(\\d)$/) || [])[1] || h.getAttribute('aria-level') || 2), text: (h.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 120) }))
    .filter((h) => h.text);
  const text = document.body ? (document.body.innerText || '') : '';
  const seen = new Set(), lines = [];
  for (const l of text.split('\\n')) { const t = l.replace(/\\s+/g, ' ').trim(); if (t && !seen.has(t)) { seen.add(t); lines.push(t.slice(0, 200)); if (lines.length >= 400) break; } }
  const area = innerWidth * innerHeight; let media = 0;
  for (const el of document.querySelectorAll('canvas, video, embed, object')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    media += Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
  }
  return { headings: heads, lines: lines, textLength: text.length, media: area ? Math.min(1, media / area) : 0 };
})()"""

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
  return { chosen: o.label.trim(), verified: this.value === o.value };
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

# L74 — what a field holds after typing, read back from the page (a password's value is never sent back, only whether
# it matches); whether a box is checked.
READ_VALUE = """function () {
  const v = ('value' in this && typeof this.value === 'string') ? this.value : (this.isContentEditable ? this.innerText : null);
  return { value: v, password: String(this.type || '').toLowerCase() === 'password' };
}"""
CHECKED = """function () {
  return { tag: (this.tagName || '').toLowerCase(), checked: ('checked' in this && (this.type === 'checkbox' || this.type === 'radio')) ? !!this.checked : this.getAttribute('aria-checked') === 'true' };
}"""
# L75 — the file field a control stands for: itself, the field of its <label>, one inside or near it, or the page's only one.
FILE_INPUT = """function () {
  const isFile = (e) => !!e && e.tagName === 'INPUT' && String(e.type || '').toLowerCase() === 'file';
  if (isFile(this)) return this;
  if (isFile(this.control)) return this.control;
  const inside = this.querySelector && this.querySelector('input[type=file]'); if (inside) return inside;
  for (let p = this.parentElement, i = 0; p && i < 4; p = p.parentElement, i++) { const f = p.querySelector('input[type=file]'); if (f) return f; }
  const all = document.querySelectorAll('input[type=file]'); return all.length === 1 ? all[0] : null;
}"""
FILE_NAMES = "function () { return [...(this.files || [])].map((f) => f.name); }"
# L75 — smart wait: after the load and the quiet network (settle), the page's own changes calm down (a MutationObserver
# sees nothing for 300 ms; 3 s at most).
QUIET = """new Promise((done) => {
  const start = Date.now(); let last = Date.now();
  const mo = new MutationObserver(() => { last = Date.now(); });
  mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const tick = () => { if (Date.now() - last >= 300 || Date.now() - start >= 3000) { mo.disconnect(); done(Date.now() - start); } else setTimeout(tick, 50); };
  setTimeout(tick, 50);
})"""

def smart(t, cap=8.0, quiet=0.5):
    waited = settle(t, cap=cap, quiet=quiet)
    try:
        r = t.call("Runtime.evaluate", _wait=5, expression=QUIET, awaitPromise=True, returnByValue=True)
        waited += float((r.get("result") or {}).get("value") or 0) / 1000.0
    except Fail:
        pass
    return round(waited, 2)

def finish(ans, r):
    """The answer of an action; with "after" (L65), a fresh snapshot of the tab in front once it is done (it may be a new
    tab the action opened), so the bot reads what changed instead of looking at a screenshot."""
    if AT[0] and ans.get("ok") and "at" not in ans:
        ans["at"] = AT[0]
    if r.get("after") and not ans.get("dialog"):
        try:
            t2, info2, ctx2 = front()
            if t2 is None:
                ans["dialog"] = ctx2["dialogs"].get(ctx2["id"])
            else:
                T[0] = t2
                s = snapshot(max(1, min(300, int(r.get("limit", 150)))), info2)
                s["ctx"] = ctx2
                ans["after"] = s
        except DialogOpen as e:
            ans["dialog"] = e.info
        except Fail:
            pass
    out(ans)

def find_again(role, name):
    hits = []
    for n in call("Accessibility.getFullAXTree").get("nodes", []):
        if n.get("ignored") or not n.get("backendDOMNodeId"):
            continue
        if val(n, "role") == role and " ".join(val(n, "name").split())[:120] == name:
            hits.append(n)
            if len(hits) > 1:
                break
    return hits

def check_node(r, relocate):
    """The element a request names, as the page is now: {"backend", "name", "node"} (and "moved" when it was found again by
    its role and name after the page redrew it, L74), or {"why": …} when it is gone or changed. A committing click never
    relocates."""
    backend = int(r.get("node", 0))
    me, why = None, None
    try:
        part = call("Accessibility.getPartialAXTree", backendNodeId=backend, fetchRelatives=False).get("nodes", [])
        me = next((n for n in part if n.get("backendDOMNodeId") == backend), part[0] if part else None)
    except Fail:
        me = None
    name = ""
    if not me:
        why = "that element is no longer on the page"
    else:
        name = " ".join(val(me, "name").split())[:120]
        if val(me, "role") != r.get("role") or name != r.get("name"):
            why = "that element changed (now %s \"%s\")" % (val(me, "role"), name)
    if why is None:
        return {"backend": backend, "name": name, "node": me}
    if relocate and r.get("role") and r.get("name"):
        hits = find_again(r.get("role"), r.get("name"))
        if len(hits) == 1:
            return {"backend": hits[0]["backendDOMNodeId"], "name": r.get("name"), "node": hits[0], "moved": hits[0]["backendDOMNodeId"]}
    return {"why": why}

class NotSent(Exception):
    pass

AT = [None]
def screen_point(x, y):
    """L149: where a click at (x, y) of the window lands on the whole screen (the approximation of computer.ts
    targetScript, good for a maximised window), for the trail of clicks on the screen view."""
    try:
        o = call("Runtime.evaluate", returnByValue=True, expression="(() => { const s = Math.max(0, (outerWidth - innerWidth) / 2); return [screenX + s, screenY + Math.max(0, outerHeight - innerHeight - s)]; })()")["result"]["value"]
        AT[0] = [round(x + o[0]), round(y + o[1])]
    except Exception:
        AT[0] = None

def press(backend, double=False):
    """A real mouse click in the middle of the element, after checking what is under that point. Returns what covers it,
    or None once the click was sent (a Fail after that point means: sent, not confirmed)."""
    try:
        call("DOM.scrollIntoViewIfNeeded", backendNodeId=backend)
    except Fail:
        pass
    try:
        x, y, _, _ = center(backend)
        h = hit_test(backend, x, y)
        if not h.get("ok"):
            return h.get("by") or "?"
        call("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y)
        screen_point(x, y)
    except Fail as e:
        raise NotSent(str(e))
    for n in ((1, 2) if double else (1,)):
        call("Input.dispatchMouseEvent", _wait=10, type="mousePressed", x=x, y=y, button="left", buttons=1, clickCount=n)
        call("Input.dispatchMouseEvent", _wait=10, type="mouseReleased", x=x, y=y, button="left", buttons=0, clickCount=n)
    return None

def typed_of(check, text, clear):
    v = (check or {}).get("value")
    if v is None:
        return {"verified": None}
    norm = lambda s: " ".join(str(s).split())
    ok = norm(v) == norm(text) if clear else norm(text) in norm(v)
    ans = {"verified": ok}
    if not (check or {}).get("password"):
        ans["value"] = str(v)[:200]
    return ans

def same_page(r, info):
    if r.get("target") != info["id"]:
        out({"stale": "another tab is in front now"})
    if r.get("loader") != loader():
        out({"stale": "the page changed (a new page was loaded)"})

def act(r):
    t, info, ctx = front()
    need(t, ctx)
    T[0] = t
    # Stale checks: the same tab, the same document, the element still there with the same role and name (or, L74,
    # found again by them when the page redrew it — never for a committing click or a check before one).
    same_page(r, info)
    what = r.get("action")
    if r.get("frameTarget"):
        frame_act(r, t, info)  # L14: a control of a frame of another site (screen-frames.ts)
    found = check_node(r, what in ("click", "type", "select", "hover", "upload") and not isinstance(r.get("expect"), dict))
    if "why" in found:
        out({"stale": found["why"]})
    backend, name, me = found["backend"], found["name"], found["node"]
    base = {"moved": found["moved"]} if found.get("moved") else {}
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
    if what in ("click", "hover"):
        # A committing click was approved for one control on one site: checked again here, on this very tab, just before.
        expect = r.get("expect")
        if what == "click" and isinstance(expect, dict):
            if host_of(here(t)[0]) != str(expect.get("host") or "") or name[:120] != str(expect.get("label") or "")[:120]:
                out({"stale": "the page changed since this click was approved (now \"%s\" on %s)" % (name, host_of(here(t)[0]) or "?")})
        if what == "hover":
            try:
                call("DOM.scrollIntoViewIfNeeded", backendNodeId=backend)
            except Fail:
                pass
            x, y, _, _ = center(backend)
            call("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y)
            finish(dict(base, ok=True, waited=smart(t, cap=2.0, quiet=0.2)), r)
        try:
            covered = press(backend, bool(r.get("double")))
            if covered:
                out({"covered": covered})
            waited = smart(t)
        except DialogOpen as e:
            out(dict(base, ok=True, dialog=e.info))
        except NotSent as e:
            out({"error": "the click could not be aimed (%s)" % e})
        except Fail as e:
            out({"sent": True, "error": "the page did not confirm the click (%s)" % e})
        finish(dict(base, ok=True, waited=waited), r)
    if what == "type":
        try:
            call("DOM.scrollIntoViewIfNeeded", backendNodeId=backend)
        except Fail:
            pass
        call("DOM.focus", backendNodeId=backend)
        text = str(r.get("text", ""))
        typed = {"verified": None}
        try:
            if r.get("clear"):
                on(backend, SELECT_ALL)
                if not text:
                    key("Backspace", "Backspace", 8)
            if text:
                call("Input.insertText", _wait=10, text=text)
            typed = typed_of(on(backend, READ_VALUE), text, bool(r.get("clear")))
            if r.get("submit"):
                key("Enter", "Enter", 13, "\r")
            waited = smart(t, cap=8.0 if r.get("submit") else 2.0, quiet=0.5 if r.get("submit") else 0.2)
        except DialogOpen as e:
            out(dict(base, ok=True, dialog=e.info, typed=typed))
        except Fail as e:
            out({"sent": True, "error": "the page did not confirm the typing (%s)" % e})
        finish(dict(base, ok=True, waited=waited, typed=typed), r)
    if what == "select":
        res = on(backend, CHOOSE, str(r.get("value", ""))) or {}
        if res.get("error") == "not a list":
            out({"error": "that element is not a drop-down list (<select>): click it, then click the option"})
        if res.get("error"):
            out({"error": "no option matches", "options": res.get("options", [])})
        try:
            smart(t, cap=3.0, quiet=0.3)
        except DialogOpen as e:
            out(dict(base, ok=True, chosen=res.get("chosen", ""), dialog=e.info))
        finish(dict(base, ok=True, chosen=res.get("chosen", ""), verified=res.get("verified")), r)
    if what == "upload":
        path = os.path.realpath(os.path.join("/root/files", str(r.get("path", "")).lstrip("/")))
        if not path.startswith("/root/files/") or not os.path.isfile(path):
            out({"error": "there is no such file in your files folder"})
        obj = call("DOM.resolveNode", backendNodeId=backend)["object"]["objectId"]
        field = (call("Runtime.callFunctionOn", objectId=obj, functionDeclaration=FILE_INPUT, returnByValue=False).get("result") or {}).get("objectId")
        if not field:
            out({"error": "no file field goes with that element: take a snapshot and give the file field, or the button that opens the file picker"})
        call("DOM.setFileInputFiles", files=[path], objectId=field)
        names = (call("Runtime.callFunctionOn", objectId=field, functionDeclaration=FILE_NAMES, returnByValue=True).get("result") or {}).get("value") or []
        try:
            waited = smart(t, cap=4.0, quiet=0.3)
        except DialogOpen as e:
            out(dict(base, ok=True, dialog=e.info, uploaded=names))
        finish(dict(base, ok=True, waited=waited, uploaded=names, verified=os.path.basename(path) in names), r)
    out({"error": "unknown action"})

TRUE = (True, 1, "1", "true", "on", "yes", "checked", "oui", "vrai")
CHECKABLE = ("checkbox", "switch", "radio", "menuitemcheckbox", "menuitemradio")

def fill_one(f):
    if f.get("frameTarget"):
        return {"error": "that field is inside a frame of another site: click it, then type with screen_type (card_fill for a payment card)"}
    found = check_node(f, True)
    if "why" in found:
        return {"stale": found["why"]}
    backend, me = found["backend"], found["node"]
    moved = {"moved": found["moved"]} if found.get("moved") else {}
    if props(me).get("disabled") not in (None, False, "false"):
        return {"error": "that element is disabled"}
    v = f.get("value")
    kind = on(backend, CHECKED) or {}
    if kind.get("tag") == "select":
        res = on(backend, CHOOSE, str(v)) or {}
        if res.get("error"):
            return {"error": "no option matches", "options": res.get("options", [])}
        return dict(moved, ok=True, chosen=res.get("chosen", ""), verified=res.get("verified"))
    if f.get("role") in CHECKABLE:
        want = (v.strip().lower() if isinstance(v, str) else v) in TRUE
        if f.get("role") in ("radio", "menuitemradio") and not want:
            return {"error": "a radio button cannot be unticked: choose another one of its group"}
        if kind.get("checked") != want:
            covered = press(backend)
            if covered:
                return {"covered": covered}
            time.sleep(0.15)
        now = (on(backend, CHECKED) or {}).get("checked")
        return dict(moved, ok=True, checked=now, verified=now == want)
    try:
        call("DOM.scrollIntoViewIfNeeded", backendNodeId=backend)
    except Fail:
        pass
    call("DOM.focus", backendNodeId=backend)
    text = "" if v is None else str(v)
    on(backend, SELECT_ALL)
    if text:
        call("Input.insertText", _wait=10, text=text)
    else:
        key("Backspace", "Backspace", 8)
    return dict(moved, ok=True, typed=typed_of(on(backend, READ_VALUE), text, True))

def op_fill(req):
    """L75 — several fields of one form in one call: text typed (replacing what was there), a list's option chosen, a box
    ticked or unticked; each read back. Stops at a dialog; a field that cannot be done is said and the others still are."""
    t, info, ctx = front()
    need(t, ctx)
    T[0] = t
    same_page(req, info)
    t.call("Network.enable", _wait=4)
    results = []
    try:
        for f in list(req.get("fields") or [])[:30]:
            try:
                results.append(fill_one(f))
            except NotSent as e:
                results.append({"error": "it could not be aimed (%s)" % e})
            except Fail as e:
                results.append({"sent": True, "error": str(e)[:200]})
                break
        waited = smart(t, cap=3.0, quiet=0.3)
    except DialogOpen as e:
        out({"ok": True, "results": results, "dialog": e.info})
    finish({"ok": True, "results": results, "waited": waited}, req)

def op_wait(req):
    """L75 — waits (30 s at most) until the tab in front shows a text, no longer shows one, is on an address that contains
    some words, and/or has finished loading; then reads the page like after an action."""
    t, info, ctx = front()
    need(t, ctx)
    T[0] = t
    t.call("Network.enable", _wait=4)
    text, gone, url = str(req.get("text") or ""), str(req.get("gone") or ""), str(req.get("url") or "")
    cap = max(0.5, min(30.0, float(req.get("timeout") or 10)))
    start = time.time()
    probe = "(() => { const b = (document.body ? document.body.innerText : '').toLowerCase(); return [location.href, document.readyState, b.includes(%s), b.includes(%s)]; })()" % (json.dumps(text.lower()), json.dumps(gone.lower()))
    v = None
    while True:
        try:
            v = t.value(probe, wait=5) or v
        except Fail:
            pass
        if v and (not text or v[2]) and (not gone or not v[3]) and (not url or url.lower() in str(v[0]).lower()) and (not req.get("load") or v[1] == "complete"):
            if req.get("load"):
                settle(t, cap=max(0.5, cap - (time.time() - start)), quiet=0.5)
            finish({"ok": True, "waited": round(time.time() - start, 2), "url": v[0]}, req)
        if time.time() - start >= cap:
            out({"timeout": True, "waited": round(time.time() - start, 2), "url": (v or [""])[0],
                 "textSeen": bool(v and v[2]), "goneSeen": bool(v and v[3]), "state": (v or ["", ""])[1]})
        t.pump(min(start + cap, time.time() + 0.25))

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
export interface PageFrame { label: string; url: string; sameSite: boolean; readable: boolean; elements?: number; /** L14: kept by the browser in its own process (read through its own target). */ crossSite?: boolean; /** L14: a CAPTCHA: never read nor acted on. */ captcha?: boolean }
/** `hint` (L74): icon, picture, stable attribute or row words of a control with no name or a shared one; `href`: a link's address. */
export interface PageElement { node: number; role: string; name: string; visible: boolean; frame?: string; value?: string; disabled?: unknown; checked?: unknown; expanded?: unknown; selected?: unknown; required?: unknown; hint?: string; href?: string; /** L75: centre in the window (visible ones), for the annotated capture. */ at?: [number, number]; /** L14: inside a frame of another site, read through that frame's own target (its id). */ frameTarget?: string; crossSite?: boolean }
/** L65: the page's headings, its visible text as lines, and the share of the screen a canvas, video or embed covers. */
export interface PageOutline { headings?: { level: number; text: string }[]; lines?: string[]; textLength?: number; media?: number }
export interface ElementSnapshot { url: string; title: string; target: string; loader: string; elements: PageElement[]; more: number; frames?: PageFrame[]; ctx?: TabContext; outline?: PageOutline }
/** What an action asks for: the element as the snapshot saw it, and where. `expect`: an approved committing click. `after`: send a fresh snapshot back (L65). */
export interface ElementRequest { action: "click" | "type" | "select" | "info" | "hover" | "upload"; node: number; role: string; name: string; target: string; loader: string; text?: string; clear?: boolean; submit?: boolean; value?: string; expect?: { label: string; host: string }; after?: boolean; double?: boolean; path?: string; limit?: number; /** L14: the control is in this frame of another site. */ frameTarget?: string }
/** L74: what a field holds after typing (no value for a password), and whether it is what was typed. */
export interface Typed { verified: boolean | null; value?: string }
/** One field of element_fill, as the helper did it. */
export interface FillResult { ok?: boolean; stale?: string; error?: string; covered?: string; sent?: boolean; options?: string[]; chosen?: string; checked?: boolean; typed?: Typed; verified?: boolean | null; moved?: number }
export interface ElementAnswer {
  ok?: boolean; stale?: string; error?: string; covered?: string; dialog?: PageDialog | null; options?: string[]; chosen?: string;
  info?: { label: string; tag: string; role: string; type: string; formAction: string; formMethod: string; url: string; frameUrl?: string }; url?: string; waited?: number;
  /** L74: the action was sent but the page did not confirm it (it may have happened). */ sent?: boolean;
  /** L74: the element was found again by its role and name under this node. */ moved?: number;
  typed?: Typed; verified?: boolean | null; uploaded?: string[]; results?: FillResult[];
  /** L65: the page once the action was done. */ after?: ElementSnapshot;
  /** L149: where a click landed on the whole screen (pixels), for the trail on the screen view. */ at?: [number, number];
  /** L75 browser_wait: still not there. */ timeout?: boolean; textSeen?: boolean; goneSeen?: boolean; state?: string;
}
/** A JavaScript dialog a page shows (alert, confirm, prompt, beforeunload), as the browser reported it. */
export interface PageDialog { type: string; message: string; url?: string; defaultPrompt?: string }
/** The bot's tabs as the helper saw them: how many, the ones that opened since it last looked, open dialogs, the active one. */
export interface TabContext { tabs: number; new: { title: string; url: string }[]; dialogs: Record<string, PageDialog>; id: string }
