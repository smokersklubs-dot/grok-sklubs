import { clip } from "./store.js";

/**
 * L81 and L56 — the developer side of the bot's browser, as parts of the browser helper (browser-cdp.ts):
 *  - the console and the requests of the tab in front, kept by the tab watcher (WATCH_PY in browser-cdp.ts) for the tab's
 *    last 3 pages; read-only for the bot, header values that can carry a secret are masked here before the bot sees them
 *    (like chrome-devtools-mcp's --redactNetworkHeaders; our own list), a response body only for text, scrubbed;
 *  - op_pagecheck: a page the bot just published, rendered in a temporary tab at a phone and a computer width from the
 *    exact files it published (served by a one-shot local server inside the computer with the same headers as the real
 *    page), with its console errors, failed loads, the in-page rules of pagecheck.ts, and one screenshot per width.
 *
 * Ideas from the audits of chrome-devtools-mcp (Apache-2.0) and agent-browser (Apache-2.0), docs/audits; the Python here
 * is ours. CDP methods used, documented at https://chromedevtools.github.io/devtools-protocol/tot/ : Runtime.enable,
 * events Runtime.consoleAPICalled / exceptionThrown; Log.enable, event Log.entryAdded; Network.enable, events
 * Network.responseReceived / loadingFailed; Emulation.setDeviceMetricsOverride; Page.navigate; Page.captureScreenshot;
 * Runtime.evaluate (awaitPromise); and the /json/new and /json/close endpoints.
 */
export const DEVTOOLS_PY = String.raw`
# ── L81: the console and requests of the tab in front (kept by the watcher) ─────────────────────────────────────────
def from_watcher(op, extra=None):
    t, info, ctx = front(enable=False)
    if t:
        t.close()
    ensure_watch()
    try:
        ans = watch_ask(dict({"op": op, "target": info["id"]}, **(extra or {})), 8)
    except Exception as e:
        out({"error": "the tab watcher did not answer (%s)" % str(e)[:120]})
    ans["url"] = info.get("url", "")
    ans["title"] = info.get("title", "")
    ans["ctx"] = ctx
    return ans

def op_console(req):
    out(from_watcher("console"))

def op_network(req):
    out(from_watcher("network"))

def op_body(req):
    out(from_watcher("body", {"id": str(req.get("id", ""))}))

# ── L56: the check of a page the bot published ─────────────────────────────────────────────────────────────────────
def op_pagecheck(req):
    import http.server as hs, shutil, tempfile, threading
    if not alive():
        # Not running yet (a computer just woken): started on its home page, as the desktop does (open-browser.sh).
        subprocess.Popen(["/opt/sklubot/open-browser.sh"], env=dict(os.environ, DISPLAY=":1"), stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, cwd="/root")
        for _ in range(80):
            time.sleep(0.25)
            if alive() and all_pages():
                break
        else:
            out({"error": "the browser did not start"})
    root = tempfile.mkdtemp(prefix="sklubot-check-")
    files = {"index.html": str(req.get("html", ""))}
    for f in list(req.get("files") or [])[:40]:
        rel = os.path.normpath(str(f.get("path", ""))).lstrip("/")
        if rel and not rel.startswith(".."):
            files[rel] = str(f.get("content", ""))
    for rel, body in files.items():
        full = os.path.join(root, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(body)
    headers = dict(req.get("headers") or {})
    types = {"html": "text/html; charset=utf-8", "css": "text/css; charset=utf-8", "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8",
             "json": "application/json; charset=utf-8", "svg": "image/svg+xml; charset=utf-8", "csv": "text/csv; charset=utf-8", "txt": "text/plain; charset=utf-8", "md": "text/markdown; charset=utf-8"}

    class Handler(hs.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass
        def do_GET(self):
            path = urllib.parse.urlsplit(self.path).path
            rel = path[len("/p/check/"):] if path.startswith("/p/check/") else None
            rel = "index.html" if rel == "" else rel
            full = os.path.realpath(os.path.join(root, rel or "-missing-"))
            if rel is None or not full.startswith(root + "/") or not os.path.isfile(full):
                self.send_response(404)
                self.end_headers()
                return
            data = open(full, "rb").read()
            self.send_response(200)
            self.send_header("content-type", types.get(full.rsplit(".", 1)[-1].lower(), "application/octet-stream"))
            for k, v in headers.items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(data)

    server = hs.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d/p/check/" % server.server_address[1]
    made = http("/json/new?about:blank", method="PUT")
    shots, logs, failed, rules = [], [], [], {}
    try:
        t = open_tab(made)
        for d in ("Runtime.enable", "Log.enable", "Network.enable"):
            t.call(d, _wait=4)
        for size in list(req.get("sizes") or [[390, 844], [1280, 800]])[:3]:
            w, h = max(320, min(1920, int(size[0]))), max(400, min(1400, int(size[1])))
            t.call("Emulation.setDeviceMetricsOverride", _wait=5, width=w, height=h, deviceScaleFactor=1, mobile=w < 600)
            t.events = []
            r = t.call("Page.navigate", _wait=20, url=base)
            if r.get("errorText"):
                out({"error": "The page could not be opened: %s" % r["errorText"]})
            settle(t, cap=8.0)
            try:
                t.call("Runtime.evaluate", _wait=5, expression=QUIET, awaitPromise=True, returnByValue=True)
            except Fail:
                pass
            found = t.call("Runtime.evaluate", _wait=10, expression=req.get("rules") or "[]", returnByValue=True, awaitPromise=True)
            rules[str(w)] = (found.get("result") or {}).get("value") or []
            shot = t.call("Page.captureScreenshot", _wait=15, format="jpeg", quality=60)
            shots.append({"width": w, "height": h, "data": shot.get("data", "")})
            for msg in t.events:
                m, p = msg.get("method"), msg.get("params") or {}
                if m == "Runtime.exceptionThrown":
                    d = p.get("exceptionDetails") or {}
                    logs.append({"width": w, "text": ((d.get("exception") or {}).get("description") or d.get("text") or "error").split("\n")[0][:300], "line": (d.get("lineNumber") or 0) + 1, "url": d.get("url", "")})
                elif m == "Runtime.consoleAPICalled" and p.get("type") in ("error", "assert"):
                    logs.append({"width": w, "text": " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args") or [])[:300], "line": 0, "url": ""})
                elif m == "Log.entryAdded" and (p.get("entry") or {}).get("level") == "error" and (p.get("entry") or {}).get("source") != "network":
                    e = p.get("entry") or {}
                    logs.append({"width": w, "text": str(e.get("text", ""))[:300], "line": (e.get("lineNumber") or 0) + 1, "url": e.get("url", ""), "source": e.get("source", "")})
                elif m == "Network.responseReceived" and int((p.get("response") or {}).get("status") or 0) >= 400 and not (p.get("response") or {}).get("url", "").endswith("/favicon.ico"):
                    failed.append({"width": w, "url": (p.get("response") or {}).get("url", "")[:300], "status": (p.get("response") or {}).get("status")})
                elif m == "Network.loadingFailed" and not p.get("canceled"):
                    failed.append({"width": w, "url": "", "id": p.get("requestId"), "error": p.get("errorText", ""), "blocked": p.get("blockedReason", "")})
        t.close()
    finally:
        try:
            urllib.request.urlopen(BASE + "/json/close/" + made["id"], timeout=5).read()
        except Exception:
            pass
        server.shutdown()
        shutil.rmtree(root, ignore_errors=True)
    out({"ok": True, "base": base, "shots": shots, "console": logs, "failed": failed, "rules": rules})
`;

// ── Formatting for the bot (L81) ────────────────────────────────────────────────────────────────────────────────────
export interface ConsoleMessage { level: string; text: string; url?: string; line?: number; source?: string; nav?: number; at?: number }
export interface NetRequest { id: string; method: string; url: string; type?: string; status?: number; mime?: string; size?: number; failed?: string; blocked?: string; done?: boolean; nav?: number; reqHeaders?: Record<string, string>; resHeaders?: Record<string, string> }

/** Header names whose value can carry a secret: shown as "(masked)" (Cookie, Authorization, tokens, keys, sessions…). */
const SECRET_HEADER = /^(cookie|set-cookie|authorization|proxy-authorization|www-authenticate|proxy-authenticate)$|token|secret|passw|api[-_]?key|apikey|session|csrf|xsrf|signature|credential|auth/i;
export const maskHeaders = (h: Record<string, string> | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k, SECRET_HEADER.test(k) ? "(masked)" : clip(String(v), 300)]));

/** Query values that look like secrets are masked in a request's address (?token=…, &key=…). */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (SECRET_HEADER.test(k) || /^(key|sig|code|access_token|id_token)$/i.test(k)) u.searchParams.set(k, "(masked)");
    return u.toString().replace(/%28masked%29/g, "(masked)");
  } catch { return url; }
}

const where = (m: ConsoleMessage) => (m.url ? ` (${clip(m.url.replace(/^.*\//, ""), 60)}${m.line && m.line > 0 ? `:${m.line}` : ""})` : "");
/** The console lines of the tab, newest last; errors only unless `all`. */
export function consoleLines(msgs: ConsoleMessage[], all: boolean, limit: number): { lines: string[]; errors: number; total: number } {
  const errors = msgs.filter((m) => m.level === "error").length;
  const picked = msgs.filter((m) => all || m.level === "error" || m.level === "warning").slice(-limit);
  return { lines: picked.map((m) => `[${m.level}] ${clip(m.text.replace(/\s+/g, " "), 400)}${where(m)}`), errors, total: msgs.length };
}

const size = (n?: number) => (n === undefined ? "" : n >= 1_000_000 ? ` ${(n / 1_000_000).toFixed(1)} MB` : n >= 1000 ? ` ${(n / 1000).toFixed(1)} kB` : ` ${n} B`);
/** One line a request: short number, method, status (or why it failed), kind, address with secret-looking values masked, size. */
export const requestLine = (r: NetRequest, n: number) =>
  `#${n} ${r.method} ${r.failed ? `failed (${clip(r.failed, 60)}${r.blocked ? `, blocked: ${r.blocked}` : ""})` : r.status ?? (r.done ? "?" : "pending")} ${r.type ? r.type.toLowerCase() : ""} ${clip(maskUrl(r.url), 200)}${size(r.size)}`.replace(/ {2,}/g, " ");
