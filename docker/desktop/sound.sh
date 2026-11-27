#!/bin/sh
# The computer's virtual sound card: PulseAudio with one null sink, "sklubot". What the browser (or any program) plays
# goes there; nobody hears it and nothing leaves the computer. Its monitor source, "sklubot.monitor", is what Sklubot's
# listen_screen records (ffmpeg -f pulse -i sklubot.monitor) to turn it into text. Clients find the server through
# PULSE_SERVER (set in the image). Safe to run again: it does nothing when the sound card is already there.
command -v pulseaudio >/dev/null 2>&1 || exit 0
pactl list short sinks 2>/dev/null | grep -q sklubot && exit 0
pulseaudio --kill >/dev/null 2>&1
# 711: the browser user (open-browser.sh, L48) reaches the socket inside, without listing the folder.
rm -rf /tmp/pulse; mkdir -p /tmp/pulse; chmod 711 /tmp/pulse
# Options of PulseAudio 16 (pulseaudio --help, pulse-cli-syntax): -n skips the default script, so only these two modules
# load; no realtime or high priority (the computer has no such privilege), never exits when idle.
pulseaudio --daemonize=yes --exit-idle-time=-1 --disallow-exit=yes --realtime=no --high-priority=no -n \
  --load="module-native-protocol-unix socket=/tmp/pulse/native auth-anonymous=1" \
  --load="module-null-sink sink_name=sklubot sink_properties=device.description=Sklubot" \
  --log-target=file:/tmp/pulse/log >/dev/null 2>&1
for _ in 1 2 3 4 5 6 7 8 9 10; do pactl list short sinks 2>/dev/null | grep -q sklubot && exit 0; sleep 0.2; done
exit 1
