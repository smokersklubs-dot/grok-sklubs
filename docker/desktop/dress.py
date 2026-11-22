#!/usr/bin/env python3
"""Dresses this computer as its bot's own: wallpaper and colours from the bot's colour, a small dock,
a home page for the browser, a light terminal, and tidy browser settings.

  dress.py            read the bot's look (JSON) on standard input, apply what changed, repair what died
  dress.py --profile  only tidy the browser profile (called before each browser start)

Running it again with the same look only checks that everything is still alive (fast).
"""
import colorsys, hashlib, json, os, subprocess, sys, time

HOME = "/root"
STATE = f"{HOME}/.sklubot"
PROFILE = f"{HOME}/.config/sklubot-browser"
VERSION = "5"
ENV = dict(os.environ, DISPLAY=":1")
W, H = (int(x) for x in os.environ.get("SCREEN_RES", "1280x800x24").split("x")[:2])


def run(*args, **kw):
    return subprocess.run(args, env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kw)


def alive(pattern):
    return run("pgrep", "-f", pattern).returncode == 0


def spawn(*args):
    subprocess.Popen(args, env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


# ── Colours ──────────────────────────────────────────────────────────────────
def hex_to_rgb(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def hsl(h, s, l):
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360, max(0, min(1, l)), max(0, min(1, s)))
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


def palette(accent):
    try:
        r, g, b = hex_to_rgb(accent)
    except Exception:
        r, g, b = hex_to_rgb("#7a869a")
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    hue = h * 360
    if s < 0.15:  # black, grey: a calm blue-grey instead of a dull one
        hue, s, l = 218, 0.30, 0.54
    else:
        s = min(0.9, max(0.55, s))
    return {
        "accent": hsl(hue, s, min(0.55, max(0.4, l))),
        "ink": hsl(hue, s * 0.35, 0.16),
        "wash": hsl(hue, s, 0.925),
        "light": hsl(hue - 12, s * 0.9, 0.965),
        "deep": hsl(hue + 10, s, 0.865),
        "glowA": hsl(hue + 28, min(1, s + 0.1), 0.84),
        "glowB": hsl(hue - 30, s, 0.84),
        "line": hsl(hue, s * 0.85, 0.68),
    }


# ── Pieces ───────────────────────────────────────────────────────────────────
# Sixteen small single-stroke doodles, drawn for Sklubot on a 24×24 grid (no fill; stroke 1.5, round ends and joins).
DOODLES = {
    "check": "M5 12.5 L10 17.5 L19 7",
    "spark": "M12 3 V8 M12 16 V21 M3 12 H8 M16 12 H21 M6 6 L8.5 8.5 M15.5 15.5 L18 18 M18 6 L15.5 8.5 M8.5 15.5 L6 18",
    "leaf": "M5 19 C5 10 10 5 19 5 C19 14 14 19 5 19 Z M5 19 L13 11",
    "plane": "M3 11 L21 4 L15 20 L11 13 Z M11 13 L21 4",
    "bubble": "M6 6 H18 Q21 6 21 9 V14 Q21 17 18 17 H11 L7 20 V17 H6 Q3 17 3 14 V9 Q3 6 6 6 Z",
    "star": "M12 3 L14.6 9 L21 9.5 L16 13.6 L17.6 20 L12 16.5 L6.4 20 L8 13.6 L3 9.5 L9.4 9 Z",
    "squiggle": "M3 14 C6 8 8 8 9 12 C10 16 12 16 13.5 12 C15 8 17 8 18 12 C19 15 20 15 21 13",
    "moon": "M15 4 C10 5 7 9 7 13 C7 17.5 10.5 21 15 21 C17 21 18.5 20.4 20 19.5 C15 19 11.5 15.5 11.5 11 C11.5 8 13 5.5 15 4 Z",
    "cloud": "M7 18 H17 Q21 18 21 14.5 Q21 11 17.5 11 Q17 7 13 7 Q9.5 7 8.5 10.5 Q4 10.5 4 14.5 Q4 18 7 18 Z",
    "bolt": "M13 3 L5 13.5 H11.5 L10.5 21 L19 10 H12.5 Z",
    "pencil": "M4 20 L5 15.5 L16 4.5 L19.5 8 L8.5 19 Z M14 6.5 L17.5 10",
    "heart": "M12 20 C6 15.5 3.5 12.5 3.5 9 C3.5 6.5 5.5 4.5 8 4.5 C9.8 4.5 11.2 5.5 12 7 C12.8 5.5 14.2 4.5 16 4.5 C18.5 4.5 20.5 6.5 20.5 9 C20.5 12.5 18 15.5 12 20 Z",
    "plus": "M12 5 V19 M5 12 H19",
    "ring": "M12 4.5 C16.1 4.5 19.5 7.9 19.5 12 C19.5 16.1 16.1 19.5 12 19.5 C7.9 19.5 4.5 16.1 4.5 12 C4.5 7.9 7.9 4.5 12 4.5 Z",
    "note": "M9 18 V6 L19 4 V16 M9 18 C9 19.7 7.7 21 6 21 C4.3 21 3 19.7 3 18 C3 16.3 4.3 15 6 15 C7.7 15 9 16.3 9 18 Z M19 16 C19 17.7 17.7 19 16 19 C14.3 19 13 17.7 13 16 C13 14.3 14.3 13 16 13 C17.7 13 19 14.3 19 16 Z",
    "list": "M9 6 H20 M9 12 H20 M9 18 H20 M4.5 6 H5 M4.5 12 H5 M4.5 18 H5",
}
# Where the doodles go (top-left corner, in % of the screen): along the edges only, so the middle and the dock stay calm.
SLOTS = [(3.5, 7), (10, 27), (3, 47), (9.5, 67), (4, 86), (91, 6), (85, 25), (92, 45), (86, 65), (91.5, 85), (20, 4.5), (74, 5.5), (21, 88), (73, 89)]
# Soft glows: (colour key, opacity at the centre, centre x %, centre y %, radius x %, radius y %).
BLOBS = [("white", 0.85, 12, 6, 46, 52), ("glowA", 0.60, 90, 98, 50, 58), ("glowB", 0.65, 82, 12, 30, 36), ("glowB", 0.65, 6, 96, 30, 34)]


def seeded(seed_text):
    """A small reproducible generator (mulberry32) seeded from the bot's id: same bot, same wallpaper, always."""
    state = [int(hashlib.sha256(seed_text.encode()).hexdigest()[:8], 16)]

    def rand():
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = state[0]
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return rand


def doodle_layout(seed_text, w, h):
    """Which doodle sits in each slot, and its size, turn, nudge and strength. Depends only on the seed and the screen size."""
    rand = seeded(seed_text)
    names = sorted(DOODLES, key=lambda _n: rand())  # each doodle gets a random key; sorting by it shuffles them
    out = []
    for i, (sx, sy) in enumerate(SLOTS):
        name = names[i % len(names)]
        size = 38 + rand() * 26
        turn = -25 + rand() * 50
        dx, dy = -1.2 + rand() * 2.4, -1.2 + rand() * 2.4
        alpha = 0.34 + rand() * 0.26
        out.append({"name": name, "x": (sx + dx) / 100 * w, "y": (sy + dy) / 100 * h, "size": size, "turn": turn, "alpha": alpha})
    return out


def rgba(hex_colour, a):
    r, g, b = (round(c * 255) for c in hex_to_rgb(hex_colour))
    return f"rgba({r},{g},{b},{a})"


def wallpaper_png(p, seed_text, w, h, out):
    """Draws the wallpaper at exactly w×h: diagonal wash, four soft glows, fourteen doodles along the edges."""
    side = int((w + h) / 1.41421356) + 2  # a vertical gradient turned 45° spans the screen corner to corner
    half = side // 2
    cmd = [
        "convert",
        "(", "-size", f"{side}x{half}", f"gradient:{p['light']}-{p['wash']}", "-size", f"{side}x{side - half}", f"gradient:{p['wash']}-{p['deep']}", "-append",
        "-background", p["wash"], "-rotate", "-45", "+repage", "-gravity", "center", "-crop", f"{w}x{h}+0+0", "+repage", ")",
        "-gravity", "northwest",
    ]
    for key, a, cx, cy, rx, ry in BLOBS:
        colour = "#ffffff" if key == "white" else p[key]
        bw, bh = max(2, int(rx / 100 * w * 2)), max(2, int(ry / 100 * h * 2))
        cmd += ["(", "-size", "256x256", "-define", "gradient:extent=Minimum", f"radial-gradient:{rgba(colour, a)}-{rgba(colour, 0)}",
                "-resize", f"{bw}x{bh}!", ")", "-geometry", f"{int(cx / 100 * w - bw / 2):+d}{int(cy / 100 * h - bh / 2):+d}", "-composite"]
    mvg = []
    for d in doodle_layout(seed_text, w, h):
        k = d["size"] / 24
        mvg.append(
            f"push graphic-context translate {d['x'] + d['size'] / 2:.1f},{d['y'] + d['size'] / 2:.1f} rotate {d['turn']:.1f} scale {k:.3f},{k:.3f} translate -12,-12 "
            f"fill none stroke '{p['line']}' stroke-opacity {d['alpha']:.2f} stroke-width 1.5 stroke-linecap round stroke-linejoin round "
            f"path '{DOODLES[d['name']]}' pop graphic-context")
    # Given inline: the image tool's security policy refuses to read drawing commands from a file ("@file").
    cmd += ["-draw", " ".join(mvg), "-resize", f"{w}x{h}!", out]
    r = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:300] or f"convert exited {r.returncode}")


def wallpaper(p, seed_text):
    """Our own wallpaper (B-1), drawn from the bot's palette and id. Falls back to a plain two-tone gradient, then to a flat colour."""
    stamp = hashlib.sha256(json.dumps([p, seed_text, W, H]).encode()).hexdigest()[:12]
    out = f"{STATE}/wallpaper-{stamp}-{W}x{H}.png"
    for old in os.listdir(STATE):
        if old.startswith("wallpaper") and old.endswith(".png") and f"{STATE}/{old}" != out:
            try:
                os.remove(f"{STATE}/{old}")
            except OSError:
                pass
    try:
        if not os.path.exists(out):
            wallpaper_png(p, seed_text, W, H, out)
    except Exception as err:  # vector drawing unavailable: two tones, corner to corner
        print(f"wallpaper: drawing failed ({err}), using a plain gradient", file=sys.stderr)
        try:
            subprocess.run(["convert", "-size", f"{W}x{H}", "-define", "gradient:direction=SouthEast", f"gradient:{p['wash']}-{p['deep']}", out], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            out = None
    # feh paints the root window; the image tool's own "display -window root" is a fallback (its X output is often
    # disabled by the system's image policy).
    if out and (run("feh", "--no-fehbg", "--bg-scale", out).returncode == 0 or run("display", "-window", "root", out).returncode == 0):
        return out
    # No way to paint the desktop: a flat colour, with a warning (not a failure).
    print("wallpaper: could not paint the desktop, keeping a flat colour", file=sys.stderr)
    run("xsetroot", "-solid", p["wash"])
    return None


def desktop_entries():
    apps = f"{HOME}/.local/share/applications"
    os.makedirs(apps, exist_ok=True)
    entries = {
        "sklubot-browser": ("Browser", "/opt/sklubot/open-browser.sh", "chromium"),
        "sklubot-terminal": ("Terminal", "xterm", "utilities-terminal"),
        "sklubot-files": ("Files", f"pcmanfm {HOME}/files", "system-file-manager"),
    }
    for key, (name, cmd, icon) in entries.items():
        with open(f"{apps}/{key}.desktop", "w") as f:
            f.write(f"[Desktop Entry]\nType=Application\nName={name}\nExec={cmd}\nIcon={icon}\nTerminal=false\n")
    return [f"{apps}/{k}.desktop" for k in entries]


def dock(p, launchers):
    """tint2 as a small light dock at the bottom: the three apps, open windows, and a clock."""
    conf = f"{HOME}/.config/tint2"
    os.makedirs(conf, exist_ok=True)
    with open(f"{conf}/tint2rc", "w") as f:
        f.write(f"""# Written by dress.py
rounded = 0
border_width = 1
border_color = {p['deep']} 100
background_color = {p['light']} 100
rounded = 9
border_width = 0
background_color = {p['wash']} 100
rounded = 9
border_width = 0
background_color = {p['deep']} 100

panel_items = LTC
panel_monitor = all
panel_position = bottom center horizontal
panel_size = 0 52
panel_margin = 0 10
panel_shrink = 1
panel_padding = 10 6 8
panel_background_id = 1
wm_menu = 0
panel_dock = 0
panel_layer = top
strut_policy = follow_size
autohide = 0
font_shadow = 0
mouse_left = toggle_iconify

launcher_padding = 2 2 8
launcher_background_id = 0
launcher_icon_size = 30
launcher_icon_theme = Adwaita
launcher_tooltip = 1
{chr(10).join('launcher_item_app = ' + l for l in launchers)}

taskbar_mode = single_desktop
taskbar_padding = 6 0 6
taskbar_background_id = 0
taskbar_name = 0
task_text = 0
task_icon = 1
task_centered = 1
task_maximum_size = 40 40
task_padding = 6 4 6
task_background_id = 0
task_active_background_id = 3
task_iconified_background_id = 0
task_tooltip = 1

time1_format = %H:%M
time1_font = DejaVu Sans Bold 10
clock_font_color = {p['ink']} 100
clock_padding = 8 0
clock_background_id = 0
""")
    run("pkill", "-x", "tint2")
    spawn("tint2")


def terminal_colours(p):
    path = f"{HOME}/.Xresources"
    with open(path, "w") as f:
        f.write(f"""XTerm*faceName: DejaVu Sans Mono
XTerm*faceSize: 11
XTerm*background: #fbfbfc
XTerm*foreground: #1d1e22
XTerm*cursorColor: {p['accent']}
XTerm*internalBorder: 10
XTerm*scrollBar: false
XTerm*saveLines: 5000
XTerm*selectToClipboard: true
""")
    run("xrdb", "-merge", path)


def browser_policy(p):
    """Chromium reads these on start: home page, theme colour, and no distracting prompts."""
    os.makedirs("/etc/chromium/policies/managed", exist_ok=True)
    with open("/etc/chromium/policies/managed/sklubot.json", "w") as f:
        json.dump({
            "HomepageLocation": "http://127.0.0.1:7391/", "HomepageIsNewTabPage": False,
            "NewTabPageLocation": "http://127.0.0.1:7391/", "RestoreOnStartup": 5,
            "BrowserThemeColor": p["accent"], "BookmarkBarEnabled": False, "BrowserSignin": 0,
            "PromotionalTabsEnabled": False, "DefaultBrowserSettingEnabled": False, "MetricsReportingEnabled": False,
            "BrowserGuestModeEnabled": False, "DeveloperToolsAvailability": 1,
        }, f)


def browser_running():
    """Whether a Chromium on the bot's profile is running: its lock (SingletonLock, a link to "<host>-<pid>") names a
    live process, or a process uses the profile."""
    try:
        pid = int(os.readlink(f"{PROFILE}/SingletonLock").rsplit("-", 1)[1])
        os.kill(pid, 0)
        return True
    except (OSError, ValueError, IndexError):
        pass
    return alive(f"user-data-dir={PROFILE}")


def tidy_profile():
    """No 'restore pages?' bubble, no welcome page, no sign-in nudges. Never while the browser runs: removing the lock of
    a live browser let a second Chromium start on the same profile (two browsers, the page read was not the page shown,
    a damaged profile), and the running one rewrites its preferences anyway."""
    if browser_running():
        return
    path = f"{PROFILE}/Default/Preferences"
    for name in ("SingletonLock", "SingletonSocket", "SingletonCookie"):
        try:
            os.remove(f"{PROFILE}/{name}")
        except OSError:
            pass
    if not os.path.exists(path):
        return
    try:
        with open(path) as f:
            prefs = json.load(f)
    except Exception:
        with open(path) as f:
            text = f.read()
        with open(path, "w") as f:
            f.write(text.replace('"exit_type":"Crashed"', '"exit_type":"Normal"').replace('"exited_cleanly":false', '"exited_cleanly":true'))
        return
    prefs.setdefault("profile", {}).update({"exit_type": "Normal", "exited_cleanly": True})
    prefs.setdefault("browser", {})["has_seen_welcome_page"] = True
    prefs.setdefault("bookmark_bar", {})["show_on_all_tabs"] = False
    prefs.setdefault("signin", {})["allowed"] = False
    with open(path, "w") as f:
        json.dump(prefs, f)


def main():
    os.makedirs(STATE, exist_ok=True)
    if "--profile" in sys.argv:
        tidy_profile()
        return
    raw = sys.stdin.read()
    look = json.loads(raw) if raw.strip() else json.load(open(f"{STATE}/look.json"))
    p = palette(look.get("color", "#7a869a"))
    look["palette"] = p
    stamp = hashlib.sha256((VERSION + json.dumps(look, sort_keys=True)).encode()).hexdigest()[:20]
    try:
        applied = open(f"{STATE}/applied").read().strip()
    except OSError:
        applied = ""
    with open(f"{STATE}/look.json", "w") as f:
        json.dump(look, f)
    if applied == stamp and alive("tint2") and alive("home-server.py"):
        print("ok")
        return
    started = time.time()
    if applied != stamp:
        wallpaper(p, str(look.get("id") or look.get("name") or "sklubot"))
        terminal_colours(p)
        browser_policy(p)
        dock(p, desktop_entries())
    else:
        if not alive("tint2"):
            spawn("tint2")
    if not alive("home-server.py"):
        spawn("python3", "/opt/sklubot/home-server.py")
    with open(f"{STATE}/applied", "w") as f:
        f.write(stamp)
    print(f"dressed in {time.time() - started:.1f}s")


if __name__ == "__main__":
    main()
