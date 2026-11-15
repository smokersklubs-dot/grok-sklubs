#!/bin/sh
# Brings up the screen and the desktop, then keeps the container alive.
RES="${SCREEN_RES:-1280x800x24}"
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1
# A browser that was killed with the container leaves lock files that would block the next start.
rm -f /root/.config/sklubot-browser/Singleton* 2>/dev/null
Xvfb :1 -screen 0 "$RES" -nolisten tcp &
for i in $(seq 1 50); do xdpyinfo -display :1 >/dev/null 2>&1 && break; sleep 0.1; done
# Keyboard layout chosen on the server (DESKTOP_KEYBOARD); the US layout if it is unknown.
setxkbmap "${KEYBOARD:-us}" 2>/dev/null || setxkbmap us 2>/dev/null
xsetroot -solid "#2b3040"
openbox &
mkdir -p /root/files /root/.sklubot
# Put the bot's look back on (it is kept in the home volume), or start plain until the server sends one.
if [ -f /root/.sklubot/look.json ]; then rm -f /root/.sklubot/applied; python3 /opt/sklubot/dress.py </dev/null >/dev/null 2>&1; else tint2 >/dev/null 2>&1 & fi
exec sleep infinity
