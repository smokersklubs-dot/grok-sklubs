/**
 * L14 — frames of another site (a payment box, a consent banner served by another company, a CAPTCHA) in the bot's
 * browser. Chrome runs such a frame in its own process: it is not in the page's frame tree, so the element snapshot
 * used to name it only. Here each one is read through its own DevTools target session (it is listed by /json/list as a
 * target of type "iframe" whose "parentId" is the page, or another such frame), its controls are listed with the frame's
 * site, and their positions are moved into the page's window (DOM.getFrameOwner gives the <iframe> element of the parent;
 * DOM.getBoxModel its box).
 *
 * Gates, all kept:
 *  - A CAPTCHA frame is never read nor acted on: the bot is told to ask the user (ask_takeover), as the prompt says.
 *  - Only click, hover and "info" (the read behind the approval of a committing click) work on a control of such a
 *    frame. Typing, choosing, filling and uploading are refused: a card form goes through card_fill (bound to the site and
 *    asked every time); anything else is clicked, then typed with screen_type, like before.
 *  - The page is checked as for any element (same tab, same document), the control is checked again in its frame (same
 *    role and name, never "found again"), an approved committing click is checked against the page's site and the
 *    control's words right before, and what is really under the point is checked twice: the <iframe> in the page, then
 *    the control in the frame. The click itself is a real mouse event sent to the page (Input.dispatchMouseEvent at the
 *    page's coordinates: the browser routes it into the frame).
 *
 * Methods (https://chromedevtools.github.io/devtools-protocol/tot/): HTTP /json/list (…/#endpoints: "parentId" of an
 * "iframe" target), DOM.getFrameOwner (…/DOM/#method-getFrameOwner), DOM.getBoxModel, DOM.scrollIntoViewIfNeeded,
 * Accessibility.getFullAXTree / getPartialAXTree, Runtime.callFunctionOn, Input.dispatchMouseEvent.
 * Python, appended to the browser helper after ELEMENT_OPS_PY (browser-cdp.ts BROWSER_PY): it uses its call(), T,
 * collect(), center(), on(), HIT, INFO, check_node(), smart(), finish() and host_of().
 */
export const FRAME_OPS_PY = String.raw`
# ── L14: frames of another site, each read through its own target session ────────────────────────────────────────────
CAPTCHA_MARKS = ("recaptcha", "hcaptcha", "challenges.cloudflare.com", "turnstile", "arkoselabs", "funcaptcha", "geetest", "captcha")
FRAME_ONLY = ("click", "hover", "info")

def is_captcha(url):
    try:
        u = urllib.parse.urlsplit(url)
        where = ((u.hostname or "") + u.path).lower()
    except Exception:
        return False
    return any(m in where for m in CAPTCHA_MARKS)

def frame_targets(page_id):
    """The out-of-process frames of a page (and of its frames), at most 10, parents first."""
    try:
        ts = http("/json/list")
    except Exception:
        return []
    ids, kids, grew = {page_id}, [], True
    while grew and len(kids) < 10:
        grew = False
        for x in ts:
            if x.get("type") == "iframe" and x.get("parentId") in ids and x["id"] not in ids and x.get("webSocketDebuggerUrl"):
                ids.add(x["id"])
                kids.append(x)
                grew = True
    return kids[:10]

def frame_box(parent_tab, frame_id):
    """The <iframe> element of a frame in its parent's session, and the top-left corner of its content box there."""
    owner = parent_tab.call("DOM.getFrameOwner", frameId=frame_id)["backendNodeId"]
    q = parent_tab.call("DOM.getBoxModel", backendNodeId=owner)["model"]["content"]
    return owner, min(q[0::2]), min(q[1::2])

def frame_chain(page, page_id, frame_id):
    """The frame's own session and where it sits in the page's window: {"tab", "x", "y", "owner", "parent", "url"} (and the
    sessions opened on the way, to close), or None when it is not a frame of this page any more."""
    ts = {x["id"]: x for x in frame_targets(page_id)}
    if frame_id not in ts:
        return None
    path, cur = [], ts[frame_id]
    while cur is not None:
        path.insert(0, cur)
        cur = ts.get(cur.get("parentId"))
    if path[0].get("parentId") != page_id:
        return None
    parent, ox, oy, opened, owner, parent_tab = page, 0.0, 0.0, [], None, page
    for f in path:
        owner, x, y = frame_box(parent, f["id"])
        parent_tab = parent
        ox, oy = ox + x, oy + y
        parent = Tab(f, timeout=8)
        opened.append(parent)
    return {"tab": parent, "x": ox, "y": oy, "owner": owner, "parent": parent_tab, "url": path[-1].get("url", ""), "opened": opened,
            "parentX": ox - x, "parentY": oy - y}

def cross_site_frames(page_id, size, found, frames, top, listed):
    """Reads every out-of-process frame of the page: its controls go into "found" (positions in the page's window), each
    frame into "frames". Returns the addresses it handled."""
    done = set()
    page = T[0]
    for f in frame_targets(page_id):
        if len(frames) >= 20:
            break
        url = f.get("url", "")
        done.add(url)
        if url in listed:
            continue
        entry = {"label": host_of(url) or "frame", "url": url[:200], "sameSite": host_of(url) == top, "crossSite": True, "readable": False}
        if is_captcha(url):
            entry["captcha"] = True
            frames.append(entry)
            continue
        chain = None
        try:
            chain = frame_chain(page, page_id, f["id"])
            if chain:
                T[0] = chain["tab"]
                mine, before = [], len(found)
                collect(call("Accessibility.getFullAXTree").get("nodes", []), entry["label"], size, mine, set())
                for e in mine[: max(0, 400 - before)]:
                    e["x"], e["y"] = round(e["x"] + chain["x"]), round(e["y"] + chain["y"])
                    e["visible"] = 0 <= e["x"] < size[0] and 0 <= e["y"] < size[1]
                    e["frameTarget"] = f["id"]
                    e["crossSite"] = True
                    found.append(e)
                entry["readable"] = True
                entry["elements"] = len(found) - before
        except Fail:
            entry["readable"] = False
        except Exception:
            entry["readable"] = False
        finally:
            T[0] = page
            for s in (chain or {}).get("opened", []):
                s.close()
        frames.append(entry)
    return done

def frame_act(r, page, info):
    """An action on a control of a frame of another site (see FRAME_ONLY): checked in its frame, clicked through the page."""
    what = r.get("action")
    if what not in FRAME_ONLY:
        out({"error": "that control is inside a frame of another site: only clicking it works here. For a payment card use card_fill; otherwise click the field, then type with screen_type"})
    chain = frame_chain(page, info["id"], str(r.get("frameTarget")))
    if not chain:
        out({"stale": "that frame is no longer on the page"})
    if is_captcha(chain["url"]):
        out({"error": "that is a CAPTCHA: never solve it yourself. Ask the user with ask_takeover"})
    try:
        T[0] = chain["tab"]
        found = check_node(r, False)
        if "why" in found:
            out({"stale": found["why"]})
        backend, name, me = found["backend"], found["name"], found["node"]
        if what == "info":
            i = on(backend, INFO) or {}
            i["label"] = name
            i["frameUrl"] = chain["url"]
            T[0] = page
            i["url"] = here(page)[0]
            out({"info": i, "url": i["url"]})
        if props(me).get("disabled") not in (None, False, "false"):
            out({"error": "that element is disabled"})
        expect = r.get("expect")
        T[0] = page
        if what == "click" and isinstance(expect, dict):
            if host_of(here(page)[0]) != str(expect.get("host") or "") or name[:120] != str(expect.get("label") or "")[:120]:
                out({"stale": "the page changed since this click was approved (now \"%s\" on %s)" % (name, host_of(here(page)[0]) or "?")})
        try:
            chain["parent"].call("DOM.scrollIntoViewIfNeeded", backendNodeId=chain["owner"])
        except Fail:
            pass
        T[0] = chain["tab"]
        try:
            call("DOM.scrollIntoViewIfNeeded", backendNodeId=backend)
        except Fail:
            pass
        for s in chain["opened"]:
            s.close()
        chain = frame_chain(page, info["id"], str(r.get("frameTarget")))
        if not chain:
            out({"stale": "that frame is no longer on the page"})
        T[0] = chain["tab"]
        fx, fy, _, _ = center(backend)
        inner = hit_test(backend, fx, fy)
        x, y = fx + chain["x"], fy + chain["y"]
        T[0] = chain["parent"]
        outer = hit_test(chain["owner"], x - chain["parentX"], y - chain["parentY"])
        T[0] = page
        if not outer.get("ok"):
            out({"covered": outer.get("by") or "?"})
        if not inner.get("ok"):
            out({"covered": inner.get("by") or "?"})
        page.call("Network.enable", _wait=4)
        page.call("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y)
        screen_point(x, y)
        if what == "hover":
            finish({"ok": True, "waited": smart(page, cap=2.0, quiet=0.2)}, r)
        try:
            for n in ((1, 2) if r.get("double") else (1,)):
                page.call("Input.dispatchMouseEvent", _wait=10, type="mousePressed", x=x, y=y, button="left", buttons=1, clickCount=n)
                page.call("Input.dispatchMouseEvent", _wait=10, type="mouseReleased", x=x, y=y, button="left", buttons=0, clickCount=n)
            waited = smart(page)
        except DialogOpen as e:
            out({"ok": True, "dialog": e.info})
        except Fail as e:
            out({"sent": True, "error": "the page did not confirm the click (%s)" % e})
        finish({"ok": True, "waited": waited, "frame": host_of(chain["url"])}, r)
    finally:
        T[0] = page
`;
