#!/bin/sh
# Opens an address in the bot's browser: a new tab if it is already running and answering, otherwise a
# fresh start. A browser that is running but no longer answers is restarted (logins are kept). Videos may start
# without a click (Chromium's --autoplay-policy switch, developer.chrome.com/blog/autoplay): their sound goes to the
# computer's virtual sound card (sound.sh), where only listen_screen hears it.
PROFILE=/root/.config/sklubot-browser
alive() { curl -fsS -m 1.5 http://127.0.0.1:9222/json/version >/dev/null 2>&1; }
if pgrep -f "user-data-dir=$PROFILE" >/dev/null 2>&1 && ! alive; then
  pkill -f "user-data-dir=$PROFILE"; sleep 1; pkill -9 -f "user-data-dir=$PROFILE" 2>/dev/null
  rm -f "$PROFILE"/Singleton* 2>/dev/null
fi
python3 /opt/sklubot/dress.py --profile >/dev/null 2>&1
exec chromium --no-sandbox --test-type --no-first-run --no-default-browser-check --disable-dev-shm-usage \
  --hide-crash-restore-bubble --password-store=basic --start-maximized --class=SklubotBrowser \
  --autoplay-policy=no-user-gesture-required \
  --remote-debugging-port=9222 --remote-allow-origins=http://127.0.0.1:9222 \
  --user-data-dir="$PROFILE" "${@:-http://127.0.0.1:7391/}" >/dev/null 2>&1
