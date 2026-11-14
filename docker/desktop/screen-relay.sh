#!/bin/sh
# Connects standard input/output to this computer's screen server, starting it if needed.
#   screen-relay.sh watch    → view-only screen (port 5901): input from the viewer is ignored
#   screen-relay.sh control  → full control (port 5900)
# The screen servers listen on this container's loopback only; nothing is reachable from outside.
if [ "$1" = "control" ]; then PORT=5900; EXTRA=""; else PORT=5901; EXTRA="-viewonly"; fi
if ! pgrep -f "rfbport $PORT" >/dev/null 2>&1; then
  x11vnc -display :1 -localhost -rfbport "$PORT" -forever -shared -nopw -noxdamage -quiet -bg $EXTRA -o /tmp/x11vnc-$PORT.log >/dev/null 2>&1
fi
for i in 1 2 3 4 5 6 7 8 9 10; do socat -T 1 /dev/null TCP:127.0.0.1:$PORT >/dev/null 2>&1 && break; sleep 0.3; done
exec socat - TCP:127.0.0.1:$PORT
