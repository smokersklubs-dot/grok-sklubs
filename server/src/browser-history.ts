/**
 * L75 — two browser tools that were missing (agent-browser and chrome-devtools-mcp audits; our own code):
 *  - browser_back: back (or forward) one page in the tab in front, through the tab's own history
 *    (Page.getNavigationHistory, Page.navigateToHistoryEntry — https://chromedevtools.github.io/devtools-protocol/tot/Page/),
 *    then the page read back in words like after any action;
 *  - an annotated capture: the page in front with the reference number of each visible control drawn on it (in a closed
 *    shadow root placed over the page, never clickable, removed right after), so the bot can match an icon without a
 *    name or a crowded area to its reference. Page.captureScreenshot (jpeg) of the viewport; the numbers are placed at
 *    the controls' centres as the snapshot measured them (the same window coordinates the clicks use).
 * Python, appended to the browser helper after FRAME_OPS_PY (browser-cdp.ts BROWSER_PY): it uses front(), need(),
 * here(), smart(), finish(), out() and T.
 */
export const HISTORY_OPS_PY = String.raw`
# ── L75: back / forward, and the capture with reference numbers ─────────────────────────────────────────────────────
def op_history(req):
    t, info, ctx = front()
    need(t, ctx)
    T[0] = t
    forward = bool(req.get("forward"))
    h = t.call("Page.getNavigationHistory")
    entries, cur = h.get("entries") or [], int(h.get("currentIndex") or 0)
    i = cur + (1 if forward else -1)
    if i < 0 or i >= len(entries):
        out({"error": "There is no later page in this tab." if forward else "There is no earlier page in this tab: it opened on this page."})
    t.call("Network.enable", _wait=4)
    t.call("Page.navigateToHistoryEntry", _wait=20, entryId=entries[i]["id"])
    waited = smart(t, cap=10.0)
    u, title = here(t)
    finish({"ok": True, "url": u, "title": title, "waited": waited}, req)

MARKS_JS = """((marks) => {
  const old = document.getElementById('__sklubot_marks'); if (old) old.remove();
  const host = document.createElement('div'); host.id = '__sklubot_marks';
  host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
  const root = host.attachShadow({ mode: 'closed' });
  for (const [label, x, y] of marks) {
    const b = document.createElement('span'); b.textContent = label;
    b.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;transform:translate(-50%,-50%);font:700 12px/1.1 Arial,sans-serif;color:#fff;background:#c2185b;border:1.5px solid #fff;border-radius:9px;padding:1px 5px;box-shadow:0 1px 3px rgba(0,0,0,.55);white-space:nowrap';
    root.appendChild(b);
  }
  (document.body || document.documentElement).appendChild(host);
  // Resolved once the numbers are painted (two frames), so the screenshot that follows shows them; a tab that draws no
  // frame (hidden) still answers after 400 ms.
  return new Promise((done) => { const t = setTimeout(() => done(marks.length), 400); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); done(marks.length); })); });
})(__MARKS__)"""

def op_annotate(req):
    t, info, ctx = front()
    need(t, ctx)
    T[0] = t
    marks = [[str(m[0])[:8], float(m[1]), float(m[2])] for m in (req.get("marks") or [])[:150]]
    try:
        # awaitPromise (CDP Runtime.evaluate, https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-evaluate): wait for the paint above.
        t.call("Runtime.evaluate", _wait=5, expression=MARKS_JS.replace("__MARKS__", json.dumps(marks)), returnByValue=True, awaitPromise=True)
        shot = t.call("Page.captureScreenshot", _wait=15, format="jpeg", quality=65)
    finally:
        try:
            t.call("Runtime.evaluate", _wait=5, expression="(() => { const h = document.getElementById('__sklubot_marks'); if (h) h.remove(); return 1; })()", returnByValue=True)
        except Fail:
            pass
    u, title = here(t)
    out({"ok": True, "data": shot.get("data", ""), "url": u, "title": title, "marks": len(marks)})
`;
