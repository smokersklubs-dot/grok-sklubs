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
      python3 python3-pip python3-venv python3-websocket ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# The official command-line tools of Anthropic and OpenAI, so a bot can work on its owner's own
# subscription (Claude Pro/Max, ChatGPT Plus/Pro) once signed in on this computer.
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code @openai/codex && npm cache clean --force

# Agent Reach (MIT, https://github.com/Panniantong/Agent-Reach): read-only search and reading of the web and social
# sites, as a command-line tool printing JSON. Installed with uv from the pinned GitHub release asset of v1.6.1 — never
# from PyPI, where a different project uses the same name — into /opt (root-owned; the bot works as root on its own
# computer), with the system Python. Its default `setup` (non-interactive, JSON) then adds the default channels; its
# state lands in /root/.agent-reach, which seeds each new home volume. REACH_BROWSER_PORT moves Agent Reach's own
# browser off 9222, the debugging port of the desktop's Chromium (agent_reach/runtime/browser.py, configured_port()).
# Outbound services it uses: r.jina.ai (page reading) and Exa (web search), plus the sites themselves.
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /uvx /usr/local/bin/
ARG AGENT_REACH_URL=https://github.com/Panniantong/Agent-Reach/releases/download/v1.6.1/agent-reach.zip
ARG AGENT_REACH_SHA256=51443d733bcb26064262442083a8f8abf6ba5e3e7df54beebafe98c88be04a60
ENV REACH_BROWSER_PORT=9333
RUN curl -fsSL -o /tmp/agent-reach.zip "$AGENT_REACH_URL" \
    && echo "$AGENT_REACH_SHA256  /tmp/agent-reach.zip" | sha256sum -c - \
    && UV_TOOL_DIR=/opt/agent-reach/tools UV_TOOL_BIN_DIR=/usr/local/bin UV_PYTHON_PREFERENCE=only-system UV_NO_CACHE=1 \
       uv tool install "agent-reach @ file:///tmp/agent-reach.zip" \
    && rm -f /tmp/agent-reach.zip \
    && agent-reach setup > /opt/agent-reach/setup.json \
    && python3 -c "import json; d=json.load(open('/opt/agent-reach/setup.json')); assert d['ok'], d; print('agent-reach', d['result']['version'])"

COPY start-desktop.sh page-text.py open-browser.sh screen-relay.sh dress.py home-server.py tidy.sh /opt/sklubot/
# The credential relay's helper (spec 08 A1): programs call APIs with the user's keys without ever holding them.
COPY sklubot-api /usr/local/bin/sklubot-api
RUN chmod +x /opt/sklubot/*.sh /opt/sklubot/page-text.py /usr/local/bin/sklubot-api

WORKDIR /root
CMD ["/opt/sklubot/start-desktop.sh"]
