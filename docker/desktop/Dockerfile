# The Linux computer every Sklubot bot gets: a small graphical desktop with a browser, a terminal
# and the usual command-line tools. One container per bot.
# Node 22 is needed by Claude Code; the official image is plain Debian bookworm underneath.
ARG BASE_IMAGE=node:22-bookworm-slim
FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 DISPLAY=:1 HOME=/root \
    BROWSER=/opt/sklubot/open-browser.sh

RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb x11vnc socat openbox tint2 xdotool wmctrl imagemagick feh x11-xserver-utils dbus-x11 \
      chromium xterm xfonts-base pcmanfm mousepad \
      fonts-dejavu fonts-liberation fonts-noto-color-emoji \
      ca-certificates curl wget git jq unzip zip nano less procps sudo \
      python3 python3-pip python3-venv python3-websocket \
    && rm -rf /var/lib/apt/lists/*

# The official command-line tools of Anthropic and OpenAI, so a bot can work on its owner's own
# subscription (Claude Pro/Max, ChatGPT Plus/Pro) once signed in on this computer.
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code @openai/codex && npm cache clean --force

COPY start-desktop.sh page-text.py open-browser.sh screen-relay.sh dress.py home-server.py tidy.sh /opt/sklubot/
RUN chmod +x /opt/sklubot/*.sh /opt/sklubot/page-text.py

WORKDIR /root
CMD ["/opt/sklubot/start-desktop.sh"]
