#!/bin/sh
# Tidies the screen: politely closes every window except the desktop's own pieces, forces the stubborn
# ones after a short wait, then reopens the browser on the home page. Logins and files are kept.
export DISPLAY=:1
keep() { case "$1" in *tint2*|*Tint2*|*panel*|*desktop*) return 0;; esac; return 1; }
wmctrl -lx 2>/dev/null | while read -r id desk class rest; do keep "$class" || wmctrl -i -c "$id"; done
for i in 1 2 3 4 5; do
  left=$(wmctrl -lx 2>/dev/null | awk '{print $3}' | grep -vci 'tint2\|panel\|desktop')
  [ "$left" = "0" ] && break; sleep 0.5
done
wmctrl -lx 2>/dev/null | while read -r id desk class rest; do
  keep "$class" && continue
  pid=$(xdotool getwindowpid "$id" 2>/dev/null)
  if [ -n "$pid" ] && [ "$pid" -gt 1 ]; then kill "$pid" 2>/dev/null; else xdotool windowkill "$id" 2>/dev/null; fi
done
sleep 0.5
setsid /opt/sklubot/open-browser.sh >/dev/null 2>&1 &
echo "tidied"
