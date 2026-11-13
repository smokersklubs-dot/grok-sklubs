# 03 — Functional specification: "team of AI bots in a chat app" (reference: OpenMausBot)

Status: clean-room behavioural specification. Written by the analysis side after reading the reference
project's public documentation and observing its behaviour contracts. It describes WHAT the product does,
never HOW the reference implements it. No source code, prompts, comments or UI strings are reproduced; all
wording, names of tools, entities and screens below are our own paraphrases. Numbers (limits, timeouts,
thresholds) are facts about observed behaviour and are given so an implementer can pick sensible defaults.
Third-party product and API names (Claude Code, Codex, ACP, MCP, Composio, ElevenLabs, Fish Audio, noVNC,
bubblewrap, Tailscale, Croner-style cron…) are public names.

Conventions: "MUST" = behaviour the reference guarantees; "SHOULD" = default behaviour that is configurable;
"MAY" = optional/advanced. "Person" = a human user. "Bot" = an agent identity. "Host" = the server process.
Requirement ids are `OMB-nnn`.

---

## 1. Product overview and concepts

- **OMB-001** The product is a messaging-style application in which every contact is an AI agent ("bot"). A
  person chats with bots one-to-one, in group conversations, and delegates work; bots can also work
  unattended on schedules and external events.
- **OMB-002** Architecture is two processes: a thin client (web/desktop UI) and one local "harness" server.
  The client holds no model transports: it sends typed commands over HTTP and folds a single server-sent
  event stream into its state. The server owns every agent process, every credential and all persistence.
- **OMB-003** Local-first: by default the server binds to loopback only; transcripts, settings, keys, logs
  and bot workspaces live in one per-user data directory. Remote access (phone, other desktop, browser) is
  opt-in and goes through explicit pairing.
- **OMB-004** "Bring your own agent": each bot runs on an *engine* — an installed agent CLI the person is
  already signed in to (subscription login), an API-key chat endpoint, or a custom engine. Engines are
  pluggable behind one small adapter contract (§3.7).
- **OMB-005** Core nouns: **Bot** (durable identity: role, instructions, memory, skills, tools, computer
  preference, voice), **Thread** (one conversation with one bot; own transcript, model, approval level, run
  state), **Folder** (cosmetic grouping of a bot's threads), **Group/Room** (multi-bot conversation with a
  member list and responder rule), **Department** (sidebar grouping of bots with shared instructions and at
  most one lead bot), **Chief of Staff** (a bot role that manages a department), **Assignment** (a unit of
  work handed from one requester to one bot), **Routine/Trigger** (work that starts on its own),
  **Skill** (reusable written procedure), **Computer** (where a bot does visual/terminal work),
  **Connected app** (OAuth-backed third-party tools), **Card** (interactive message asking the person to
  decide, answer, sign in or supply a secret).
- **OMB-006** A fresh install starts with one built-in assistant bot that is also the first Chief of Staff
  and the product helper. It cannot be deleted, only hidden.
- **OMB-007** Two interface modes exist: **Simple** (default; only what is needed to talk to bots and get
  work done) and **Advanced** (adds models, token usage, inspectors, raw logs, developer options).
  Advanced only adds detail; it never rearranges, and switching never loses data.
- **OMB-008** Product stance on interruptions: bots get on with the work. The default approval level is the
  most permissive; the app adds no confirmation dialogs of its own; configuration changes made by bots
  apply immediately and leave a one-line receipt with Undo. Real questions and missing credentials always
  reach a person.
- **OMB-009** Deployment shapes supported by the same server: packaged desktop app with embedded server;
  headless server from a terminal (`serve`), in Docker, or as an OS service; hosted "cloud home" per person;
  shared team workspace with multiple signed-in people.
- **OMB-010** External control surfaces: a local HTTP API, a scripting CLI, a stdio MCP server exposing a
  bounded "team control plane", a per-bot inbound message API, and webhooks.

## 2. Data entities

Each entity lists the behaviour-relevant attributes. Storage layout is the implementer's choice.

- **OMB-020 Bot**: id; name; title/role; description; standing instructions (short persona + never-break
  rules); colour, mascot/avatar (image with crop/zoom/focus); default model selection (engine instance,
  model id, optional reasoning effort or variant); ordered fallback models; approval level; per-bot saved
  "always allow" grants; computer preference (off / auto / this computer / local VM / cloud / own server /
  built-in browser); working folder; department; flags (pinned, hidden, archived, unread, notifications
  on/off); chief-of-staff flag and list of managed departments; "reports to" person (teams); visibility
  (everyone / admins / named people); allowed-peer list (optional restriction on which bots it may
  contact); memory enabled; memory upkeep enabled; helper-model allowed; voice id, speak-replies,
  voice-notes enabled, reply style; connected-apps enabled, per-app read/write scope, per-app tool grants,
  outbound policy ("ask every time" vs "send without asking"); assigned MCP servers; tool selection
  (allow/exclude lists); browser enabled + browser profile; installed playbooks; provenance of an installed
  package; inbound API enabled + hashed key; concurrency limit.
- **OMB-021 Thread** (direct conversation): id; bot; title (from first message, optionally model-generated);
  folder; own model selection or "follows bot"; own approval level; pinned; archived; snoozed-until;
  unread + last-read marker; pinned message; activity state (working / waiting on person / idle / no signal
  / dead / parked waiting for a computer); busy flag and turn start time; active computer surface; token
  and cost usage totals + last turn + context fill; working folder override; who opened it (person, bot,
  routine, API, webhook) and who closed it; privacy/sharing flags (teams); fork origin (branch of another
  thread); prompt-cache keep-warm state.
- **OMB-022 Message**: id; role (person / bot); kind (text, option card, activity/tool row, screenshot,
  connector card, secret card, sign-in card, routine-run card, goal-run card, burst card, turn digest,
  compaction marker, call record, widget, mini-app); text; attachments (images, video, audio, documents);
  parent id (messages form a tree so edits create branches); reply-to; sender identity (which person, which
  bot, via API/call/relay/webhook); turn id; flags (queued, steered into a running turn, aside, pending
  request, turn terminal, succeeded); reactions; routing attribution (which decision provider picked the
  speaker, with probability); idempotency key supplied by the sender.
- **OMB-023 Card payload** (on an option-card message): title, subtitle, options, request type (permission
  vs question), answered value/text, who answered and how (tap, typed, reaction, voice, another bot on the
  person's behalf, default), dismissed / expired / stopped / superseded flags, auto-applied + undone flags,
  and one typed sub-payload: tool permission, structured question set, routine/webhook/app-trigger change,
  profile change, model change, team setup plan, MCP server change, skill change, team-memory save, outbound
  send consent, engine-switch offer, computer request, wait, app setting.
- **OMB-024 Group (room)**: id; name; description; member bot ids; default responder rule (a named member /
  everyone / mentions only / automatic routing with fallback member); bulletin (standing shared
  instructions); department; shared working folder; per-room turn timeout; threads within the room (each
  with own transcript, title, unread, pin); per-member holds (paused bots) and messages held for them; live
  queue (who is running, who is queued, position); per-member context fill; audience floor (who may see
  it); usage totals per room thread.
- **OMB-025 Department**: name; member bots; shared instructions/context; at most one Chief; optional owner
  person; optional assigned shared computer; shared team memory entries (kind, name, detail, aliases).
- **OMB-026 Assignment** (work record): id; root id, parent id, depth (a tree); origin (person / routine /
  outside); requester (person, bot turn, routine run, external runtime; chief flag); assignee bot + target
  thread kind (standing work thread, new thread, named thread, room thread); mode (work / consult /
  notify); reply mode (resume requester / poll only / none); status (queued, running, waiting on children,
  needs input, resume due, terminal); outcome + detail (completed, failed with reason — refused, expired,
  interrupted, stalled, stopped, out of budget — or cancelled); approval level and which rule set it;
  execution count; restart bookkeeping; brief (≤12,000 chars); "done when" criterion; result (≤12,000
  chars); harness-observed evidence (successful tool calls, errors, files touched, outward actions); open
  card ids; optional goal-run id. Plus an append-only event trail (every status change) and an inbox table
  (the wake lane).
- **OMB-027 Routine (schedule)**: id; owning bot (or room for a goal); name; instructions; schedule (one
  time / weekdays at time / interval 5–1,440 minutes / monthly / yearly / 5-field cron with IANA zone);
  enabled; where it runs (bot's current setup vs dedicated cloud computer); optional own model; optional
  run time limit; results destination thread; continuity ("remember last run"); overlap policy; run on app
  start; pre-model checks (calendar, mail, other runs); access profile (normal vs read-and-draft only);
  delivery (chat vs daily brief). **Run**: id, routine, trigger (scheduled, catch-up, startup, run-now,
  webhook, app event), state (queued, active, waiting, completed, missed, failed, cancelled), hidden
  execution thread, report text, retry notes.
- **OMB-028 Webhook trigger**: id; bot; name; instructions; secret (shown once; stored hashed); event-type
  and payload filters; enabled; delivery attempts log (≤2,000) with outcome. **App-event trigger**: bot,
  app, event type, connected account, filter, config, enabled, daily counters and skipped counts.
- **OMB-029 Skill**: name (lowercase letters/digits/hyphens, ≤64); one-line description; body; optional
  reference files; tags, license, compatibility; enabled flag per bot; source (written by person, written
  by bot, learned automatically, imported from file, organisation library); revisions; scan warnings.
  Library skill additionally: "every bot" flag and list of assigned bots.
- **OMB-030 Memory**: per bot — one core notes document (always loaded, bounded), many topic documents
  (loaded on demand, with title/description/aliases header), an archive document, daily log documents, and a
  change journal (who changed what, undoable). Workspace-wide — "About me" profile text (≤24,000 chars)
  with bot-added dated facts, "rules for every bot" text (≤24,000 chars).
- **OMB-031 Engine instance**: id; driver kind; display name; icon; environment; enabled/hidden; access
  type (subscription login / custom / pay-per-use API); driver config (binary path, base URL, tool lists);
  live snapshot (installed? version? signed in? model catalogue with efforts/variants, capabilities, plan
  usage windows).
- **OMB-032 Usage row** (one per settled turn, no message text): time; bot; thread; engine instance, driver,
  model; input, output, cached-input, cache-write, reasoning tokens; stable vs volatile prompt bytes; cost
  and cost source (engine-reported, equivalent estimate, price list, absent); trigger (which person/device,
  routine, other bot, helper job); department; turn start/end; parent turn; outcome; step, tool and
  tool-error counts; context tokens and window.
- **OMB-033 Decision-log row** (one per approval decision): time; decision (auto-allowed by which rule,
  card shown, allowed/denied by whom, auto-denied by safety floor, expired); bot; tool; summary; thread;
  request id; whether nobody was present (unattended).
- **OMB-034 Computer**: kind (host desktop, local container desktop, cloud desktop, remote container over
  SSH, built-in browser, Android phone over USB); owner (bot / team / shared pool); state (provisioning,
  waking, ready, asleep, deleting); control holder (bot vs person "take control"); lease; latest frame.
- **OMB-035 Vault item**: saved website login (site, username, password, optional TOTP seed, extra sites it
  may be filled on) or named secret (scoped to one bot, and to "tools only" vs "bot commands"); never
  returned to clients, masked in transcripts and logs.
- **OMB-036 Wait**: bot, thread, label, condition kind (URL contains/does not contain text, file exists /
  missing / changed, process running / gone, another bot idle), follow-up instruction, expiry (1–168 h,
  default 24).
- **OMB-037 Device/session**: paired device token (stored as digest), label, capabilities (chat, computer
  view/control separately), role (owner/admin/member/guest/client-only).
- **OMB-038 Notification**: thread, kind (needs you, done, failed, mention, routine result, limit), read
  state; delivered to desktop, browser tab badge and paired phones.

## 3. Agent runtime behaviour

### 3.1 Turn loop and event model

- **OMB-050** A *turn* is one run of one bot on one thread, started by a message (person, bot, routine,
  webhook, API, call) and ended by exactly one terminal event. Turns on the same thread never overlap.
- **OMB-051** Every engine's native protocol is normalised into one canonical event stream: session
  started/exited; turn started/completed/retrying; text deltas; tool item started/updated/output/completed;
  request opened/resolved (permission or question); token-usage updated; context compacted; step-cap
  exhausted; runtime notice/error; long-wait started/ended. Events are appended per thread to an
  append-only log (size-capped and rotated; retention configurable in days) and fanned out to all clients.
- **OMB-052** The transcript shows a bot's intermediate tool activity as collapsible "worked for N" rows
  with one short human phrase per tool call (computed once server-side so the visible chip and the spoken
  narration match); the final reply is one bubble. Individual tool rows are hidden by default.
- **OMB-053** For engines that are plain chat endpoints, the host runs the tool loop itself: send messages
  + tool definitions, execute returned tool calls through the host's gate, feed results back, repeat until
  a final answer. Default step cap 64 model calls per execution; at most 128 tools offered per call
  (configurable; some providers learn a lower limit from refusals).
- **OMB-054** For CLI agents the engine runs its own loop; the host injects its tools as MCP servers, the
  system prompt as an appended file, and a per-turn permission channel.
- **OMB-055** A turn that hits a step cap or loses its computer seat ends as "continue", not as done: the
  same work is queued again and its next execution opens with why it stopped and what was done so far.
- **OMB-056** Loop guards: (a) two consecutive continuations with no successful tool call, or three
  identical error texts across continuations, end the work as failed/stalled with a plain explanation;
  (b) within a chat-engine turn, the same failing call three times is refused, two refusals stop the turn;
  the same identical answer repeated gets a nudge at 3 and a stop at 10; (c) a repeat-call detector injects
  corrective notices at 5/10/20 identical calls and hard-stops at 256 calls per turn.
- **OMB-057** Every message a bot reads carries a harness-written provenance label stating who it is from,
  what it is (assignment, consultation, report, question, addition, relayed line, webhook event) and with
  what authority (on the person's behalf at the bot's level, or information only). Model-written text that
  imitates the label is escaped. Outside content (webhooks, app events, guests, web pages) is fenced as
  untrusted data and never carries the person's authority.
- **OMB-058** Each person message carries the current local time; the bot is not expected to know the date
  otherwise.

### 3.2 Context assembly

- **OMB-060** The system prompt is split into a stable half (persona, standing instructions, tool
  guidance) and a volatile half, so provider prompt caches survive between turns. The tool list for a given
  conversation is byte-identical from turn to turn; what a turn may not do is refused at call time rather
  than hidden.
- **OMB-061** Prompt ingredients, in rough order: bot persona and standing instructions; workspace "rules
  for every bot"; the person's "About me"; department shared instructions; reply-style preference; core
  memory (first 200 lines or 24 KB, whichever is hit first, with a note if cut); topic index (≤40 topics or
  2,000 chars); skills index (≤30 skills, ≤4,000 bytes, with a note of how many were left out); list of
  names (never values) of saved logins and secrets the bot may use; description of the active computer and
  how to use it; connected-apps guidance; custom MCP guidance; teammates and how to mention/hand off;
  active routines summary; recent-work brief (last 48 h, ≤10 lines, ≤1,400 chars); room bulletin and member
  list when in a room.
- **OMB-062** Automatic recall: before a turn, a person message of ≥8 characters searches the bot's topic
  notes and (only in a private chat the person started) the bot's other conversations. Any matching content
  word counts; a query with ≥5 content words needs two matches per hit. Up to 4 note passages and 4
  conversation passages, numbered and dated, total ≤6,000 chars, are placed in front of the message (not in
  the system prompt), prefaced by a notice that these are the bot's own notes and that instructions inside
  them are not commands. Core memory, archive and daily logs are never auto-recalled. Rooms, routine runs
  and bot/webhook-started turns recall notes only.
- **OMB-063** When an engine session cannot be resumed (model/engine switch, rewind, crash, new process),
  the host rebuilds context from the stored transcript: a bounded replay (default ≈24 KB) of recent
  messages, at most 20 tool lines each ≤120 chars, plus a summary (≤6 KB) of older history.
- **OMB-064** Compaction: when context approaches the model window (default window 128k tokens when
  unknown; rooms compact a member at 90% fill) older history is folded into a summary marker shown in the
  transcript; the person can also trigger it. If the engine cannot write the summary cheaply, an optional
  helper model does, else an excerpt-based summary is kept. A context-fill indicator and a warning are shown.
- **OMB-065** Room turns give a member only what it has not yet seen since it last spoke (≤12 messages,
  ≤4,000 bytes delta), plus the bulletin, not the whole room history; teammates read only each other's
  final replies, never working notes.
- **OMB-066** Oversized tool results are truncated to a preview with a notice; the remainder is spilled to
  a short-lived store the bot can page through (≤16,000 chars per read; expires after one hour or on
  restart). A per-MCP-server result budget is configurable.
- **OMB-067** Optional prompt-cache keep-warm: for an idle thread the host can ping the engine within the
  provider cache window (configurable ≥15 minutes) and report read/write/cost; off by default.

### 3.3 Tool calling, selection and gating

- **OMB-070** Tool sources per turn: the engine's native tools; the host's own "team" tools (§4); computer
  / browser / phone tools for the active surface; connected-app tools; custom MCP servers assigned to the
  bot.
- **OMB-071** Per-bot tool selection: "all current tools", or custom allow list and/or exclude list of
  selectors (`native:<name>`, `mcp:<server>:<tool>`, whole-namespace wildcard only; ≤256 selectors of ≤1,024
  chars each). Exclude always wins; an empty allow list means no tools; an unknown name selects nothing.
  Multi-action tools expose per-action selector names. Changes apply next turn. If an engine cannot
  enforce a restriction the turn is refused with a setup error rather than silently unrestricted.
- **OMB-072** Optional "tool bridge" for small-context models: list only a short core set plus a search
  tool (returns top-3 matches with full schema, word-based matching) and a call-by-name tool. Calls through
  the bridge pass exactly the same checks as direct calls and are displayed under the real tool's name.
  Default off except for local models; never used where any party decides by tool name (bots with a tool
  selection, engines with their own permission rules).
- **OMB-073** All host-tool calls go through a per-turn capability token bound to bot + thread; a tool call
  timeout budget of ≈120 s (computer file copies up to ≈9 min; configurable per MCP server).
- **OMB-074** Host tools declared read-only carry read-only/idempotent metadata. Third-party servers'
  claims of being read-only are never trusted for skipping approval.

### 3.4 Concurrency, queueing, steering, cancellation

- **OMB-080** A bot may run several threads at once (default 3 including threads waiting on the person;
  hard maximum 16; default scales with RAM). Parallelism beyond that comes from more bots.
- **OMB-081** Shared physical resources (one desktop, one browser session, a shared project folder) are
  never driven by two turns at once: a turn that needs a busy resource waits visibly ("waiting for the
  computer") and is told about contention; it is not failed.
- **OMB-082** Sending to a busy thread queues the message (shown above the composer; each can be edited or
  removed) and delivers it when the turn ends. A second Enter within a short window "steers": the text is
  injected into the running turn without killing it, where the engine supports it. Steering has three
  outcomes (steered / refused / indeterminate); refused falls back to the queue.
- **OMB-083** Stop on a thread aborts the running turn, closes its open cards as "stopped", cancels work it
  handed out that has not started, lets already-running children finish and report, and never resumes the
  stopped requester. Stop is recorded with who pressed it.
- **OMB-084** In a room, a person can pause one member ("stop @Bot") — its running turn ends and it is
  skipped until addressed again or resumed — or pause/resume everyone.
- **OMB-085** Editing an earlier message forks the conversation: a new branch is created, the abandoned
  branch remains reachable, and the next turn must not resume the engine's stale native session.
- **OMB-086** A person's direct message outranks background work on the same bot.
- **OMB-087** Idempotent sends: a client-supplied send id deduplicates retries.

### 3.5 Retries, stalls, recovery

- **OMB-090** Transient provider failures (network drop, overloaded, 5xx, short rate limit) are retried up
  to 3 attempts with backoff ≈1 s / 3 s / 8 s and a visible "retrying" event; authentication,
  configuration, no-route-to-model and usage-limit errors are terminal and explained in plain words with
  the next action.
- **OMB-091** Watchdog: a turn with no activity for the per-thread/room timeout is ended as stalled;
  machine sleep is not counted as a stall (monotonic clock; several suspended sweeps are tolerated); a tool
  visibly in flight counts as activity; a first-reply-is-slow notice appears after a threshold.
- **OMB-092** Restart policy at boot: queued work dispatches; a turn that was running with no hand-offs and
  no known outward action is re-run exactly once with a note to check what it already did; a turn that had
  already acted outward (sent, posted, pushed, paid — judged from recorded tool activity, never from model
  text) is failed as interrupted and never re-run; a turn with running children becomes "waiting" and its
  resume says it was cut; work parked on the person stays parked and its card is not re-posted.
- **OMB-093** Usage-limit failover (on by default): when a turn ends on a subscription limit, the same
  message is re-sent on another eligible engine (same engine's default model first for a model-only limit,
  then the bot's backups, then the workspace default), only engines that can run now and satisfy the same
  tools/folder/approval level, never a second login to the same subscription. The limited engine is held
  until its stated reset (or 1 hour if unknown; a single model ≤6 h). The person is notified once per limit
  stretch; the thread returns to its engine after reset with one line saying so. With nothing to fail over
  to, the bot waits. Holds persist across restarts.
- **OMB-094** Signed-out engine: same failover if a backup exists; otherwise a sign-in prompt and one
  notification per bot and cause.
- **OMB-095** A thread whose own model becomes unusable falls back to the bot's model permanently with one
  explanatory line.

### 3.6 Model and provider selection

- **OMB-100** Model is chosen per bot and optionally per thread (engine instance + model + effort/variant).
  Changing a bot's model moves all threads that follow it; threads with their own model keep it (with a
  one-shot "switch them too"). Switching model mid-conversation preserves context via rebuild (OMB-063).
- **OMB-101** Model picker groups by provider, marks defaults, dims unavailable providers with the reason
  (not installed, signed out, not allowed, limited) and separates cloud agents from local models.
- **OMB-102** Engines are auto-discovered (PATH, common install locations, login shell); an explicit binary
  path per engine is supported; engines can be installed/updated from the app; unknown or broken drivers
  degrade to "unavailable" without affecting others.
- **OMB-103** Supported engine families (behavioural classes): (a) full agent CLIs with native sessions,
  native permission modes and sub-agents; (b) agents speaking the Agent Client Protocol over stdio — one
  process per thread, reused across turns, closed after 10 minutes idle; (c) OpenAI-compatible /
  Anthropic-compatible / other chat endpoints incl. local servers, driven by the host loop; (d) user-defined
  engines via config (any ACP CLI or compatible endpoint).
- **OMB-104** Engine capability flags drive behaviour instead of engine names: keeps a native session; has
  a native automatic reviewer; supports "accept edits"; has a step cap; supports sub-agents; supports
  steering; has a cheap one-shot text call.
- **OMB-105** One-shot text generation (titles, memory upkeep, summaries, setup suggestions, skill review)
  uses the bot's own engine when it has a cheap call; otherwise an optional, explicitly configured
  workspace **helper model**; a bot can opt out of the helper. Text never goes to a provider other than the
  bot's own without that opt-in.
- **OMB-106** A separate, optional fast **decision model** answers typed multiple-choice questions with
  probabilities in a few hundred ms (used for room routing, inbox triage, and as a bot tool). It never does
  work, always fails open (timeout 1.5 s, any error → previous behaviour), acts only at probability ≥0.6,
  validates every answer, and logs provider, choice, probability, latency and a state hash — never text.
- **OMB-107** Workspace default model applies to new bots; "automatic recovery" names a workspace backup
  engine.

### 3.7 Engine adapter contract (behavioural)

- **OMB-110** An engine adapter MUST offer: start a turn (thread, text, images/video, model, approval level,
  working folder, system prompt, MCP servers, resume cursor); interrupt a turn; answer an open request
  (allow once / reject / answer / unavailable); report whether a native session exists; stop everything;
  emit canonical events. It MAY offer: steer; keep-warm ping; idle compaction; one-shot text generation;
  permission review; snapshot (installed, version, auth, models, plan limits); authentication start/status.
- **OMB-111** Fail-closed approvals: a request with no reachable answerer resolves as "unavailable", never
  as allowed; cancellation closes all outstanding requests so stale cards cannot be answered later.

### 3.8 Work hand-off runtime (assignments)

- **OMB-120** One record, one lifecycle and one wake mechanism cover every hand-off regardless of origin
  (chat, room, routine, webhook, goal run, external runtime, one-way notice, consultation). Every turn is
  the root of a tree; hand-offs are children.
- **OMB-121** Lifecycle: queued → running → (completed | failed | cancelled); running → waiting (it handed
  out work) → resume once all children settled → running; running → needs-input (question or card) →
  running on answer, or failed/expired when a bounded wait runs out.
- **OMB-122** Enqueue checks: parent is running; no hand-back to an ancestor (exception: a bot may open a
  new thread on itself once); duplicate briefs to the same assignee from the same parent are rejected
  unless flagged as rework; depth and per-root budgets hold. Refusals are typed results returned to the
  calling bot, never exceptions.
- **OMB-123** Identical concurrent requests (same normalised words, ≥40 chars, same mode/level/criterion)
  to the same bot from two conversations visible to the same people may share one answer.
- **OMB-124** Access is re-validated before each dispatch and on every tick; access revoked mid-work ends it
  as failed/refused and withholds the result.
- **OMB-125** Wake rule: the requester is resumed by its own follow-up turn carrying all settled children
  at once, only when idle, only on terminal outcomes / needs-input / stall, never on progress, at most once
  per result. A child's typed question interrupts the parent's wait once so the parent can react.
- **OMB-126** Terminal outcome is written exactly once and reported exactly once. One-way notices are never
  awaited. Cancel cascades down the tree.
- **OMB-127** Budgets per root, renewed only by durable progress: number of requests, executions, wakes (a
  fan-out to several teammates counts once). Clocks: queue bound (never started → expired); per-root stall
  window; per-turn activity window. Time parked on the person is charged to nothing; handed-off work parked
  on a person expires after 3 days with one reminder after 1 day; a root parked on its own cards never
  expires.
- **OMB-128** Level rule: effective approval level = max(assignee's own, inherited). Inheritance happens
  only from a Chief-of-Staff conversation in work a person or their routine started, flows down every hop,
  only raises, is capped by what the assignee's engine supports, is computed once at enqueue and recorded.
  Ordinary bot-to-bot hand-offs use the recipient's level. Consultations carry no level.
- **OMB-129** Every delegated turn opens with a harness-written envelope built from stored data: assignment
  id, who asked, the person's quoted request (≤400 chars), the level and that nothing within it needs
  confirmation, how to ask the person (structured question tool for set choices; a marked needs-input
  block with an optional default otherwise). Reports back include what the harness observed, with advice to
  verify claims against evidence.
- **OMB-130** At the most permissive level, in person- or routine-started work, a child's answerable
  question goes to its requester bot rather than the person; if unanswered it proceeds with its stated
  default. Questions involving sign-in, codes, payments, secrets or the person's own account always go to
  the person.
- **OMB-131** Invariants an implementation should test: no live assignment without an owner; exactly one
  report per resumable terminal assignment; no result delivered twice; every root ends; expired is never
  reported as approved; the level run equals the level recorded; every status change has an event; a cut
  turn is re-run at most once; the runtime never throws into a turn.

## 4. Tool / capability catalogue (host-provided tools available to bots)

Names are ours. "Chief only" = offered to lead bots. Each takes effect immediately unless noted.

**Team coordination**
- **OMB-150 Discover teammates**: list every reachable bot (department, model, status) and every room the
  bot belongs to with members; a combined "targets" listing with roles and working folders.
- **OMB-151 Hand off / ask**: send work or a question to one or more bots; options: room target, standing
  work thread vs new thread vs a thread it opened earlier, title, run in my folder, reply mode (resume me /
  none), consult-only, completion criterion, rework flag, answers to a child's pending question.
- **OMB-152 Assignment status**: read one assignment or everything this conversation still awaits
  (long-pollable by external runtimes).
- **OMB-153 Own threads**: list own threads and threads opened on teammates with state; open a separate job
  on itself (title, message, folder, optional other model, report-back); close a finished thread (leaves
  default list, nothing deleted); post an informational message into an open thread with optional wake.
- **OMB-154 List models** it may use for self-threads, with reasons for unusable ones.
- **OMB-155 Burst**: propose splitting one job into many independent items run in parallel self-threads
  with one merged result; a card previews the plan and nothing runs until the person confirms. Limits:
  ≤200 items (≤10 on a small plan), parallelism 10 (2 on a small plan), item ≤2,000 chars, instructions
  ≤12,000, merged result budget ≈150,000 chars, ≈3 min estimated per item, 5 start attempts.
- **OMB-156 Post to room**: put one message (optional voice note, mentions) in a room without starting
  anyone's turn. Rate-limited: ≤10 posts/minute per sender, duplicate suppression within 60 s, a
  circuit-breaker with 5-minute cool-down on ping-pong loops.
- **OMB-157 Message a person**: deliver a note to a named person's inbox; their answer returns to the
  conversation (≤10 messages/hour per conversation).
- **OMB-158 Chief only**: create a specialist bot (≤4 per turn; name, role, instructions, optional copy-from,
  model, folder); list team setup options and exact model ids; browse a library of ready-made teams;
  submit one combined team-setup plan (create/configure/move/appoint); request deletion of a named bot
  (separate, explicit); create/rename/re-member rooms and edit bulletins (≤4 rooms per turn); retry a
  teammate's failed or stalled thread where it stopped.

**Memory and recall**
- **OMB-160 Update core memory**: append one dated, sourced entry (≤1,000 chars, ≤20 lines), replace an
  exact passage, or supersede a changed fact (struck through, kept); optional expiry date.
- **OMB-161 Write daily log**: one timestamped event line ("what happened", not "what is true").
- **OMB-162 Search own history**: full-text search over own conversations, joined rooms, memory files and
  accepted team notes with date range/scope; read a specific hit in context. Never other bots' private
  history; reads from a private chat into a room are audited as disclosures.
- **OMB-163 Save team memory**: add a shared fact/decision for the department (applies with Undo).

**Self-configuration (apply at once with an Undo receipt)**
- **OMB-165** Change own profile (name, title, description, standing instructions, working folder,
  notification and speak toggles); a Chief may do this for a teammate.
- **OMB-166** Switch own default engine/model (result warns about gained/lost capabilities).
- **OMB-167** List skills; create/update/enable/disable/delete own skill (only when the person asked).
- **OMB-168** Manage MCP servers: list, add, enable, disable, restart, test, update, sign in/out, remove —
  only for a server the person asked for.
- **OMB-169** Read/change app settings: search settings, read one with allowed values, set (safe ones apply
  with Undo; secrets open a secure card).

**Automation**
- **OMB-170** Trigger info: list own schedules, app events and webhooks with next run/last fire/problems and
  the authoritative current time and zone; discover available app events.
- **OMB-171** Trigger manage: create/update/pause/resume/run-now a schedule, webhook or app-event trigger
  in the same turn the person describes it, with no confirmation; delete only on request (separate tool).
- **OMB-172** Wait-until: register a plain-code watcher (OMB-036) that tells the person in this chat when a
  condition holds; list and cancel waits. Limits: 10 per bot, 50 total; checks every 5 s (URLs every 60 s
  with backoff to 15 min).

**Person interaction**
- **OMB-175 Ask the person**: structured questions (≤6 per call, ≤12 options each, single or multi-select,
  free-text allowed ≤2,000 chars) rendered as a question card; the turn waits.
- **OMB-176 Show widget**: a small declarative interactive card (buttons, pick-one, prefilled form, live
  status) that can be updated in place; answer comes back as the person's reply.
- **OMB-177 Show mini-app**: a self-contained HTML/JSX page rendered sandboxed in the chat, updatable in
  place, where the person can point at an element to request a change.
- **OMB-178 Attach file**: attach a produced file (image, video, audio, PDF, sheet, deck, document) to the
  reply with preview/download.
- **OMB-179 Voice note**: synthesize a short spoken message with the bot's voice; attached at turn end with
  its text as caption/transcript.
- **OMB-180 Generate image**: one image per call via the configured image provider (base + optional
  backup); ≤4 per reply by default (1–10), ≤50 per day per installation; only in person-started work.
- **OMB-181 Request credential**: open a secure card for a host-kept key or a named secret (OMB-235).
- **OMB-182 Request sign-in**: ask the person to sign in on the bot's browser/computer (OMB-236).
- **OMB-183 Fill saved login**: have the host type a saved login (and one-time code) into the current page.
- **OMB-184 Report a bug** to the maintainers with diagnostics (only when the person explicitly asks).

**Computers and files**
- **OMB-185 Select computer**: inspect available places and choose where this conversation does computer
  work (or "auto"); only on a person's own message.
- **OMB-186** List shared computers / use a shared computer: file read/write/edit/append/delete inside
  explicitly lent folders (hash required to overwrite; ≤256 KiB per write), run a command, call a tool on it.
- **OMB-187** Run a shell command in the bot's own container desktop (exit code, stdout, stderr; timeout).
- **OMB-188** Copy one file between the cloud desktop and the working folder (≤2 GiB, ≤9 min, refuses if
  disk would have <256 MiB free); background command execution with status polling.

**Publishing, data, research**
- **OMB-190** Publish/unpublish a page or small static app to a public link (≤5 MB; same path updates same
  link); check included hosting quota. Only on explicit request.
- **OMB-191 Data tools**: describe, query (SQL) and show tabular results/charts in a data tab of the chat.
- **OMB-192** Typed extraction (read named fields from text or an image; null when absent) and typed
  decision questions via the helper models.
- **OMB-193** Paid read-only research: search posts on a social network; search a catalogue of research
  endpoints, read one, call one (each call reports its cost).
- **OMB-194** Usage limits: read each AI account's percent used and reset time (no credentials).
- **OMB-195** Meeting tools: join an online meeting from the cloud desktop, take notes, answer in meeting
  chat, leave (OMB-296).

## 5. Computer / desktop control

- **OMB-200** Each bot has a "works on" setting: Off, Auto, This computer, Private desktop (container on
  the same machine), Cloud desktop, Own server (container over SSH), plus a built-in browser. Placement is
  explicit per bot and independent of its model. Auto may reuse an already-ready backend but never
  silently provisions one or turns on host control.
- **OMB-201** Computer tools offered on a surface: screenshot, zoom, click/double/right click, drag,
  scroll, type, key press, batch of actions, status, run command, request human help. Browser tools:
  navigate, back/forward, read page as text, accessibility snapshot, click, hover, type, fill, select,
  press, scroll, drag, wait-for, dialogs, downloads, file upload (≤100 MB), tabs, screenshot, request
  takeover. Phone tools (Android over USB debugging): screenshot, read screen, tap, tap-by-text, type,
  swipe, press, list/open apps, batch.
- **OMB-202** Screenshots taken by the bot are folded into the transcript as collapsible frames and stream
  to a live Screen panel while the bot works. Preview is not permission: watching never grants control.
- **OMB-203** Take control / hand back: a person can take interactive control of a bot's desktop or browser
  (in-app remote viewer; browser fallback); while held, the bot's actions are refused and it waits. Only
  one viewer pane holds control at a time. The bot can also *request* help; the person gets a card with
  Open and Done.
- **OMB-204** Host-desktop control is gated: explicit opt-in, OS accessibility/screen-recording permission
  owned by the app, one certified native driver bundled and version-pinned with the release (never
  downloaded at runtime), disabled on platforms where the safety boundary is not certified, and a separate
  warning when combined with the most permissive level.
- **OMB-205** Container desktop: per-bot or shared mode; max instances configurable (e.g. 2); 4 GiB RAM / 2
  CPUs default (2–128 GiB, 1–64 CPUs); durable workspace + browser profile mount survives recreation;
  ownership via renewable lease; image/safety contract validated before reuse; no host mounts beyond the
  workspace; no published ports.
- **OMB-206** Cloud desktop: provisioned on first open of the Computer panel; sleeps after 10 minutes with
  no bot turn, viewer or holder; stays awake if a routine using it is due within 30 minutes or a background
  command is running (≤2 h); wakes on demand. Creation is idempotent and deletion journaled.
- **OMB-207** Own-server desktop: host drives Docker over an SSH alias; viewer through a temporary SSH
  tunnel to a random loopback port; auto-start is a per-bot opt-in.
- **OMB-208** Lazy claim: under Auto, computer tools are listed without claiming a seat; the first
  screen-touching call claims it, waits visibly if another thread holds it, and fails honestly (not as
  contention) if the computer died.
- **OMB-209** "Ask for the person's computer" card: when work needs the person's screen, folders or
  terminal and it is unavailable, a card states the need and the reason (paused, starting, permission
  missing, blocked, off, app not running, unsupported, terminal off, app closed, never set up, needs
  update) and offers to turn it on from here or to install/open the app; states: asking, turning on, on,
  failed, declined, ended.
- **OMB-210** Lending a computer to a remote workspace: the person lends specific folders (read-only by
  default, optionally editable) and capabilities (screen, terminal); never the home folder root, drive
  roots, key/settings folders or the app's own data. While the computer is away, reads are answered from a
  synced copy (≤3 GB per folder) and writes are staged and applied on return only if the person did not
  touch the file; the person's computer always wins conflicts; mass deletes (≥10 files and ≥20% of folder)
  ask first.
- **OMB-211** Sandbox for hosted/multi-tenant use: each bot turn (engine, its shell commands, MCP servers)
  runs in an unprivileged sandbox that sees only the image read-only, the turn's working folder and the
  bot's own folder, a private temp and process namespace, and loopback-only networking with two bridges:
  an egress proxy that resolves names itself and refuses private/link-local/metadata addresses, and a
  harness gate exposing only internal per-turn-token routes. Provider keys are replaced by per-process
  tokens pointing at a credential broker that injects the real key toward a fixed upstream. A boot
  self-check runs hostile probes and reports pass counts.
- **OMB-212** Optional recording of browser steps as reusable "saved steps" a bot can replay.

## 6. Rooms and multi-bot collaboration

- **OMB-220** A room has members, a default responder rule and a bulletin. Rule options: a named lead
  answers un-mentioned messages; everyone answers; only mentioned bots answer; automatic routing by the
  decision model (one bot at p≥0.6, or "several" → everyone, else fallback lead). The routed reply shows a
  small attribution with provider and probability. New rooms default to automatic routing when available.
- **OMB-221** `@Bot` mentions address specific members; `@everyone` addresses all; mentions chain (a
  mentioned bot can mention another). People appear in the mention list on team workspaces.
- **OMB-222** Members take turns serially by default (one working at a time, visible queue with positions);
  optional parallel mode runs members side by side each in its own thread. A member busy elsewhere joins
  when free (bounded wait, with a visible note), never silently skipped.
- **OMB-223** Each member keeps its own engine session, model, level and context fill; the room shows a
  per-thread cost/tokens badge and per-member context gauges.
- **OMB-224** Rooms contain multiple threads (new thread in the room starts fresh context for all members).
- **OMB-225** When a bot fans out the same request to several members the room shows one shared message
  addressed to them; different requests remain separate.
- **OMB-226** Work for a non-member goes to that bot in its own thread; the room shows a "sent to X" line
  and the answer when it returns.
- **OMB-227** Goal mode: a message sent as a goal starts a bounded multi-turn team run (default cap 13
  member turns) coordinated by the lead; a live goal card shows progress and ends as achieved, limit
  reached, stopped or failed; busy members are waited for (≤30 minutes, three exhaustions end the run); a
  routine may trigger a goal; goals are durable across restarts only as records (a cut run ends).
- **OMB-228** One-to-one goals: a standing objective on a single bot with per-turn verdict
  (done/continue/wait), a turn budget with auto-pause, and pause on any person message.
- **OMB-229** Cards raised by a member park only that member; the room keeps taking messages. Widgets,
  mini-apps and waits are not offered inside rooms.
- **OMB-230** Direct bot-to-bot channels exist (not listed as rooms) and are visible to the person as
  identifiable peer exchanges.
- **OMB-231** Department lead ("Chief of Staff"): hears about its bots' incidents, may retry their work,
  proposes/applies team setup, answers teammates' answerable questions on the person's behalf (marked as
  such; the person's own answer overrides), and is the person's inbox on team workspaces. At most one per
  department; an absent chief is surfaced in rooms.
- **OMB-232** Team workspaces: every bot reports to one person; that person receives its questions,
  approvals, failures and routine results in a single inbox with tabs "needs you / for your info / done";
  answering in the inbox answers at the source; counts appear on the person's row, app icon and tab.
- **OMB-233** Reactions: 👍/👎 on a bot message count as yes/no answers to it (and allow/deny on an open
  approval card); other reactions are informational and read with the next message.

## 7. Memory and skills

### 7.1 Memory

- **OMB-240** Memory is plain markdown in the bot's private workspace, editable by the person in any
  editor; an in-app Memory panel shows the files, a budget gauge (amber from 80%, red when something no
  longer loads, with the count of unloaded lines), a conflict-safe editor, and a journal with one-click
  undo. Per-bot master switch (on by default) disables loading, recall, upkeep, memory tools and logs.
- **OMB-241** Writes via the host are atomic, owner-only, and credential-shaped text is redacted before
  reaching disk. Entries are dated and sourced ("from chat X", "noticed", "learned by Bot").
- **OMB-242** The core file never overflows: each host write keeps it within budget by moving oldest dated
  entries to the archive (superseded first, then expired, then oldest), archive written first; hand-written
  undated lines, health/safety facts and the just-written entry never move; the bot is told what moved.
- **OMB-243** Entries may carry an expiry date; expired entries stop loading the next day.
- **OMB-244** Upkeep (per bot, on by default): **capture** — after 2 minutes of quiet or 6 turns in a
  private chat, one cheap model call files new durable facts; personal facts require a supporting quote
  from the person's own words (questions, tasks and hypotheticals are never facts); core facts go to the
  core file, the rest to topic files (created with title/aliases). **Organise** — moves subject detail from
  core to topic files (≤20 lines per pass), never moving rules ("always/never/from now on…") or
  health/diet lines. **About me** — lasting facts about the person are added to the workspace profile with
  attribution and a Remove that prevents re-adding. **Nightly tidy** (after 03:00 or next wake, never while
  working): archive expired, dedupe exact duplicates, and strike through the older of two contradictory
  entries (≤1/5 of entries per pass; none in files with <5 entries). Every change is journaled and undoable.
- **OMB-245** Room learning is a separate opt-in: another person's lines yield only shared-work facts,
  another bot's lines only verified outcomes or person-approved decisions.
- **OMB-246** Pending captures at shutdown are kept as ids (≤50 chats) and processed at next start.
- **OMB-247** A "this bot loads a lot every turn" hint appears when always-loaded text exceeds 24 KB with ≥8
  KB of memory, offering tidy-up.
- **OMB-248** Routine runs and read-and-draft runs load/capture nothing personal unless continuity is on.

### 7.2 Skills

- **OMB-250** A skill is a named folder with one instruction document (frontmatter: name, description,
  optional license/compatibility/tags) and optional reference files. Skills are instructions, never
  permissions.
- **OMB-251** Only enabled skills participate; each turn the bot sees an index (name, one-line description,
  path) and reads the body on demand.
- **OMB-252** Bots may author skills (on by default): on request, or via a `/learn <description>` command
  that turns the current conversation into a skill. Changes apply at once and show as one line with Details
  and Undo.
- **OMB-253** Automatic skill review (off by default): after N tool steps in a conversation (configurable
  3–100) a background review may create/improve ≤3 skills; ≤3 failed attempts; counts toward spend.
- **OMB-254** Imported skills arrive switched off; text is scanned for a few risky patterns (download piped
  to shell, long encoded blobs, invisible characters) and flagged as advice, not blocked.
- **OMB-255** Optional shared skills library: import by pasting text (no network fetch), enable once, assign
  to bots or to every bot; sharing of learned skills with the department: off / ask / automatic.
- **OMB-256** Bundled starter skills cover: building dashboards/pages, previewing social posts per
  platform, publishing a site, driving an Android phone, diagnosing phone connectivity, writing a
  verification skill for a project.
- **OMB-257** Slash commands in the composer include setup, learn, goal and burst.

### 7.3 Packages, presets, sharing

- **OMB-260** A department can be exported as one file: bots (profile, instructions, look, downscaled
  picture), skills (text only; ≤30 per bot, ≤60 per team), playbooks, rooms, shared instructions, routines,
  chief assignment, connection slots (addresses and required key *names* only), optional starter notes. It
  never contains chat history, keys, model choices or computers, and secret-looking text is stripped. The
  export dialog shows exactly what is included.
- **OMB-261** Import shows a review screen first; imported bots arrive with skills off, routines paused,
  connections off and no app grants. A portable markdown-with-frontmatter team format and URL import are
  supported.
- **OMB-262** Presets: allow-listed starting roles (name, description, instructions, look, playbooks,
  skills, starter notes) selectable when adding a ready-made bot; a preset can never set model, folder,
  computer, level, apps or routines.
- **OMB-263** "New bot" creates instantly from saved defaults (unique name, default model) and opens its
  chat; the bot offers to set itself up by asking questions in chat. Duplicate, archive, hide, reorder and
  bulk-select are supported.

## 8. Automation

- **OMB-270** A trigger is "when X happens, bot does Y". Bots create triggers conversationally in the same
  turn; the chat shows a live card with the rule, timezone, next three dates, Edit, Pause, Undo.
- **OMB-271** Schedules run inside the app (no external scheduler): the app must be running. On desktop it
  may prevent idle sleep for the hour before a due run while on power. Finest resolution one minute.
- **OMB-272** Cron semantics: five fields, explicit IANA zone, lists/ranges/steps/last-day/nth-weekday;
  non-existent dates skipped; DST gap moves forward; repeated hour runs once. Interval schedules stay
  aligned to their start and skip an occurrence if the previous run is still active.
- **OMB-273** Catch-up: an occurrence missed by ≤12 h runs once; older ones get a "missed" receipt; no
  replay of every missed tick; no overlapping copies of the same routine.
- **OMB-274** Each run works in its own hidden thread; only the result is posted to the destination thread
  (default: the bot's main thread) with a line naming the routine; a "nothing new" run posts nothing and
  notifies nobody. Results never interleave a live exchange. "See run" opens the hidden thread.
- **OMB-275** Unattended recovery: one automatic retry in the same conversation after 15 s (60 s after a
  rate limit) with a note to check prior effects; a busy bot is waited for (poll 30 s, ≤1 h); usage limit
  with a known reset ≤12 h reschedules just after reset; hard causes (signed out, no credit, setup) notify
  once per bot and cause. Run log shows what happened; each routine shows "N of M OK this week".
- **OMB-276** A run that needs approval or an answer waits (not counted against its time limit), names the
  routine in the notification, and gives way to the next occurrence.
- **OMB-277** Pre-model checks: a routine may declare plain-code checks (calendar next 36 h, new mail since
  cursor, other routines' finished runs); a quiet tick starts no model turn. Reliability rules: failed read
  is never "nothing new"; exponential backoff 15 min → 4 h; ≤24 model runs per 24 h; first checks 2 min
  after boot; cursor advances only after the answer is kept.
- **OMB-278** Read-and-draft access profile: a run that may only read specified apps and create drafts;
  every other request is refused outright; no web, computer, memory or skills.
- **OMB-279** Built-in proactive routine ("watch my day"), created once on personal installs with connected
  apps: one daily brief card edited in place (needs you / your day / important emails with why + draft
  reply + dismiss / other routines), meeting-prep card within 4 h of a meeting, 10-minute reminder; the
  brief is never posted empty; opens on first open of the day or after 3 h away; pausing the routine is the
  off switch. Inbox triage uses helper models when available.
- **OMB-280** Webhooks: a dedicated receiver on its own port exposing only health and secret hook paths;
  secret shown once; bearer auth preferred, capability URL fallback; payload ≤48,000 chars, rate-limited per
  minute; event content is fenced as untrusted. A bot never sees its webhook's secret unless it owns the
  trigger and the conversation qualifies.
- **OMB-281** App events: connected-app events are queued by a relay service and long-polled by the server
  (no public address needed; queue kept up to 7 days); ≤3 waiting runs per automation with ≤20 events each;
  each event runs once (id dedupe); daily caps (e.g. 500 desktop / 2,000 paid); polled apps checked every 15
  minutes; expired connections show as "needs you".
- **OMB-282** Automations page: list of all schedules/webhooks/app events with on/off switch, calendar
  (day / 3-day / week, filter by bot), run logs. One-time past schedules read "done" with no switch.
  Deleting a bot deletes its triggers.
- **OMB-283** Per-bot inbound API (off by default): POST a message with a per-bot key → reply text + thread
  id; optional continue-thread and wait seconds (default 50, max 300); returns "working" or "needs
  approval" when not finished; limits: message ≤20,000 chars, body ≤256 KB, 10 calls/min per key, 50
  concurrent; key shown once, stored hashed, rotatable.

## 9. Question / approval cards and permissions

- **OMB-290** Four approval levels per bot and per thread: **Ask** (commands and edits need approval),
  **Auto-accept edits**, **Approve for me** (engine's automatic reviewer decides routine actions), **Full
  access** (default; engine's most permissive mode; residual prompts auto-answered). Plus a "custom"
  pass-through of the engine's own config, settable only from the local desktop. Each level maps to the
  engine's native mode; the host never silently substitutes a more permissive mode.
- **OMB-291** Level changes apply immediately (no confirmation); mid-turn they affect host-gated calls from
  the next call and native-mode engines from the next request/turn. Bulk "set for all bots in department"
  previews per-bot outcome and skips incompatible or busy bots with reasons.
- **OMB-292** Approval card: shows the action and scope; actions Allow once / Deny / Always allow this
  session (hands the engine its own remembered rule, or the host remembers for exact bot + tool + server
  config until restart). For read-shaped tools of a configured MCP server an explicit standing "Always
  allow" exists (exact bot, server, tool, config; invalidated by any config change; revocable in settings;
  never offered to guests or for write/computer tools). Exact shell commands can be saved to a per-bot
  allowlist.
- **OMB-293** A bot reading its own files (instructions, skills, memory, conversation folders) with plain
  read commands never asks at any level; anything composite asks as usual.
- **OMB-294** No level answers a question for the person. Question card: 1–6 questions, options with
  descriptions, multi-select, free-text answer, a one-tap default when the bot named one; answerable by
  tap, typed reply, reaction, voice, or relayed by another bot; states answered / dismissed (bot told to
  use best judgement) / stopped / closed / expired.
- **OMB-295** Outbound sends through connected apps (email, messages, posts, payments) follow a per-bot
  "sending on your behalf" setting: ask every time vs send without asking; per-app read/write scopes and
  per-tool grants; ungranted tools are not offered to the model.
- **OMB-296** Meeting attendance: the bot joins as a clearly named note-taker, announces itself in the
  meeting chat before capturing anything (leaves if it cannot), answers `@notes` questions, leaves on
  request, stops after 4 h, and posts notes (summary, decisions, action items, open questions, attendees,
  transcript).
- **OMB-297** Secure credential card: never in chat; host-kept keys saved to settings; named secrets saved to
  an encrypted vault for that bot only, either as a one-use reference usable only by host tools (bot never
  sees the value) or as a file readable by the bot's commands that is deleted after 24 h and excluded from
  backups/exports. Vault suggests a fitting saved secret by name. Paired phones may fill the card.
- **OMB-298** Sign-in card: names the site and the bot's reason; Open (goes to the exact browser/computer
  the bot uses, already in person control), Done (hands back and resumes), Cancel (resumes with a decline),
  Save a login (masked form incl. optional 2FA seed). Saved logins are typed by the host only on that
  login's own site; bots never see passwords or codes, never ask for them in chat, and never enter a code
  anywhere but the site it was issued for.
- **OMB-299** Optional safety floor (off by default): a short never-list (recursive delete of root/home/
  system dirs, disk format/overwrite, fork bomb) that auto-grants cannot approve; unreadable commands fall
  back to a card; a person's explicit Allow still stands.
- **OMB-300** Engine-switch offer card when a limit is hit and several engines could continue.
- **OMB-301** Cards are durable: survive restart without duplicate notifications; Stop marks them stopped;
  a superseded card is marked so; guests/webhook-driven turns on shared workspaces wait for the owner.
- **OMB-302** Decision log: every auto-allow, shown card and answer (with who) is appended, redacted,
  retained ≥180 days (1–3650 configurable), exportable as CSV with formula-injection protection.
- **OMB-303** Roles on shared servers: owner, admin, member, guest, chat-only client; bot visibility
  (everyone / admins / named people); who may answer a card follows who the bot reports to; email-code
  sign-in and invitations.

## 10. Usage metering and budgets

- **OMB-310** Every settled turn appends one usage row (OMB-032) to monthly files; no message text.
- **OMB-311** Chat header chip: cost when the engine reports it, otherwise uncached input tokens (or total
  input); tooltip separates uncached input, cached input and output, and the latest turn; a missing cache
  split is shown as unknown, never as zero. Rooms show the same per room thread plus the latest speaker.
- **OMB-312** Usage history screen: totals for a period grouped by bot, model, person, day, engine, routine
  or department; CSV export one line per turn; also readable via API with inclusive UTC date range (≤1
  year; default month-to-date).
- **OMB-313** Cost sources: engine-reported real cost on metered keys; subscription-equivalent estimate;
  operator price list (per-million input/output/cached) when configured; otherwise absent — sums include
  only reported costs.
- **OMB-314** Plan-limit meters for subscription engines: 5-hour and weekly windows, per-model windows and
  extra-credit balances with percent used and reset time, shown in engine settings and readable by bots.
- **OMB-315** Monthly spend budget: configurable monthly amount and warn threshold (percent); one warning
  alert at the threshold and one at the cap per month; at the cap new turns are refused with a plain
  message. Background jobs (skill review, setup suggestions) count toward spend.
- **OMB-316** Per-turn trace (Advanced inspector): steps and tool calls with start/end, status, error,
  timing source, tokens per step, parent turn — for a waterfall view.
- **OMB-317** Hosted-plan allowance meter: for each included allowance (computer hours, voice characters,
  decisions, research spend, storage) used vs included with a bar (amber ≥80%, red at 100%), reset date,
  shown as a sidebar card only when something is ≥80% (dismissable for the month) and fully in settings,
  with a one-tap upgrade that previews the exact charge before confirming.
- **OMB-318** Other caps: attachments store quota (default 512 MiB; file ≤100 MB, preview ≤25 MB); images
  per reply/day (OMB-180); app events per day; inbound API rate; room post rate; burst sizes.
- **OMB-319** Optional health scanner: an out-of-process, read-only, model-free job that groups failed tool
  calls, failed turns and long queue waits into deduplicated issues with normalised titles (no raw content).

## 11. Integrations, channels, relay

- **OMB-330** Connected apps via one aggregator (Composio-style sessions): marketplace of hundreds of apps;
  OAuth in the person's normal browser; multiple labelled accounts per app with explicit account selection;
  disconnect per account; either the person's own project key or an included managed service; connector
  cards in chat prompt a missing connection mid-task and resume after connecting.
- **OMB-331** Custom MCP servers: add by pasting a URL, a CLI add-command, an `npx`/`uvx`/`docker run` line
  or a JSON block; the app derives name/transport/headers/env and asks only for missing values
  (placeholders are never saved as written); the server is test-connected (handshake + tool list) before
  being switched on; clear failure states (keys refused → fix keys; unreachable → try again; OAuth → open
  sign-in); per-bot assignment; applies next turn without restart; per-server call timeout and result
  budget; OAuth discovery and token storage.
- **OMB-332** The product itself exposes a stdio MCP server for external clients: list bots/rooms with
  activity, read/search bounded transcript pages (no image data), create/edit bots, rooms and threads, send
  work, wait for settle-or-needs-help, interrupt, list models, switch an idle bot's model. It cannot
  approve requests, grant permissions, delete data, change credentials or manage computers.
- **OMB-333** Scripting CLI: apply a team from a file, set engine keys from env, run a bot with a prompt and
  wait until it and every teammate it asked are done, export produced files, pair, list/revoke devices,
  doctor; `--json` output and meaningful exit codes; works against local or remote servers with a token.
- **OMB-334** Phone/remote access options: same-LAN, tailnet, own HTTPS reverse proxy/domain, managed
  tunnel, or an end-to-end encrypted relay (server dials out; relay forwards sealed bytes it cannot read;
  no open port or domain needed). Pairing by QR with a high-entropy single-use credential (2-minute
  validity) plus 6-digit fallback; device tokens stored as digests; revocable device list.
- **OMB-335** A companion sidecar fronts the loopback-only server for devices: default-deny allowlist per
  method/path, response scrubbing (engine session ids never leave), computer view/control as a separate
  per-device capability off by default, local-network discovery by name, and an encrypted envelope for
  filling one pending credential card from the phone.
- **OMB-336** Native phone apps and an installable web app share the same chat, cards, inbox, notifications,
  voice and live screen view; desktop-to-desktop client mode pairs one desktop to another host.
- **OMB-337** Voice: text-to-speech providers (hosted keys or local server or OS voices) kept server-side;
  per-bot voice; speak-on-demand per reply; auto-speak; replies are rewritten into speakable text (code,
  paths, tables dropped or named) and split into utterances fetched ahead. **Call mode, take-turns**:
  half-duplex with silence endpointing ≈1.7 s, tool activity narrated, approvals read aloud and accepted
  only on an unambiguous yes/no, questions answered by the next spoken turn. **Call mode, live**: a
  realtime voice model speaks as the bot while each request goes to the bot as a normal message marked
  "via call"; interruptible; call bar with captions, mute, hang-up; auto hang-up after 5 minutes of
  silence; a call record row is kept in the chat. Dictation in the composer.
- **OMB-338** Image generation providers (base + backup), model lists, test button; avatars use the same.
- **OMB-339** Email mailbox connection (IMAP/SMTP-style via credential card), calendar reads, social
  scheduling connector, 1Password-style external vault, static hosting connector.
- **OMB-340** Backups: workspace backup/restore, team backup, moving bots between a computer and a hosted
  home with a freeze during the move; installation-bound tokens are excluded from backups.
- **OMB-341** Organisation library: an admin-published catalogue of packages/presets synced to connected
  desktops (verified, size-capped) and added with one click; organisation branding and managed policy
  (allowed engines, models).
- **OMB-342** Optional anonymous analytics with a documented event list and an off switch; project
  announcements feed.

## 12. UI screens and interaction design principles

### 12.1 Screens (described)

- **OMB-350 Sidebar**: search (bots + message content); inbox row; departments as collapsible headings with
  bots as rows (avatar, name, status mark: working / needs you / unread); a bot expands to its recent and
  active threads and folders with "all threads" picker; rooms; pinned threads; people (teams); footer with
  automations, connected apps, templates, files, settings, profile. Drag to reorder bots/rooms; resizable;
  context menu on a bot (pin, mark unread, edit profile, duplicate, copy id, hide, archive, delete) and on
  a department (rename, share, set for all bots, add/remove bots, delete).
- **OMB-351 Chat view**: header with bot identity, model chip, usage chip, call button, computer/screen
  button; transcript with day separators, new-messages divider, reply quotes, collapsible work rows, cards,
  screenshots, attachments gallery, widgets, mini-apps, citations, code blocks, tables; message actions
  (pin, copy, react, retry, read aloud, fork/edit, reveal raw markdown); find-in-chat; export transcript;
  pinned-message banner; error banner with retry; context warning.
- **OMB-352 Composer**: multiline with mentions menu, slash commands, attachments (paste/drag images,
  files), dictation mic, approval-level chip, "+" menu (new thread, goal, burst, attach), queued-messages
  strip, send/stop button that reflects state.
- **OMB-353 Bot panel / settings**: profile (name, avatar generator, colour, mascot), instructions editor
  with revision history, model + backups, access (approval level, saved grants, tool selection, inbound
  API), computer, connected apps and MCP servers, memory panel, skills list, voice & alerts, routines,
  activity log.
- **OMB-354 Computer panel**: place selector, live screen preview, open desktop / take control, files pane,
  browser tab, phone screen, reset/recover actions, two-desktop side-by-side workspace.
- **OMB-355 Room view**: header with members and responder rule, bulletin editor, queue list, holds banner,
  member management, working folder, per-room timeout, goal card, group call view.
- **OMB-356 Automations**: list + calendar + run logs + editor (schedule presets incl. monthly/yearly/cron,
  timezone, destination, continuity, run-on-startup, time limit, where it runs).
- **OMB-357 Connected apps / plugins**: marketplace, connected accounts, MCP servers editor, per-bot grants.
- **OMB-358 Templates**: ready-made bots/teams gallery, import, share, organisation shelf.
- **OMB-359 Settings**: general (profile/About me, defaults for new bots, language, appearance skins,
  notifications, analytics), AI engines (accounts, sign-in, updates, limits), API keys, routing & extraction
  (decision model), image generation, voice, desktops & browser, skills library, vault, usage history,
  activity/decision log, early features, paired phones/devices, backups, organisation.
- **OMB-360 Other**: command palette; keyboard-shortcuts sheet; notifications panel; inspector (raw events,
  turn trace); team map (departments, who reports to whom, drag to reassign); "today" overview; files page.
- **OMB-361 Onboarding**: (1) a welcome flow of short beats — hello, feature reel, connect an AI (only if
  none works), permissions (only if relevant), phone, meet your bot; (2) a code-drawn feature reel (agents,
  hands, apps, rooms, automations, terminal); (3) a guided tour spotlighting the live interface step by
  step. Everything skippable, replayable from settings, never shown on paired remote clients. The first
  bot's opening message lists remaining setup and does each step with the person. Terminal first-run:
  arrow-key wizard for AI access, model and optional phone.

### 12.2 Interaction and visual principles (to adopt as our own rules)

- **OMB-370** Calm by default: nothing blinks, counts or competes unless the person must act. No count
  badges or "needs you" summaries above lists; a status mark on the owning row is enough.
- **OMB-371** Three places only: sidebar, chat, bot panel. No new header buttons; per-bot settings live in
  the bot panel, app-wide in Settings, never both.
- **OMB-372** Prefer automatic behaviour with a good default over a new setting; prefer Undo over a
  confirmation dialog; bots configure themselves by asking in chat instead of forms.
- **OMB-373** Everyday features reachable within two clicks from the chat in Simple mode.
- **OMB-374** Plain words: name things as people know them ("AI" not "engine", "cloud desktop" not "VM");
  sentence case; no exclamation marks; buttons say what they do; errors say what happened and what to do
  next; show values not explanations; empty states are one line and one action; never promise unbuilt
  features.
- **OMB-375** Every state is designed: default, hover, focus, pressed, disabled, loading (reserve space;
  spinner only after 300 ms), empty, error (inline with retry), long/odd content, narrow window, touch,
  light and dark.
- **OMB-376** Design tokens only: semantic colour tokens for surfaces, three ink levels, hairlines, accent
  (rare: links, focus, selection), status colours (status only), per-bot identity colours (bot-owned
  things only). Hierarchy from ink and size, not colour. Text contrast ≥4.5:1, focus/control edges ≥3:1 on
  every skin.
- **OMB-377** Type scale fixed (≈11–20 px), three weights, tabular numerals for changing numbers, single-
  line truncation for titles/rows with full text reachable.
- **OMB-378** Shape scale by element job (pills full, rows 6–8, cards 12, dialogs 14, bubbles 18); nested
  shapes smaller than containers; 4 px spacing grid; control heights 24/28/32/36 with 40–44 on touch; group
  with space before lines; no cards in cards; logical (RTL-safe) properties.
- **OMB-379** Only floating things cast shadows; rich content in a reply stays inside the bubble; one
  reply is one bubble.
- **OMB-380** Motion explains change: ≤300 ms, nothing scales from zero, no loops except truly live status,
  full reduced-motion support.
- **OMB-381** Accessibility: full keyboard operation, visible focus, hover-only controls also on touch and
  focus, focus-trapped dialogs with destructive confirmation focusing Cancel, correct roles, auto text
  direction in chat.
- **OMB-382** All strings localisable through one catalogue; server-originated lines carry codes +
  parameters so clients can localise them.

## 13. Configuration and environment

- **OMB-390** One JSON config file in the data directory (owner-only) holding: engine instances; default
  model; automatic recovery (enabled + backup); new-bot defaults; thread limits (max concurrent per bot,
  event-log size and retention); feature switches; provider keys (plaintext on headless, OS-encrypted on
  desktop with only placeholders in the file); budgets; price list; connected-apps ids; cloud-computer
  token; own-server SSH alias; container desktop mode/instances/memory/cpus; voice provider + voices;
  decision model; live calls; image generation; helper model; safety floor; decision-log retention; rules
  for every bot; profile; language; computer name; room defaults (turn timeout, tool-call timeout);
  browser profiles; sign-in allow lists; custom domain; onboarding progress.
- **OMB-391** Feature switches (default): bot skill authoring (on), automatic skill review (off), show tool
  calls (off), built-in browser (on), shared computers (single-owner lending), inherit personal engine MCP
  servers/skills (off), model-written thread titles (off), smart setup choices (on), auto recall (on),
  skills library (off), room memory capture (off), parallel room jobs (off), agent plan lines (off), tool
  bridge (off except local models). Switches never bypass permissions.
- **OMB-392** Environment overrides (categories): data directory, API port (default 8799; fallbacks +10000,
  +20000), webhook port (default API port + 1), public URL, role (desktop / personal cloud / team cloud),
  provider keys, decision/helper model ids, feature toggles (sandbox on/off, quota switch, tool bridge,
  safety floor, skill authoring), retention days, attachment quota, idle timeouts for pooled agent
  processes, tool limit, tunnels/relay, sign-in mail, staging endpoints. Environment wins over file.
- **OMB-393** Secrets are write-only toward clients: the UI only ever sees "configured" booleans; values
  are validated before saving; per-provider environment injection ensures an engine process receives only
  the credentials it needs.
- **OMB-394** Data-format versioning with a lease on the data directory so two servers never share it.

## 14. Notable constants and edge cases

| Area | Value |
|---|---|
| Core memory budget | 200 lines or 24 KB; entry ≤1,000 chars / 20 lines |
| Topic index | ≤40 topics or 2,000 chars |
| Auto recall | query ≥8 chars; 4 notes + 4 passages; ≤6,000 chars; topic passage ≈600 chars |
| Capture trigger | 2 min quiet or 6 turns; nightly tidy after 03:00 |
| Skills index | ≤30 skills, ≤4,000 bytes; ≤20 staged skill writes |
| Recent-work brief | 48 h, 10 lines, 1,400 chars |
| Context rebuild | ≈24 KB replay; summary ≤6 KB; ≤20 tool lines × 120 chars |
| Room delta | ≤12 unseen messages, ≤4,000 bytes; compact at 90% window |
| Chat-engine step cap | 64 model calls; ≤128 tools per call |
| Retries | 3 attempts; 1 s / 3 s / 8 s |
| Concurrent threads per bot | default 3 (RAM-scaled), max 16 |
| Questions | ≤6 per card, ≤12 options, label ≤120, description ≤400, question ≤8,000, free answer ≤2,000 |
| Assignment text | brief ≤12,000; result ≤12,000; quoted request ≤400 |
| Person-wait on handed-off work | expires 3 days; reminder at 1 day |
| Loop guards | 2 no-progress continuations; 3 identical errors; notices at 5/10/20 repeats; hard stop 256 calls |
| Goal run | 13 member turns; busy wait 30 min × 3 |
| Burst | 200 items max; parallel 10; item 2,000 chars |
| Waits | 10 per bot / 50 total; 1–168 h (default 24); tick 5 s; URL 60 s → 15 min backoff |
| Routines | catch-up 12 h; interval 5–1,440 min; ≤2,000 runs kept; retry after 15 s / 60 s |
| Proactive checks | backoff 15 min → 4 h; ≤24 model runs/24 h; 2 min boot delay |
| Webhooks | payload ≤48,000 chars; ≤2,000 attempts kept; deleted restorable 7 days |
| App events | queue 7 days; 3 waiting runs × 20 events; 500 / 2,000 per day |
| Inbound bot API | 20,000-char message; 256 KB body; 10/min per key; 50 concurrent; wait 50 s default, 300 max |
| Decision model | threshold 0.6; 1.5 s budget; log retained 180 days |
| Cloud desktop idle sleep | 10 min; stays awake 30 min before a routine; background job ≤2 h |
| File copy | ≤2 GiB, ≤9 min, keep 256 MiB free |
| Lent-folder write | ≤256 KiB; hash required to overwrite; folder copy ≤3 GB |
| Attachments | file ≤100 MB; preview ≤25 MB; store 512 MiB |
| Images | ≤4 per reply (1–10); 50 per day |
| Room posts by bots | 10/min per sender; breaker cool-down 5 min |
| Tool-result paging | 16,000 chars per read; expires 1 h |
| Agent process pool | idle close 10 min (floor 10 s) |
| Pairing | QR credential 2 min single-use; 6-digit fallback |
| Meetings | wait for admission ≤10 min; stop after 4 h |
| Live call | hang up after 5 min silence; connect timeout 20 s |
| Profile / rules text | ≤24,000 chars each |
| Tool selectors | ≤256 per list, ≤1,024 chars each |

Edge cases worth copying:

- **OMB-400** A "nothing new" result must be distinguishable from a failed read; never advance cursors on
  failure.
- **OMB-401** Never run a cut turn twice if it already acted outward; derive that from recorded tool
  activity, not from model claims.
- **OMB-402** A missing token-cache figure is "unknown", not zero; partial costs are summed as partial.
- **OMB-403** Placeholders and shell variables pasted into config forms are detected and never saved
  literally.
- **OMB-404** A person's computer always wins sync conflicts; bot edits are staged and applied only to
  untouched files; replaced files go to the OS trash first.
- **OMB-405** Imported/shared content always lands least-privileged (skills off, routines paused, apps
  off) regardless of the sender's settings.
- **OMB-406** Spoken consent must be an unambiguous yes/no; a sentence merely containing an affirmative
  word is re-asked.
- **OMB-407** Laptop sleep must not count as a stall; downtime is nobody's budget except the wall-clock
  wait on a person.
- **OMB-408** Reactions as answers are revocable until the bot consumes them, except on approval cards
  where the decision stands.
- **OMB-409** Results of background runs never interrupt an in-progress exchange; they appear after the
  bot's reply to the person.
- **OMB-410** A thread deleted while it is a routine's destination makes hidden run threads visible so
  pending approvals remain reachable.
- **OMB-411** When several OAuth accounts exist for an app, a tool call must name the account; a new OAuth
  flow never silently becomes the default.
- **OMB-412** Tool list stability matters for prompt caching: prefer refusing at call time over reshaping
  the list per turn.
- **OMB-413** Cloud browsers refuse sites known to ban datacenter traffic and steer the bot to a connected
  app or the person's own computer.

## 15. Top 25 ideas worth adopting

Ranked by (user value ÷ implementation cost) for a small Node + SQLite + React codebase. Cost: S ≈ days,
M ≈ 1–2 weeks, L ≈ multi-week.

| # | Idea | Value | Cost | Notes |
|---|---|---|---|---|
| 1 | Bot / thread / room data model with per-thread model, level, usage and run state (OMB-020–024) | Very high | M | Foundation; SQLite tables + one SSE stream folded by a reducer. |
| 2 | Canonical runtime event stream + per-thread append-only log (OMB-051) | Very high | M | Decouples providers from UI; enables inspector, usage, replay. |
| 3 | Durable cards (approval, question, secret, sign-in) that park a turn and resume on answer (OMB-121, 292–298, 301) | Very high | M | One `needs_input` state + card table; survives restarts. |
| 4 | "Apply now + one-line receipt with Undo" instead of confirmations (OMB-008, 372) | High | S | Keep a revision per change; huge UX win. |
| 5 | Usage ledger row per turn + header chip + grouped history + CSV (OMB-310–312) | High | S | One table; group-by queries are trivial in SQLite. |
| 6 | Monthly budget with warn/cap alerts (OMB-315) | High | S | Sum of ledger; two idempotent alerts per month. |
| 7 | Bounded markdown memory: core file with budget gauge, topic files, archive, journal with undo (OMB-240–243) | High | M | Plain files + a journal table; no vector DB needed. |
| 8 | Keyword auto-recall injected before the message, not into the system prompt (OMB-062) | High | S | SQLite FTS5; preserves prompt cache. |
| 9 | Stable/volatile prompt split and byte-stable tool list (OMB-060, 412) | High | S | Direct cost saving with cached providers. |
| 10 | Skills as folders with an index in the prompt and on-demand body; `/learn` (OMB-250–252) | High | S | Index ≤30 items / 4 KB. |
| 11 | Unified assignment record with resume-on-settle wake and typed refusals (OMB-120–127) | Very high | L | Start with: queued/running/waiting/needs_input/terminal + one inbox table. |
| 12 | Harness-written provenance envelope on every delegated/outside message (OMB-057, 129) | High | S | Cheap prompt-injection hardening. |
| 13 | Room responder rules (lead / everyone / mentions / auto) with visible queue and per-member holds (OMB-220–222, 084) | High | M | Serial turns first; parallel later. |
| 14 | Conversational triggers with live card (rule, next 3 dates, pause, undo) + hidden run threads + "nothing new" silence (OMB-270, 274) | High | M | Cron library + runs table. |
| 15 | Catch-up, no-overlap and single-retry rules for unattended runs (OMB-273, 275) | High | S | Small state machine; big reliability gain. |
| 16 | Restart policy: re-run once unless outward action recorded (OMB-092, 401) | High | M | Needs tool-activity rows tagged "outward". |
| 17 | Queue-while-busy with editable queued messages and optional steer (OMB-082) | Medium-high | S | Queue first; steer where the provider allows. |
| 18 | Loop guards (repeat-call notices, no-progress strikes, identical-error stop) (OMB-056) | Medium-high | S | Protects budget on weak models. |
| 19 | Usage-limit / signed-out failover to a backup model with one notification (OMB-093–095) | Medium-high | M | Needs engine capability flags + hold table. |
| 20 | Secure vault: named secrets by reference, saved logins typed by host, masked everywhere (OMB-297–298) | High | M | Encrypt at rest; redact in transcript pipeline. |
| 21 | Decision log + optional safety floor (OMB-299, 302) | Medium | S | Append-only table; small never-list parser. |
| 22 | Team packages and presets that import least-privileged (OMB-260–262, 405) | Medium-high | M | JSON export with secret stripping; review screen. |
| 23 | Simple vs Advanced mode and the "calm" design rules as lintable checks (OMB-007, 370–381) | Medium-high | S | Token-only styling, contrast check, no-native-select tests. |
| 24 | Tool selection per bot + search/call bridge for small-context models (OMB-071–072) | Medium | M | Selector grammar is simple; bridge optional. |
| 25 | Voice: speakable-text rewrite, per-bot voice, half-duplex call with narrated tool activity and strict spoken consent (OMB-337, 406) | Medium | M | TTS behind the server; narration reuses tool phrases. |

Deferred / high-cost items to consider later: sandboxed bot box with egress gate and credential broker
(OMB-211), lent-folder sync (OMB-210), end-to-end encrypted phone relay (OMB-334), meeting attendance
(OMB-296), burst fan-out (OMB-155), fast decision-model routing (OMB-106), proactive daily brief (OMB-279).
