#!/bin/sh
# Opens an address in the bot's browser: a new tab if it is already running, otherwise a new window.
exec chromium --no-sandbox --no-first-run --no-default-browser-check --disable-dev-shm-usage \
  --password-store=basic --test-type --start-maximized --remote-debugging-port=9222 --remote-allow-origins=http://127.0.0.1:9222 \
  --user-data-dir=/root/.config/sklubot-browser "$@" >/dev/null 2>&1
