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
VERSION = "4"
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
        hue, s = 218, 0.30
    else:
        s = min(0.9, max(0.55, s))
    return {
        "accent": hsl(hue, s, min(0.55, max(0.4, l))),
        "ink": hsl(hue, s * 0.35, 0.16),
        "wash": hsl(hue, s, 0.93),
        "light": hsl(hue - 12, s * 0.9, 0.965),
        "deep": hsl(hue + 10, s, 0.87),
        "glowA": hsl(hue + 28, s + 0.1, 0.84),
        "glowB": hsl(hue - 30, s, 0.84),
        "line": hsl(hue, s * 0.85, 0.7),
    }


# ── Pieces ───────────────────────────────────────────────────────────────────
def wallpaper(p):
    """A soft diagonal wash with two glows and a sprinkle of dots, drawn with ImageMagick."""
    out = f"{STATE}/wallpaper.png"
    draw = []
    for i in range(46):
        x = (i * 397) % W
        y = (i * 263) % H
        if W * 0.2 < x < W * 0.8 and H * 0.2 < y < H * 0.75:
            continue  # keep the middle calm
        r = 2 + (i % 3)
        draw += ["-draw", f"circle {x},{y} {x + r},{y}"]
    subprocess.run([
        "convert", "-size", f"{W}x{H}", f"gradient:{p['light']}-{p['deep']}", "-rotate", "0",
        "(", "-size", f"{W}x{H}", "xc:none", "-fill", p["glowA"], "-draw", f"circle {int(W * 0.82)},{int(H * 0.18)} {int(W * 1.05)},{int(H * 0.18)}", "-blur", "0x90", ")", "-compose", "over", "-composite",
        "(", "-size", f"{W}x{H}", "xc:none", "-fill", p["glowB"], "-draw", f"circle {int(W * 0.12)},{int(H * 0.88)} {int(W * 0.34)},{int(H * 0.88)}", "-blur", "0x90", ")", "-compose", "over", "-composite",
        "-fill", p["line"], *draw, out,
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    run("display", "-window", "root", out)


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


def tidy_profile():
    """No 'restore pages?' bubble, no welcome page, no sign-in nudges."""
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
        wallpaper(p)
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
