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
# Put the bot's look back on (it is kept in the home volume), or start plain until the server sends one.
if [ -f /root/.sklubot/look.json ]; then rm -f /root/.sklubot/applied; python3 /opt/sklubot/dress.py </dev/null >/dev/null 2>&1; else tint2 >/dev/null 2>&1 & fi
# The way to Sklubot (security review H2): this computer's own socket, offered on 127.0.0.1 to its programs (Claude
# Code, Codex, sklubot-api). Sklubot also starts it after each wake; a second one just fails to bind and exits.
if [ -d /run/sklubot ]; then socat TCP-LISTEN:39100,bind=127.0.0.1,reuseaddr,fork UNIX-CONNECT:/run/sklubot/s.sock >/dev/null 2>&1 & fi
exec sleep infinity
