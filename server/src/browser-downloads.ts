/*
 * Portions adapted from Fei2411/DS-Bot (https://github.com/Fei2411/DS-Bot, commit d104d9ca18d69a35460f14e15dff4d553181433a),
 * ds-bot/src/host/browser/session.js (finishDownload, reserveDownloadPath: a download is authorised before it is saved,
 * its file name cleaned, never written over an existing file), Copyright 2026 Fei2411 and the DS Bot contributors,
 * Apache License 2.0. Modified for Sklubot: rewritten in Python for the browser helper of the bot's Linux computer, on the
 * Chrome DevTools Protocol instead of Playwright: the browser saves every download into a held folder outside the bot's
 * library, and a download only enters the library (files/downloads) once approved (browser_download, tools-browser.ts).
 *
 * DS-Bot item 10 (docs/audits/AUDIT-DS-BOT.md #106) — downloads under approval:
 *  - honest limit: the bot also has a root terminal in its own computer, which can reach the held folder; the approval
 *    covers the browser's path into the bot's library (files/downloads), where its file tools and previews look;
 *  - the tab watcher (browser-cdp.ts WATCH_PY) sets Browser.setDownloadBehavior { behavior: "allowAndName", downloadPath:
 *    the held folder, eventsEnabled: true } and follows Browser.downloadWillBegin / Browser.downloadProgress
 *    (https://chromedevtools.github.io/devtools-protocol/tot/Browser/#method-setDownloadBehavior,
 *    https://chromedevtools.github.io/devtools-protocol/tot/Browser/#event-downloadWillBegin,
 *    https://chromedevtools.github.io/devtools-protocol/tot/Browser/#event-downloadProgress); with "allowAndName" each
 *    file is saved under its guid, so a page cannot choose where it lands;
 *  - over 200 MB a download is cancelled (Browser.cancelDownload,
 *    https://chromedevtools.github.io/devtools-protocol/tot/Browser/#method-cancelDownload); at most 50 are kept, each 1 hour;
 *  - "release" moves an approved, finished file into /root/files/downloads under a clean, unique name; "discard" deletes it.
 */

/** Inside the watcher (Python, no triple quotes): state, events and the requests the helper relays. */
export const DOWNLOADS_WATCH_PY = String.raw`
HELD = "/root/Downloads/.held"
FILES_DL = "/root/files/downloads"
DL_MAX = 200 * 1024 * 1024
DL_KEEP_S = 3600
downloads = {}

def dl_prepare():
    # Chromium runs as its own user (docker/desktop/open-browser.sh) and owns /root/Downloads: the held folder is made
    # inside it and handed to that same owner, so the browser can write there and nothing else of the bot's files moves.
    os.makedirs(HELD, exist_ok=True)
    try:
        st = os.stat(os.path.dirname(HELD))
        os.chown(HELD, st.st_uid, st.st_gid)
        os.chmod(HELD, 0o700)
    except OSError:
        pass

def dl_forget(g):
    d = downloads.pop(g, None)
    try:
        os.unlink(os.path.join(HELD, g))
    except OSError:
        pass
    return d

def dl_event(m, prm):
    g = str(prm.get("guid") or "")
    if not g or "/" in g or g.startswith("."):
        return
    if m == "Browser.downloadWillBegin":
        downloads[g] = {"id": g.replace("-", "")[:8], "guid": g, "url": str(prm.get("url", ""))[:2000], "name": str(prm.get("suggestedFilename") or "download")[:200], "state": "inProgress", "size": 0, "at": time.time()}
        while len(downloads) > 50:
            dl_forget(min(downloads.values(), key=lambda d: d["at"])["guid"])
    elif m == "Browser.downloadProgress" and g in downloads:
        d = downloads[g]
        d["size"] = int(prm.get("receivedBytes") or d["size"])
        st = prm.get("state")
        if st in ("completed", "canceled"):
            d["state"] = st
        elif d["size"] > DL_MAX:
            send("Browser.cancelDownload", {"guid": g})
            d["state"] = "canceled"
            d["why"] = "over 200 MB"

def dl_name(name):
    # DS-Bot reserveDownloadPath: control characters and <>:"/\|?* become _, the last path part only.
    base = os.path.basename(str(name).replace("\\", "/"))
    clean = "".join("_" if ord(ch) < 32 or ch in '<>:"/\\|?*' else ch for ch in base).strip()
    return clean if clean and clean not in (".", "..") else "download"

def dl_reserve(name):
    os.makedirs(FILES_DL, exist_ok=True)
    safe = dl_name(name)
    stem, ext = os.path.splitext(safe)
    i = 1
    while True:
        cand = os.path.join(FILES_DL, safe if i == 1 else "%s (%d)%s" % (stem, i, ext))
        try:
            fd = os.open(cand, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
            os.close(fd)
            return cand
        except FileExistsError:
            i += 1

def dl_op(req):
    now = time.time()
    for g in [g for g, d in downloads.items() if now - d["at"] > DL_KEEP_S]:
        dl_forget(g)
    op = req.get("op")
    if op == "downloads":
        return {"downloads": [{k: d.get(k) for k in ("id", "url", "name", "state", "size", "at", "why")} for d in downloads.values()]}
    d = next((x for x in downloads.values() if x["id"] == str(req.get("id") or "")), None)
    if not d:
        return {"error": "no held download has this id (a download is kept 1 hour)"}
    if op == "discard":
        dl_forget(d["guid"])
        return {"ok": True}
    src = os.path.join(HELD, d["guid"])
    if d["state"] != "completed" or not os.path.isfile(src):
        return {"error": "that download has not finished (%s)" % (d.get("why") or d["state"])}
    path = dl_reserve(d["name"])
    os.replace(src, path)
    downloads.pop(d["guid"], None)
    return {"ok": True, "path": os.path.relpath(path, os.path.dirname(FILES_DL)), "size": os.path.getsize(path), "name": os.path.basename(path)}
`;

/** In the browser helper: relays the bot's requests about held downloads to the watcher. */
export const DOWNLOADS_OPS_PY = String.raw`
def op_downloads(req):
    if not ensure_watch():
        out({"error": "the browser is not running"})
    out(watch_ask({"op": "downloads"}, 3))

def op_download(req):
    if not ensure_watch():
        out({"error": "the browser is not running"})
    action = req.get("action")
    if action not in ("release", "discard"):
        out({"error": "unknown download action"})
    out(watch_ask({"op": action, "id": str(req.get("id") or "")}, 15))
`;

export interface HeldDownload { id: string; url: string; name: string; state: "inProgress" | "completed" | "canceled"; size: number; at: number; why?: string }
