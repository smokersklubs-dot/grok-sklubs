#!/bin/sh
# Brings up the screen and the desktop, then keeps the container alive.
RES="${SCREEN_RES:-1280x800x24}"
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1
# A browser that was killed with the container leaves lock files that would block the next start.
rm -f /root/.config/sklubot-browser/Singleton* 2>/dev/null
Xvfb :1 -screen 0 "$RES" -nolisten tcp &
for i in $(seq 1 50); do xdpyinfo -display :1 >/dev/null 2>&1 && break; sleep 0.1; done
xsetroot -solid "#2b3040"
openbox &
tint2 >/dev/null 2>&1 &
mkdir -p /root/files
exec sleep infinity
