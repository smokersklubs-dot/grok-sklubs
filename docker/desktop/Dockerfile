# The Linux computer every Sklubot bot gets: a small graphical desktop with a browser, a terminal
# and the usual command-line tools. One container per bot.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 DISPLAY=:1 HOME=/root

RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb x11vnc socat openbox tint2 xdotool imagemagick x11-xserver-utils dbus-x11 \
      chromium xterm xfonts-base pcmanfm mousepad \
      fonts-dejavu fonts-liberation fonts-noto-color-emoji \
      ca-certificates curl wget git jq unzip zip nano less procps sudo \
      python3 python3-pip python3-venv python3-websocket nodejs npm \
    && rm -rf /var/lib/apt/lists/*

COPY start-desktop.sh page-text.py open-browser.sh screen-relay.sh /opt/sklubot/
RUN chmod +x /opt/sklubot/*.sh /opt/sklubot/page-text.py

WORKDIR /root
CMD ["/opt/sklubot/start-desktop.sh"]
