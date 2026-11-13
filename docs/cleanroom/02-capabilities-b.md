# 02 — Reference Capability Specification (RKZ)

Clean-room functional specification derived from analysing an Apache-2.0 reference project
("the reference"). It describes observable behaviour only. Nothing here is source code, a
verbatim prompt, a verbatim UI string, or a file layout. Capability names used below
(for example "screen-observe") are this document's own neutral labels, not the reference's
identifiers. Numbers are behavioural facts (limits, timeouts) an implementer may adopt or tune.

Reading guide

- "MUST/SHOULD/MAY" describe what an equivalent product needs, in descending importance.
- "Owner" = the human whose account a bot acts for. "Run" = one unit of agent work.
- "Outside content" = any text not written by the owner in this product (web pages, emails,
  webhook bodies, tool results, other bots, channel messages).
- Section 13 ranks what is worth copying for a small Node + SQLite + React codebase.

---

## 1. Product overview and concepts

RKZ-001 The product is a self-hostable "home" for persistent AI teammates. Each bot is a
long-lived identity with: a name and avatar, standing instructions, one continuous chat, its own
memory, a to-do list, scheduled routines, a computer (browser, terminal, files, desktop), and
access to connected apps.

RKZ-002 One bot has exactly one visible conversation with its people. Runs, attempts, retries,
tool calls and helper agents are internal; the chat shows replies, a small amount of progress,
results, and genuine requests for help.

RKZ-003 A bot works in the background and remains conversational while working: a new message
during a run steers that run rather than queueing behind it (see RKZ-114).

RKZ-004 Requests for help (question, approval, credential entry, screen takeover, app sign-in)
appear as inline cards. A pending card never blocks the chat; the person may keep talking, new
work still runs, and the card stays answerable until answered or expired.

RKZ-005 Concept hierarchy: Deployment → Organization (billing/tenancy; optional for a small
build) → Space (authorization boundary) → Bots, Groups, Threads, Routines, Computers, Memory,
Connections. Account-level settings (models, voice, approvals, credential vault) are defaults
every space follows; a space may deliberately override one of them.

RKZ-006 A Space is the hard isolation boundary: chats, files, memory, computers, app
connections, bot-saved skills and (optionally) credentials never cross spaces implicitly.
Bots only talk to bots in the same space unless a per-bot "cross-space communication"
permission is on.

RKZ-007 Spaces can be shared by single-use invite link (valid 7 days, revocable while unused).
In a shared space everyone shares bots, chats, memory, routines and the team computer; each
person keeps their own models, connected accounts, tool servers, skills, vault and approval
rules, and pays for their own runs. A bot acts with the accounts of whoever messaged it, and
only that person may answer the questions that run raises. A routine runs with its owner's
accounts; editing someone else's routine transfers ownership to the editor.

RKZ-008 Leaving a shared space: what the leaver created passes to the owner, routines pause,
their runs stop, a screen they controlled is released, and their space-scoped credentials are
deleted.

RKZ-009 No hosted vendor is mandatory. Models, sandboxes, memory providers, voice, app
catalogs, messaging channels, payments and observability are optional adapters behind
provider-neutral contracts; vendor names never leak into shared data models, settings keys or
UI outside the adapter that owns them.

RKZ-010 One product on every surface: web, desktop shell (hosting the web UI), native mobile,
and third-party messaging apps all show the same bots and state. A feature either works on
each applicable surface or degrades with an explicit reason (e.g. routine editing and
teach-by-demonstration are web/desktop only; mobile can view/pause/test).

RKZ-011 Frontends express intent and render state. The backend owns orchestration,
authorization, validation, retries, recovery and provider translation.

RKZ-012 Routines are scheduled or triggered prompts, deliberately not a visual workflow
builder.

RKZ-013 Deployment administration is separate from app accounts: sign-up order or workspace
ownership grants no server privileges. Admins are only the verified emails the operator lists
in configuration, and their powers are narrow (review plugin submissions, add local-process
tool servers, grant capped credits).

---

## 2. Data entities

Each entity lists the fields that matter behaviourally. Names are descriptive.

RKZ-020 **User**: profile, email, timezone, locale, avatar style, marketing opt-out, deactivation
flag, per-user daily bot-email allowance, list of trusted outbound-link sites, passkeys,
sessions, registered devices/push tokens.

RKZ-021 **Organization / Member**: tenancy and billing container with roles. A small build may
collapse this into the deployment.

RKZ-022 **Space**: name, default flag, creator, deletion-in-progress marker (a space being
deleted accepts no new work), memberships (owner | member), invites (hashed token, expiry,
accepted-by).

RKZ-023 **Bot**: space, owner user, name (≤ 80 chars), public description read by other bots
(≤ 4,000), private instructions (≤ 20,000) with version history, avatar (colour + one of a
small set of shapes, or an uploaded image), notify-on-finish flag, pinned flag, sidebar
position and section, archived timestamp, parent bot (when created by another bot),
memory scope (isolated | shared), computer mode (team | private), voice + read-aloud flag,
model override (provider, model, thinking level), list of disabled built-in tools, webhook
secret, ambient-listening flag and room guidance for team chat, cross-space permission,
daily check-ins flag, manage-other-bots flag, reply mode.

RKZ-024 **Bot section**: user-defined sidebar grouping with ordering; holds bots and groups.

RKZ-025 **Group**: space, name (≤ 80), 2–10 member bots in a stable order, pinned, section,
archived. Has its own thread, artifacts and pages.

RKZ-026 **Thread**: belongs to a bot, a group, a helper (hidden), or an external conversation.
Holds monotonic message and event sequence counters and compaction state (summary text,
"compacted up to" cursor, generation counter).

RKZ-027 **Thread read state** (per user per thread): unread flag, last-read sequence,
snoozed-until.

RKZ-028 **Message**: thread, sequence number, role (user | bot | system), ordered content
blocks, author (bot or user), reply-to + quoted excerpt (≤ 2,000), originating run, client
nonce (unique per thread; the idempotency key for every write), search tokens, bounded
record of the tool calls behind the reply (for later replay). Text ≤ 100,000 chars.

RKZ-029 **Message block kinds**: text; generic card; question/ask (with options, optional
detail in text or code format, text or masked input, pending/answered status); multiple
choice; app-connect card; tool-server approval card; computer/takeover card; voice-call
marker; incoming-call request (ringing | answered | declined | missed); meta/status line;
delivery marker; progress; tool-steps summary; helper-agent card (running | completed |
failed); child-bot card (created | archived | deleted); remote coding-agent card; skill
draft card (draft | saved); import-setup checklist; image; file; embedded mini-app; page
card; handoff; channel message; bot-message sent / received; chart.

RKZ-030 **Event** (append-only, per-thread sequence): message created/updated/reaction,
thread cleared, progress, artifact, ask, choice, meta, computer status and takeover
requested/granted/released, shell command output (≤ 16,000 chars), helper/remote-agent
updates, call ended, run started / steering claimed / checkpointed / waiting-for-input /
completed / failed / cancelled, memory revised, routine created/updated/fired, teaching
started/stopped, skill draft/saved, effect recorded/reconciled, tool called/completed, usage
recorded, bot spawned/updated/archived/deleted, group created/updated/handoff, and a
non-persisted heartbeat.

RKZ-031 **Task**: a user prompt and status that groups one or more runs.

RKZ-032 **Run**: space, bot, thread, user it acts for, status (queued, leased, running,
waiting for input, waiting for takeover, completed, failed, cancelled), trigger (see RKZ-110),
model/provider/thinking actually used and whether pinned, "reply optional" flag (group),
error, lease owner + fence token + expiry, checkpoint (serialised turn state for resume),
source message, routine reference, retry-of reference, wake-at time, first-response time,
started/late-since/completed times, flags for "outcome returned to requesting bot" and
"mirrored to messaging channel".

RKZ-033 **Attempt**: one execution of a run under a specific fence: status, error, timings.

RKZ-034 **Steering message**: a message received mid-run, linked to the run that should
absorb it, with claimed-at.

RKZ-035 **External effect**: a record of every consequential tool call: run, kind, idempotency
key, status (pending approval, approved, executing, uncertain, completed, denied…), the exact
request that was approved, per-action breakdown for batch calls, stored result, and the
auto-reviewer's decision, reason and model.

RKZ-036 **Routine**: bot, owner, target thread, name, prompt, list of cron expressions,
timezone, active, notify flag, webhook-enabled, git-event-enabled, message-channel trigger,
allowed email senders (owner only | owner's domain), optional model override, watch
definition and last watch state, last/next run times, consecutive account-failure counter.

RKZ-037 **Scratchpad item** ("open work"): bot, title (≤ 200), status (open | parked | done),
notes (≤ 4,000).

RKZ-038 **Memory document**: space, scope (bot or space-shared), path, content, revision
number; plus revision history rows naming the source run/thread.

RKZ-039 **Skill**: name (≤ 80), description (≤ 2,000), markdown body, optional reference
files, source (user | built-in | plugin), availability (all of the owner's spaces or a chosen
subset).

RKZ-040 **Taught skill**: goal, status (recording | drafting | draft | saved), recorded input
timeline (pointer, key, clipboard, snapshot, scroll events), generated playbook.

RKZ-041 **Connection** (managed app account): connector id, provider, display name, status
(pending | connected | revoked | error), encrypted secret reference, provider reference.

RKZ-042 **Tool server**: name, transport (streamable HTTP | SSE | local process when
admin-enabled), endpoint, headers, encrypted secret, enabled flag, "keep results whole"
flag, health status/message/tool count, availability, and per-bot assignment rows with
"all tools" or an allowed-tool list.

RKZ-043 **Capability install** (plugin / API source): kind, source URL, pinned commit digest,
config, availability.

RKZ-044 **Vault credential**: owner, vault (account or space), name, title, note, destination
origin, auth shape (bearer | named header | basic | login fields | shell variable | payment
card | contact), ciphertext, policy (use freely | ask first), allowed bots, up to 10 extra
origins, authenticator seed. Up to 100 items; value ≤ 16,384 chars.

RKZ-045 **Computer**: space, scope (team | private), provider reference, state (stopped |
booting | running | suspended | error), control holder (bot | user | none) with lease and
fence, executing run with lease and fence, screen URL, running-since, disk usage, home
snapshot revision, restore-pending flag. Plus per-bot execution leases, usage intervals, and
maintenance jobs (update | recover; queued/running/interrupted/completed/failed).

RKZ-046 **Artifact**: file a bot sent: name (≤ 255), description (≤ 280), MIME type, size,
hash, storage key, version chain (same name → new version of the same artifact), standalone
flag.

RKZ-047 **Page**: title (≤ 200), owner bot or group, visibility (private | link), share-token
hash, pinned, current version; versions hold source and compiled output (source ≤ 256 KB).

RKZ-048 **Usage record**: run, provider, model, input/output/cache-read/cache-write/reasoning
tokens, cost and its source, operation kind (answer | setup | retrieval | subagent |
compaction), parent run.

RKZ-049 **Approval rule**: effect (always allow | require approval | deny), match kind (tool |
connector | category | site), value; held at account level with optional per-space sets.
**Approval preference**: mode (ask | auto | never).

RKZ-050 **Messaging**: identity (provider address ↔ user/space/bot, verified time, last
inbound time, outbound-since-inbound counter), one-time link code (10-minute life),
installation (workspace-level app install), channel + members (invited | approved |
declined | left), external conversation (per-room settings: listening mode, guidance,
per-automated-sender policy), external message (status, engagement reason, linked run),
outbound queue row (idempotency key, status, provider handle, claimed-at).

RKZ-051 **Bot email**: permanent address (name@domain), inbox messages (sender, verified
flag, subject, text, attachments, received time, search tokens), send log for rate limits.

RKZ-052 **Board / Ticket / Comment** (optional feature): ticket number with prefix, title
(≤ 200), description (≤ 20,000), status (to do, in progress, in review, blocked, done, won't
do), priority, assignee bot, comments (≤ 10,000).

RKZ-053 **Payments** (optional): spending limit (amount, currency, period), payment ledger,
wallet connection, purchase (merchant, amount, status, single-use card/token ciphertext).

RKZ-054 **Agent-to-agent connection** (cross-owner): requester bot, target bot, status
(pending | approved | declined | revoked).

RKZ-055 **Audit event** (append-only, never updated): time, actor (user | bot | system) with
copied display label, action, target with copied label, outcome (success | failure | denied),
space, run, thread, client IP/user-agent for people, small metadata. Never message content,
tool arguments or secret values. Separate **security event** log for sign-ins, credential
changes and refusals.

RKZ-056 **Notification preference** per user per space: on finish, on help needed, on takeover.

---

## 3. Agent runtime behaviour

### 3.1 Run creation and dispatch

RKZ-100 Work starts immediately in the process that created it; the request returns at once
and clients follow the reply over a realtime channel. A durable job is written in the same
transaction purely as a crash backup, scheduled for the attempt's own timeout plus a margin;
it is deleted on success and fires by itself if the process dies.

RKZ-101 Every start claims the run with an atomic lease and an incrementing fence token, so a
run executes once no matter how many processes exist. All writes by an attempt are conditional
on still holding the current fence; a superseded attempt stops writing without disturbing
the run.

RKZ-102 A recovery sweep (start-up and every ~5 s in the reference) picks up runs whose
process died, whose lease expired, or whose hand-off was lost. Recovery is a safety net, never
the normal path. Interactive runs are scanned before scheduled ones.

RKZ-103 On shutdown or memory pressure a process hands its runs over (requeues them without
recording a failure) so a replacement resumes them within moments.

RKZ-104 No global concurrency cap on runs or model calls. Only the specific contended resource
is serialised: one run at a time per bot's computer, one writer per thread, one provider's
rate limit. Unrelated work never waits.

RKZ-105 A bot uses its computer for one run at a time. A background run that needs the
computer while another run of the same bot holds it stays queued with no retry timer; the run
that releases the computer starts the next waiting one.

RKZ-106 Delivery is at-least-once; every side effect carries an idempotency key (per-thread
client nonce for messages, effect key for tool calls, delivery key for outbound sends).

RKZ-107 Timing metrics recorded per run: wait before run creation, queue wait, time to first
visible response (text or card; reasoning and placeholders do not count), total time,
execution wall time. An alert-grade log fires when an interactive run has been due but
unstarted for 30 s.

### 3.2 Triggers

RKZ-110 Run triggers: owner message; routine; resume (after answer/approval/takeover);
follow-up; reaction to a message; end of a voice call; spawn (first task for a new bot);
skill; message from another bot; webhook; messaging channel; remote coding agent finished;
purchase decided; media generation finished; bot creation intro; ticket assignment;
background helper; helper result returning.

RKZ-111 The trigger determines trust. "Owner-started" means: the owner's own message, a
follow-up they wrote, or the close of their call. Everything else (bots, channels, spawns,
tickets, webhooks, routines, email) is not owner-started and gets reduced powers (see §8).

RKZ-112 Bot-creation intro run: the new bot may only ask what it is for and record the answer
on its own profile; it gets no acting tools until the person answers. Routine runs and the
intro run do not see thread history.

### 3.3 Turn loop

RKZ-113 A turn is a loop: assemble context → call the model with streaming → show text as it
streams → execute requested tools (in parallel when the model requests several) → feed
results back → repeat until the model produces a text-only reply. Text emitted in the same
model response as a tool call is narration, not the final answer.

RKZ-114 Steering: a message from the run's person arriving mid-run is injected into the
running turn, marked as arriving mid-task. The bot is told to answer it through the interim
update channel so answering does not end the task. Messages from anyone else arrive labelled
with their origin and no obligation to reply. Steering not consumed before the turn ends stays
queued for the next run.

RKZ-115 Interim updates: the bot may post short progress messages (≤ 500 chars by default,
silently truncated with the bot told so) without ending the turn. Durable interim messages
are allowed only once a turn is ≥ 60 s old, at most 3 per run; a mid-task message from the
person may reset that budget (max 3 resets, ≥ 60 s apart). Short narration otherwise appears
only as a one-line working indicator (≤ 60 chars).

RKZ-116 Live activity: while a tool runs, the thread shows a short description of the step
(≤ 90 chars) instead of a bare spinner. On completion, steps fold into a summary (tool count
and duration).

RKZ-117 Silence: runs where a reply is optional (routines, FYI bot messages, group messages
that name no one) may end silently via an explicit "no response" sentinel or an empty reply,
provided the run did no visible work. Stray sentinels at the edge of a real reply are
stripped.

RKZ-118 If a turn ends with tools run but no final text, the runtime uses the last held-back
narration as the reply; if there is nothing at all, it is treated as a missed answer (retry
path), never as success.

RKZ-119 Some models stop immediately after a tool result. The runtime sends up to 3 automated
"continue" nudges, clearly marked as automated so the model does not read them as the user
forbidding it to stop.

### 3.4 Limits and loop guards

RKZ-120 Tool-loop guard: the same tool with the same arguments (compared independent of object
key order) failing 6 times in a row ends the run with an explanation. Calls differing only by
digits, or identical calls that keep succeeding, get up to 25 repeats (legitimate paging or
polling). A repeat whose result is new restarts the count. Calls issued together in one model
response count as one step.

RKZ-121 Screen/browser action batches are limited to 24 actions per call (a double-click
counts as two). An over-limit batch is refused unrun; 4 consecutive over-limit batches end
the run.

RKZ-122 Optional per-turn tool-call budget (unlimited by default). Exceeding it is a soft
stop: the turn still ends with a durable reply.

RKZ-123 Tool result text is capped (12,000 chars per result, shared across text parts) before
it reaches the model. Stored tool history per reply is separately bounded, keeping head and
tail and stating what was omitted.

RKZ-124 Shell commands are stopped after a few minutes (5 min default); the bot is instructed
to launch long work detached and poll a log file. Output can stream while the command runs.

RKZ-125 Bot-to-bot chains: a hop counter travels with each bot message; after 6 hops (default)
the next message is refused. A person's own message resets the chain.

RKZ-126 At most 4 helper agents run in parallel per turn; at most 50 active routines per bot.

### 3.5 Pauses, cancellation, expiry

RKZ-130 A run pauses (status waiting for input / waiting for takeover) when it asks a
question, needs approval, needs a credential, or requests the screen. The full turn state is
checkpointed so any process can resume it exactly, including which model and credential type
were in use; if those no longer exist the resume fails rather than silently switching.

RKZ-131 When several parallel tool calls need approval simultaneously, only the first shows a
card and saves the pause; the others wait for it, so the resumed turn runs exactly the call
that was approved.

RKZ-132 Stop: a user-initiated stop is noticed within about one second even during a silent
model call or a long tool (a throttled cancellation check runs alongside). Already streamed
text is kept in the thread; unfinished tool calls are recorded as not run.

RKZ-133 Stuck work: a queued run or a human wait untouched for 4 h triggers one reminder
notification per waiting episode; after 24 h it is cancelled with a status line in the
thread. A takeover request nobody acts on is cancelled after 30 min because it holds the
bot's computer. Both thresholds are configurable (1 min – 30 days).

RKZ-134 A person denying a tool call lets the bot continue; a repeat of the same denied
request in the same run is refused automatically without a new card.

### 3.6 Retries, fallbacks, error handling

RKZ-140 Transient provider failures retry the same model with backoff (2 s, 8 s, 20 s).
Quota exhaustion, usage-window limits and rejected credentials skip straight to the next
backup model, since they will not clear within the retry window.

RKZ-141 Users configure a main model plus an ordered list of up to 10 backups. A backup is
used only if it is connected, accepts the run's inputs (e.g. images), and the conversation
fits its context window after that backup's own pruning policy. A backup runs at its own
thinking level, with its own credential (never borrowing the primary's key). Once switched,
earlier reasoning blocks tied to the previous model are omitted from requests.

RKZ-142 Empty or thinking-only replies are provider glitches: repeat the call up to 2 times
from the same context, then try backups; pass through only if every attempt is empty.

RKZ-143 Output-limit recovery: a call that spent its whole output budget before writing
anything gets one more try with double the budget (within model ceiling) or, if the budget is
user-set/maxed, one thinking level lower. A reply cut off mid-way (dropped connection or
length limit) is continued in the same chat bubble: the continuation request asks the model to
restart by repeating the last few words, and the join removes that overlap (4–240 chars) and
a leading ellipsis. At most 3 such self-recoveries per run.

RKZ-144 Model stream timeouts: 30 s to connect, 120 s to first headers per attempt, 180 s of
stream silence; there is no cap on total active streaming time.

RKZ-145 Setup failures before the model is reached (e.g. computer provider outage) requeue
the run; after 8 consecutive setup failures the run fails. Waiting for a busy computer does
not count. Retries for a provider outage are spread over roughly 15 minutes.

RKZ-146 Failed runs keep whatever reply text streamed, placed above an error notice.
Errors are classified by whose problem they are (key, credit, spending, rate, auth, access,
model choice, context, unusable output) and worded for the user; operator-side faults are
reported to the operator, not blamed on the user. Failures of unrequested check-ins are not
announced.

RKZ-147 Default output cap is modest (4,096 tokens; 32,768 for reasoning models) to avoid
providers reserving credit for a huge ceiling; never more than a quarter of the context
window; user/operator overrides apply.

### 3.7 Context assembly

RKZ-150 System context is ordered stable-first, volatile-last to preserve prompt caching:
identity and instructions, behaviour rules, tool guidance matching only the tools actually
offered, roster of other bots (≤ 40 entries, each with its public description), skills
catalogue (one line per skill), memory notes, shared memory, open-work items, then
time/trigger-specific context.

RKZ-151 History: the most recent 50 messages are sent verbatim. Older messages are
summarised in batches of 50 by a background job into a rolling summary (≤ 20,000 chars) with
a cursor; the summary is used only when messages after its cursor are contiguous, otherwise
a larger verbatim window (200) is used rather than leaving a gap. Transcript given to the
summariser is capped (40,000 chars); summariser timeout scales with prompt size (2–8 min).
An empty summary never advances the cursor.

RKZ-152 Within a run, context selection never drops the current request, steering,
approvals or authoritative constraints. Older exchanges are dropped as a contiguous prefix;
a tool request and all its results are indivisible. Oversized tool results are shortened
head-and-tail with a marker, preserving JSON shape and all ids/cursors/routing fields.
A result shortened before the model read it is labelled as missing evidence; one shortened
after the model already used it is labelled differently so the model does not retract earlier
statements.

RKZ-153 Token estimation is tokenizer-free and deliberately conservative (≈ 3.3 ASCII chars
per token, one per digit / camelCase boundary, higher weights for non-Latin scripts).

RKZ-154 If instructions plus tool schemas alone exceed a model's window, the run fails with a
specific context error instead of sending a truncated request.

RKZ-155 Images: attachments are downscaled client-side (longest edge 1,600 px, quality 0.7).
For a model that cannot read images, screenshots in history are replaced with placeholders and
user images are delivered as files on the computer instead.

RKZ-156 Tool-history replay: later turns may see what earlier replies' tools were sent and
returned (redacted and bounded) only in runs the owner started themselves; every other run
sees only the visible replies, so tool output never reaches an audience it was not for. Any
replayed tool result marks the run as having read outside content.

### 3.8 Model and provider selection

RKZ-160 Model roles: main (+ backups), approval reviewer, optional computer-use model,
optional judge for ambient team chat, media generation. Each role resolves: routine override →
bot override → space override → account default → deployment default.

RKZ-161 Connection types: API key; subscription sign-in via OAuth where the provider permits;
any OpenAI-compatible server URL (with model discovery, declared context window, image
support, reasoning support, and wire protocol choice among chat-completions, responses-style
and messages-style); operator-declared local models; deployment-wide default key.

RKZ-162 Thinking level is selectable per model/bot/routine across a range from minimal to
maximum; levels are narrowed at runtime to what the endpoint accepts.

RKZ-163 Computer-use role: when set, the main model receives a single "enter computer mode"
capability instead of screen tools; it hands a concrete goal to the vision-capable model,
which works the screen in the same run and returns a summary. If none configured, the main
model drives the screen itself.

RKZ-164 The picker marks models that cannot read images. Requests for private-network model
endpoints require an explicit operator opt-in.

RKZ-165 Usage (tokens incl. cache read/write and reasoning, cost) is recorded per call and
shown per model in settings. Optional local token-per-minute pacing; pacing time is not
counted as model time.

### 3.9 Lazy tool loading

RKZ-170 Only a core set (~12–20 tools chosen by usage) is listed to the model in full. The
rest are reachable through a "find tool" capability (exact-name lookup or deterministic
keyword ranking over name, description and parameter names; top 3–10 with full schemas) and a
"use tool" capability that runs the target through the identical gate, approval and audit path
as a direct call. The finder's description lists hidden tool names grouped by area (bounded:
≤ 200 names, ≤ 2 KB). The listed tool set never changes mid-run so the prompt cache survives.
UI shows the real tool, not the wrapper. A test pins the visible list and a byte budget.

RKZ-171 Tools are offered conditionally per run: computer tools only when a computer exists;
page-browser tools only on a graphical computer; inbox tools only in the owner's own runs
outside groups/channels; wallet tools only if a wallet is connected; hang-up only during a
live call; call-user not when already on a call or reached via a channel that cannot ring;
semantic-memory tools only when a provider is configured (and forget/reflect only if it
supports them); fleet tools only in owner-started runs with the permission on.

---

## 4. Tool / capability catalogue

Names are neutral labels. "R" = read-only, "W" = changes something.

### 4.1 Bot's computer

RKZ-200 **screen-observe** (R): screenshot of the bot's desktop with frame metadata. Must be
used before coordinate actions and whenever someone else may have changed the screen.

RKZ-201 **screen-act** (W): up to 24 ordered actions — click (left/right, double), move,
press, release, type text, key with modifiers, scroll (direction, 1–20 notches, default 3, at
a point), wait, focus-or-launch an application (optionally with a URI). Returns the resulting
screen. Guidance: batch only predictable actions.

RKZ-202 **page-open** (W): open a URL in a structured page browser on the computer; returns a
page snapshot, or the saved path for a download. May report "fall back to raw screen
actions".

RKZ-203 **page-snapshot** (R): accessibility-style outline of the current page with short
element references; dropdowns list their options; says when content was cut; optional query
narrows to matching controls anywhere on the page; frames are included under their own site;
a loading flag asks for another snapshot.

RKZ-204 **page-act** (W): actions by element reference — click, fill, keyboard-style type
(replaces field text; for one-box-per-digit codes), file upload, fill one field of a saved
login (by label; value never visible to the model; only on the login's allowed sites), fill
saved/approved card fields, fill a one-time code, hand over an approved pay token. Returns
the page afterwards. Downloads land in a downloads folder and are listed with their state.

RKZ-205 **file-list / file-read / file-write**: workspace files. Reads are UTF-8 text in line
ranges with a continuation offset. On a team computer relative paths resolve to the bot's own
folder; a shared folder is for deliberately shared work.

RKZ-206 **file-attach** (W): send a workspace file to the chat as image or file. With a name
and one-line description it becomes a named artifact; re-attaching under the same name creates
a new version of that artifact.

RKZ-207 **shell** (W): run a command on the bot's computer with optional working directory;
streams output; time-limited (RKZ-124). Shell variables from the vault are injected fresh
before every command and redacted from output (plain, base64, URL-encoded).

RKZ-208 **open-path / launch-app** (W): open a file or URL in its default graphical app, or
launch/raise an installed app; returns the screen.

RKZ-209 **request-takeover**: ask the person to take the screen for CAPTCHA, passkey,
payment or other protected input; pauses the run until they finish or skip.

### 4.2 Owner's own computer (desktop app only)

RKZ-215 **host-shell** (W): command on the user's real machine, confined to their home folder.
**host-observe** (R): one app's window as numbered accessibility rows plus screenshot, opened
in the background without disturbing the user. **host-act** (W): up to 24 actions in one app
(click by element or pixel, type, set value, key with modifiers, scroll, menu path, wait).
Offered only in chats the owner starts with their own bots — never from routines or other
people's messages — and only while that desktop is connected.

### 4.3 Talking to the person

RKZ-220 **ask-user**: one short question (≤ 240 chars) with 2–4 unique tappable options
(≤ 80 chars each) and optional detail (≤ 4,000 chars, e.g. a draft to approve); pauses the
run.

RKZ-221 **interim-message**: short progress update that does not end the turn (RKZ-115).

RKZ-222 **connect-app**: inline card to connect a named app; the run waits.

RKZ-223 **call-user**: ring the person's devices with a reason (≤ 120 chars) and a spoken
opening (≤ 240). Intended when asked, or after three unanswered reminders about the same
thing. Cooldown between calls per person (2 min default), ring timeout 45 s; missed/declined
shows a call-back marker. **end-call**: hang up with a short title (≤ 40) and one spoken
farewell sentence (≤ 160).

RKZ-224 **send-feedback**: bug report or feedback to the server operators (≤ 2,000 chars),
only when the user asks, stripped of personal detail.

### 4.4 Credentials

RKZ-230 **request-credential**: show a protected-entry card. Variants: named API credential
bound to exactly one HTTPS origin with bearer / named-header / basic auth; website login with
1–8 labelled fields (default username + password); shell variable (no origin; exported as an
upper-cased environment variable); payment card; contact details; one-time code bound to an
origin; one-use connector code. The value is cleared from the input on submit and never
appears in messages, events or model input. Asking again with the same name returns the
existing reference unless "replace" is set.

RKZ-231 Login field visibility: fields whose label consists only of identifier words (id,
phone, email, account, username + filler words) start visible; everything else starts hidden.
The person can flip any field before saving; the bot cannot. Hidden values are only ever typed
into password-type inputs, visible ones only into text/email/tel inputs.

RKZ-232 The entry card has a "save to vault" switch (default on). Off = the value lives
encrypted only for that run and is deleted when the run ends however it ends; the bot is told
it was not saved.

RKZ-233 **generate-credential**: create a random password/key the model never sees, saved as a
login (for new sign-ups) or shell variable; optional character rules; never overwrites.

RKZ-234 **list-credentials** (R): names, destinations, card brand/last-four/expiry, contacts,
usage notes — never values.

RKZ-235 **authenticated-request** (W): HTTP request where the backend injects the saved
credential, only at the exact saved origin (including port). Redirects rejected; 30 s
deadline; 1 MB response limit; ≤ 20,000 chars returned, with echoes of the credential (plain
and common encodings) redacted; pagination links/headers surfaced.

RKZ-236 **forget-credential** (W): remove a saved credential.

RKZ-237 Authenticator codes: a login may hold a TOTP seed; the bot can have the current code
typed for it without seeing it.

### 4.5 Knowledge, memory, history

RKZ-240 **note-fact** (W): add one short fact to the bot's notes; or replace/delete an
existing fact by quoting its old text. Notes are capped at 4 KB.

RKZ-241 **save-shared-memory** (W): replace a named shared document read by every bot in the
space (≤ 4,000 chars per save).

RKZ-242 **semantic-save / semantic-recall / semantic-reflect / semantic-forget**: only with an
external memory provider. Recall returns cited memories; reflect answers a question by
reasoning over many memories; forget takes an id from a recall citation.

RKZ-243 **history-search** (R): literal keyword search over earlier messages and attachment
file names. Scope "this chat" (default) or "all my chats" (owner-started app runs only).
Accepts one query or up to 5 variants (every word of a variant must match the same message),
filters by date range, bot, and kind (bot exchanges/handoffs, user/channel text, bot text
replies, replies that used tools). Returns ≤ 5 hits newest-first grouped by chat, with a
continuation cursor.

RKZ-244 **history-read** (R): read around a message (around | older | newer, ≤ 5 messages),
including linked background-run outcomes, artifact references and attachments, with cursors
for long text. Authorization is rechecked per thread. Results are framed as possibly outdated,
untrusted data.

RKZ-245 **inventory** (R): authoritative list of the bot's real open tasks, routines, taught
skills, reusable skills and currently offered tools; the bot must consult it before claiming a
task or skill exists.

### 4.6 Open work, tickets

RKZ-250 **scratchpad list/add/update/complete/remove**: the bot's own to-do list (open,
parked, done). Explicitly not a reminder mechanism.

RKZ-251 **board list / ticket get / create / update / comment** (optional feature): shared
ticket board; assigning a ticket to a bot starts a run; ticket work stays out of chats but
help requests still appear as cards in the bot's chat.

### 4.7 Scheduling

RKZ-255 **schedule-create** (W): exactly one timing method — cron (5 fields); every N
minutes/hours/days (min 1 minute) optionally from a start date; one-shot at a datetime; one-shot
after N minutes; one-shot after N seconds; or a change-watch (RKZ-413). Name + self-contained
prompt + timezone (default: user's). Blank/null leftovers for unused timing fields are
tolerated. The prompt must state the lasting request including standing preferences;
one-off decisions become conditions rather than permanent changes.

RKZ-256 **schedule-list / schedule-update / schedule-cancel**: update sends only what changes;
pausing via an active flag; cannot change a watch's interval or timezone. Inside a routine run
the update capability is hidden.

### 4.8 Skills

RKZ-260 **skill-read** (R): load a skill's instructions by exact name, or one of its reference
files. **skill-create / update / delete** (W): for user-created skills only; built-in and
plugin skills are read-only. Skills must be generic how-to; account names, channels and
inboxes belong in a routine.

### 4.9 Output and media

RKZ-265 **render-chart** (W): declarative chart spec + inline rows or a CSV/TSV/JSON file →
PNG saved to the workspace and attached. Self-documenting: can list chart types with runnable
examples, search them by keyword, or return a full guide.

RKZ-266 **save-page** (W): create/update a rich page from component source using a provided
component kit (RKZ-520). Supports full replace, atomic find/replace edits (each "find" must
match exactly once; all or none apply), reading current source, and returning the kit guide on
demand. Validation errors return with line numbers and nothing is saved.

RKZ-267 **generate-image / generate-video** (W, may cost money): image attached on
completion; video is asynchronous and attached when ready without polling; no automatic
retry of failed submissions.

### 4.10 Web and data

RKZ-270 **web-search** (R): titles, URLs, snippets (default 5, max 10). No computer needed.

RKZ-271 **web-fetch** (R): readable text of a public page without JavaScript (default 8,000
chars, 100–50,000, with offset for continuation). SSRF-guarded: 15 s timeout, 5 MB, ≤ 5
redirects, private/metadata addresses blocked.

RKZ-272 **paid-service search / call** (optional): find a metered data service by the job it
does, then call it with a declared maximum cost (≤ $2 per call) shown on the approval.

RKZ-273 **paid-request / request-purchase / purchase-status** (optional): pay-per-request APIs
and wallet purchases; every purchase is approved by the human in their wallet, bound to one
merchant URL, with a justification of ≥ 100 chars shown to the approver.

### 4.11 Integrations

RKZ-275 **add-tool-server** (W): register a remote tool server from details the user supplied
(name, transport, HTTPS endpoint, optional headers/token); it is created immediately but its
tools become usable only after the person approves a card. Local-process servers are
admin-only.

RKZ-276 Connected-app tools, tool-server tools, OpenAPI operations and GraphQL operations are
exposed alongside built-ins through the lazy catalogue (RKZ-170), each carrying a declared
read-only flag.

RKZ-277 **remote coding agent launch / status / reply / cancel** (optional): start a hosted
coding agent on a repository (optionally opening a PR); the bot is woken when it finishes.

### 4.12 Email

RKZ-280 **claim-address** (W): give the bot a permanent address (2–64 chars local part) on the
server's mail domain, only after the owner agreed to the exact name; never changeable.

RKZ-281 **email-read** (R): list newest, search sender/subject/text, page by time, read one
message in full (body in 8,000-char pages; attachments copied to the computer), or wait up to
120 s for a matching new message (for sign-up codes). Each message carries a verified flag;
mail is always framed as untrusted.

RKZ-282 **email-send** (W): plain text from the bot's address to the owner's verified address
or operator-approved recipients; optionally replies to authenticated senders of mail received
in the last 30 days. Rolling 24 h allowance (10 deliveries initially, shared by all the
account's bots; every recipient counts). **email-delete** (W): permanently remove up to 50
received messages.

### 4.13 Self-configuration and fleet

RKZ-285 **update-self**: with no fields, read own settings plus selectable models and thinking
levels; with fields, patch name, description, avatar colour/shape or an attached image,
notifications, daily check-ins, instructions (whole-text replace, paged read for long text),
model (resolved from a loose name against connected models), thinking level, read-aloud,
voice. Only when the user asks. Chat-made changes produce an undo affordance (instructions
via history; other settings via a card that restores previous values only if the changed
ones still hold). A bot can never widen its own powers from chat (credentials, disabled
tools, fleet permission, cross-space permission, computer mode, memory scope, approval rules).

RKZ-286 **update-user-preferences**: read/change the user's timezone and marketing-email
opt-in only, only in runs they started.

RKZ-287 **create-space** (W): propose a new space; always needs a person's approval.

RKZ-288 **spawn-bot** (W): create a full peer bot (name, description, instructions, optional
first task, team or private computer).

RKZ-289 **helper-agent**: short-lived helper with a label, a task, optional extra instructions
and optional model; no thread, memory or roster entry of its own (see §9).

RKZ-290 **message-bot** (W): asynchronous message to another bot with an intent (request |
result | question | status | fyi) and up to 4 file/folder attachments. **handoff** (W): pass a
distinct next stage to another member of a group. (See §9.)

RKZ-291 **fleet tools** (permission-gated): list bots/groups/sections (≤ 200 bots, ≤ 100
groups, truncation stated) or read one bot's full instructions + version; create group; update
group; move to section / pin; edit another bot's profile; replace another bot's instructions
(must pass the version it read; one edit per bot per run); set/clear another bot's model;
create a routine for another bot; archive another bot (exact-name confirmation; never itself).

RKZ-292 **cross-owner agent messaging** (only when a public chat line is enabled): request a
standing connection to another person's agent by their chat address; approve/decline on the
owner's explicit instruction; message over an approved connection.

---

## 5. Memory and knowledge

RKZ-300 Three layers of first-party memory, none requiring an external service:
(a) per-bot notes (≤ 4 KB, one fact per line, rewritten rather than appended, merged or pruned
to make room); (b) space-shared documents every bot in the space reads and maintains;
(c) rolling conversation summary (RKZ-151).

RKZ-301 Users can read, edit, download and delete every note, and add their own beyond the
bot's cap. Memory documents keep revisions naming the run that changed them.

RKZ-302 "Just tell it" works: a remember-this instruction results in a note.

RKZ-303 Optional semantic memory provider per space with a default scope: isolated (each bot
recalls only what it saved; default) or shared (one pool per space). Each bot may override the
scope. Provider can be recall-and-write or recall-only.

RKZ-304 Conversation learning (provider-dependent): bounded excerpts of recent human messages
and replies (≤ 200 messages, ≤ 32,000 chars total, ≤ 8,000 per message) from direct chats,
groups and bot-to-bot exchanges are submitted for learning; can be switched off. Up to 5
recalled memories are injected automatically per run.

RKZ-305 Memory is context, not permission. Old replies, summaries, recalled facts and other
bots' messages never carry authority to change instructions or authorise actions. Speaker and
provider attribution is preserved but does not certify truth.

RKZ-306 Automatic recall draws only from the bot's own and deliberately shared space memory.
Imported/external banks are read only by explicit recall, which counts as fresh outside input
(tainting the run, RKZ-610).

RKZ-307 Memory never crosses spaces. Deleting a bot can preserve or remove its memories.

RKZ-308 Open work (scratchpad) is separate from memory and user-editable from bot settings.

RKZ-309 Skills are the procedural knowledge layer: listed one line each in context, body
loaded on demand; matched automatically or invoked explicitly with a slash command; sources
are user-written, bot-saved after a multi-step task, imported from a public repository
(instructions only — bundled scripts never run), plugin-provided, or taught by demonstration.

RKZ-310 Teach by demonstration: the person states the goal, records themselves doing the task
on the bot's screen (the bot watches, does not act; protected input is not recorded), stops,
and receives an editable draft skill covering steps, when to use it, what to verify, and when
to ask first. The draft can be saved, test-run once, or attached to a routine. Recording
visibility is limited to the teacher in shared spaces.

RKZ-311 Skills the user adds are available in all their spaces unless narrowed; skills a bot
creates stay in the space where they were created, and a bot may only modify skills that live
in its space alone.

RKZ-312 Files as memory: bots can retrieve files sent long ago through history search over
attachment names; every file a bot produced is listed in a global artifacts view with search
and date filter.

RKZ-313 Built-in product-help skill: an index of documentation topics the bot fetches before
answering product questions instead of guessing.

RKZ-314 Agent import: bring an existing assistant in from another agent framework's home
folder or backup archive, or from a pasted self-description produced by a supplied export
prompt. A review screen lists every found item (instructions, memory, skills, model, tool
servers, scheduled jobs, API keys) with checkboxes; anything that runs code or acts on its own
starts unticked, as does text that looks like it contains a key. A "not imported" list
explains omissions. Imported schedules arrive paused; the new bot opens with a checklist of
remaining setup. Limits: 500 files, 100 KB each, 4 MB total.

---

## 6. Automation

### 6.1 Routines

RKZ-400 A routine = name + self-contained instruction + one or more triggers + optional model
and thinking override, owned by a bot, reporting into that bot's chat. Creatable by asking in
chat or through an editor; has active/paused switch, "test run now", run history (first page
5, then 20 per page), and a live running indicator with stop.

RKZ-401 Schedule triggers: hourly, daily, weekdays, weekly, monthly, custom interval, or raw
cron; evaluated in the user's timezone. One-shot reminders ("in 20 minutes") are routines too,
with second-level granularity available.

RKZ-402 Recurring timer coalescing: at most one untouched pending catch-up run exists per
routine; later ticks reuse it. Late runs are never skipped; a run starting ≥ 15 min after its
due time is told both the due time and the actual time, and the history shows how late it
started.

RKZ-403 Routine runs do not see chat history; the prompt is all they know. They may finish
silently when there is nothing worth reporting.

RKZ-404 A routine carries its own notify setting. Repeated account-level failures are counted
and can pause the routine with an explanation.

### 6.2 Event triggers

RKZ-410 Webhook: per-bot URL + secret key; any POST (≤ 64 KB body) starts the routine. The
payload is fenced as untrusted data and event labels are sanitised.

RKZ-411 Git-hosting webhook: a URL to register for push / issue / pull-request events.

RKZ-412 Email: mail arriving at the bot's address starts the routine; allowed senders are the
owner only or anyone at the owner's email domain; sender authenticity is verified (signed
mail). BCC'd or unverifiable mail starts nothing but is still stored. Without a routine, the
owner's own verified mail to the bot is treated like a chat message, with quoted/forwarded
content treated as data.

RKZ-413 Change watch: every 5–1,440 min (default 15) a model-free checker fingerprints
something and runs the routine only when it changed: files/folders on the computer, a shell
command's output, a read-only connected tool call with fixed arguments, or a public HTTPS GET
(no auth, headers, body or redirects). For JSON lists the watch tracks an identity field plus
the fields whose changes count, and can name changed items (≤ 20 listed). The first successful
check only records a baseline. Optional "post a note even when nothing changed". A watch
cannot be combined with a schedule. Checks time out at 60 s; a busy/booting computer is
retried in 60 s without counting as failure; a permanently failing check pauses the routine
and the bot says why. Only fingerprints are stored, never endpoint data.

RKZ-414 Messaging trigger: a routine may be the handler for messages arriving on a connected
team-chat workspace; mentions are batched (≤ 100).

RKZ-415 Externally triggered runs (webhook, email, channel message) follow the owner's
approval mode but with outside-content rules: every changing tool is gated even if the owner's
own chats never ask, and purchases are refused outright.

### 6.3 Self-initiated work

RKZ-420 Follow-ups: when something is left open until a known time, the bot may set itself
one follow-up routine linked to a scratchpad item; if the item is already closed when it
fires, the run stays quiet; closing the item cancels the follow-up.

RKZ-421 Daily check-in (per-bot opt-in): once per 24 h, a bot with open-work items untouched
for ≥ 12 h gets a proactive run (≤ 5 items in the prompt) limited to asking or messaging the
user — no autonomous side effects, enforced at dispatch as well as by tool listing. It may
stay silent. A failed check-in backs off for 7 days.

RKZ-422 Escalation: after three unanswered reminders about the same thing a bot may ring the
user (RKZ-223).

### 6.4 Background and maintenance work

RKZ-430 Background helpers (RKZ-702), asynchronous media jobs, remote coding agents and
purchases each wake the originating chat with a new run when they settle.

RKZ-431 Computer idle management: a computer starts lazily when needed, sleeps after 10 min
idle (configurable; 0 = never), with a 30 min grace while a person holds the screen and an
optional maximum uptime (2 h) on providers billed by runtime. Detached shell work the bot
started is detected and holds off sleep. Opening the screen wakes it.

RKZ-432 Workspace persistence: the computer's home is snapshotted on sleep and after runs
that touched it, so a replaced or destroyed machine restores the last saved workspace.
Maintenance actions: stop, update (save then install current software), recover (recreate a
broken machine), reset (return to last saved workspace).

RKZ-433 Other periodic jobs: history compaction, stuck-work reminders/expiry, outbound message
delivery sweeps, dead-job pruning (7 days), audit/security log retention (365 / 90 days),
expired call clean-up, retention of deleted homes.

---

## 7. Integrations and channels

### 7.1 App connections

RKZ-500 Connect from chat ("connect my calendar" → inline card → provider sign-in) or from an
integrations screen (search, browse by category, connect, reconnect, rename account,
uninstall). Once connected in a space, every bot in that space may use it; bots choose which
apps they need rather than per-bot setup.

RKZ-501 The managed app catalogue is optional (backed by a hosted connector provider when
the operator configures one). Custom sources work on any server: remote tool server by HTTPS
URL (with a public directory search), OpenAPI document, GraphQL endpoint, a tool gateway
reachable with one token, or a plugin from a public repository.

RKZ-502 Auth options for custom sources: none, bearer token, API-key header, or OAuth
discovered from the server (with manual client id/secret fallback). Credentials are encrypted
and never sent to the model. A "verify and add" step tests the connection; a management list
shows health, tool count, test-connection, sign-in state and which bots may use each server.

RKZ-503 First use of a tool server by a bot requires an in-chat approve/authorise card.
Per-bot assignment supports "all tools" or an explicit allow-list.

RKZ-504 Within one run all calls to a given tool server share one session (so servers with
pausable, stateful steps work); sessions are never shared across runs and close at run end or
after ~10 idle minutes.

RKZ-505 Discovery limits: per-server tool-list wait 20 s (the run proceeds without that
server on timeout), ≤ 250 tools.

RKZ-506 Interactive mini-apps: a tool server may ship a small UI rendered above the bot's
reply. It runs sandboxed, sees only that call and result, may reach only declared sites
(≤ 32), cannot call tools or see the account; links ask before opening; a message it suggests
is placed in the composer for the user to send. Size limits: 2 MB markup, 256 KB result,
64 KB arguments.

RKZ-507 Plugins: a manifest plus optional tool-server declarations and skills in a public
repository. Installing previews what will be added and what is skipped; installs are pinned
to a commit and never auto-update. Anything that would execute third-party code server-side
(hooks, local processes, scripts) is not installed. Limits: ≤ 200 files, 100 KB per file,
4 MB total; ≤ 40 reference files / 400 KB per skill. A marketplace submission flow with
manual review exists.

RKZ-508 Availability: each user-added skill, tool server and plugin is available in all of
the owner's spaces (including future ones) or a chosen subset; the control appears only when
the user has more than one space. Managed app connections stay with the space they were made
in.

### 7.2 Messaging channels

RKZ-510 Supported channel families: workplace chat (workspace install + DMs + channels),
enterprise chat DMs, consumer chat apps (DMs; personal group linking on some), SMS, and
optionally more. A settings screen lists what the operator configured.

RKZ-511 Linking: choose a bot, choose an app, receive a code, send it from that app within
10 minutes. Thereafter messages there go to that bot's one conversation and replies return
there; the conversation is the same one seen in the app. A linked sender pasting a new code
re-points the address to another of their bots. Unlinked senders get silence unless the
operator enabled an open sign-up line.

RKZ-512 Owner text commands in the verified 1:1 chat: yes/no (answer the most recent invite
or connection request, within a day), leave, stop.

RKZ-513 Voice notes delivered as audio are transcribed (20 s budget per message) when a
transcription-capable voice provider is connected; otherwise the file is passed through.

RKZ-514 Personal group linking: adding the line to a group produces an invite request the
owner approves or declines in settings (or by replying yes/no); messages from approved linked
members reach each such member's own bot; unlinked members trigger a one-time intro note.

RKZ-515 Team rooms (workspace channels) have per-room settings: listen to everything or
mentions only; plain-language room guidance (≤ 4,000 chars); and a per-automated-sender
policy (ignore | roll up into a periodic digest | always act | treat like a person).

RKZ-516 Ambient listening: unaddressed room messages wait for ~15 s of quiet, then a small
judge model reads recent context (≤ 20 messages, ≤ 2,000 chars each) plus the room guidance
and decides whether the bot should engage. Direct mentions always engage.

RKZ-517 In shared channels the bot uses its private memory and notes only for the person who
connected/linked it; everyone else is answered the way a group chat is.

RKZ-518 Outbound delivery is queued with idempotency keys, a 60 s send timeout, stale-claim
takeover at 2×, strict ordering per conversation, and a cap on consecutive outbound DMs
without a reply (≈ 140) after which messages are held until the person writes again.

RKZ-519 Bot email (RKZ-280–282) requires the operator to route inbound mail for a domain to
the server; every message is stored regardless of sender, capped per bot per day against
floods.

### 7.3 Pages

RKZ-520 A page is authored as a single component file against a fixed kit: structure (page,
hero, sections incl. collapsible, table of contents, grid, divider, floating bar), text
(paragraph, callout, quote, bullet/numbered lists, pros/cons, link cards), maths, data
(metrics with deltas and sparklines, properties, status pills, rows, steps, checklist,
sortable/filterable table), charts (line, bars, columns, grouped/stacked series, stacked bars,
donut, scatter with trend, heatmap, calendar heatmap, Venn, 2×2 matrix, auto-layout flow
diagram, "as of" stamp), and controls (segmented switch) with local state. No network, no
script/style/iframe elements, images only as data URIs, colours from the theme.

RKZ-521 Pages render in an isolated viewer in light/dark, print cleanly (PDF via the browser),
appear as a card in chat, open full-screen with the chat docked below for change requests,
and are listed per bot/group with rename, pin, delete.

RKZ-522 The bot edits the same page rather than creating new ones, so a routine can keep a
dashboard current. Sharing: private by default; "anyone with the link" gives sign-in-free
viewing and reflects each save immediately; switching back disables the link.

### 7.4 Voice

RKZ-530 Voice providers are pluggable (speech + transcription, speech only, a self-hosted
OpenAI-compatible speech server, or the host OS's voices). Settings: provider, key (or reuse
of a model connection), voice with sample playback, speech model, transcription model.

RKZ-531 Hold-to-talk dictation in the composer with slide-to-lock; per-message "speak this
reply"; per-bot "read replies aloud" with a per-bot voice. Optional spoken summary for replies
longer than a threshold.

RKZ-532 Live calls: call a bot from the chat header; mute, live transcript, minimise while
using the app, hang up; the transcript remains in the chat. During a call the bot answers in
short spoken style and can end the call itself. Bots can ring the user (incoming-call UI with
accept/decline; missed-call marker with call back). Mobile may use on-device speech
recognition and voices; calls continue with the screen off where the OS allows.

### 7.5 Computers and sandboxes

RKZ-540 Sandbox providers are interchangeable behind one contract: lifecycle (provision /
reconnect / stop / destroy), desktop (observe, ordered batched actions, user input, live
screen session), command execution, files (list/read/write and whole-workspace
export/import). Options range from local containers to hosted sandboxes, a cluster, a local
VM, the host machine itself, or "none".

RKZ-541 Team computer (default): one per space; bots share files and installed tools; each
bot has its own folder plus a shared folder (organisational, not a security boundary). Each
concurrently active bot gets its own display and browser process with a persistent per-bot
profile. Sign-ins are checkpointed into a shared identity so other bots' browsers pick them
up; older desktops cannot overwrite newer shared state. Private computer: fully isolated home
and browser identity.

RKZ-542 Screen control is exclusive: one actor at a time. A person can watch live, take
control, and release; control also returns when they leave the screen or stop checking in for
about a minute. While a person holds control the bot's screen actions are refused (not
queued), and afterwards the bot must look again before acting. Taking over one bot's screen
never blocks other bots.

RKZ-543 View and control are separate revocable capabilities; a recycled display can never
serve an old connection.

RKZ-544 Optional egress restriction for computers (block host, private ranges and cloud
metadata), per-user and per-space computer caps, optional cap on simultaneous desktops,
resource limits per computer.

RKZ-545 Shell guard on a graphical computer: commands that would kill or reconfigure the
desktop session are refused with a reason, including when hidden in quoting or heredocs.

---

## 8. Permissions, approvals, guardrails, audit

### 8.1 Modes and rules

RKZ-600 Three approval modes, account default with per-space override; the deployment chooses
the default so a server with no reviewer model still works:
- **Ask**: ask before anything that changes something; reads ask only when the request itself
  could carry private data somewhere new.
- **Auto**: a reviewer model passes actions that plausibly serve the owner's request or the
  bot's job, and asks only when an action is clearly off-task or irreversible and unrequested.
- **Never ask**: everything runs without waiting (with the narrow exceptions below).

RKZ-601 Two rule lists shape every mode: Allow and Block, keyed by exact tool, connector,
category or site. They grow from approval cards ("always allow this tool / this site") and
from settings, never from guessed categories. A settings preview shows what would happen for
a given tool.

RKZ-602 Deterministic resolution: a block always wins (a narrower allow cannot punch through
it); otherwise the most specific rule decides, and a site rule beats a tool rule. A blocked
action is refused without a card in every mode.

RKZ-603 Batch tools that name several inner actions are evaluated per action; the strictest
decides; an entry that names no action forces a question. Generic "run anything" connector
tools match any non-site block so a block cannot be routed around.

RKZ-604 Read/write classification: a connector tool's declared write always needs approval; a
declared read never relaxes the name-based check, because the provider chooses both name and
hint.

RKZ-605 Approval card: shows exactly what will run (summary ≤ 500 chars, detail ≤ 4,000; a
request that cannot be shown whole is refused rather than truncated) with allow once / always
allow (tool or site) / deny. Deny lets the bot carry on. The stored request is what executes
on resume, even if policy changed meanwhile.

RKZ-606 Always-ask actions (Ask and Auto; "always allow" not offered): changing a bot's
instructions or model via fleet tools, creating a space, a routine that watches a shell
command or repeats HTTP requests unattended, a routine naming a site that the run only
learned from outside content, logins marked "ask first", saved-card fills. Never-ask runs
them, except accepting another owner's agent connection when the run was not owner-started or
has read outside content.

RKZ-607 Purchases ask in every mode including Never ask; no rule or reviewer passes them; in
runs with nobody to ask (webhook) they are refused.

### 8.2 Outside-content ("taint") model

RKZ-610 A run becomes tainted when any tool returns content that could carry attacker text:
pages, search hits, files, connector data, screenshots, shell output, other bots, email,
explicit semantic recall, replayed tool history. Only confirmations of the bot's own writes,
the owner's answers and the product's own saved state do not taint. New tools taint by
default.

RKZ-611 After taint, or in any non-owner-started run: memory saves go through approval;
connector reads are free only on connectors the run already used or was approved for
(arguments could now be attacker-chosen); fleet changes are disabled for the rest of the run
(Ask/Auto).

RKZ-612 Outbound-site gate: fetching a URL sends data to that site, so a site the run was not
"given" is a new destination. Given = named in the owner's own words, approved earlier in the
run, covered by a site allow rule, or the exact URL of a search result (which trusts only that
URL). A new site goes to the reviewer (Auto) or the person; in webhook runs with nobody to
ask it is refused. "Always allow" on such a card allows the site, never the whole tool.

RKZ-613 Reviewer isolation: for a new site or a post-taint memory save, the reviewer sees only
the owner's own words and the full request — never tool results or inbound messages — so
injected text cannot argue its own case. In webhook-started runs it judges against the
owner's routine text only.

RKZ-614 Reviewer robustness: 10 s timeout; verdict must be a single well-formed structured
object with no repeated keys, else it becomes "ask"; one retry on unreadable output; errors
fail closed to asking; arguments too long to show the reviewer in full (≈ 8,000 chars) always
ask; minimum confidence threshold (0.5 default). Decision, reason and model are stored on the
effect and audited.

RKZ-615 Background helpers may only read, regardless of mode or rules; they can never show a
card.

### 8.3 Effects and idempotency

RKZ-620 Every consequential call records an effect before executing and moves it through
approved → executing → completed/uncertain. On a retried attempt the stored result is
returned instead of re-executing; if the outcome is unknown the model is told the effect is
uncertain rather than silently repeating it.

### 8.4 Secrets

RKZ-630 The model has no way to read a stored secret. Values are encrypted at rest with
record-bound authenticated encryption; optional external secret store; optional content
encryption with per-space keys and key rotation.

RKZ-631 Output scrubbing: tool results (pages, command output, file reads) are scrubbed of
saved hidden login values in plain, URL-encoded, form-encoded and base64 forms, in every run
on that computer; values shorter than 6 chars are scrubbed only in the run that used them.
Tool arguments stored for replay redact fields whose names suggest credentials.

RKZ-632 A login fills only if the page is on the saved origin (or one of ≤ 10 owner-added
exact origins) at that moment; lookalike hosts, plain HTTP and redirects are refused; frames
must be on the login's own site. Wildcard origins are refused. Only the owner can add origins.

RKZ-633 Per-credential policy: usable by all bots or selected bots; "use freely" or "ask
first"; per-item activity list (last 20 uses). Space may use the account vault or keep its
own.

RKZ-634 Shell variables are a convenience, not a boundary: documentation must state the bot's
shell can read them. Reserved names (loader, runtime, TLS, git/ssh helpers and product
prefixes) are refused.

RKZ-635 Fleet tools refuse instructions, profile text or routine prompts that contain detected
credentials.

### 8.5 Spending

RKZ-640 Once a bot can pay, a spending limit (amount, currency, reset daily/weekly/monthly/
never, in the user's timezone) covers all bots and spaces of the account. A payment that would
exceed it is refused before the person is even asked. With a limit set, a checkout whose total
cannot be read, or is in another currency, is refused. A recent-payments list shows site, bot,
time and amount.

RKZ-641 Pay-click detection: before screen/page actions, the page browser is asked whether a
click or key press would complete a purchase; the approval card shows the button text, total
and order lines read from the page itself (not chosen by the model), with invisible/bidi
characters stripped.

### 8.6 Other guardrails

RKZ-650 Outbound links in chat ask before opening; "always open" builds a per-user trusted
site list. Web images load automatically only if the user enables it.

RKZ-651 Mobile asks consent before first sending content to the AI services the server uses;
reviewable and withdrawable later.

RKZ-652 Host-computer access requires native confirmation on the device, belongs to the
account that enabled it, ends on sign-out/password reset, asks before first use of each app
per space in every approval mode, and is never available to routines or other people's
messages.

RKZ-653 SSRF policy shared by web fetch, authenticated requests, watches, model endpoints and
tool servers: public HTTPS by default; private/loopback only with explicit operator opt-in;
link-local and metadata addresses always blocked.

### 8.7 Audit

RKZ-660 Audit log (per organisation/space): tool calls (success | failure | denied),
approval decisions, auto-review verdicts, approval policy changes, credential
created/changed/deleted/revealed/used, space created/renamed/deleted, sign-in/out, password
and passkey changes, session revocation, device changes, account (de)activation, audit
export. Append-only (updates rejected at the database), labels copied at write time so
records survive deletion of their subjects, retention pruning only, export and optional
forwarding to an external collector with retry.

RKZ-661 A user-facing Activity view lists every run with status and date filters, and flags
runs that failed or have been waiting on the person.

---

## 9. Multi-agent and delegation

RKZ-700 **Helper agents (in-turn)**: the parent spawns a helper with a label and task; it
shares the parent's turn budget, has no thread/memory/roster entry, never gets fleet tools,
and returns a bounded result (≤ 12,000 chars) that the parent reads as a tool result
explicitly attributed to the helper. Shown as a card (running | completed | failed). A helper
that needs approval or the user's input pauses the parent.

RKZ-701 Intended product direction (not fully implemented in the reference): one helper
behaviour where helpers run independently while the parent stays conversational, can take
actions under the same approvals, never gain authority through delegation, and report back to
the parent, which reconciles late results against changed instructions or cancellation.

RKZ-702 **Background helpers**: a helper started in its own hidden thread so the chat stays
free; read-only tools, no computer, no questions, no memory/skill/routine changes. Only a turn
in the bot's own app chat may start one; a returning result never starts another. Its result
comes back as a new turn in the originating chat and settles its card; a stopped helper only
settles its card.

RKZ-703 **Bot-to-bot messages**: asynchronous, with intent and optional files (recipients on
the same computer read in place; others get copies). Delivery is idempotent, echoed in the
sender's chat in the same transaction, and wakes the recipient. Both chats show a
"messaged / message from" marker that opens a view-only exchange. When a requested bot
finishes, its final outcome is returned automatically to the requester exactly once unless it
already sent an explicit result. Bots are told not to poll or send acknowledgement-only
messages.

RKZ-704 Bots choose whom to ask from each bot's one-line public description.

RKZ-705 **Group chats**: 2–10 bots sharing only the conversation; each keeps its own memory,
computer and instructions. Routing: no mention → the first member answers and may bring in
others; @name wakes that bot (several allowed; each mention consumed once so a full name does
not also wake its prefix); @everyone wakes all. A member not named may stay silent.
Non-member mentions remain plain text.

RKZ-706 **Handoff**: within a group, a bot passes a genuinely distinct next stage to another
member with a visible handoff entry and optional files; the turn that handed off needs no
reply. Bots are told not to hand back merely to report. From outside a group the bot must name
one of its own groups as the destination.

RKZ-707 **Bots that build and manage bots**: any bot can create a peer bot. With the per-bot
"manage other bots" permission (on by default for new bots, rechecked on every call) and only
in owner-started runs, a bot can organise the sidebar, form and edit groups, edit other bots'
profiles, rewrite their instructions (optimistic version check; saved to instruction history
attributed to the managing bot), set their model, schedule routines for them, and archive
them. It cannot permanently delete a bot, touch secrets, change another bot's permissions /
memory scope / computer / voice / connections, move bots between spaces, or remove itself from
the group it is running in. If the target changed while an approval card waited, approving
does not overwrite.

RKZ-708 **Remote coding agents** (optional) and **cross-owner agent connections** (optional,
mutual owner approval) extend delegation beyond the space.

RKZ-709 Shared resources coordinate rather than couple: simultaneous work by different bots
on a team computer is independent; only work needing the same screen waits.

---

## 10. UI screens and interactions

### 10.1 Shell

RKZ-800 Layout: left sidebar (space switcher, create button, search, roster of bots and
groups in user-defined sections with pins, activity toggle, archived and snoozed shelves,
footer with connect-apps and account menu), centre chat, optional resizable right panel
(computer, pages, routines, details).

RKZ-801 Create menu: new bot, new group chat, new private space. Creating a bot needs only a
name; the bot then asks what its job is.

RKZ-802 Roster item context menu: pin, move to section, mark unread, duplicate, archive,
delete; drag to reorder. Archived bots restorable. Density setting for the sidebar.

RKZ-803 Activity view replaces the whole roster (not shown alongside it) and lists runs with
status/date filters.

RKZ-804 Snooze a chat until a preset time (mornings at 09:00 local, next week on Monday); it
returns marked as woken. News waits for the snooze; questions, takeovers and failures still
notify the run's person.

RKZ-805 Command palette (jump to bot, page, setting, or run an action), global search over
bots and conversations, in-chat find bar, keyboard shortcut sheet. Shortcuts cover: create,
group chat, palette, connect apps, chat details, focus composer, dictate, switch to bot 1–9,
next/previous bot, back/forward, toggle sidebar, settings, escape to stop the reply; typing
anywhere starts a message.

RKZ-806 Unread badges per chat and on the app icon; unread divider in the transcript.

### 10.2 Chat

RKZ-810 Composer: send with Enter (default on desktop, off on touch), attachments via button
/ drag-drop / paste (default 4 per message, 10 MB each, configurable), @ to mention a bot,
group, routine or connected app, / at message start to pick a skill, hold-to-talk microphone,
stop button while a run is active, per-chat model picker.

RKZ-811 Messages: markdown with tables, charts, files (inline preview + download; PDF viewer;
sandboxed HTML viewer), page cards, images. Hover actions: react, reply, copy; select text in
a reply to quote just that part. Streaming on by default (toggle). Copy preserves markdown.

RKZ-812 Tool activity disclosure (off by default, per-device preference): while live, shows
the last six steps with a count of earlier ones; when finished, folds to one line with tool
count and duration; a message with only tool calls renders as a slim line, not a bubble.

RKZ-813 Cards: question with tappable options; approval; protected credential entry (masked
fields, origin shown, save-to-vault switch); app connect / sign-in; tool-server approve or
authorise; takeover request ("needs you" → done / skip); helper agent; child bot; remote
agent; skill draft (edit, save, test, add to routine); settings-updated with undo;
import-setup checklist; incoming call; missed call with call-back.

RKZ-814 Bot header: name (opens settings), call button, computer button, working indicator.

### 10.3 Bot settings panel

RKZ-820 Top level: name and avatar (shape + colour picker or upload), notifications on
finish/needs input, open work (add, complete, remove), memory notes (edit, download, delete).

RKZ-821 Advanced: model + thinking, computer mode, voice + read aloud, permissions
(cross-space communication, manage other bots), instructions with history and restore,
public description for other bots, disable individual tools, memory scope (when a provider
exists), export setup as a file, clear conversation.

### 10.4 Computer panel

RKZ-830 Live screen beside the chat or full window; states: sleeping, booting, running,
"you have control", "needs you". Actions: take control / release, done / skip for takeover
requests, on-screen keyboard on mobile, teach a task, more actions (stop, update with
progress stages, recover, reset). Below the screen: routines list with create/edit, and an
embedded terminal/files where supported. Shared-space notice that sign-ins are shared.

### 10.5 Routine editor

RKZ-835 Fields: name, instruction, triggers ("add trigger": schedule presets + cron, change
watch with interval and what to watch, webhook with URL + key, git event URL, email with
address claim and sender policy, messaging), advanced model/thinking, active switch, test
run, run history with late-start labels.

### 10.6 Group panel

RKZ-840 Group settings: rename, add/remove members (2–10), delete; tabs for members, pages,
artifacts.

### 10.7 Integrations and skills

RKZ-845 Integrations: catalogue with search and categories, featured apps, per-app page
(connect, reconnect, rename, uninstall), "+" to add tool server / OpenAPI / GraphQL / gateway /
plugin from repository, manage tool servers (health line, test, OAuth sign-in, per-bot
access, "use in this bot"), availability-in-spaces control, bot templates.

RKZ-846 Skills library: your skills, plugin skill sets, browse ready-made, new skill form
(name, when-to-use description, steps), add from repository with preview.

RKZ-847 Bot templates: ready-made bots (e.g. morning briefing, inbox triage, pull-request
review, topic watch) each previewing an example output and listing what will be added
(instructions, a skill, a paused routine). Nothing is connected automatically; creating the
same template twice opens the existing bot.

### 10.8 Settings

RKZ-850 General: name, appearance (light/dark/system), sidebar density, language, timezone;
advanced toggles (send with Enter, stream replies, show tool activity, auto-load web images);
trusted link sites; computers ("let bots use this computer", connected/offline); data export
(zip of all spaces' chats, files, workspaces), data import, agent import, account deletion
with emailed code.

RKZ-851 Models: add provider, provider list, main model + ordered backups (move up/down),
approval model, computer-use model, per-model thinking, custom server form with model
discovery and advanced fields.

RKZ-852 Voice (RKZ-530), Memory (shared documents editor, provider connection, default
scope), Approvals (mode, allow/block list with switch/remove, preview, spending limit, recent
payments), Vault (items by kind — API keys, logins, shell variables, cards, contacts; add,
replace value, edit extra sites, per-bot access, ask-first policy, activity, import from a
password-manager export), Messaging (link flow, requests, conversations with per-room
settings, unlink), Usage (runs, tokens, cost by model), Security (password, passkeys),
Organisation, Billing (hosted only), Space settings (rename, members + invite, per-space
overrides with "use defaults", delete).

RKZ-853 Other views: Artifacts (all files, search, date filter), Pages list, Peer messages
overlay (view-only bot-to-bot exchanges, one conversation per peer), Board (optional),
public shared-page shell, invite acceptance page explaining what sharing means, onboarding
(connect a model, first bot), admin pages for plugin review.

### 10.9 Notifications and mobile

RKZ-860 Notifications: per bot "when it finishes or needs input"; completion text ≤ 180
chars; a reply notifies everyone in the space, but questions/takeovers/failures notify only
the run's person; muted chats are silent. Browser notifications on web; push on mobile; live
"bot at work" status on lock screen where the OS supports it.

RKZ-861 Mobile specifics: custom server address at sign-in; split view on tablets; share
sheet target ("send to a bot"); OS shortcuts/voice-assistant actions (message bot, ask bot and
return reply, record message, open bot, start voice chat, run routine); haptics toggle;
view/pause/test routines but create/edit triggers beyond schedules on web/desktop.

RKZ-862 Desktop specifics: choose server on first launch (hosted, local stack on this
machine, existing instance by address with connection check) and switch later; local stack
keeps running after quit so routines still fire; background auto-update with an install
prompt; OS-native dictation.

---

## 11. Configuration / environment

RKZ-900 Required secrets for a deployment: database credentials (separate migration owner and
restricted app role), auth signing secret, encryption key, screen-proxy secret, sandbox
supervisor token. Example/placeholder values are detected and called out at production start.

RKZ-901 Core toggles: sign-ups enabled + allowlist; admin emails; default approval mode;
content encryption on/off; secret store choice; object storage (local dir or S3-compatible);
client minimum build; UI default locale; extra nav links; outbound proxy.

RKZ-902 Agent/runtime tunables: default provider/model/credentials; local model list with URL,
context window, max tokens, tokens-per-minute pacing, vision and reasoning model lists;
model stream retries and connect/header/idle timeouts; per-turn tool-call budget; interim
message max chars; bot-message max hops; stuck-work notify/expire thresholds; reviewer
provider/model/min confidence; team-chat judge provider/model.

RKZ-903 Computer tunables: provider selection and its credentials; idle timeout; max active
time; command timeout; per-computer CPU/memory/process limits; per-team desktop limit;
per-user and per-space computer caps; egress mode; DNS; host mounts.

RKZ-904 Integration tunables: managed catalogue keys; tool-server private-endpoint opt-in;
local-process tool servers enable + allowed commands + timeouts; discovery timeout; max tools;
private-HTTP opt-in for credentials; messaging app credentials per channel; open-signup line
toggle; inbound email domain + shared secret; outbound email provider/SMTP; push provider
token; media generation provider/models; paid-data provider; payment wallet provider.

RKZ-905 Feature switches: ticket board; user-device (host computer) access; phone calls with
cooldown and ring seconds; spoken-summary threshold; upload size (MiB) and attachments per
message; experiments list (self-hosters always get the control variant).

RKZ-906 Operations: log level/format, optional log/metrics/trace exporters, security and audit
retention days, audit forwarding URL, job-queue driver (durable queue vs in-memory for
embedded installs), DB pool size, worker concurrency, replica counts and memory limits,
self-update sidecar.

RKZ-907 Providers and optional packages load only when configured.

RKZ-908 Schema changes must stay compatible with the previously deployed release (additive
first; removals deferred one deploy).

---

## 12. Notable constants and edge cases

RKZ-950 Limits summary (reference defaults): bot name 80; description 4,000; instructions
20,000; group 2–10 members, name 80; message text 100,000; reply quote 2,000; notes 4 KB;
shared memory save 4,000; scratchpad title 200 / notes 4,000; ask question 240, options 2–4 ×
80, detail 4,000; interim message 500; attachments 4 × 10 MB; artifact name 255 / description
280; page source 256 KB, title 200; chart rows 5,000; vault 100 items, value 16,384, login
fields 1–8, extra origins 10, one-time code 4–12 chars; history search ≤ 5 hits, ≤ 5 query
variants; fleet list 200 bots / 100 groups; routines 50 per bot; watch interval 5–1,440 min;
webhook body 64 KB; model backups 10; roster in prompt 40.

RKZ-951 Timing summary: recovery sweep 5 s; queue-delay alert 30 s; durable interim messages
after 60 s; ambient debounce 15 s; reviewer timeout 10 s; judge timeout 20 s; shell 5 min;
watch check 60 s; link code 10 min; invite 7 days; takeover wait expiry 30 min; stuck
reminder 4 h, expiry 24 h; idle sleep 10 min; takeover idle grace 30 min; max uptime 2 h;
check-in every 24 h, stale threshold 12 h; call ring 45 s, cooldown 2 min; email wait 120 s.

RKZ-952 Edge: a message that arrives during the bot-creation intro waits and is answered
afterwards.

RKZ-953 Edge: clearing a conversation while a background job (summary save, helper result,
remote-agent wake) is in flight must leave nothing behind and must not resurrect cleared
data; lock order is thread first, then dependents.

RKZ-954 Edge: a group whose members were archived cannot open; restoring the group restores
its bots atomically within computer quotas or not at all.

RKZ-955 Edge: two devices answering the same incoming call, or an answer racing the ring-out,
settle exactly once (compare-and-set on call status).

RKZ-956 Edge: a tool can finish before its "called" event is processed; the UI/event layer
must tolerate either order.

RKZ-957 Edge: text streamed before a tool call must be flushed to the client before the tool
activity line, preserving order.

RKZ-958 Edge: when two assistant text segments are joined into one reply, insert separating
whitespace so they do not run together.

RKZ-959 Edge: a bot's own earlier reply that already holds text must never be extended by a
"continue from tool results" on resume.

RKZ-960 Edge: settings changed while an approval card waits (instructions, model) are not
overwritten by approving; the bot must ask again.

RKZ-961 Edge: a space being deleted accepts no runs, messages, webhooks (HTTP 409) or mail.

RKZ-962 Edge: a deactivated user's bots take no webhook deliveries, mail or channel messages.

RKZ-963 Edge: providers that reject tool names with certain prefixes or over 64 chars require
sanitised, collision-free tool aliases.

RKZ-964 Edge: screen results are compared by frame identity (not text with timestamps) in the
loop guard, so a blinking cursor does not look like progress.

RKZ-965 Edge: a routine created "for this week's" circumstances must not bake in one-off
decisions; if the bot already did this period's work, the first scheduled run is deferred.

RKZ-966 Edge: duplicate bots do not inherit the fleet permission from the source; imported
data restores the exported setting.

RKZ-967 Edge: outbound-link and web-image safety apply to bot-generated content too.

RKZ-968 Edge: evaluation of free-form output uses an LLM judge with a versioned rubric
(opt-in, cost reported separately, judge errors count as unqualified); structured effects are
asserted deterministically. A tool-choice evaluation suite pairs "must act" cases with
"must not touch product tools" control cases.

---

## 13. Top 25 ideas worth adopting

Ranked by user value against implementation cost for a small Node + SQLite + React codebase.
Value and cost: H/M/L. "SQLite note" flags where the single-writer model simplifies things.

| # | Idea | Value | Cost | Notes for a small build |
|---|------|-------|------|-------------------------|
| 1 | One continuous thread per bot + non-blocking cards for questions/approvals (RKZ-002, 004, 813) | H | L | Message blocks as JSON; card state = block status. |
| 2 | Steering: mid-run messages are injected into the live turn (RKZ-114) | H | M | In-process queue per run; poll between model steps. |
| 3 | Three approval modes + exact allow/block lists grown from cards (RKZ-600–605) | H | M | One rules table; block-wins resolver is ~50 lines. |
| 4 | Effect ledger with idempotency keys for every changing tool (RKZ-035, 620) | H | M | Unique (run, key); return stored result on replay. |
| 5 | Routines as prompts: cron / interval / one-shot, test run, history, pause (RKZ-400–403) | H | L | Single timer loop over next_run_at; SQLite note: no leasing needed with one process. |
| 6 | Model-free change watches (files, command, HTTP, tool) with baseline-first (RKZ-413) | H | M | Store only a hash; zero tokens on quiet checks. |
| 7 | Bounded self-maintained notes (4 KB, rewrite-not-append) + shared space document (RKZ-300) | H | L | Two text rows; edit-by-old-text tool. |
| 8 | Rolling summary + 50-message verbatim window with contiguous-cursor rule (RKZ-151) | H | M | Background job after each run. |
| 9 | Loop guard: 6 identical failures / 25 similar / result-novelty reset (RKZ-120) | H | L | Pure function over a streak record. |
| 10 | Main model + ordered backups with transient-vs-permanent error split (RKZ-140–142) | H | M | Classify errors once; reuse everywhere. |
| 11 | Taint model: outside content reduces what a run may do unasked (RKZ-610–612) | H | M | One boolean on the run + list of "given" sites. |
| 12 | Trigger-based trust: owner-started vs everything else (RKZ-111, 415) | H | L | Enum on run; gate fleet/memory/purchases on it. |
| 13 | Credential vault with origin-bound injection and masked entry card (RKZ-230–236, 630) | H | M | Model never sees values; exact-origin match; redact echoes. |
| 14 | Ask-user with 2–4 tappable options and optional detail (RKZ-220) | H | L | Pauses run with checkpoint; resume as same run. |
| 15 | Scratchpad "open work" + self-set follow-ups that stay quiet when closed (RKZ-250, 420) | M | L | Follow-up = one-shot routine linked to item id. |
| 16 | Group chat routing: first member by default, @name, @everyone, optional silence (RKZ-705, 117) | H | M | Ordered membership; "reply optional" flag. |
| 17 | Bot-to-bot messages with intent, hop cap, auto-return of outcome (RKZ-703, 125) | H | M | Hop counter on the message; unique delivery key. |
| 18 | Lazy tool catalogue: small core list + find/use wrappers through the same gate (RKZ-170) | M | M | Big token saving once tools exceed ~20; keep list stable per run. |
| 19 | Interim progress budget (after 60 s, max 3) + one-line working indicator (RKZ-115–116) | M | L | Keeps chats calm without feeling dead. |
| 20 | Skills: one-line catalogue, body on demand, slash invoke, "save that as a skill" (RKZ-309, 260) | H | L | Markdown with front-matter; no code execution. |
| 21 | Pages from a fixed component kit with atomic find/replace edits and link sharing (RKZ-520–522) | H | H | Start with a small kit (metrics, table, bars, line); sandboxed iframe viewer. |
| 22 | Stuck-work reminder at 4 h and expiry at 24 h; takeover expiry at 30 min (RKZ-133) | M | L | One periodic sweep. |
| 23 | Channel linking by one-time code; same conversation everywhere; per-room listen/mentions + guidance (RKZ-511, 515) | H | M | Start with one chat app; ambient judge can come later. |
| 24 | Read/patch "update self" tool with undo, never widening own powers (RKZ-285) | M | L | Omit-fields-to-read pattern; loose model-name resolution. |
| 25 | Append-only audit log with copied labels + user-facing Activity view (RKZ-660–661) | M | L | SQLite trigger rejecting UPDATE; cheap trust win. |

Worth deferring for a small build: multi-process leases and fencing (RKZ-101–103; a single
process with crash-recovery scan is enough), per-bot isolated desktops on a shared computer
(RKZ-541), computer-use model hand-off (RKZ-163), payments and spending detection
(RKZ-640–641), semantic memory providers (RKZ-303–304), plugin marketplace (RKZ-507),
teach-by-demonstration (RKZ-310), content encryption with per-space keys (RKZ-630), and
directory provisioning.
