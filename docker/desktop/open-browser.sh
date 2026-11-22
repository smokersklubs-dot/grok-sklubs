#!/bin/sh
# Opens an address in the bot's browser: a new tab of the running browser if it answers (opened through its debugging
# port, PUT /json/new — https://chromedevtools.github.io/devtools-protocol/#endpoints), otherwise a fresh start. A
# browser that is running but no longer answers is stopped first, then restarted (logins are kept). Never a second
# Chromium on the same profile: its lock files are only removed once no browser uses it. Videos may start without a
# click (Chromium's --autoplay-policy switch, developer.chrome.com/blog/autoplay): their sound goes to the computer's
# virtual sound card (sound.sh), where only listen_screen hears it.
PROFILE=/root/.config/sklubot-browser
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
exec chromium --no-sandbox --test-type --no-first-run --no-default-browser-check --disable-dev-shm-usage \
  --hide-crash-restore-bubble --password-store=basic --start-maximized --class=SklubotBrowser \
  --autoplay-policy=no-user-gesture-required \
  --remote-debugging-port=9222 --remote-allow-origins=http://127.0.0.1:9222 \
  --user-data-dir="$PROFILE" "${@:-http://127.0.0.1:7391/}" >/dev/null 2>&1
