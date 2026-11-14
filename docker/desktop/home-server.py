#!/usr/bin/env python3
"""The browser's home page on this computer, served on the loopback only (port 7391).

It shows the bot's name and role in its colours, a clock, a search box and the computer's apps; the
app tiles open the terminal or the file manager on this screen. The page reloads itself when the bot's
look changes (renamed, new colour)."""
import html, json, os, subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATE = "/root/.sklubot"
ENV = dict(os.environ, DISPLAY=":1")
APPS = {
    "terminal": ["xterm"],
    "files": ["pcmanfm", "/root/files"],
    "browser": ["/opt/sklubot/open-browser.sh", "about:blank"],
}
WORDS = {
    "fr": {"hello": "Bon retour", "search": "Rechercher sur le web", "terminal": "Terminal", "files": "Fichiers", "browser": "Nouvelle fenêtre", "role": "Ordinateur de"},
    "en": {"hello": "Welcome back", "search": "Search the web", "terminal": "Terminal", "files": "Files", "browser": "New window", "role": "Computer of"},
}


def look():
    try:
        with open(f"{STATE}/look.json") as f:
            return json.load(f)
    except Exception:
        return {"name": "Bot", "label": "", "palette": {"accent": "#6b7280", "ink": "#1f2430", "wash": "#f1f2f4", "deep": "#e6e8ec", "light": "#f6f7f8"}}


def stamp():
    try:
        return open(f"{STATE}/applied").read().strip()
    except OSError:
        return ""


def character(kind, body):
    """The bot's character, drawn in SVG (simplified from the app's): it breathes, blinks and follows the mouse."""
    if kind == "dots":
        return f"""<svg class="chr" viewBox="0 0 100 100" aria-hidden="true">
<circle cx="50" cy="50" r="44" fill="color-mix(in srgb,{body} 14%,#fff)" stroke="color-mix(in srgb,{body} 30%,#fff)"/>
<g id="face"><g class="eyes"><circle cx="37" cy="42" r="6.5" fill="{body}"/><circle cx="63" cy="42" r="6.5" fill="{body}"/></g>
<g fill="{body}"><circle cx="35" cy="60" r="2.6"/><circle cx="42" cy="64" r="2.6"/><circle cx="50" cy="65.5" r="2.6"/><circle cx="58" cy="64" r="2.6"/><circle cx="65" cy="60" r="2.6"/></g></g></svg>"""
    if kind == "muse":
        return f"""<svg class="chr muse" viewBox="0 0 100 100" aria-hidden="true">
<defs><radialGradient id="mg" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="color-mix(in srgb,{body} 45%,#fff)"/><stop offset="1" stop-color="{body}"/></radialGradient>
<radialGradient id="mh"><stop offset="0.5" stop-color="{body}" stop-opacity=".45"/><stop offset="1" stop-color="{body}" stop-opacity="0"/></radialGradient></defs>
<circle class="halo" cx="50" cy="50" r="48" fill="url(#mh)"/><circle cx="50" cy="50" r="30" fill="url(#mg)"/>
<g id="face"><g class="eyes" stroke="#fff" stroke-width="3" stroke-linecap="round"><path d="M42 44v7"/><path d="M58 44v7"/></g></g></svg>"""
    return f"""<svg class="chr" viewBox="0 0 100 100" aria-hidden="true">
<defs><radialGradient id="hl" cx="34" cy="24" r="46" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<radialGradient id="sh" cx="44" cy="40" r="62" gradientUnits="userSpaceOnUse"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></radialGradient>
<radialGradient id="bead" cx="45%" cy="38%" r="60%"><stop offset=".55" stop-color="#fff"/><stop offset="1" stop-color="#c9ccd3"/></radialGradient></defs>
<ellipse cx="50" cy="96" rx="33" ry="3.6" fill="#000" opacity=".16"/>
<g class="body"><path d="M50 8 C75 8 90 29 90 54 C90 79 73 92 50 92 C27 92 10 79 10 54 C10 29 25 8 50 8 Z" fill="{body}"/>
<path d="M50 8 C75 8 90 29 90 54 C90 79 73 92 50 92 C27 92 10 79 10 54 C10 29 25 8 50 8 Z" fill="url(#sh)"/>
<path d="M50 8 C75 8 90 29 90 54 C90 79 73 92 50 92 C27 92 10 79 10 54 C10 29 25 8 50 8 Z" fill="url(#hl)"/>
<g class="eyes"><circle cx="37" cy="54" r="12" fill="url(#bead)"/><circle cx="63" cy="54" r="12" fill="url(#bead)"/>
<g id="face"><circle cx="37" cy="54" r="6" fill="#1b1d21"/><circle cx="63" cy="54" r="6" fill="#1b1d21"/><circle cx="35" cy="52" r="1.7" fill="#fff"/><circle cx="61" cy="52" r="1.7" fill="#fff"/></g></g>
<path d="M44 72 Q50 76 56 72" fill="none" stroke="color-mix(in srgb,{body} 22%,#111215)" stroke-width="2" stroke-linecap="round"/></g></svg>"""


def page():
    lk = look()
    p = lk.get("palette", {})
    w = WORDS.get(lk.get("locale", "en"), WORDS["en"])
    e = lambda s: html.escape(str(s or ""))
    name, label, owner = e(lk.get("name")), e(lk.get("label")), e(lk.get("owner"))
    tiles = "".join(
        f'<button class="tile" data-app="{k}"><span class="ico">{icon}</span><span>{e(w[k])}</span></button>'
        for k, icon in (("terminal", "&gt;_"), ("files", "&#128193;"), ("browser", "&#8862;"))
    )
    return f"""<!doctype html><html lang="{e(lk.get('locale', 'en'))}"><head><meta charset="utf-8">
<title>{name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{{--accent:{p.get('accent')};--ink:{p.get('ink')};--wash:{p.get('wash')};--deep:{p.get('deep')};--light:{p.get('light')}}}
*{{box-sizing:border-box}}html,body{{margin:0;height:100%}}
body{{font-family:"DejaVu Sans",system-ui,sans-serif;color:var(--ink);background:linear-gradient(135deg,var(--light),var(--deep));display:flex;align-items:center;justify-content:center}}
main{{width:min(640px,92vw);text-align:center}}
.avatar{{width:120px;height:120px;margin:0 auto 14px}}.chr{{width:100%;height:100%;overflow:visible}}
.chr .body,.chr.muse circle:nth-of-type(2){{transform-origin:50px 94px;animation:breathe 3.6s ease-in-out infinite}}
.chr .eyes{{transform-box:fill-box;transform-origin:center;animation:blink 5s infinite}}
.chr .halo{{transform-origin:50px 50px;animation:halo 3.6s ease-in-out infinite}}
#face{{transition:transform .12s ease-out}}
@keyframes breathe{{50%{{transform:scale(1.015,1.045)}}}}
@keyframes blink{{0%,93%,100%{{transform:scaleY(1)}}95%{{transform:scaleY(.08)}}}}
@keyframes halo{{50%{{transform:scale(1.08);opacity:.8}}}}
.clock{{font-size:76px;font-weight:300;letter-spacing:-2px;line-height:1}}
.date{{margin-top:6px;opacity:.7;font-size:16px;text-transform:capitalize}}
.hello{{margin-top:26px;font-size:20px}}.hello b{{color:var(--accent)}}
.role{{margin-top:4px;opacity:.65;font-size:14px}}
form{{margin:28px auto 0;max-width:520px}}
input{{width:100%;padding:14px 20px;border-radius:999px;border:1px solid color-mix(in srgb,var(--ink) 12%,transparent);background:#ffffffcc;font:inherit;font-size:16px;outline:none}}
input:focus{{border-color:var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 18%,transparent)}}
.tiles{{display:flex;gap:14px;justify-content:center;margin-top:30px}}
.tile{{width:104px;padding:14px 8px;border:0;border-radius:18px;background:#ffffffb3;color:var(--ink);font:inherit;font-size:13px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px}}
.tile:hover{{background:#fff}}.ico{{width:42px;height:42px;border-radius:13px;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:700}}
</style></head><body><main>
<div class="avatar">{character(lk.get("kind", "mascot"), e(lk.get("color") or p.get("accent")))}</div>
<div class="clock" id="clock">--:--</div><div class="date" id="date"></div>
<div class="hello">{e(w['hello'])}, <b>{name}</b></div>
<div class="role">{label or e(w['role']) + ' ' + name}{(' · ' + owner) if owner else ''}</div>
<form action="https://duckduckgo.com/" method="get"><input name="q" placeholder="{e(w['search'])}" autocomplete="off" autofocus></form>
<div class="tiles">{tiles}</div>
</main><script>
const lang=document.documentElement.lang;
function tick(){{const d=new Date();document.getElementById('clock').textContent=d.toLocaleTimeString(lang,{{hour:'2-digit',minute:'2-digit'}});document.getElementById('date').textContent=d.toLocaleDateString(lang,{{weekday:'long',day:'numeric',month:'long'}});}}
tick();setInterval(tick,1000);
const face=document.getElementById('face');if(face)addEventListener('pointermove',ev=>{{const r=face.ownerSVGElement.getBoundingClientRect();const dx=ev.clientX-(r.left+r.width/2),dy=ev.clientY-(r.top+r.height/2),d=Math.hypot(dx,dy)||1,k=Math.min(1,d/400)*4.5;face.style.transform=`translate(${{dx/d*k}}px,${{dy/d*k}}px)`;}});
document.querySelectorAll('.tile').forEach(b=>b.onclick=()=>fetch('/launch',{{method:'POST',headers:{{'x-sklubot':'1','content-type':'application/json'}},body:JSON.stringify({{app:b.dataset.app}})}}));
let s={json.dumps(stamp())};setInterval(async()=>{{try{{const r=await fetch('/stamp');const j=await r.json();if(j.stamp!==s)location.reload();}}catch(e){{}}}},5000);
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, kind="text/html; charset=utf-8"):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("content-type", kind)
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.split("?")[0] == "/":
            return self.send(200, page())
        if self.path == "/stamp":
            return self.send(200, json.dumps({"stamp": stamp()}), "application/json")
        if self.path == "/health":
            return self.send(200, json.dumps({"ok": True, "pid": os.getpid()}), "application/json")
        self.send(404, "not found", "text/plain")

    def do_POST(self):
        # Only this page may launch apps: it sends a custom header that other sites cannot send without asking.
        origin = self.headers.get("origin")
        if self.path != "/launch" or self.headers.get("x-sklubot") != "1" or (origin and origin != "http://127.0.0.1:7391"):
            return self.send(403, "forbidden", "text/plain")
        length = min(int(self.headers.get("content-length") or 0), 4096)
        try:
            app = json.loads(self.rfile.read(length) or b"{}").get("app")
        except Exception:
            app = None
        cmd = APPS.get(app)
        if not cmd:
            return self.send(404, "unknown app", "text/plain")
        subprocess.Popen(cmd, env=ENV, cwd="/root", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        self.send(200, "{}", "application/json")


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 7391), Handler).serve_forever()
