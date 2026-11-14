# Functional Specification 05 — Successor Deltas ("HQ" generation)

This document describes what is NEW or DIFFERENT in the successor of the product specified in `01-core-product.md` (the "earlier spec"). Anything not mentioned here is unchanged and still follows the earlier spec. Requirement numbers in the earlier spec are cited as REQ-xxx; new requirements are HQ-xxx.

Conventions

- Behavioural specification only. Internal names (settings, paths, files, process names, tool names) are suggestions marked "(suggested)" unless dictated by an external provider or a public protocol.
- All user-facing and model-facing wording must be written fresh; this document says what the wording must convey.
- "Agent engine" = an external, separately installed agent runtime that owns an agent loop and exposes an OpenAI-Responses-compatible HTTP endpoint with streaming, a health endpoint, a model-options endpoint and an MCP client (the reference used the open-source Hermes Agent gateway; its public HTTP surface is: `GET /health`, `GET /v1/models`, `POST /v1/responses`, `GET /api/model/options`). "Computer provider" = whatever supplies Linux X displays (the reference used a paid cloud VM with up to 4 screens; the target implementation uses one local Linux container per bot).
- Numbers are normative unless marked "tunable".

---

## 1. Architectural overview — what changed

- HQ-001 **Who owns the agent loop.** The app no longer runs its own model loop (earlier spec §5, §7.1–7.2, the compaction/consolidation machinery, the per-turn tool loop and paused-turn state REQ-102/511/513). Each bot is backed by one agent-engine instance that owns the loop, the model history, the model/provider choice, the bot's long-term memory and its own built-in tools (shell, files, browser driving, desktop control, web search, planning, delegation, skills). The app keeps: the chat UI and transcript rows, the screens, connected apps with approvals, routines/check-ins, tasks, library, rooms, voice, and an MCP server that offers the app's own tools to the engine.
- HQ-002 **Per-turn flow.** A turn = the app posts one input (the trigger text) to the bot's engine, streaming, and converts the engine's event stream into transcript rows and live state (§3.3). The engine calls back into the app's MCP endpoint for app tools; approvals happen inside those MCP calls (§3.7).
- HQ-003 **Two engine kinds.**
  - *Primary*: an engine instance that already runs on the computer before the app is installed (a personal agent that may also serve other channels such as messaging apps and its own schedules). The first bot ever created is bound to it. The app MUST NOT start, stop, restart, or rewrite the configuration of this engine; it only calls its HTTP API. Its other sessions (outside the app) may also call the app's tools; approval cards for those calls still appear in the app.
  - *Managed*: one engine instance per additional bot, created, configured, started, restarted and deleted by the app (§3.2).
- HQ-004 **Where the app runs.** The app is designed to be installed on the same Linux machine as the screens and the primary engine ("local mode"): shell commands and file operations on the computer run directly. A remote mode (commands and files tunnelled through the computer provider's API) remains for development; some features are local-only (subscription sign-in HQ-188, direct library downloads HQ-262, browser-liveness check HQ-073).
- HQ-005 **One shared computer for the whole installation, never created or suspended by the app.** Earlier spec REQ-800–805 (lazy VM creation per user) and REQ-830–833 (idle sleep) are replaced: the computer is configured by id, is assumed to be someone's working machine, and is never created, suspended or deleted by the app. "Ensure running" only checks status (cached for 30 s), and resumes/starts it if the provider reports it asleep/stopped, with the same polling as REQ-802. The idle watcher is disabled (viewer counts are still tracked for display). The manual "sleep" action becomes a no-op.
- HQ-006 **Team size is bounded by screens.** At most N bots (setting, default 4, and never more than the provider's screen limit of 4) may exist; creating one more fails with a user-visible "team is full, remove a bot first" error (HTTP 409). In the reference the count is taken across the whole installation (all users), because all bots share one computer. Rooms and hidden bots do not count.
- HQ-007 **Removed from the app (now the engine's job):** built-in computer-use tools (REQ-600–607), remember/recall tools (REQ-620–621), subagent tools (REQ-651–654; the engine's own delegation is used), compaction and consolidation (REQ-700–7xx), effort-dependent model selection (REQ-55x) beyond passing the effort through, web/X search as provider-hosted tools (X search becomes an app tool, HQ-205).
- HQ-008 Health check reports OK plus the engine family name instead of the configured model name.

---

## 2. The computer and its screens

This is the provider-independent behaviour of the "screens layer". An implementation with one local container per bot maps "screen" to "that bot's container display"; notes marked **[Container mapping]** say what becomes simpler.

### 2.1 Screens, leases and limits

- HQ-010 Each bot works on exactly one X display ("screen"). The primary-engine bot always gets the computer's default screen (X display :99). Every other bot leases an additional provider screen; the X display number of an additional screen equals the numeric part of the provider's screen id (the first additional screen in the reference was display :100).
- HQ-011 Limits: maximum 4 screens including the default one (provider limit); the user-facing maximum is min(configured max bots, 4).
- HQ-012 Lease resolution (single-flight per bot: concurrent callers share one attempt):
  1. Ensure the computer is running (HQ-005).
  2. If the bot already has a lease: for the default screen, or if the lease was verified with the provider in the last 120 s, refresh its last-used time and return it. Otherwise ask the provider whether the screen still exists; if yes, store its current pixel size, refresh last-used, return it; if not (e.g. the computer rebooted), drop the lease and forget its dressing state, then continue.
  3. Primary-engine bot: take the default screen.
  4. Other bots: take any existing non-default screen not leased by anyone; else create a new screen if fewer than 4 exist; else fail with a user-visible error saying every screen is in use and a bot must be removed. **There is no eviction** (earlier spec REQ-821 step 4 is removed).
  5. Store the lease (bot, user, screen id, last-used time, width, height when known) and broadcast a computer event.
- HQ-013 Computer state sent to clients adds: the list of leases with optional pixel width/height per screen, and the maximum number of screens.
- HQ-014 Release (bot deleted): delete the lease, forget the dressing state, and — unless it is the default screen — undress the screen (HQ-060). The provider screen itself is NOT deleted; it becomes free for the next bot. Broadcast a computer event.
- HQ-015 Bot deletion additionally removes, on the computer, that bot's browser profile folder and its library folder (only when the bot id has the expected safe format), and removes its managed engine home (HQ-150).
- **[Container mapping]** HQ-016 With one container per bot, a lease is "the bot's container exists and its display answers"; the 4-screen limit and the default-screen rule disappear (the limit becomes a host resource setting). Keep the ideas: lease verification with a short cache, a clear "full" error instead of silent eviction, and freeing everything on delete except data the user wants kept.

### 2.2 The "desk" toolkit installed on the computer

- HQ-020 The app ships a small set of helper programs and assets (the "desk bundle": a screen-dressing command, a dock/wallpaper program, a home-page server, a home-page template, and a browser extension source) that are installed on the computer under a fixed root directory (suggested `/opt/<app>`), with logs in a log directory (suggested `/var/log/<app>`).
- HQ-021 Bundle identity: a content hash (first 20 hex chars of SHA-256 over every file's destination path and content hash). Installation is idempotent:
  1. Ask the computer "is the base setup current for hash H?" (also requires the home server to be alive).
  2. If not: send all bundle files in one gzip-compressed JSON document, unpack atomically (write `.new`, rename; executables mode 755, others 644; delete extension source files no longer in the bundle), then run the one-time base setup as a background job and follow it to completion (overall limit 900 s, because package installation on a fresh machine is slow).
  3. Memoised per server process; reset when any call reports the base as missing, so the next call reinstalls.
- HQ-022 Large file transfer through a remote command channel: base64 in chunks of 60,000 characters appended to a temp file, then decoded and moved into place with the requested mode (the provider drops very long commands). Reading a file back uses base64 of the whole file (intended for files under about 4 MB). Commands receive only a minimal environment (PATH, HOME, USER, LANG, DISPLAY) — never the server's secrets.
- HQ-023 Command protocol with the dressing helper: each action is one short command whose last recognised output line is one of: OK (nothing to do), DONE + JSON result, RUNNING + job id, NOBASE (helper missing or out of date), BASE_OK + JSON. Slow work runs as a detached job; the caller polls with "wait job, up to 25 s" until DONE. Job results contain ok, warnings (logged by the server), error, and elapsed seconds. Jobs with the same name run one at a time (file lock); finished job result files older than 1 hour are deleted.
- HQ-024 All desk calls for one screen are serialised in a per-screen queue so a rename, a reset and an undress can never interleave.
- HQ-025 Time limits: one dressing (including follow-up waits) 240 s; opening a terminal 30 s; undress command 90 s; base setup 900 s; a single helper invocation 60 s.

### 2.3 One-time base setup (per computer)

- HQ-030 Create the root, per-screen state, log, and browser-profile root directories.
- HQ-031 Install missing system packages non-interactively (no recommended extras, package-lock wait 60 s, 300 s per attempt; on failure refresh package lists and retry; if still failing install packages one by one with 180 s each so one bad package does not block the rest). The checked set: Python GTK 3 bindings with cairo, the SVG image loader for GTK's pixbuf, a window-control CLI (wmctrl), an X automation CLI (xdotool), X info utilities (xprop, xdpyinfo), X server utilities (xsetroot), D-Bus daemon, OpenSSL, and the Inter font (then rebuild the font cache). Anything still missing becomes a warning, not a failure.
- HQ-032 If the GTK bindings are unavailable, screens still work but get a plain colour and no dock (warning).
- HQ-033 Build the new-tab browser extension (HQ-090) as a signed CRX3 package using an RSA-2048 key generated on, and never leaving, the computer (mode 600). The extension id is derived from the public key (first 16 bytes of SHA-256 of the DER public key, each nibble mapped to the letters a–p). Rebuild only when the source hash or id changed; each rebuild bumps the version to 1.0.<build>. Archive entries use a fixed timestamp so builds are reproducible. Also write an update-manifest XML pointing at the CRX served by the local home server.
- HQ-034 Write a machine-wide managed browser policy (for both Google Chrome and Chromium policy folders, the latter only if its parent exists) that: force-installs the home extension from the local update URL; hides the new-tab footer's extension attribution and the "managed by your organisation" footer notice; disables the warning banner about unusual command-line flags; and allows developer tools / remote debugging on every page. The last item is required: without it the browser refuses to let a debugging client drive a tab that shows a policy-installed extension page — which the home page is — and the bot's browser automation would hang on it.
- HQ-035 Make GTK apps light for the computer's user: set theme to the first installed of a preferred list of light themes (Arc-Lighter, Arc, Adwaita), icon theme to the first installed of (Papirus, Papirus-Light, elementary-xfce, Adwaita; fallback hicolor), and "prefer dark" off, in the user's GTK 3 settings file; keep a one-time backup of the original file.
- HQ-036 (Re)start the home server and wait up to 8 s for its health endpoint. Restart any running dock/wallpaper programs so they run the new code (only for screens that are still dressed).
- HQ-037 Record base state: bundle hash, whether the dock is possible, extension id, policy files written, packages installed, time.

### 2.4 Per-screen process model

- HQ-040 Everything the app starts for screen N carries a marker in its environment (screen number) so it can be found and stopped later regardless of process names. Long-lived programs are spawned fully detached (own session, stdin closed), each with its own log file in the log directory, rotated to `.1` when over 4 MB.
- HQ-041 Base environment for screen N: PATH/HOME/USER/LANG, DISPLAY=:N, the screen marker, GTK theme = the light theme (HQ-035), desktop identifier XFCE, accessibility bridge disabled, the user's runtime dir if it exists.
- HQ-042 Session bus per screen: if a desktop session (panel/settings daemon/desktop manager) runs on that display, reuse its D-Bus session bus; otherwise start a small private D-Bus session bus for that screen alone (state remembered per screen; recreated if dead or made by an older version). The private bus uses a per-screen config home, so settings written through it never change the main desktop. Reason: single-instance apps (file manager, terminal) otherwise open on whichever display first started them.
- HQ-043 Terminals always use the private bus, and on bus creation the terminal app's settings for that screen are made light and plain: solid background #FBFBFD, foreground and cursor #2A2E37, a 16-colour light palette (#2e3440 #c7243a #2f8f46 #a66f00 #2a6fdb #8a4fd3 #16857a #8b93a1 / #5b6372 #e0364d #3aa657 #c98a00 #3d86f5 #a36bf0 #1fa293 #c5cad3), no theme colours, font DejaVu Sans Mono 11, no menu bar, no scrollbar, no "unsafe paste" confirmation.
- HQ-044 Window inspection: list top-level windows (id, pid, geometry, class, title) through the window-control CLI, falling back to X properties. "Desktop pieces" are windows of the desktop panel, the desktop manager, or the app's own dock/wallpaper; they are never closed by resets. A window is a "browser window" if its class contains "chrom" or the app's browser window class, or its process binary is Chrome/Chromium. Window geometry of display N comes from the X automation CLI, falling back to display info; a display that answers neither is "not running".
- **[Container mapping]** HQ-045 One container = one display, so markers, private buses and display-matching collapse to "everything in this container". Keep: light theming, terminal look, detached logged spawns, desktop-piece vs app-window distinction.

### 2.5 The look of a screen ("dressing")

- HQ-050 A *look* is computed by the server for (bot, manage-browser flag) and contains: the manage-browser flag; bot id, name, label, avatar shape and colour; a palette (accent, ink, wash, deep wash); the avatar as an SVG; the wallpaper as an SVG with width/height placeholders. A *stamp* = first 20 hex of SHA-256(bundle hash + serialised look). The look travels gzip+base64 encoded. Bot ids must be safe folder names (letters, digits, `_`, `.`, `-`) or dressing is refused.
- HQ-051 Colour of a bot: the 11 avatar colours map to accent hexes black #000000, brown #A06B39, red #FB2B3E, orange #FD690F, yellow #F59312, green #14C16F, cyan #13B7A2, blue #1E86FC, violet #8F59F9, magenta #F93498, gray #959595 (also accepts #RGB/#RRGGBB; unknown → gray).
- HQ-052 Palette (HSL arithmetic on the accent): if saturation < 0.15 (black, gray) use a calm blue-gray base #7A869A with hue 218 and saturation 0.30; otherwise use the accent's hue and its saturation clamped to 0.55–0.90. Then: accent = base; ink = base mixed 80% toward #14171F; wash = (hue, sat, L 0.925); light wash = (hue−12, sat×0.9, L 0.965); deep wash = (hue+10, sat, L 0.865); glow A = (hue+28, min(1, sat+0.1), L 0.84); glow B = (hue−30, sat, L 0.84); doodle line = (hue, sat×0.85, L 0.68).
- HQ-053 Wallpaper (original art; draw your own):
  - Diagonal linear gradient light wash → wash (50%) → deep wash.
  - Four soft radial blobs (centre x/y, radii as % of screen): white at 85% opacity at (12%, 6%), 46%×52%; glow A at 60% at (90%, 98%), 50%×58%; glow B at 65% at (82%, 12%), 30%×36%; glow B at 65% at (6%, 96%), 30%×34%.
  - 14 small single-stroke line doodles (picked from a set of 16 simple pictograms: check, spark, leaf, paper plane, chat bubble, star, squiggle, moon, cloud, bolt, pencil, heart, plus, ring, music note, list — all drawn on a 24×24 grid by the implementer) placed only along the edges so the centre and the dock area stay clear. Slot top-left corners in % (x, y): (3.5,7) (10,27) (3,47) (9.5,67) (4,86) (91,6) (85,25) (92,45) (86,65) (91.5,85) (20,4.5) (74,5.5) (21,88) (73,89).
  - A seeded random generator (seed = bot id) shuffles the doodle order and gives each: size 38–64 px, rotation ±25°, position jitter ±1.2 percentage points, stroke opacity 0.34–0.60; stroke width 1.5, round caps/joins, colour = doodle line. Same bot → same arrangement forever.
- HQ-054 Avatar SVG: the bot's shape drawn as a white outline shape under the colour-filled shape (even-odd fill); legacy shape names map onto the drawn set; any problem → a white-ringed circle in the colour. Shape geometry is validated to contain only path-safe characters before embedding.
- HQ-055 Neutral look (for a browser on a screen that is not dressed): accent #6b7280, ink #1f2430, wash #f1f2f4, a gray circle avatar, and a soft gray diagonal gradient wallpaper (#f6f7f8 → #e6e8ec).

### 2.6 Dressing a screen — the algorithm

- HQ-056 Options: *manage browser* (default on) — start and own this bot's browser on the screen; off means the screen already has someone else's browser (the primary agent's own Chrome, configured by a setting) that the app must NEVER start, stop or restart, while still applying wallpaper, dock, hidden panel and light theme. *Restart browser* (only with manage) — restart so it picks up a new look. *Reset* — close all app windows first (HQ-061).
- HQ-057 Fast path: if neither restart nor reset is requested and the screen is "OK for stamp S", answer OK immediately (a repeat dress costs one remote command; the desk test requires < 3 s). "OK" means: the applied-stamp record and the current look both equal S; if a dock was applied, the dock process is alive with stamp S; the home server is alive; and, with manage on, this bot's browser is running on this display.
- HQ-058 Full dress (as a background job, timings recorded per phase):
  1. The display must answer (else fatal: "screen does not answer").
  2. If the previous look on this screen managed a browser for a *different* bot, stop that bot's browser.
  3. Remove the applied-stamp record; write the new look.
  4. Paint the X root window a solid wash colour (default #eef0f3).
  5. Hide desktop panels (if a desktop panel runs on this display): remember each panel's auto-hide setting once, set every panel to "always hide", wait up to 4 s for them to leave the visible area (poll 0.3 s), unmap any panel window that ignored the setting, and unmap the thin (≤ 4 px) reveal strips auto-hidden panels leave at the edge. Panels are hidden, never killed. Warn if one could not be hidden.
  6. Light session: if a settings daemon runs on this display, switch its GTK theme and icon theme to the light ones, remembering previous values once.
  7. Ensure the dock/wallpaper program (HQ-070) runs for this screen (exactly one; extras stopped) and wait up to 12 s until it reports the new stamp.
  8. Ensure the home server runs.
  9. Reset (if requested): see HQ-061.
  10. With manage on: start/ensure the bot's browser (HQ-080) — restart only if requested and not resetting. A browser failure is fatal for the dress.
  11. Write the applied-stamp record (stamp, whether the dock applied, time). Return timings, screen size and whether a browser was started.
- HQ-059 Server-side triggers for dressing: the first time per server process a bot's screen is needed ("ready screen"); again (forced) when the bot's name, label, avatar shape or colour changes and it has a lease; and as repair (HQ-073). A failed dress is logged and forgotten so the next request retries. If the helper answers NOBASE, the server reinstalls the base (HQ-021) and retries once.

### 2.7 Reset and undress

- HQ-060 **Undress** (bot deleted, or a test returning a screen to normal): stop the browser of the bot in the current look if that look managed it; for a bot id passed explicitly that differs from the look's bot (or when the look did not manage the browser), stop only a browser the app itself started (identified by its screen marker flag) for that bot. Delete the look, applied-stamp and dock-state records (the dock program and the home server notice and let go). Restore the desktop manager's previous wallpaper settings, restore panel auto-hide values and restart the panel, restore the previous GTK theme, stop the dock program, stop every process carrying this screen's marker (grace 3 s), forget the private bus, paint the root #eceef1, delete rendered wallpaper images. A missing helper on the computer means nothing of the app runs there: treat as success.
- HQ-061 **Reset** ("clean screen", logins kept): runs a full dress with the reset flag: with manage on, stop the bot's browser; politely close every window that is not a desktop piece (and, when manage is off, not a browser — someone else's browser is never touched); wait up to 2.5 s; then terminate processes owning windows that did not close (only if they run on this display and are not the helper itself, its parent or init; grace 1.5 s), otherwise kill the window via X. Warn with the count of windows that would not close. Then (manage on) start the browser again on the home page. The browser profile (logins, cookies) is preserved.
- HQ-062 The user can reset from the live view pill (HQ-123), from App Settings → Computer (two-step confirm; disabled while the computer is not running), or via API; afterwards a computer event is broadcast.

### 2.8 Dock and wallpaper program (one per screen)

- HQ-070 Behaviour:
  - Reads the current look for its screen; exits by itself when the look disappears (checked every 1.2 s); re-applies when the look file changes or the screen size/monitor layout changes; rebuilds the dock when compositing turns on/off; every 15 s re-hides panel reveal strips.
  - Wallpaper: renders the look's SVG at the exact screen size (placeholders replaced); if SVG rendering is unavailable, paints a two-tone diagonal gradient wash → deep wash. If a desktop manager owns the root window on this display, saves the rendering as a PNG in the screen's state folder (old ones deleted), remembers the desktop manager's previous image settings once, and points every monitor/workspace backdrop at the PNG with "stretched" style. Otherwise shows its own undecorated, unfocusable, sticky, desktop-type window covering the screen, lowered below everything.
  - Writes a dock-state record: pid, stamp, width, height, wallpaper mode (desktop manager vs own window), composited flag.
- HQ-071 Dock: exactly three launchers — Browser, Terminal, Files — with icons looked up in the light icon theme, then the default theme, from lists of common icon names; a missing icon is drawn as a rounded square in ink at 35% opacity.
  - Geometry: icon 44 px; slot 58 px; inner padding 9 px; pill = 2×9 + 58×3 = 192 px wide, 2×9 + 58 − 6 = 70 px tall; 18 px transparent margin around the pill for the shadow; pill bottom sits 8 px above the screen edge; horizontally centred.
  - Window type "dock", kept *below* normal windows (a maximised window simply covers it), sticky, unfocusable, not in task lists. Uses a transparent visual when a compositor is present; otherwise paints the wallpaper slice behind itself so it looks transparent. Only the pill area receives pointer input; clicks on the shadow margin pass through.
  - Drawing: an 8-step soft shadow in ink (each step 1.6% opacity, 4 px lower); frosted white body at 58% opacity; top highlight gradient white 38% → 0 at 55% height; 1 px white 90% inner border; corner radius 20. Hovered slot: rounded 14 px white highlight at 78% (50% while pressed); the pressed icon shifts down 1 px.
  - A launch happens on left-button press and release on the same slot, in the background (never blocking drawing). Actions: Browser → HQ-084; Terminal → HQ-100 without command; Files → file manager at the library root (else home).
- HQ-072 The overall desktop impression: no taskbar, a soft wallpaper in the bot's colour with edge doodles, the small frosted dock at the bottom, light GTK apps, and (managed) a maximised light browser on the bot's home page.

### 2.9 Health checks and repair before work

- HQ-073 Before every turn ("screen for work"): lease and dress the bot's screen and wait for it. If the bot's browser is not managed by the app (primary agent with its own browser), dressing proceeds in the background and the turn does not wait. In local mode, then probe the browser's debugging endpoint (`/json/version`, 1.5 s timeout); if it does not answer, force a re-dress (which restarts the browser). Rationale: an agent that finds no browser starts a stray one of its own on the wrong screen.
- HQ-074 Repair is implicit: every dress call re-checks HQ-057 and redoes whatever is missing (dead dock, dead home server, dead browser, changed look).

### 2.10 The bot's browser

- HQ-080 One browser profile per bot in a persistent folder (suggested `<data root>/profiles/<bot id>`), surviving resets, restarts and screen changes; deleted with the bot.
- HQ-081 Binary choice: the real browser executable (not wrapper scripts that may pin another profile or debugging port), preferring Google Chrome, then Chromium.
- HQ-082 Start/ensure on screen N:
  1. If this bot's browser runs (matched by its profile folder) on another display, or a restart is requested: stop it (grace 6 s; then any leftover processes using that profile, grace 1 s).
  2. Stop any app-started browser on display N whose profile belongs to a different bot (it would occupy the debugging port).
  3. If not running: prepare the profile (HQ-083) and start it with: no sandbox, no first-run screens, no default-browser check, crash-restore bubble hidden, basic password store, no shared-memory use, remote debugging port = 9200 + N (default screen → 9299), the bot's profile folder, a dedicated window class (suggested "HQBrowser"), start maximised, and an app-specific flag recording N (so the app can later tell which screen a browser is on even though the browser wipes its environment).
  4. Wait until the debugging endpoint answers: up to 40 s after a fresh start (giving up early if the process disappeared for more than 6 s), 6 s otherwise. No process at all → error naming the log file. Process up but endpoint silent → warning.
  5. Fresh start: wait up to 30 s for the home extension to appear in the profile; then, for up to 5 s, find tabs still showing the browser's own new-tab page or a blank page (title not the home title) and replace them through the debugging API (open a new tab, close the plain ones).
  6. Maximise its windows (waiting up to 10 s after a fresh start, 1 s otherwise).
- HQ-083 Profile preparation: delete stale singleton lock files; in the profile preferences mark the last exit as clean (no "restore pages?" prompt), set start-up to "open the new-tab page", mark the welcome page seen, force the light colour scheme regardless of the system, set the browser's theme colour to the bot's accent (as a signed 32-bit ARGB value with full alpha, "tonal" variant, user-colour theme), hide the bookmarks bar, and suppress the toolbar's "sign in to the browser" nudge (shown-count ≥ 100, last-shown = now). If the preferences file cannot be parsed, only fix the two crash flags textually and leave the rest.
- HQ-084 Dock/home "Browser" action: if the app manages this screen's browser: raise its newest window on this display; if it runs without a window, ask it for a new window; if it is not running, start it (HQ-082). If the browser belongs to someone else: only raise an existing browser window; never start or stop one.
- HQ-085 The engine's browser tools are pointed at the bot's debugging endpoint (`http://127.0.0.1:<9200+N>`, or the primary agent's own browser URL when configured), so everything the agent browses is visible in the live viewer.
- **[Container mapping]** HQ-086 One container per bot: a fixed debugging port per container (published only to the host loopback), profile in a volume, no cross-bot stopping logic. Keep: profile hygiene (HQ-083), light/accent theming, DevTools liveness probe, plain-tab replacement, maximise.

### 2.11 Home page (the browser's new-tab page)

- HQ-090 Delivery: a tiny Manifest V3 extension named "Home" overrides the new-tab page with a page that frames, full-bleed and borderless, the home page served by a local home server (loopback, port 7391). The wrapper page accepts messages only from that origin: a title (used as the tab title, max 80 chars), a background colour (used if a valid #RRGGBB, so the tab strip matches), and an "open a new tab" request (from the Browser tile). The extension is force-installed by policy (HQ-034) into every browser on the computer, including browsers the app does not own.
- HQ-091 The home server decides which screen's page to serve per request: from the TCP client port it finds the socket in the kernel's socket table, finds the process holding it (browser processes searched first), walks up to 6 parent processes to find the profile folder and the app's screen flag (or DISPLAY); if the profile is one of the app's bot profiles it serves the screen whose look names that bot, else the screen of that display, else (browser wiped its environment) the display on which that browser has a window among dressed screens. Results cached per process for 5 s (entries older than 60 s purged). A `screen=N` query parameter overrides detection for GET requests. Unknown → neutral look (HQ-055).
- HQ-092 Home server endpoints (behaviour): the home page; the current stamp + screen number (JSON); the app list (id, name, kind) (HQ-095); an app icon by app id (theme icon file, cached 300 s; else a generated letter tile: rounded square in the screen's accent with the app name's first letter in white, cached 60 s); a favicon = the bot's avatar SVG; the extension update manifest and package; health (ok + pid). Responses carry no-store caching by default and no-sniff. Errors never crash the server.
- HQ-093 Launching from the page: POST with the app id; accepted only if a custom request header is present, the fetch-metadata site is same-origin (if sent) and the origin is the home server's own (if sent) — otherwise 403. Body capped at 4 KB. Unknown app or undetectable screen → 404; launch failure → 500. On success the app starts on the requesting screen (HQ-096).
- HQ-094 Page content and styling (all text paraphrased by the implementer):
  - Light colour scheme; font stack Inter → Noto Sans → Ubuntu → Liberation Sans → DejaVu Sans → system sans; text unselectable; the wallpaper SVG stretched behind everything (non-interactive); page title "Home".
  - Centred column (padding ≈28/24/40 px): the bot avatar (104 px; 76 px when the window is ≤ 640 px tall) with a soft accent-tinted drop shadow; a large clock (font size clamp(64 px, 11 vh, 104 px), weight 300, tight tracking, tabular figures) showing local time in the browser's locale with any AM/PM marker as a small (0.26 em) muted suffix; below it the long date (weekday, month, day) in muted 15 px text; a greeting heading "welcome back, <bot name>" (or without name) at 26 px semibold; the bot's label (role) in muted 15 px; the app grid; a hint line (13 px muted).
  - Clock and date update every 1 s.
  - App grid: one button per app: a 64 px frosted pad (white 62% with a white 90% 1 px border, radius 18 px, soft ink shadow, background blur) holding a 42 px icon, and the app name below (12.5 px, single line, ellipsis, max 88 px), button 92 px wide; gaps 14 px vertical / 10 px horizontal. Column count: all in one row when ≤ 6 apps, otherwise min(6, ceil(n/2)) so rows are even; 4 columns when the window is ≤ 680 px wide. Hover lifts the pad 2 px and brightens it; press scales to 95%; focus ring in accent; on click a 700 ms "pop" animation.
  - Clicking the browser app asks the wrapper for a fresh tab (or, unframed, opens the home page in a new window). Any other app POSTs a launch; the hint line says "opening <app>" or "couldn't open <app>" and clears after 2.6 s.
  - The page tells the wrapper its title and wash colour on load.
  - Dynamic: clock/date, the app list (fetched once on load), and the look: every 4 s the page fetches the current stamp and reloads itself if it changed — a rename or recolour shows up on an open tab without user action.
- HQ-095 App list: built from desktop-entry files in the standard system, local, user, snap and flatpak application folders. Keep entries of type Application that are not hidden/no-display, not terminal-only, not settings/screensaver categories, and not on a deny-list of system plumbing (desktop-environment internals, input methods, key/session managers, network/bluetooth/audio applets, VNC tools, compositors, launchers, text-mode tools, update/software managers…), except an allow-list (terminal, screenshot tool, task manager, file manager). Parse the launch command (drop field codes). De-duplicate by resolved executable and by display name. Browsers are named "Chrome" (or "Browser" for others) with rank 0; file managers "Files" rank 1; terminals "Terminal" rank 2; everything else rank 5; sort by rank then name; at most 12; cached 20 s.
- HQ-096 App launch on screen N: browser → HQ-084; files → file manager at the library root if it exists, else home (first available of several common file managers, else the desktop's open command); terminal → HQ-100; other apps → spawned detached with the screen environment and the entry's working directory.
- **[Container mapping]** HQ-097 With one display per container the caller-identification machinery is unnecessary: serve one page per container. An extension is still the most reliable way to own the new-tab page in Chromium; a simpler alternative is the browser policies for the new-tab URL and homepage pointing at the local page (Chromium honours them), plus the developer-tools policy.

### 2.12 Terminal helper

- HQ-100 Open a terminal window on screen N, optionally running a command, with a title (newlines removed, max 120 chars; default "Terminal").
  - With a command: write it into a fresh script (mode 700, starts in the home folder) in the screen's terminal folder (scripts older than 24 h are cleaned up), run it in a login shell, then print one dim line saying it finished or stopped with its exit code and that the window can be closed, and keep the window open indefinitely.
  - Terminal choice: the desktop's terminal (single-instance server mode disabled, fixed title, dynamic title off), else xterm (Monospace 11), else the system's default terminal; none → error.
  - Size 104×28 characters; after it appears (wait up to 4 s) the window is centred: width ≤ screen width − 120, height ≤ screen height − 170, x centred, y = max(24, centred − 30).
  - Uses the screen's private bus and light terminal look (HQ-043).
- HQ-101 Server use: subscription/model sign-in flows (HQ-188), and any flow that needs the user to finish something on the bot's screen. Fails with a clear message if the display does not answer.

### 2.13 Live viewer and take-control (changes to REQ-840–845, REQ-1290–1292)

- HQ-110 Relay behaviour is unchanged (server-side VNC auth, watch mode drops input/clipboard, fail closed). New: a viewer connecting to a bot without a lease leases a screen and starts dressing it in the background while the viewer is already watching.
- HQ-111 **Hand-back.** When the user stops driving (presses "hand back", closes the large view while driving, or leaves full screen in the panel view) the client tells the server; the server records the time on the bot. On that bot's next turn, the input is prefixed with a note that the user had control of the screen and handed it back, so the agent should look at the screen before relying on earlier state; the mark is then cleared.
- HQ-112 Screen size for the viewer frame: the lease's reported pixel size; before it is known assume 1280×960 for extra screens and 1920×1080 for the primary/default screen, so the frame does not change shape when the size arrives.
- HQ-113 Screen naming in settings: default screen = "main screen"; an extra screen = "screen (display − 98)" (display :100 → screen 2).
- **[Container mapping]** HQ-114 Run a VNC server inside each container on loopback-published ports; the relay authenticates upstream exactly as before.

### 2.14 Screenshots

- HQ-120 A per-bot screenshot endpoint returns the bot's current screen as JPEG (quality 75) from the provider, or 204 when there is no lease, the computer is not running, or capture fails. The details panel no longer polls thumbnails (it shows a live stream, HQ-122); screenshots remain for the desk test and API clients. The agent takes its own screenshots through the engine's desktop tool.

### 2.15 Desk test (what must be verified on a test computer)

- HQ-125 An operator test script dresses screens of a dedicated test computer for made-up bots and saves screenshots (output folder and number of extra screens 1–3 configurable; creates screens only if fewer than 2 exist; never deletes screens or the computer). It verifies, printing ok/FAIL per check and phase timings:
  1. Base setup is idempotent (second call cheap).
  2. Each extra screen, dressed for its own bot from a clean (undressed) start: the bot's browser runs with that bot's profile on port 9200 + display; the home page in that browser greets that bot by name (checked by evaluating in the page through the debugging protocol, retrying up to 12 s); the recorded look names the bot.
  3. Dressing again with nothing changed takes < 3 s and keeps the same browser process.
  4. Rename + recolour + reshape one bot and dress: the already-open home page now greets the new name without manual reload; the recorded accent is the new colour; dressing with "restart browser" yields a new browser process that also greets the new name.
  5. Shrink a browser window to reveal wallpaper and dock (screenshot), open a terminal titled for a sign-in that runs a command, confirm the window exists, reset the screen: the terminal is gone and the browser is back on the home page.
  6. Every screen has its own profile; each still greets its own bot.
  7. Default screen with a managed browser: runs on port 9299 with the main bot's profile and greets it; browsers the app does not own keep running.
  8. Undress default screen: the app's browser is gone and no look is recorded.
  9. Default screen dressed with manage off (twice): no app browser started; foreign browsers untouched; a new tab opened in a foreign browser (if one with a debugging port exists) shows the main bot's home page (identified by display); terminal opens; reset closes the terminal, leaves foreign browsers running and starts no browser.
  It ends with every screen dressed and exits non-zero on any failure.

### 2.16 Numeric constants of the screens layer

| Constant | Value |
|---|---|
| Max screens per computer | 4 (incl. default) |
| Default screen display | :99 |
| Browser debugging port | 9200 + display number (default 9299) |
| Home server | loopback, port 7391 |
| Status check cache | 30 s |
| Lease verification freshness | 120 s |
| Wait computer running | poll 3 s, up to 240 s; suspending poll 3 s × 40 |
| Bundle hash / stamp length | 20 hex chars |
| Remote file chunk | 60,000 base64 chars |
| Job poll | 25 s per wait; job files kept 1 h |
| Limits | dress 240 s, terminal 30 s, undress 90 s, base 900 s, helper call 60 s |
| Package install | lock wait 60 s; 300 s per attempt; 180 s per single package |
| Home server start wait | 8 s |
| Panel hide wait | 4 s (poll 0.3 s); strips ≤ 4 px; re-hide every 15 s |
| Dock program start wait | 12 s; look check every 1.2 s |
| Log rotation | 4 MB |
| Browser start wait | 40 s fresh (early give-up 6 s) / 6 s existing; extension wait 30 s; tab swap 5 s; maximise wait 10 s / 1 s |
| Browser stop grace | 6 s (+1 s leftovers) |
| Window close | polite wait 2.5 s; kill grace 1.5 s; marked-process stop grace 3 s |
| Terminal | 104×28 chars; centre margins 120/170 px, top ≥ 24 px, raise 30 px; settle wait 4 s; scripts kept 24 h; title ≤ 120 |
| Dock | icon 44, slot 58, pad 9, margin 18, bottom gap 8, radius 20, hover radius 14 |
| Home page | avatar 104/76 px; clock 64–104 px; tiles 92 px, pad 64 px, icon 42 px; max 6 columns (4 when ≤ 680 px wide); hint 2.6 s; clock 1 s; stamp poll 4 s; app list ≤ 12, cache 20 s |
| Caller cache (home server) | 5 s; purge after 60 s; parent walk ≤ 6 |
| Launch POST body | ≤ 4 KB |
| Root colours | dressing wash default #eef0f3; undressed #eceef1 |
| Viewer defaults | 1280×960 extra screen; 1920×1080 default screen |
| DevTools liveness probe | 1.5 s |

---

## 3. Agent engine

### 3.1 Responsibilities

- HQ-140 The engine owns: the agent loop, the model conversation history (one engine-side conversation per bot per generation; "new conversation" bumps the generation and therefore starts a new engine conversation), long-term memory files, persona file, built-in tools (shell, file read/write/patch, web search and page extraction, browser automation over the debugging protocol, desktop control on its X display, image analysis, memory notes, session search, planning list, delegation to helpers, skills, clarifying questions, its own scheduler, messaging), model/provider access (API keys or subscription sign-ins), and its own risky-command prompts (not surfaced in the app — known gap).
- HQ-141 The app owns: queueing (one turn at a time per bot, REQ-500 unchanged), the trigger text, the per-turn "instructions" add-on (HQ-170), transcript rows/live state, the app tools over MCP, approvals for connected-app writes, routines/check-ins/tasks/library/rooms/voice.

### 3.2 Managed engine lifecycle

- HQ-150 Assignment: when an agent bot is created (or on start-up for older bots without one, primary bot first then by age), if no bot is bound to the primary engine yet, bind this bot to it; otherwise make it managed and give it the lowest free port at or above a base (default 8650). Rooms have no engine.
- HQ-151 Managed engine home (one folder per bot under an engines directory that MUST be outside the primary engine's home, so the engine treats it as a separate tenant; folder mode 700; logs and lock sub-folders):
  - Config, created once by copying the primary engine's model, providers, custom providers, auxiliary-model, and fallback settings, with reasoning effort "medium". On every (re)start the app patches only its own keys: tool sets for the API-server platform (the engine's API-server set, plus desktop control when the app runs on the computer and the bot has a display); the shell's working directory = the bot's library folder (or a workspace folder in the home when remote); the browser's debugging URL (HQ-085); and the MCP server list = existing entries + configured extra MCP servers (a JSON object from a setting) + the app's own server (URL `<app MCP base>/mcp/<bot id>`, bearer token HQ-160, tool timeout 1800 s, connect timeout 30 s). Files are written mode 600.
  - Persona file: created if missing, and rewritten when the bot's name, label or description changes (primary engine keeps its own persona). It must convey: name and role; works for the owner (by name) as one of a small team of agents, each with its own screen on a shared computer; the bot's description; direct, warm, brief; does the work instead of describing it; says plainly what it did and could not do.
  - Sign-in store: initialised once by copying the primary engine's subscription sign-ins (if any); later sign-ins belong to this bot alone.
  - Environment file (owned by the app; user-added keys preserved): API server enabled on 127.0.0.1 at the bot's port with a random 48-hex-char key (kept across restarts); model/search API keys inherited from the primary engine's environment (or the app's own environment) only if not already present — a fixed allow-list of model providers (Anthropic incl. OAuth token, OpenAI, OpenRouter, xAI, Gemini/Google, Nous) and web search/extraction providers; never messaging tokens; browser debugging URL when known.
- HQ-152 Start: reuse a gateway already answering on the port if its key is accepted (models list); if the port answers but the key is wrong, stop it if its pid file belongs to this home, otherwise fail ("port taken by something else"). Write the home, stop any stale gateway of this home, then launch the engine's gateway in the foreground-no-supervisor mode, detached, with a minimal environment: PATH/HOME/USER/LANG, engine home, lock dir in the home, a per-bot browser-helper folder (otherwise all agents on the computer share one browser driver), and DISPLAY of its screen. Poll health every 1 s for up to 90 s; abort early with the log path if the process exits. Concurrent starts share one attempt; the last failure message is remembered for the Engine panel.
- HQ-153 Stop: SIGTERM to the process group (fallback the process), wait up to 10 s (40 × 250 ms), then SIGKILL. A pid file is trusted only if it names this home and the process command line looks like the gateway.
- HQ-154 Restart (managed only; the primary engine is refused with an explanation that it is the computer's own agent): wait for an in-flight start, stop, drop the cached options, start in background.
- HQ-155 Gateways keep running when the app server exits; on server start all managed engines are (re)provisioned in the background; a healthy existing gateway is adopted.
- HQ-156 Delete bot: stop its gateway and delete its home (only if inside the engines directory).
- HQ-157 "Own private screen" detection: some engines can run a private virtual desktop for an agent; while on, the agent's desktop (and possibly browser) work happens there, not on the screen the user watches. Detected from the engine home (a launcher pid that is alive plus a ready marker). The app can ask the engine CLI to stop it (60 s timeout); a refusal (e.g. a person is using it) is passed to the user.

### 3.3 Turn execution against the engine

- HQ-160 Engine request: POST to the engine's Responses endpoint, streaming, with: model = the bot's chosen model or the engine's generic default name; provider if chosen; input = trigger text (prefixed by the hand-back note HQ-111 when due); instructions = HQ-170; conversation id unique per bot and generation; store = true; reasoning effort = the bot's effort. Engine auth = the engine's API key (primary: from a setting or read from the primary engine's environment file).
- HQ-161 Trigger texts (model-facing, paraphrase): user → the text as is; routine → a bracketed note that routine "<name>" is running now, followed by its prompt; bot → a bracketed note that it is a message from <name>, another bot on the team, to reply with the bot-message tool if asked something, then the text; system → a bracketed system-notice prefix. Unchanged room/check-in texts (REQ-1023, REQ-1404).
- HQ-162 Before posting: run "screen for work" (HQ-073); failure is logged, not fatal. Then resolve/start the engine (HQ-152). Abort if interrupted meanwhile.
- HQ-163 Stream handling (Responses-API SSE frames; keep-alives and `[DONE]` ignored; unknown frames ignored):
  - Output text delta: append (leading whitespace of a new message trimmed); on the first delta set activity "working"; create the streaming assistant row immediately and rewrite it at most every 120 ms.
  - Reasoning summary/text delta: keep the last 4,000 chars of reasoning and derive a caption (HQ-164); captions are throttled to one change per 300 ms.
  - Engine status event (engine-specific progress line): caption = its text (≤ 84 chars), unthrottled.
  - Output item added, reasoning: reset the reasoning buffer; activity "thinking".
  - Output item added, function call: close the current assistant message (text before a call is its own message). If it is one of the engine's own tool-discovery tools, show caption "finding the right tool" and add no row. Otherwise append a tool-call row (call id, display name, label, status running, parsed args), increment the turn's step counter (live state "steps"), set activity from the tool (HQ-166) unless the bot is waiting for the user (then only update steps), clear caption and reasoning. For a connected-app tool, asynchronously look up the app's display name and put it in the activity detail.
  - Output item done, message: commentary-phase messages are posted as their own finished assistant message; otherwise finalise the streaming row, or, if no text was streamed in the turn, post the full text.
  - Function-call output item (seen once per call id): mark the row done; status/summary = what the app tool reported for that call if anything (HQ-167), else a guess from the output (JSON with an error field → error + text ≤ 200; non-zero exit code → error "exit code N"; success false → error + message; text starting with "error"/"tool error" → error; else done). Activity back to "thinking" unless waiting.
  - Failed/error event: raise with the engine's message.
  - HTTP failure: message from the JSON error body, else "the engine did not accept our key" for 401/403, else the first 300 chars or the status.
- HQ-164 Caption derivation from reasoning: the last bold title (3–80 chars) if any; else the first sentence of the last paragraph, whitespace-collapsed, ignored if under 4 chars, truncated to 84 chars with an ellipsis.
- HQ-165 Turn end: close the message (an assistant message with text increments unread by 1; an empty streaming row is finalised empty and not rendered). On failure: post a notice — "stopped" (info) when interrupted, else "something went wrong: <message>" (error). Unfinished tool rows become done on success, or error with summary "stopped"/"did not finish" on failure. Live state cleared (running false, activity, awaiting, start time, caption) unless an approval asked outside this turn is still pending (then only running/caption cleared). A "stay silent"/"ask user"/"connect app"/"posted to group" tool marks the turn silent: any later text is dropped.
- HQ-166 Engine tool → activity/label mapping (labels paraphrased): app tools use their own declared activity/label (X search with detail "X"; unknown app tools → connected-app); tools of other MCP servers → connected-app with the server name as label/detail; shell/process/code execution → running commands; write/patch file → drafting a file; read/search files → working ("reading files"); web search → searching web; page extraction → reading web; X search → searching (detail X); any browser tool → browsing web; desktop control → on its computer; image analysis → working; memory → remembering ("saving notes"); session search → remembering ("searching memory"); planning list → working; delegation → working ("handing off work"); messaging → messaging; skills → working; clarify → waiting for you; scheduler → working ("scheduling"); anything else → working with the tool name turned into words. Engine-side MCP tool names carry a server prefix (single or double underscores); app tool names are matched case-insensitively after removing the app-server prefix; connected-app meta-tool names are upper-cased.
- HQ-167 Correlating MCP calls with rows: when an app tool is called over MCP, the app looks for the newest unclaimed, unfinished tool row with that name in the bot's running turn, polling every 40 ms for up to 600 ms (the stream announces a call just before the engine executes it). If none (the call came from an engine session outside the app), the tool still runs but no row is updated. Tool results the app knows (status, summary) are written to the row and take precedence over guesses.
- HQ-168 Interrupt: expires the bot's pending approvals and aborts the HTTP stream.
- HQ-169 Removed: the 60-step cap, history storage, paused-turn resumption, token accounting (all engine-side).

### 3.4 Per-turn instructions add-on

- HQ-170 Sent with every turn; MUST be byte-identical between turns unless something real changed (a routine, a connected app, the team), because engines cache it as part of the prompt prefix — so it must not contain the clock. It conveys:
  - Who: for the primary engine — this conversation comes from the owner's team app where it appears under the bot's name/label; it is the same agent as everywhere else (keep identity, memory, voice); if primary, it coordinates the other agents. For managed engines — it is <name>, <label>, on the owner's team of agents; the owner talks to it in the app; its description; primary role if applicable.
  - The app's tools and that they arrive via an MCP server whose name prefixes tool names; how to use connected apps (search for the action, then multi-execute; prefer a connected app over the browser; if missing, request a connection and stop); that some app actions wait for the owner's approval and simply take longer; on refusal do not retry; X search; save file and that anything written in its library folder shows in the Library; ask-user then stop; tasks; use the app's routines (not a private scheduler) for anything the owner should see; bot messaging and group posting; stay silent.
  - Its computer: its own screen on a shared Linux computer with its own browser; the owner can watch live and take over; use browser/desktop tools for sites without a connected app; stay on its own screen.
  - Style: short, warm, direct; lists/tables only when useful; never claim done without a tool result; never invent; report outcomes, don't narrate tool calls.
  - Context: owner name and email; connected apps (or none, or "could not check"); other agents with labels and a primary marker; group chats it belongs to; its routines (name, id, schedule description or paused, first 120 chars of prompt); skills (name heading + body); the owner's standing instructions.

### 3.5 Per-bot engine settings

- HQ-175 New bot fields: model (string ≤ 120 or null = engine default) and provider (string ≤ 120 or null). Patch via the engine-settings capability; empty strings clear. The bot's model appears as a chip next to its name in the details panel (tooltip "provider · model").
- HQ-176 Engine info returned to the client: bot id; profile label ("default" for the primary engine, the bot id otherwise); status ready | starting | stopped | error; error text; model; provider; engine version (when reported and not "unknown"); provider list; own-private-screen flag.
  - No engine bound → error "this bot has no agent". Managed without a port → error.
  - Health check fails: primary → error "the agent at <url> is not answering"; managed → "starting" if a start is in flight, else "error" with the remembered failure, else trigger a start and report "starting".
  - Healthy: fetch the engine's model options (cached 15 s per bot; 8 s timeout; dropped after sign-in or restart). Model/provider shown = the bot's choice, else the engine's current default.
- HQ-177 Provider list: providers that are authenticated or on a well-known list (Anthropic, OpenAI subscription, xAI subscription, xAI API, OpenRouter, Nous, Gemini, OpenAI API). Each: id, display name (Anthropic shown as "Claude (Anthropic)"), kind = subscription if its auth type is OAuth-like or it is Anthropic and not yet authenticated (so a Claude subscription can be offered), else API key; connected flag; up to 12 suggested model ids (featured list, else all models). Sorted connected first, then well-known order, then others.

### 3.6 The Engine panel (details panel section)

- HQ-180 States: "checking…" while loading; "engine unavailable" with a try-again link when the call fails; otherwise the form. Every call fails soft and never breaks the rest of the panel.
- HQ-181 Provider select: shows the selected provider's name (or the raw id, or "default"); options read "<name> · <subscription|API key> · <connected|not connected>", connected first. Under it a status line with a dot: connected/not connected · kind.
- HQ-182 Model: free-text input with suggestions from the selected provider (placeholder = first suggestion or "model id"); Enter saves. Picking another provider replaces the model with that provider's first suggestion if the current model is not among its suggestions.
- HQ-183 Save button (enabled only when provider or model differs from the server's values; "saving…"), and an Undo link while changed. Save errors show inline. Drafts survive quiet background refreshes.
- HQ-184 Sign-in action (shown when the selected provider is an unconnected subscription — "sign in to <provider>…" — or when any unconnected subscription exists — "sign in to a subscription…"): HQ-188. Busy label "opening sign-in…".
- HQ-185 Own-private-screen notice (when detected): explains that the bot also has a private screen switched on and desktop work there will not appear here, with a "use this screen" action (HQ-157; busy "switching…").
- HQ-186 Footer: a status dot + "<engine family> · profile <p> · <status>" (tooltip engine version); when error/stopped, a "restart agent" link (busy "restarting…"); error text below.
- HQ-187 Polling: every 3 s while status is starting; every 5 s while a sign-in is in progress and the large viewer is open; one refresh when the viewer closes.
- HQ-188 **Subscription sign-in on the bot's screen.** Local mode only (else 409 explaining it works once the app runs on the computer). Optional provider id must match a lowercase slug pattern (≤ 41 chars). The server readies the bot's screen and opens a terminal (HQ-100) running, with the bot's engine home: the engine's "add sign-in for <provider>" command (for Anthropic forcing the OAuth type, because otherwise the engine asks for an API key), or without a provider the engine's interactive model chooser; titled "sign in: <provider>" / "choose a model". Cached options are dropped. The client then opens the large viewer directly in control mode with a hint telling the user to finish signing in on the bot's computer and then hand back. Product note: tell users to check their provider's terms before running an agent on a consumer subscription.

### 3.7 App tools over MCP

- HQ-190 Endpoint: one per bot (`/mcp/<bot id>`) and one alias for the primary engine (`/mcp/primary`, resolving to whichever bot is bound to the primary engine — so the primary engine can be configured before that bot exists). Streamable-HTTP MCP, POST only, JSON responses only (no server stream, no sessions); other methods → 405 with Allow: POST. Bearer token = HMAC-SHA256(session secret, "mcp:" + slug) in hex, compared in constant time; mismatch or unknown bot → 401 JSON-RPC error.
- HQ-191 JSON-RPC: supports single messages and batches (batch with only notifications → 202 empty); notifications get no answer; responses from the client are ignored; invalid request → −32600; parse error → −32700 (HTTP 400); unknown method → −32601; missing tool name → −32602. Methods: initialize (echo the client's protocol version if it is one of 2025-06-18, 2025-03-26, 2024-11-05, else the newest; capability: tools without list-changed; server info with a title and a one-line instruction saying these are the team app's tools), ping, tools/list, tools/call, and empty resources, resource templates and prompts lists.
- HQ-192 Tool list = the app's own tools (HQ-200) + the user's connected-app meta-tools (only function tools not clashing with app tool names; empty if no bot is bound yet).
- HQ-193 tools/call: if no bot is bound to the endpoint → error text asking the user to open the app once. App tools run directly (always allowed); results are text parts; exceptions return "tool error: <message>" with isError. Connected-app tools go through the policy (REQ-540 rules, plus HQ-195): blocked → refusal text; ask → approval (HQ-196); allow → execute, output JSON (failure → error + log id) truncated at 60,000 chars.
- HQ-194 Refusal texts (model-facing, paraphrase): declined → "the user declined; do not retry; find another way or say what you couldn't do"; skipped → "not approved (new message or no answer in time); do not retry unless asked".
- HQ-195 **Sandbox gating (new).** The connected-app provider's remote code workbench and remote shell tools can invoke app actions from code, bypassing per-action approvals. When their arguments mention running provider tools/proxy execution, treat the call like a write: policy key = that tool's name, title meaning "run code that uses your connected apps", default mode needs-approval (always-allow/blocked honoured).
- HQ-196 **Approvals inside the MCP call (replaces paused turns).** Post an approval card (as REQ-030, title "allow <bot> to <action>?" where the action is the humanised slug without the app prefix), store the approval, increment unread, set the tool row to awaiting-approval, set live state waiting-for-you with the humanised slug as reason, emit tasks + bot events, then block the call until: allow / always (stores the always-allow policy) / deny / expiry. Maximum wait 25 minutes (kept below the engine's 30-minute tool timeout). On allow the row returns to running and the live activity becomes "connecting service" with the app name; on deny/expiry the row becomes denied with summary "not allowed"/"skipped". When no approvals remain pending, live state returns to running/thinking (if the turn is still going) or idle.
- HQ-197 Expiry: a new user message to the bot, an interrupt, or a server restart (all pending approvals expire at start-up because waiters live in memory) expire pending approvals (record + card status). Clicking a card whose waiter no longer exists expires it.

### 3.8 App tool catalogue (exposed to the engine)

Parameters are strings unless noted. Each declares an activity kind and a short label (REQ-680). Unchanged semantics are referenced.

- HQ-200 Save file — filename, content (REQ-608; writes into the bot's library folder on the computer).
- HQ-201 Create routine — name, prompt, schedule (5-field cron), timezone? (REQ-630).
- HQ-202 List event triggers — toolkit slug (REQ-631).
- HQ-203 Create event routine — name, prompt, trigger slug, config JSON string? (REQ-632).
- HQ-204 List / update / delete routine (REQ-633–635); set check-ins — enabled (bool), times (string list), timezone (REQ-636).
- HQ-205 **X search** — query (required, plain words); handles (list, ≤ 10, leading @ stripped) to restrict to; exclude handles (used only when no restriction list); from/to date (YYYY-MM-DD, ignored if malformed). Implementation: one non-stored call to the model provider's Responses API with the provider's X-search tool configured accordingly and a short system instruction (it is a research tool for another agent; answer precisely; for each post relied upon give author handle, date, engagement when visible and link; no preamble or advice). Timeout 240 s. Output = the answer text (or "no answer") followed by a "sources" list of up to 40 unique links from annotations/citations; total ≤ 60,000 chars. Activity searching (detail "X"); summary "searched X". Its description encourages one focused question per call stating what to return.
- HQ-206 Stay silent — reason? (REQ-662).
- HQ-207 Create task — title; update task — task id, state (enum), note? (REQ-640–641).
- HQ-208 Send to bot — bot name, message (REQ-650; hop limit 3).
- HQ-209 Create group — name, bot names list; post to group — group name, text (REQ-655–656).
- HQ-210 Ask user — question, options list (REQ-660); request app connection — toolkit slug, reason (REQ-661).
- HQ-211 Ending tools (ask user, connect, stay silent, successful group post) mark the turn silent (HQ-165).
- HQ-212 Connected-app meta-tools — passed through (REQ-670) with policy/approval (HQ-193–196).

---

## 4. Chat and UI changes

### 4.1 Live work display ("thinking block") — replaces REQ-1232

- HQ-220 Shown at the end of the transcript while the bot is running and not currently streaming text, or while it waits for the user.
- HQ-221 Left: a badge — the bot's avatar (36 px, gently bobbing) sitting on top of a dark rounded pill (#1C1C1C, radius 20, min width 88, max 260) that shows the bot name (white, 14 px medium) and a status word (white 60%, 12 px, pulsing opacity 1↔0.4 over 1.6 s). A small glowing yellow light-bulb icon sits at the avatar's upper right while working; while waiting it is replaced by an amber alert dot, the bobbing and pulsing stop and the status turns amber.
- HQ-222 Status word by activity (paraphrase): thinking, working, searching, reading, browsing, on its computer, running commands, waiting on results, checking in / "checking with <bot>", using an app / "working in <app>", writing, remembering; waiting → "needs you". The app name is used only if it looks like a display name (no underscores, not a lowercase slug).
- HQ-223 Right: a one-line caption — while waiting, the awaiting reason (or "waiting for your answer"); else the server's live caption (HQ-164) if any; else the rotating friendly phrase of the activity (REQ-1232 phrase rules; rotation every 6 s counted from the activity start). When the caption changes, the new line slides up/fades in while the old one fades out (320 ms). Below: a meta line "working for <duration>" (from turn start; shown after 1 s) or "waiting for <duration>" (from awaiting start), plus "· N step(s)" when no steps chip is currently open (HQ-226). Durations: "8s", "1m 23s", "1h 4m". Ticks every 1 s.
- HQ-224 Live state additions: caption (string|null) and steps (count of tool calls in the turn), both reset at turn start/end.

### 4.2 Steps chip — replaces the "N steps" toggle of REQ-1231

- HQ-225 Consecutive tool-call rows fold into one chip (pill, 26 px tall, subtle border; count in monospace 11 px).
  - While that run is the last item and the bot is running (not waiting): a spinner, the label of the newest running step (or the last step) which slides in on change, a separator, and the count.
  - Otherwise: optional coloured flag dot (amber if any step awaits approval — tooltip "waiting for your OK"; red if any failed/denied — "a step didn't finish"), then "worked for <duration> ·" when known, then the count, then a chevron that rotates when open.
  - Count while the turn is open = rows in the run + steps the server has counted that have no row yet (live steps minus tool rows since the last user message, floored at 0). "N step"/"N steps".
  - "Worked for" duration = time from the row just before the run to the row just after it (or to the last step if nothing followed), shown only if ≥ 1 s and < 12 h; not shown while the turn is still open.
- HQ-226 Expanding lists every step: a spinner (running) or a status dot (green done, red error/denied, amber awaiting), the label, the summary (muted, ellipsis) and a note "failed" / "not allowed" / "waiting for your OK". Steps with arguments are clickable and reveal the arguments as pretty JSON (≤ 2,000 chars, ellipsis), in a scrollable monospace box (max height 180 px). The list animates in; max width 640 px.

### 4.3 Live screen in the details panel — replaces the Computer row of REQ-1251

- HQ-230 Panel top ("hero") for agent bots: a live view of the bot's screen in a rounded frame (radius 22 px) keeping the screen's aspect ratio (HQ-112), then an identity row: avatar 36, "name · label", model chip (HQ-175), "computer <status>" line, and an "Open" button (large viewer, watch). Rooms keep the plain identity block. The separate Computer section and the 4 s thumbnail are removed.
- HQ-231 The panel view streams (watch mode) only when the computer is running, the page is visible, the large viewer is not open (then it shows "open in the large view") and the bot already has a screen (or the user pressed "open its screen") — browsing bots never consumes screens.
- HQ-232 Phases and their content (same component for panel and large stage; mascot 40 px panel / 64 px stage):
  - live: a "Live" badge top-left (avatar + text + a small green breathing dot on a translucent black chip; animations off under reduced-motion) when watching; a transparent overlay button opens the large view (the VNC canvas swallows clicks);
  - switching (reconnecting after a frame was seen): "one moment…";
  - waking: a soft band tinted with the bot's colour sweeping across + bobbing mascot + "waking <bot>'s computer…";
  - asleep: sleeping mascot, "going to sleep…" or "<bot>'s computer is asleep" + "wake it up";
  - idle (no screen yet): "<bot> hasn't opened a screen yet" + "open its screen", or, when all screens are taken, "all N screens are in use; reset one in Settings";
  - paused (large view open): "open in the large view";
  - error: "couldn't wake …" / "the screen disconnected" / "couldn't reach …'s screen", the provider error if any, the all-screens-in-use note if relevant, and "retry" (reconnect if running, else wake).
- HQ-233 Hover control pill (bottom centre, dark translucent, appears on hover/focus; always visible on touch devices; pinned while a confirmation or note shows): a Watch / Take control segmented switch (icons only in large view), a divider, a full-screen toggle (if supported; failure note "full screen isn't available"), and a reset button → inline "close all windows?" with Reset (danger, "resetting…") and Cancel; the question auto-cancels after 6 s; notes disappear after 4 s. Reset reconnects the stream afterwards; failure note "couldn't reset the screen".
- HQ-234 Driving: the frame gets a 2 px ring in the bot's action colour and a 52 px "chin" bar under it in that colour showing a pulsing ping dot and the hint (e.g. the sign-in hint) or "you're driving", a full-screen toggle, and a "hand back to <bot>" button with the bot's avatar (HQ-111). The panel view cannot be driven: "take control" from the panel opens the large view in control mode; in panel full screen it can, and leaving full screen hands back.
- HQ-235 Large viewer (REQ-1290 changes): auto-wakes the computer once when opened while asleep; opens in the mode requested (watch, or control with an optional hint); closing while driving hands back; Escape closes only in watch mode and not in full screen; the hint is cleared when the user returns to watch.

### 4.4 Other UI changes

- HQ-240 Details panel Activity tab sections, in order: Upcoming, Members (rooms), Suggested (dismissible), **Engine** (HQ-180), Voice chat. (The Computer section moved to the hero.)
- HQ-241 Bot settings → Memories: entries now come from the engine's memory files (HQ-260); chips distinguish "picked up" (agent notes) from "saved in chat" (facts about the user). The conversation-memory meter of REQ-1274 has no data any more and SHOULD be removed (the reference still renders it with zero values, which shows a meaningless percentage). Consolidate/compact capabilities answer no-op results for old clients.
- HQ-242 Thinking-effort choices unchanged in meaning (low / medium / high / max), now passed to the engine.
- HQ-243 App Settings → Computer: header text says the bots share one cloud computer with a screen each; status row as before but the sleep/wake buttons drive HQ-005 (sleep is a no-op; text about idle sleep is now inaccurate and should say the computer stays on); "screens in use · X of N"; each lease row shows bot, screen label (HQ-113), last-used, and Reset (two-step confirm "reset screen"; disabled with tooltip when the computer is not running); hint: reset closes every window on that bot's screen; up to N bots can have a screen; when full, reset one to free it.
- HQ-244 Create bot: shows the server's "team is full" error inline (HQ-006).
- HQ-245 Developer fixtures (REQ-1295) gain variants: working (pulsing status, caption, timer, live steps chip with steps in every status), waiting ("needs you"), idle (only finished "worked for" chips).
- HQ-246 Shortcuts, sidebar, composer, cards, tasks view, search, connect-apps: unchanged.

---

## 5. Authentication changes

- HQ-250 **Allow-list.** A comma-separated list of e-mail addresses (case-insensitive) may restrict *account creation*: a sign-in (Google, developer, owner) for an address that has no account and is not on the list fails with "this account is not allowed to sign in here" (developer/owner endpoints answer 403 with that message; Google sign-in redirects with the failure flag). Existing accounts are not affected. Empty list = anyone who can reach the app.
- HQ-251 **Owner key.** A secret derivable only by someone who can read the server's settings: HMAC-SHA256(session secret, a fixed label) in hex, compared in constant time. An owner endpoint accepting `Authorization: Bearer <owner key>` and an e-mail (must contain "@"), optional name, optional "link" flag: finds or creates the user (allow-list applies); without "link" it sets a session cookie directly; with "link" it returns a one-time sign-in URL.
- HQ-252 **One-time sign-in link.** 24 random bytes, base64url; stored in memory only (a restart invalidates links); valid 15 minutes; consumed on first use (deleted even when expired). Visiting it creates a session and redirects to the app root; reused/expired → HTTP 410 with a plain message asking for a new link. The URL is built on the public app URL.
- HQ-253 Operator helper: a shell command run on the computer that derives the owner key from the settings file, calls the owner endpoint on loopback with link=true, and prints the link — for when Google sign-in is not configured.
- HQ-254 Session cookie gets the Secure attribute when the public app URL is https. Sign-in screen otherwise unchanged.
- HQ-255 New-account primary bot: its name and label come from settings (defaults: a human first name and "chief of staff"); still bound to the primary engine if free (HQ-150).

---

## 6. Voice, X research, routines, tasks, library — differences only

- HQ-260 **Memory source.** A bot's memories are the engine's two memory files in its home: agent notes ("picked up") and user facts ("saved in chat"); each file is a list of entries separated by a line holding only a section sign. Memory ids encode bot id, file key and a 16-hex hash of the text; listing uses the file's modification time as the entry time; deleting rewrites the file without that entry (ownership checked through the id's bot). There is no app-side memory table, saving, recall, consolidation or compaction.
- HQ-261 **Voice.** Unchanged except: the voice prompt's memory list takes the 12 entries with user facts first (from HQ-260); the voice agent hands work to the same engine-backed turn queue; settings for the voice and transcription models (defaults: provider's latest voice model, provider's transcription model).
- HQ-262 **Library.** Location unchanged (per-bot folder on the computer). In local mode: listing does not require the computer to be "running"; downloads are served directly by the app from disk (attachment, octet-stream, no-sniff), after resolving symlinks and verifying the real path stays inside the bot's library (else 404). Remote mode keeps the provider export link. The engine's shell starts in the library folder, so anything it writes there appears in the Library.
- HQ-263 **X research.** Now an app tool available to every engine (HQ-205) instead of a provider-hosted tool in the app's own loop.
- HQ-264 **Routines.** Unchanged scheduling; the agent is told to prefer app routines over its engine's private scheduler (HQ-170). Event payloads passed to the routine turn are clipped to 8,000 chars (pretty JSON). A setting disables all schedulers (routines, triggers, check-ins) for extra servers sharing a database copy.
- HQ-265 **Tasks, rooms, check-ins:** unchanged.
- HQ-266 **Subagents:** no longer offered as tools; delegation is the engine's own.

---

## 7. Install, deploy, upgrade, remove

- HQ-270 **Package.** A build step produces one archive with the built server and web app, the desk bundle, the avatar shape data, the installer, the engine-config helper and the sign-in-link helper — no secrets and no dependencies folder.
- HQ-271 **Install/upgrade (one command, as root, on the computer).** Guarantees:
  - Uses a private Node 22 runtime under the app's folder (downloaded if absent); the system Node is left alone.
  - Code and data live in separate folders; an upgrade replaces only the built code and reinstalls production dependencies (without running package install scripts, so the bundled native database binary is used).
  - The settings file is written only on first install (requires the public URL and the computer id; generates the session secret; reads the model, connector and computer keys from a one-shot keys file, falling back to the primary engine's environment for the computer key; points at the engines and data folders; local mode on). Later runs keep it — so the session secret, every bot's MCP token and all sessions survive upgrades. The keys file is deleted after use. Settings file mode 600.
  - Exactly one supervised service is added or restarted; nothing else under the process supervisor is touched; logs to the app's log folder (10 MB cap).
  - Waits up to 30 s for the health endpoint and prints it.
  - Never restarts or reconfigures the primary engine. Instead it writes a ready-made MCP-server entry (URL to the primary alias, bearer token HQ-190, timeouts 1800/30 s) to a file and prints its path.
- HQ-272 **Engine-config helper** (adds/removes the app's MCP entry in the primary engine's config): edits the text in place (comments and layout preserved), replaces an existing entry, creates the section if missing, refuses unusual layouts it cannot edit safely; verifies by parsing before/after that every other setting is unchanged and that the new entry reads back with a URL and an Authorization header (or is gone, on remove); keeps a dated backup; replaces the file atomically preserving mode and owner; prints "nothing to change" when idempotent. The engine hot-reloads the config.
- HQ-273 **Public URL.** The provider's public URL (or any reverse proxy) points at the app port (default 8787).
- HQ-274 **Remove everything:** undress the default screen; remove the MCP entry from the primary engine; stop and remove the service; delete the service config, app folder, logs, browser profiles/library root and the browser policy file; delete the public URL. Other bots' screens are released when those bots are deleted in the app.
- HQ-275 **Development mode:** run against a remote computer through its API (local mode off); developer e-mail login only with an explicit flag and never on a public address; `?fixtures` sample data in development builds.
- HQ-276 **End-to-end test:** creates a throwaway bot (own engine + screen), exercises chat, its browser on its screen, the live viewer, connected apps, voice sessions and settings, then deletes it; signs in via developer login or an existing session cookie; uses real providers.

---

## 8. Configuration

Names are suggestions. "Earlier" = still as in earlier spec §13 where not listed.

| # | Setting (suggested) | Effect | Default |
|---|---|---|---|
| HQ-280 | PORT | Server port | 8787 |
| HQ-281 | APP_URL / SERVER_URL | Public app URL (redirects, sign-in links, cookie Secure flag) / server URL (callbacks) | localhost:5173 / localhost:PORT |
| HQ-282 | SESSION_SECRET | Sessions; derives MCP tokens (HQ-190) and the owner key (HQ-251) | required |
| HQ-283 | DEV_LOGIN | Developer e-mail login | off |
| HQ-284 | SIGNIN_ALLOWLIST | Comma-separated e-mails allowed to create accounts | empty = anyone |
| HQ-285 | DB_PATH | Database file | data folder |
| HQ-286 | MODEL_API_KEY / MODEL_NAME | Model provider key for X search, voice, TTS, STT / model used by X search | required / provider's current flagship |
| HQ-287 | VOICE_MODEL / STT_MODEL | Realtime voice / transcription models | provider latest / provider transcription model |
| HQ-288 | APPS_API_KEY | Connected-app provider key | required |
| HQ-289 | COMPUTER_API_KEY (or a *_FILE variant naming a file) | Computer provider key; any secret may be read from a file instead | required (remote) |
| HQ-290 | COMPUTER_ID | The one shared computer | empty → computer features error |
| HQ-291 | LOCAL_MODE | App runs on the computer: local shell/files, sign-in, direct downloads, liveness probe | off |
| HQ-292 | PRIMARY_BROWSER_URL | Debugging URL of a browser the primary bot already owns on the default screen; when set, the app never starts/stops that screen's browser | empty |
| HQ-293 | MAX_BOTS | Maximum agent bots (each needs a screen); effective cap min(value, 4) | 4 |
| HQ-294 | ENGINE_BIN | Engine CLI used to start gateways, sign-in, private-screen stop | engine's default command |
| HQ-295 | PRIMARY_ENGINE_URL / PRIMARY_ENGINE_KEY / PRIMARY_ENGINE_HOME | Primary engine API, its key (else read from its home's environment file), its home (memory, sign-ins, config to copy) | loopback 8642 / read / user's default engine home |
| HQ-296 | ENGINES_DIR | Managed engine homes (must be outside the primary home) | data/engines |
| HQ-297 | ENGINE_PORT_BASE | First managed engine port | 8650 |
| HQ-298 | MCP_BASE_URL | How engines reach the app's MCP endpoint | loopback PORT |
| HQ-299 | EXTRA_MCP_SERVERS | JSON object of extra MCP server entries every managed bot gets (invalid JSON ignored with a warning) | empty |
| HQ-300 | PRIMARY_BOT_NAME / PRIMARY_BOT_LABEL | New account's first bot | a first name / "Chief of Staff" |
| HQ-301 | NO_SCHEDULER | Disable routines, triggers and check-ins in this process | off |
| HQ-302 | IDLE_* (minutes 20, sweep 60 s, dry run) | Retained but inert: the shared computer is never suspended | — |
| HQ-303 | Desk test: SHOTS_DIR, TEST_SCREENS | Screenshot folder; extra screens 1–3 | temp/desk-test; all existing (≥ 2) |
| HQ-304 | Installer inputs | public URL, computer id, allow-list, keys file, port, primary browser URL, dev login, primary bot name/label | — |

Removed from the earlier spec: VM size/resolution/workspace (the computer is pre-existing), compaction thresholds, consolidation settings, model-per-effort settings.

---

## 9. Top ideas worth adopting

Target product already has: one Docker container per bot (Xvfb, openbox, tint2, Chromium, xterm, file manager), its own agent loop with Claude/OpenAI-compatible providers, MCP connectors, approvals, routines, memory, Telegram. Ranked by user value ÷ cost (H/M/L).

1. **"Worked for … · N steps" chip + live thinking block with reasoning caption** (value H, cost L). Pure UI over data the loop already has: steps counter, turn start, current tool label, last bold heading / first sentence of reasoning (HQ-164, HQ-220–226). Biggest perceived-quality jump for the least work.
2. **Screen readiness before every turn, with stamp-based idempotent dressing and repair** (H, M). Before a turn: container up → desktop pieces alive → Chromium's DevTools `/json/version` answers within 1.5 s → else restart it on the bot's profile (HQ-057, HQ-073, HQ-082). Removes the "agent launched its own stray browser / found a dead screen" class of failures.
3. **Live screen in the side panel with a hover pill (watch / take control / full screen / reset) and a "hand back" chin** (H, M). Reuse the existing VNC relay; stream only when visible and when the screen exists (HQ-230–235).
4. **Hand-back note to the agent** (H, L). After the user drove the screen, prefix the next turn with "the user had control; look before relying on earlier state" (HQ-111).
5. **"Reset screen" = close every app window, keep logins, reopen the browser on the home page** (M-H, L). Polite close → wait 2.5 s → kill; never touch desktop pieces (HQ-061). Great self-service fix for messy screens.
6. **Per-bot "dressed" desktop** (M-H, M). Wallpaper generated from the bot's colour (palette + edge doodles, HQ-051–053), tint2 restyled as a small frosted bottom dock with Browser/Terminal/Files (no taskbar), light GTK + light xterm palette, Chromium themed with the bot's accent, and a **local home page as the new-tab page** (avatar, big clock, date, "welcome back, <name>", role, up to 12 app tiles that launch apps, auto-reload on rename) via Chromium's new-tab/homepage policies or a tiny MV3 extension (HQ-090–097). In a one-display container, skip the caller-identification machinery. Makes each bot feel like "its own computer" and photographs well in screenshots.
7. **Chromium hygiene for agent driving** (M, L): clean-exit flags (no restore prompt), welcome seen, sign-in nudge suppressed, bookmarks bar hidden, plain-tab replacement, and the policy that allows DevTools on extension pages (HQ-034, HQ-083). Prevents silent CDP hangs.
8. **Approvals inside the tool call with a bounded wait** (M, L-M). If you ever expose your tools to an external agent CLI over MCP, block inside the MCP call (≤ 25 min, below the client's tool timeout) instead of pausing your own loop; expire on new user message/interrupt/restart (HQ-196–197). Also adopt **sandbox gating**: treat a connector provider's remote code/shell tool that calls connector actions as a write needing approval (HQ-195) — closes a real approval bypass.
9. **Subscription sign-in on the bot's own screen** (M, M). Open a light terminal on the bot's display running the provider CLI's OAuth login, then pop the viewer in control mode with a "finish signing in, then hand back" hint; poll engine status meanwhile (HQ-188). Lets users bring a Claude/ChatGPT subscription per bot (flag the providers' terms).
10. **Per-bot Engine panel** (M, L-M): provider select with connected/kind badges, model input with suggestions, save/undo, status line with restart (HQ-180–187). You already have providers; this surfaces them per bot.
11. **Byte-stable per-turn instructions** (M, L): keep the clock and volatile data out of the system add-on so prompt caching hits (HQ-170) — cheaper and faster turns.
12. **One-time sign-in link + allow-list** (M, L): operator CLI prints a 15-minute single-use link; allow-list gates account creation (HQ-250–253). Ideal for self-hosting behind Telegram-first usage.
13. **Upgrade-safe installer and verified config editing** (M, M): code/data split, settings written once, secrets file consumed then deleted, only one service touched, config edits that verify every other key is unchanged and keep dated backups (HQ-271–272).
14. **Desk test** (M, M): an automated script that dresses screens, checks greeting text through CDP, timings (< 3 s repeat dress), reset behaviour, profile isolation, and saves screenshots (HQ-125) — catches desktop regressions that unit tests miss.
15. **Team-full error instead of silent eviction** (L-M, L): with per-bot containers, cap concurrent containers by host resources and say so clearly (HQ-006, HQ-012).
