#!/bin/sh
# Opens an address in the bot's browser: a new tab of the running browser if it answers (opened through its debugging
# port, PUT /json/new — https://chromedevtools.github.io/devtools-protocol/#endpoints), otherwise a fresh start. A
# browser that is running but no longer answers is stopped first, then restarted (logins are kept). Never a second
# Chromium on the same profile: its lock files are only removed once no browser uses it. Videos may start without a
# click (Chromium's --autoplay-policy switch, developer.chrome.com/blog/autoplay): their sound goes to the computer's
# virtual sound card (sound.sh), where only listen_screen hears it.
#
# L48 — the browser runs as the user "browser" with Chromium's own sandbox (Dockerfile; the computer is created with
# docker/desktop/seccomp-chromium.json, which allows the user namespaces that sandbox needs). The bot's shell stays root.
# If the sandbox cannot start (a computer made without that profile, a host that forbids user namespaces), the browser
# still opens, without its sandbox but never as root, and /tmp/sklubot-browser-sandbox says why: Sklubot shows it to
# the server's owner (browserfreshness.ts).
PROFILE=/root/.config/sklubot-browser
STATE=/tmp/sklubot-browser-sandbox
LOG=/tmp/sklubot-browser.log
BUSER=browser
alive() { curl -fsS -m 1.5 http://127.0.0.1:9222/json/version >/dev/null 2>&1; }
running() { pgrep -f "user-data-dir=$PROFILE" >/dev/null 2>&1; }
if running && alive; then
  URL="${1:-http://127.0.0.1:7391/}"
  Q=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$URL")
  ID=$(curl -fsS -m 5 -X PUT "http://127.0.0.1:9222/json/new?$Q" | python3 -c 'import json, sys; print(json.load(sys.stdin)["id"])' 2>/dev/null)
  [ -n "$ID" ] && curl -fsS -m 5 "http://127.0.0.1:9222/json/activate/$ID" >/dev/null 2>&1
  DISPLAY=:1 wmctrl -x -a SklubotBrowser >/dev/null 2>&1
  exit 0
fi
if running; then
  pkill -f "user-data-dir=$PROFILE"; sleep 1; pkill -9 -f "user-data-dir=$PROFILE" 2>/dev/null
  for i in 1 2 3 4 5 6 7 8 9 10; do running || break; sleep 0.3; done
fi
running || rm -f "$PROFILE"/Singleton* 2>/dev/null
python3 /opt/sklubot/dress.py --profile >/dev/null 2>&1
[ $# -gt 0 ] || set -- "http://127.0.0.1:7391/"

# Who runs the browser. As root with the browser user present (the normal case): that user, with a clean environment
# (nothing the bot exported in its terminal reaches the browser). Its profile and downloads, in the bot's home volume,
# are handed to it (files the bot's root shell put there included); /root itself only lets it pass (711), never list.
AS=""
if [ "$(id -u)" = 0 ] && id -u "$BUSER" >/dev/null 2>&1; then
  mkdir -p /root/.config "$PROFILE" /root/Downloads
  chmod 711 /root; chmod o+x /root/.config; chmod 700 "$PROFILE" /root/Downloads
  find "$PROFILE" /root/Downloads ! -user "$BUSER" -exec chown -h "$BUSER:$BUSER" {} + 2>/dev/null
  AS="setpriv --reuid=$BUSER --regid=$BUSER --init-groups env -i HOME=/home/$BUSER USER=$BUSER LOGNAME=$BUSER \
PATH=/usr/local/bin:/usr/bin:/bin LANG=${LANG:-C.UTF-8} DISPLAY=:1 PULSE_SERVER=${PULSE_SERVER:-unix:/tmp/pulse/native}"
fi
set -- --test-type --no-first-run --no-default-browser-check --disable-dev-shm-usage \
  --hide-crash-restore-bubble --password-store=basic --start-maximized --class=SklubotBrowser \
  --autoplay-policy=no-user-gesture-required \
  --remote-debugging-port=9222 --remote-allow-origins=http://127.0.0.1:9222 \
  --user-data-dir="$PROFILE" "$@"

if [ -z "$AS" ]; then
  # An image without the browser user, or a call that is already not root: the old way (root needs --no-sandbox).
  if [ "$(id -u)" = 0 ]; then echo "off root" > "$STATE"; exec chromium --no-sandbox "$@" >/dev/null 2>&1; fi
  exec chromium "$@" >/dev/null 2>&1
fi

: > "$LOG"
# What the browser writes (profile, downloads) is its own: the bot's root shell still reads it, nobody else.
umask 077
# Only the first 64 kB of its output are kept (enough to see why a start failed; Chromium keeps logging while it runs),
# the rest is read and dropped so the browser never writes into a closed pipe. "exit N" marks its end.
( $AS chromium "$@" 2>&1; echo "exit $?" ) | { head -c 65536 > "$LOG"; cat > /dev/null; } &
JOB=$!
# Up to 15 s for the first answer. Still starting after that: it is left to finish. Gone with a sandbox error: the
# browser starts again without its sandbox (still as the browser user), and the reason is kept for the owner.
for i in $(seq 1 60); do
  alive && break
  grep -q "^exit " "$LOG" 2>/dev/null && break
  sleep 0.25
done
if ! grep -q "^exit " "$LOG" 2>/dev/null; then echo "on" > "$STATE"; wait "$JOB"; exit 0; fi
if grep -qi "sandbox\|zygote" "$LOG"; then
  if grep -qi "no usable sandbox" "$LOG"; then echo "off no usable sandbox" > "$STATE"; else echo "off sandbox error" > "$STATE"; fi
  ( $AS chromium --no-sandbox "$@" 2>&1 ) | { head -c 65536 >> "$LOG"; cat > /dev/null; }
fi
