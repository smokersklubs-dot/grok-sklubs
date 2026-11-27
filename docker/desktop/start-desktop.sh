#!/bin/sh
# Brings up the screen and the desktop, then keeps the container alive.
RES="${SCREEN_RES:-1280x800x24}"
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1
# A browser that was killed with the container leaves lock files that would block the next start.
rm -f /root/.config/sklubot-browser/Singleton* 2>/dev/null
Xvfb :1 -screen 0 "$RES" -nolisten tcp &
# Up to 15 s for the screen: on a slow machine a window manager started before it exits at once ("cannot open display").
for i in $(seq 1 150); do xdpyinfo -display :1 >/dev/null 2>&1 && break; sleep 0.1; done
xsetroot -solid "#2b3040"
# L164 — the accessibility bus (at-spi2-core), started before any app so that every app registers on it: a private session
# bus for its launcher, which writes the bus address on the screen (the AT_SPI_BUS property) where the apps and the app
# reader (server/src/apptree.ts) find it. An app started before the bus never joins it.
if [ -x /usr/libexec/at-spi-bus-launcher ]; then
  DBUS_SESSION_BUS_ADDRESS=$(dbus-daemon --session --fork --print-address) /usr/libexec/at-spi-bus-launcher --launch-immediately >/dev/null 2>&1 &
fi
# The window manager, kept running: without it no window is listed (wmctrl), so the app mask (server/src/teachappmask.ts)
# and the desk checks see nothing. If it stops it is started again; why it stopped goes to /tmp/openbox.log.
keep_wm() { while :; do if ! pgrep -x openbox >/dev/null; then openbox >>/tmp/openbox.log 2>&1 & fi; sleep 2; done; }
keep_wm &
for i in $(seq 1 50); do pgrep -x openbox >/dev/null && break; sleep 0.1; done
# Keyboard layout chosen on the server (DESKTOP_KEYBOARD); the US layout stays if it is unknown. It is set once
# the desktop is up: the screen forgets a layout set while no program is connected to it, so it is tried again
# until it holds.
KB="${KEYBOARD:-us}"
if [ "$KB" != us ]; then
  for i in $(seq 1 15); do
    setxkbmap "$KB" >/dev/null 2>&1 || break
    setxkbmap -query 2>/dev/null | grep -q "^layout: *$KB\$" && break
    sleep 0.2
  done
fi
mkdir -p /root/files /root/.sklubot
# The virtual sound card (sound.sh): what the browser plays can be listened to by the bot (listen_screen).
/opt/sklubot/sound.sh >/dev/null 2>&1 || true
# Debian packages the bot installed with sklubot-install come back after the computer was made again from a new image.
[ -s /root/.sklubot/apt-packages.txt ] && (sklubot-install --restore >>/root/.sklubot/apt-restore.log 2>&1 &)
# Put the bot's look back on (it is kept in the home volume), or start plain until the server sends one.
if [ -f /root/.sklubot/look.json ]; then rm -f /root/.sklubot/applied; python3 /opt/sklubot/dress.py </dev/null >/dev/null 2>&1; else tint2 >/dev/null 2>&1 & fi
# The way to Sklubot (security review H2): this computer's own socket, offered on 127.0.0.1 to its programs (Claude
# Code, Codex, sklubot-api). Sklubot also starts it after each wake; a second one just fails to bind and exits.
if [ -d /run/sklubot ]; then socat TCP-LISTEN:39100,bind=127.0.0.1,reuseaddr,fork UNIX-CONNECT:/run/sklubot/s.sock >/dev/null 2>&1 & fi
exec sleep infinity
