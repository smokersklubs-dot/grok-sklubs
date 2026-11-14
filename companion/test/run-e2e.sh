#!/usr/bin/env bash
# Runs the end-to-end tests under a virtual X server (Xvfb, 1280x800).
# Usage: bash test/run-e2e.sh            # dev mode (electron .)
#        bash test/run-e2e.sh packaged   # dist/linux-unpacked (run `npm run dist:linux:dir` first)
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-dev}"
command -v Xvfb >/dev/null || { echo "Xvfb is required (apt-get install xvfb)"; exit 1; }
command -v import >/dev/null || { echo "ImageMagick is required for screenshots (apt-get install imagemagick)"; exit 1; }
DISPLAY_NUM="${RELAIS_DISPLAY:-:99}"
Xvfb "$DISPLAY_NUM" -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 &
XVFB_PID=$!
trap 'kill $XVFB_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do [ -e "/tmp/.X11-unix/X${DISPLAY_NUM#:}" ] && break; sleep 0.1; done
export DISPLAY="$DISPLAY_NUM"
# A window manager makes window.list/window.focus testable (desktopCapturer and wmctrl rely on it).
if command -v openbox >/dev/null; then openbox >/dev/null 2>&1 & WM_PID=$!; trap 'kill $XVFB_PID ${WM_PID:-} 2>/dev/null || true' EXIT; sleep 0.5; fi
export RELAIS_MODE="$MODE"
# RELAIS_E2E_FILES picks some files only (e.g. test/e2e/sklubot-server.e2e.test.js); default: all of them.
RUN=(node --test --test-concurrency=1 "${RELAIS_E2E_FILES:-test/e2e/*.test.js}")
if command -v dbus-run-session >/dev/null; then RUN=(dbus-run-session -- "${RUN[@]}"); fi
"${RUN[@]}"
