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

# Office documents (server/src/office.ts: office_convert, office_recalculate, office_render): LibreOffice without its
# graphical front-ends (Debian's -nogui variants of Writer, Calc and Impress; about +480 MB on the image, measured on
# bookworm 7.4.7), and poppler-utils for pdftoppm / pdfinfo (one PDF page to PNG). In its own layer so the layer above
# stays cached when only this one changes.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui poppler-utils \
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

# Seeing, hearing and reading on the computer (server/src/media.ts, docs/ORDINATEUR.md), Debian bookworm packages, about
# +130 MB in all (installed sizes from packages.debian.org): Tesseract 5.3 OCR with the French and English data (~25 MB,
# Apache-2.0); PulseAudio 16.1, a virtual sound card the browser plays into so listen_screen can record it (~15 MB,
# LGPL-2.1+); xclip for the clipboard (~0.1 MB, GPL-2+); and the usual Python libraries for data work, Debian's own builds
# so the system python3 has them without pip — requests, Beautiful Soup, lxml, Pillow, openpyxl, python-docx, pandas with
# numpy (~80 MB). Recommends stay out (no ghostscript: it is AGPL).
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-fra tesseract-ocr-eng pulseaudio pulseaudio-utils xclip \
      python3-requests python3-bs4 python3-lxml python3-pil python3-openpyxl python3-docx python3-pandas \
    && rm -rf /var/lib/apt/lists/* \
    && tesseract --list-langs 2>&1 | grep -qx fra && pactl --version >/dev/null

# yt-dlp (Unlicense, https://github.com/yt-dlp/yt-dlp): the official zipimport release 2026.10.26 (3.1 MB; its bundled
# meriyah/astring are ISC/MIT; it needs Python 3.11+, bookworm has 3.11), checked against the release's SHA2-256SUMS.
# YouTube needs a JavaScript runtime: Node 22 of this image, enabled in the system configuration (--js-runtimes node,
# README "Configuration": /etc/yt-dlp.conf). Used by video_download and transcribe.
ARG YTDLP_URL=https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp
ARG YTDLP_SHA256=e51e69e89489f199530f13d32a4342da3ddb2cf34842f364603a066db05afbf3
RUN curl -fsSL -o /usr/local/bin/yt-dlp "$YTDLP_URL" \
    && echo "$YTDLP_SHA256  /usr/local/bin/yt-dlp" | sha256sum -c - \
    && chmod 755 /usr/local/bin/yt-dlp \
    && printf '%s\n' '--js-runtimes node' > /etc/yt-dlp.conf \
    && yt-dlp --version

# L164 — the app reader by accessibility (server/src/apptree.ts, agent/tools-apptree.ts): the bot reads the controls of the
# computer's apps (text editor, file manager, dialog boxes…) and acts on one by reference instead of at pixels. Debian
# bookworm packages, +4.7 MB in all (measured on this image): at-spi2-core (the accessibility bus launcher and registry,
# LGPL-2.1+), gir1.2-atspi-2.0 and python3-gi (libatspi for the system python3, LGPL-2.1+). start-desktop.sh starts the
# bus before any app; GTK apps join it by themselves, Qt 5 apps once QT_LINUX_ACCESSIBILITY_ALWAYS_ON is set
# (read by Qt 5's own bridge, qtbase src/platformsupport/linuxaccessibility/dbusconnection.cpp; not tried with a Qt app).
RUN apt-get update && apt-get install -y --no-install-recommends at-spi2-core gir1.2-atspi-2.0 python3-gi \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -c "import gi; gi.require_version('Atspi', '2.0'); from gi.repository import Atspi" \
    && test -x /usr/libexec/at-spi-bus-launcher
ENV QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1

# Clients of the sound card find it here (docker/desktop/sound.sh). What the bot installs in its home folder stays (the
# home is a volume): ~/.local/bin comes last on the PATH, so it never hides the computer's own programs.
ENV PULSE_SERVER=unix:/tmp/pulse/native PATH=$PATH:/root/.local/bin

COPY start-desktop.sh page-text.py open-browser.sh screen-relay.sh dress.py home-server.py tidy.sh sound.sh /opt/sklubot/
# The credential relay's helper (spec 08 A1): programs call APIs with the user's keys without ever holding them.
COPY sklubot-api /usr/local/bin/sklubot-api
# Installs Debian packages that come back after a rebuild (the list is kept in the home volume).
COPY sklubot-install /usr/local/bin/sklubot-install
RUN chmod +x /opt/sklubot/*.sh /opt/sklubot/page-text.py /usr/local/bin/sklubot-api /usr/local/bin/sklubot-install

COPY install-craft.sh /opt/sklubot/install-craft.sh
RUN sh /opt/sklubot/install-craft.sh

# L48 — Chromium with its own sandbox. The bot keeps its root shell; only the browser drops to the user "browser"
# (open-browser.sh, with setpriv), since Chromium's sandbox refuses to run as root. Debian's chromium has no setuid
# helper (and no-new-privileges would neutralise one), so the sandbox is the user-namespace one: Sklubot creates the
# computer with docker/desktop/seccomp-chromium.json (Docker's default profile plus user namespaces, see linux.ts). The
# browser's home is in the image (caches); its profile and downloads stay in the bot's home volume
# (/root/.config/sklubot-browser, /root/Downloads), given to the browser user before each start. The label tells
# Sklubot this image is ready for it: an older image keeps its root browser and the owner sees a notice.
RUN useradd --uid 1001 --user-group --create-home --shell /usr/sbin/nologin browser \
    && ln -s /root/Downloads /home/browser/Downloads \
    && command -v setpriv >/dev/null
LABEL sklubot.browser-sandbox="1"

WORKDIR /root
CMD ["/opt/sklubot/start-desktop.sh"]
