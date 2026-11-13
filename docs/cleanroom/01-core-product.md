# Functional Specification 01 — Core Product

Self-hosted, multi-bot AI agent application: a web app plus one server process. Each user owns a team of named bots; every bot has its own chat thread, memory, skills, routines, tasks and a private desktop on a shared cloud Linux VM. Bots use connected third-party apps, delegate to each other, run on schedules, and can be spoken to over realtime voice.

Conventions used in this document

- This is a behavioural specification. Names of internal things (tool names, setting names, storage keys, paths, cookie names) are deliberately not prescribed unless they are dictated by an external provider. Where a name is suggested it is marked "(suggested)"; the implementer is free to choose.
- All user-facing wording and all model-facing prompt wording must be written fresh by the implementer; this document only states what the wording must convey.
- "The model provider" = xAI (OpenAI-compatible Responses API at `https://api.x.ai/v1`, realtime voice, TTS, STT). "The computer provider" = Orgo (REST at `https://www.orgo.ai/api`). "The app provider" = Composio (SDK + REST at `https://backend.composio.dev/api/v3.1`). These external endpoints and event names are public provider facts.
- Timestamps are epoch milliseconds unless stated otherwise.
- MUST / SHOULD / MAY are used in the usual sense.

---

## 1. Product concepts and data entities

### 1.1 User

- REQ-001 A user has: unique id, email (unique, compared case-insensitively), display name (defaults to the part of the email before "@"), optional avatar URL (never populated by current flows), creation time.
- REQ-002 All other entities are scoped to exactly one user; no cross-user sharing exists. Deleting a user cascades to everything they own.

### 1.2 Sign-in session

- REQ-003 A session is an opaque random token (at least 256 bits of entropy) mapped to a user, with creation and expiry times. Lifetime: 30 days. Delivered as an HTTP-only, SameSite=Lax cookie on path "/".
- REQ-004 A pending third-party sign-in attempt records: attempt id, a provisional user id generated up front, the provider's connected-account id (if known at start), creation time. It is deleted when the callback is processed.

### 1.3 Bot

- REQ-010 A bot has these fields:
  - id; owner user id.
  - name (required, trimmed, max 60 characters; if empty after trimming, a generic "new bot" default name is used).
  - label: short job title shown beside the name (default empty; UI limits to 60 chars).
  - description ("about" text; default empty; UI limits to 500 chars).
  - instructions: standing guidance from the user, injected into every prompt (default empty; UI limits to 8,000 chars).
  - avatar shape: one of 25 named silhouettes — blob, pebble, bean, egg, squircle, tablet, capsule, cylinder, hex, gem, crystal, wedge, shield, dome, arch, cloud, teardrop, leaf, square, sparkle, clover, flower, heart, house, star.
  - avatar colour: one of 11 — black, brown, red, orange, yellow, green, cyan, blue, violet, magenta, gray.
  - mode: "personal" (default; a private assistant) or "teammate" (described to the model as shared with a team). Mode only changes prompt wording and empty-state copy; there is no real multi-user sharing.
  - primary flag: exactly one bot per user should be primary (the user's main point of contact; the only bot that performs proactive check-ins).
  - kind: "agent" (default) or "room" (a group chat; see 1.6).
  - pinned flag (default false; stored and patchable, but no UI uses it).
  - effort: reasoning effort — low, medium (default), high, xhigh.
  - voice settings: voice id (default "luna"), speed multiplier (default 1; valid 0.7–1.5), language (BCP-47 code from a fixed list or "auto"; default "auto").
  - generation: integer starting at 1; incremented each time the conversation is reset. Transcript rows and model history are partitioned by generation.
  - next row sequence (starts at 1 per generation) and a per-bot revision counter (monotonic; bumped on every row append or rewrite).
  - unread count (default 0).
  - hidden flag and parent bot id (used only for subagents, see 1.7).
  - member list (rooms only).
  - created / updated times. "Updated" is touched by every row write and every settings patch.
- REQ-011 Derived, read-only bot fields returned to clients:
  - last preview: text of the most recent row of kind message, card or event in the current generation, truncated to 140 chars. For cards the preview is: approval → a "waiting for you" phrase plus the card title; question → the question; connect → "connect <app name>"; draft → a fixed word for "draft".
  - last activity time: creation time of that row, else the bot's updated time.
- REQ-012 When no valid avatar shape is supplied at creation, a shape is chosen deterministically from the bot id (stable hash) among the first 13 shapes of the list above; when no valid colour is supplied, a colour is chosen the same way among all colours except black.
- REQ-013 Bot lists exclude hidden bots and are ordered: primary first, then by creation time ascending.

### 1.4 Conversation / transcript rows

- REQ-020 Each bot has exactly one conversation thread at a time (the current generation). A thread is an append-mostly ordered list of rows. A row has: bot id, generation, sequence number (position; unique within bot+generation), revision stamp (the bot's revision counter value at the last write), kind, body (structured), creation time.
- REQ-021 Row kinds and bodies:
  - message: role (user or assistant), text, optional streaming flag (true while the text is still being produced), optional origin `{kind: bot | routine | voice, id, name}` when the message was not typed by the user, optional citations list `{url, title?}`.
  - tool-call: call id, tool name, human-readable activity label, status (running, done, error, awaiting-approval, denied), parsed arguments, optional short summary, optional screenshot thumbnail (field reserved; not populated).
  - card: one of four card types (1.5).
  - event: event type (routine-created, routine-updated, routine-run, task-changed, bot-message, conversation-cleared, computer, voice-call), display text, optional reference id, and for voice-call events an optional call record `{id, phase: started|ended, durationMs?, summary?, transcript?[{role,text}], tasks?[string]}`.
  - notice: text and tone (info, warn, error).
- REQ-022 A streaming reply is one row rewritten repeatedly with a higher revision stamp; clients upsert by sequence number and keep whichever copy has the higher (or equal) revision stamp.
- REQ-023 Resetting a conversation increments the bot's generation, restarts sequence numbering at 1, and discards any paused-turn state. Old rows and old model history remain stored but are no longer listed (they stay searchable by the voice search tool's "earlier" scope).
- REQ-024 Separately from the visible transcript, the server stores the model-facing history per bot and generation: an ordered list of raw Responses-API input/output items (user messages, assistant messages, reasoning items with encrypted content, function calls, function-call outputs, built-in search call items, compaction items).

### 1.5 Cards

- REQ-030 Approval card: approval id, title (a question of the form "allow <bot> to <action>?"), detail text (flattened argument summary, see REQ-327), policy key (the tool slug the decision applies to), optional toolkit slug, toolkit display name and logo URL, raw arguments, status: pending → allowed | always | denied | expired.
- REQ-031 Question card: question text, up to 6 options, status: pending → answered | dismissed, and the chosen answer.
- REQ-032 Connect card: toolkit slug, toolkit display name, optional logo, the bot's stated reason, status: pending → connected | skipped.
- REQ-033 Draft card: channel (email, slack, message), recipient, optional subject, body text, approval id, status: pending → sent | discarded. The client renders this card and resolves it through the approval-decision capability (send = allow, discard = deny), but no server path currently creates one; treat as an optional extension point.

### 1.6 Group room

- REQ-040 A room is stored as a bot record with kind "room": name (max 60), fixed label meaning "group", description stating how many bots it contains, a fixed neutral avatar (cloud shape, gray), and an ordered list of member bot ids. It has its own transcript but never runs an agent loop itself.
- REQ-041 A room needs a non-empty name and at least 2 distinct member bots owned by the same user, none of which is itself a room (and, when created from the UI, none hidden).

### 1.7 Subagent

- REQ-050 A subagent is a hidden child bot: same owner, avatar, mode and effort as its parent; name = parent name + separator + (label or goal, whitespace-collapsed, first 32 chars); label meaning "subagent"; description naming its parent; instructions generated from the goal (see REQ-470); parent id set; hidden; never primary. It gets its own transcript, history and desktop.
- REQ-051 At most 4 live subagents per parent.

### 1.8 Memory

- REQ-060 A memory is a short durable fact owned by a bot: id, text, creation time, source = "chat" (saved explicitly by the bot's save-memory tool) or "learned" (extracted automatically by consolidation). Default source "chat".
- REQ-061 Per bot, a consolidation record keeps: time up to which messages have been consolidated, and a small result summary of the last run.
- REQ-062 A compaction log records each history compaction: bot, generation, method ("provider compaction" or "summary"), item counts before/after, estimated size before/after, time.

### 1.9 Skill

- REQ-070 A skill is a user-authored how-to attached to one bot: id, name (required, max 80), optional description of when to use it (max 300), body with the steps (required, max 20,000), created and updated times. All of a bot's skills are injected into its system prompt (name as heading, body below).

### 1.10 Task

- REQ-080 A task is a tracked unit of work created by a bot: id, bot id, title, state (working — default, needs_input, done), free-text note (default empty), created/updated times. Tasks are only created and updated by bots (via tools); users only view them.

### 1.11 Routine (scheduled or event-triggered)

- REQ-090 A routine belongs to a bot: id, name, prompt (the instruction executed each run), schedule, timezone (IANA; default UTC), enabled flag (default on), last-run time, creation time, plus for event routines the provider trigger id and trigger configuration.
- REQ-091 Schedule is either a 5-field cron expression or a marker string identifying an app event trigger type (suggested encoding: a fixed prefix followed by the upper-cased provider trigger slug).
- REQ-092 Derived routine fields returned to clients: next run time (computed from cron + timezone when enabled and parseable, else null) and a human description:
  - event routines: "When <App>: <rest of trigger slug in lower-case words>".
  - cron: recognised patterns are rendered in plain words — a fixed minute and hour every day; the same on weekdays (day-of-week 1–5); the same on one named weekday (0–6, Sunday = 0); every hour (minute 0, hour wildcard); every N minutes; every N hours; anything else shows the raw expression. Times use 12-hour clock with minutes.

### 1.12 Approval and policy

- REQ-100 An approval record: id, bot id, sequence number of its card row, the function-call id it gates, policy key (tool slug), status (pending, allowed, always, denied, expired), created and resolved times.
- REQ-101 A policy is per user and per tool slug with mode: always_allow, needs_approval or blocked. Only always_allow is ever written by the product (via "always allow"); the other modes are honoured if present.
- REQ-102 Paused-turn state: at most one per bot; holds the ordered remaining function calls of the current batch (call id, name, raw arguments, tool-call row sequence), the outputs already produced for that batch, the pending approval id, and the bot-to-bot hop depth.

### 1.13 Computer and desktops

- REQ-110 One computer record per user: provider VM id (nullable), status (absent — default, creating, starting, running, suspending, suspended, resuming, error, stopped), last error text, updated time.
- REQ-111 A desktop lease per bot: bot id, user id, provider screen id (the VM's default screen or an additional screen), last-used time.
- REQ-112 Library: not a database entity. It is the set of files in a per-bot directory on the user's VM (suggested: `<data root>/files/<bot id>/`). A listing entry has name, size in bytes, modified time, is-directory flag.
- REQ-113 Per-bot browser profile directory on the VM (suggested: `<data root>/profiles/<bot id>/`) so each bot keeps its own logged-in browser state.

### 1.14 Connected apps

- REQ-120 The catalogue entry ("toolkit") has: slug, name, logo URL, description, category names, whether provider-managed auth is available, whether it needs no auth, and (per user) whether it is connected.
- REQ-121 The server stores, per user, the app provider's tool-router session id so the same session is reused across restarts.

### 1.15 Proactive check-in settings

- REQ-130 Per user: enabled (default off), list of local times "HH:MM" 24-hour (default two times: 09:00 and 16:30; max 6), timezone (default UTC), key of the last fired slot (local date + slot time), count of consecutive silent check-ins, updated time.

### 1.16 Live state (not persisted)

- REQ-140 Per bot, in memory only: is-running flag, current activity `{kind, optional detail, since}`, awaiting `{reason, since}` when paused for the user, and turn start time. Lost on server restart (defaults to idle).
- REQ-141 Activity kinds: thinking, working, searching_web, reading_web, browsing_web, on_its_computer, running_commands, waiting_on_command, messaging_named, connecting_service, waiting_for_you, drafting_file, remembering.

### 1.17 Voice call (in memory)

- REQ-150 An active call: call id, bot id, user id, start time, sequence of the "call started" row, list of task requests handed off during the call (each clipped to 200 chars).

### 1.18 Storage

- REQ-160 A single embedded SQL database file (write-ahead logging, foreign keys enforced) holds everything above except live state and active calls. Schema changes MUST be idempotent on start (create-if-missing, add-column-if-missing) so old databases upgrade in place. Deleting a bot cascades to its rows, model history, paused turn, approvals, routines, tasks, memories, skills, consolidation record, compaction log.

---

## 2. Authentication and sessions

- REQ-200 "Who am I": unauthenticated-safe query that returns the current user (or null) and whether developer login is enabled.
- REQ-201 Google sign-in is implemented through the app provider rather than a first-party OAuth client:
  1. Start: generate an attempt id and a provisional user id; ask the app provider to create a session for the provisional id and begin authorising the Gmail toolkit with a callback URL on this server that carries the attempt id; store the attempt (with the connected-account id if returned); redirect the browser to the provider's hosted consent URL.
  2. Callback: look up the attempt; take the connected-account id from the query (falling back to the stored one). Fail if the attempt is unknown, the provider reports failure, no account id is available, or the returned id differs from the stored one. Delete the attempt. Read the Google account's email by proxying a Gmail "profile" request through the provider with that connected account.
  3. Find the user by email (case-insensitive) or create one using the provisional id (so the Gmail connection made during sign-in already belongs to the new account). If the user already existed under a different id, delete the just-created throwaway Gmail connection.
  4. Create a session, set the cookie, redirect to the web app root. Any failure redirects to the web app with a "login failed" query flag, which the sign-in screen shows as an error.
- REQ-202 Developer login (only when enabled by configuration): accepts email (must contain "@") and optional name; finds or creates the user; creates a session. Returns 403 when disabled, 400 on a bad email.
- REQ-203 Logout deletes the server-side session and clears the cookie.
- REQ-204 Every other capability requires a valid, unexpired session and returns 401 with an error body otherwise. Exceptions: the auth endpoints, the app-connection callback page, and a health check (which reports OK plus the configured model name).
- REQ-205 A new account starts with exactly one bot: the primary bot, with a preset human first name, a "chief of staff"-style label, a description saying it is the main point of contact that checks in proactively and coordinates the other bots, the blob shape in black. No computer exists yet (status absent); no apps are connected except Gmail if sign-in was via Google; check-ins are off.
- REQ-206 The realtime screen relay (WebSocket) authenticates with the same session cookie read from the upgrade request and rejects with HTTP 401 if the user or bot ownership check fails.

---

## 3. HTTP API surface (behaviours)

All request/response bodies are JSON unless stated. Errors are `{error: message}` with an HTTP status. "Own bot" means the id exists and belongs to the caller; otherwise 404.

### 3.1 Bots

- REQ-300 List bots (GET): returns visible bots (REQ-013) and the live state of each.
- REQ-301 Create bot (POST): input name, optional label, description, instructions, avatar shape, avatar colour, mode, primary flag. Applies REQ-010/012 defaults. Emits a roster-changed event. Returns the bot.
- REQ-302 Update bot (PATCH): any subset of name, label, description, instructions, avatar shape, avatar colour, mode, effort, pinned, voice, voice speed, voice language. Each supplied field is written as-is (no server-side validation beyond type coercion of booleans). Emits a bot-updated event; returns the bot.
- REQ-303 Delete bot (DELETE): unschedules all its routines, drops its desktop lease, deletes the bot (cascade), emits roster-changed. The server does not refuse deleting the primary bot; the UI does (REQ-1262).
- REQ-304 Make primary (POST): sets this bot primary and clears the flag on all the user's other bots atomically; emits roster-changed.
- REQ-305 Mark read (POST): sets unread to 0; emits bot-updated.

### 3.2 Conversation

- REQ-310 List rows (GET): returns current generation number and rows of the current generation. Default: the newest 200 rows in ascending order; `limit` up to 500; optional "before sequence" cursor for older pages.
- REQ-311 Send message (POST): input text (trimmed; 400 if empty). Appends a user message row. If the target is a room, dispatches to room members (REQ-480); otherwise enqueues a user turn for the bot. Returns the appended row.
- REQ-312 Interrupt (POST): aborts the bot's currently running turn, if any (REQ-560).
- REQ-313 New conversation (POST): interrupts, then resets the conversation (REQ-023), emits a cleared event and a bot-updated event.
- REQ-314 Decide approval (POST, by approval id): decision allow | always | deny. 404 if the approval does not exist or is not the caller's. No-op if already resolved. Otherwise REQ-545.
- REQ-315 Answer question card (POST, by bot + row sequence): input answer text. 400 if the row is not a question card. Marks the card answered with the answer, appends a user message row containing the answer, and enqueues a user turn whose model-facing text states which question is being answered followed by the answer.
- REQ-316 Dismiss card (POST, by bot + row sequence): 400 if not a card. Connect cards become "skipped" and the bot is sent a system turn saying the user skipped connecting that app and to continue without it. Other cards become "dismissed" with no turn.

### 3.3 Routines, tasks, memories, skills

- REQ-320 List a bot's routines (GET) ordered by creation.
- REQ-321 Enable/disable a routine (PATCH): input enabled flag; (un)schedules it (REQ-1000/1011); emits routines-changed; returns the routine.
- REQ-322 Run a routine now (POST): REQ-1003.
- REQ-323 Delete a routine (DELETE): unschedule, delete the provider trigger if it is an event routine, delete the record, emit routines-changed.
- REQ-324 List a bot's tasks (GET) newest-updated first; list all the user's tasks across bots (GET), newest-updated first, max 200.
- REQ-325 List a bot's memories (GET) newest first; delete a memory by id (DELETE; silently succeeds if it is not the caller's).
- REQ-326 Bot settings bundle (GET): memories (with source), skills (oldest first), routines, tasks, and a memory-status object: last consolidation time, current estimated history size, the compaction threshold, and the most recent compaction log entry (or null).
- REQ-327 Skills: list (GET); create (POST; name and body required — 400 with a specific message for each missing field; values trimmed and length-capped per REQ-070); update (PATCH; partial; same validation for supplied fields; bumps updated time); delete (DELETE). 404 for skills not owned by the caller.
- REQ-328 Consolidate now (POST): runs memory extraction immediately for the bot (REQ-720) and returns `{added: [texts], skipped, considered}`; 502 on model failure.
- REQ-329 Compact now (POST, optional force flag): runs history compaction inside the bot's serial queue (after any running turn) and returns items before, items after, and whether anything changed. With force, the size threshold and several guards are bypassed (REQ-705).

### 3.4 Computer and library

- REQ-340 Get computer (GET): refreshes status from the provider (REQ-816) and returns the computer state `{status, provider id, error, desktops: [{botId, screenId}]}`.
- REQ-341 Wake (POST): starts "ensure running" in the background and returns the current state immediately; progress arrives as events.
- REQ-342 Sleep (POST): suspends the VM (REQ-812) and returns the state after the attempt.
- REQ-343 Bot screenshot (GET): if the VM is recorded as running and the bot holds a desktop lease, returns the current screen image bytes (JPEG by default) with no-store caching; otherwise, or on any error, returns 204 No Content. It MUST NOT wake the VM or lease a desktop.
- REQ-344 Computer details (GET): the state, the desktop leases with last-used times (most recent first), and hibernation info (idle minutes setting, current viewer count, dry-run flag).
- REQ-345 Reset a bot's desktop (POST): if the bot has no lease → OK with a note. If the VM is not running → 409 telling the user to wake it first. Otherwise kill that bot's browser processes and remove stale browser lock files; if the lease is an additional (non-default) screen, destroy that screen at the provider and drop the lease (a fresh one is created on next use). Emits a computer event. 502 on provider failure.
- REQ-346 List library files (GET; optional relative path; optional wake flag): path segments must be non-empty, not "." or "..", with no control characters → else 400. If the VM is not running and wake was not requested, returns status "asleep" with an empty list (never wakes implicitly). Otherwise lists the bot's library directory (creating the root if missing) and returns status "ok" with entries sorted directories first, then newest modified first. Listing failures return status "error" with a message clipped to 300 chars (HTTP 200). Listing MUST NOT lease or evict a desktop: it uses the bot's existing desktop if any, else the VM default context.
- REQ-347 Download a library file (POST; relative path required and validated as above): wakes the VM if needed (409 if unavailable), asks the provider to export the file and returns a short-lived signed URL (provider links last about 1 hour); 502 if no link is produced.

### 3.5 Apps and permissions

- REQ-360 List apps (GET; optional search text, category, limit default 120): returns the filtered catalogue page with a connected flag per entry, the full list of connected slugs, the full entries for connected apps, the sorted list of all category names, and the total match count. Search matches name, slug or description, case-insensitively; category matches exactly, case-insensitively. If the connection lookup fails the catalogue is still returned with nothing marked connected.
- REQ-361 Start connecting an app (POST by slug; optional originating bot id and connect-card row sequence): asks the provider for a hosted connect link whose callback returns to this server carrying the slug, bot id and row sequence; returns the redirect URL.
- REQ-362 Connection callback (GET; no session required, but the session cookie is read if present): if the caller is a known user, the provider did not report failure, and the app now appears among that user's active connections: emit connections-changed; if a bot id was carried and belongs to the user: mark the referenced connect card "connected" (if a sequence was carried) and send the bot a system turn saying the user connected the app and to continue. Always responds with a tiny HTML page stating success or failure that posts a "connected" message (slug + ok flag) to the opener window and closes itself after ~0.8 s.
- REQ-363 Disconnect an app (DELETE by slug): deletes every connected account of that toolkit for the user at the provider, drops the cached provider session, emits connections-changed.
- REQ-364 List policies (GET): all stored per-tool policies `{tool, mode}`. Delete a policy (DELETE by tool slug): the tool reverts to default classification.

### 3.6 Rooms

- REQ-370 Create room (POST: name, bot ids): validates REQ-041 (400 with a message otherwise); creates the room; emits roster-changed; returns its id.
- REQ-371 Get room members (GET): id, name, label, avatar shape and colour for each member that still exists. 404 if not the caller's room.
- REQ-372 Set room members (PUT: bot ids): filters to the caller's non-room bots, de-duplicates, stores, updates the description count, appends an event row listing who joined and who left (only if something changed), emits roster-changed. The server does not enforce the 2-member minimum here; the UI does.

### 3.7 Check-ins

- REQ-380 Get check-in settings (GET): `{enabled, times, timezone}` (defaults per REQ-130).
- REQ-381 Update check-in settings (PUT; any subset): times are filtered to valid HH:MM strings and truncated to 6; an invalid timezone → 400. Returns the new settings.
- REQ-382 Check in now (POST): fires a check-in immediately, bypassing the recent-activity guard (REQ-1023).

### 3.8 Voice

- REQ-390 Voice options (GET): available voices `{id, name, gender?}`, languages `{code, name}`, speed presets.
- REQ-391 Start voice session (POST: bot id): REQ-1100.
- REQ-392 Voice relay tool (POST: bot id, call id, tool name, arguments): REQ-1120–1125.
- REQ-393 End voice call (POST: bot id, call id, transcript lines, optional error): REQ-1140.
- REQ-394 Voice preview (POST): REQ-1150. Dictation transcription (POST multipart): REQ-1160.

### 3.9 Static hosting

- REQ-395 If a built web app is present, the server serves it and falls back to the app's index page for unknown non-API paths (single-page routing).

---

## 4. Realtime event stream

- REQ-400 One server-sent-event stream per browser tab, per user (authenticated GET). Each event is one JSON object in the SSE data field. Events are fanned out to every open stream of the same user; nothing is replayed after a disconnect.
- REQ-401 Event kinds:
  - hello — first event on connect; carries server time.
  - ping — sent whenever 20 s pass with nothing else to send (keep-alive).
  - rows — bot id, generation, and one or more full rows that were appended or rewritten. Sent on every row append and every row rewrite (streaming text flushes, tool-call status changes, card status changes, call summary rewrite).
  - cleared — bot id and the new generation number, after a conversation reset.
  - live — the complete live state of one bot, on every change (turn start/end, activity change, pause for approval).
  - roster — no payload; the set of bots changed (create, delete, primary change, room create/member change); clients reload the bot list.
  - bot — one full bot object; sent after settings patches, mark-read, end of every turn, conversation reset, voice call start/end.
  - computer — full computer state; on every status change and whenever a desktop lease is created or reset.
  - routines — bot id; that bot's routines changed.
  - tasks — bot id; that bot's tasks changed (also sent when a turn pauses for approval).
  - memories — bot id; consolidation added memories.
  - connections — no payload; the user's connected apps changed.
- REQ-402 Client behaviour: one stream for the whole app; on error with the stream closed, reconnect with exponential backoff starting at 1 s, doubling, capped at 15 s; reset on success. On every reconnect after the first successful connection, re-fetch bots, computer state, and the open bot's rows and routines. Track a connected flag.
- REQ-403 Client row merge: ignore rows from an older generation; on a newer generation drop the old rows; otherwise upsert by sequence keeping the higher-or-equal revision. When a rows fetch completes, merge with any rows that streamed in meanwhile (keep the higher revision).
- REQ-404 On a bot event for the currently open bot with unread > 0 while the tab is visible, the client immediately marks it read.

---

## 5. Agent loop

### 5.1 Queueing and triggers

- REQ-500 Each bot has a strictly serial work queue: turns for the same bot never overlap; different bots run concurrently. A failed turn is logged and does not block later turns. Other jobs (manual compaction) can be inserted into the same queue. A bot is "busy" while its queue is non-empty.
- REQ-501 A turn is started by one of five trigger types, each of which (except resume) is appended to the model history as a user-role item:
  - user: the text as typed (or decorated, e.g. answers to question cards, voice hand-offs).
  - routine: a bracketed preamble stating that the named routine is running now and to do the following, then the routine prompt.
  - bot: a bracketed preamble stating the message is from the named other bot on the team and that replies go through the bot-messaging tool, then the text. Carries a hop depth.
  - system: a bracketed "system notice" marker followed by the text (used for check-ins, group-chat dispatch, app connected/skipped).
  - resume: no new item; continues a turn paused for approval.
- REQ-502 Bot-to-bot delivery appends a visible user-role message row in the recipient's transcript with origin = the sending bot, then enqueues a bot trigger for the recipient with depth + 1.

### 5.2 Turn lifecycle

- REQ-510 At turn start: mark live state running with activity "thinking", clear awaiting, set start time.
- REQ-511 If a paused turn exists and the trigger is not a resume, the pause is superseded first: the pending approval becomes "expired" (record and card); every remaining call in the batch gets a synthetic output telling the model it was skipped because the user sent a new message and not to retry unless asked; their tool-call rows become "denied" with a "skipped" summary; the batch outputs are appended to history; the pause is cleared.
- REQ-512 If the trigger is a resume and no paused turn exists, the turn ends immediately. Otherwise the remaining calls are processed (REQ-540); if that pauses again the turn ends; otherwise the loop continues with a model call.
- REQ-513 The loop: up to 60 model calls per turn. After each model call, append all returned output items to history. If the output contains no function calls, the turn is finished. Otherwise create a tool-call row (status running, parsed args, activity label) for every function call in order, process them (REQ-540), and stop the turn if processing paused or if any tool signalled "end the turn". Reaching the 60-step cap ends the turn silently.
- REQ-514 At turn end (always): if no paused turn remains, reset live state to idle; emit a bot-updated event.
- REQ-515 Errors: any exception ends the turn and appends a notice row — tone error with a "something went wrong" prefix and the error message, or, if the turn was aborted by the user, tone info with a one-word "stopped" message.

### 5.3 Context construction for each model call

- REQ-520 Before each model call: load the stored history; run automatic compaction if due (REQ-700; on failure use the uncompacted history); repair orphaned function calls (REQ-521); prune images (REQ-522); prepend a freshly built system prompt (REQ-525).
- REQ-521 History repair: for every function call with no matching output anywhere in the history, insert immediately after it a synthetic output stating that the call was interrupted before finishing, its result is unknown, and to check current state before retrying. (A general form of this repair leaves a trailing batch of pending-approval calls untouched, but the model is only ever called when no approval is pending, so in practice every orphan is repaired.)
- REQ-522 Image pruning: only the 3 most recent history items containing images keep them; in older items each image is replaced by a short text placeholder saying an older screenshot was omitted. Stored history is not modified.
- REQ-523 Request parameters to the Responses API: configured model; the input list; tool list (REQ-530); reasoning effort = the bot's effort setting; no server-side storage of the response; request encrypted reasoning content to be included (and pass it back unchanged on later calls); a prompt-cache key unique per bot and generation; a safety identifier derived from a hash of the user id (first 32 hex chars of SHA-256); streaming on. Client timeout 360 s. The abort signal of the turn is attached.
- REQ-524 If the provider rejects the request with HTTP 400 and connected-app tools were included, retry once with only the built-in function tools plus the two search tools.
- REQ-525 System prompt ingredients (wording is the implementer's; these concepts MUST all be present):
  1. Identity: the bot's name; that it is one of the named user's team of always-on AI teammates that do real work; its job label and description if set; if primary, that it is the main point of contact, checks in proactively and coordinates the others; a sentence reflecting personal vs teammate mode.
  2. Working method: it has its own private Linux desktop with a browser and a root shell; use the screen tools and browser-open tool for websites and the shell for commands/files; save deliverables with the save-file tool so they appear in the user's library; always screenshot before clicking and verify after each action. Prefer connected-app tools over the browser when an app is connected (discover with the provider's search meta-tool, run with its multi-execute meta-tool); request a connection when an app is missing. Some actions need user approval and the system asks on its behalf; if denied, do not retry — find another way or tell the user. Use the ask-user tool only for real decisions; track multi-part requests with tasks; create routines for scheduled work; save durable facts with the memory tool; delegate to other bots when their job fits better.
  3. Style: brief, warm, direct, like a capable colleague messaging; no headings for simple replies; lists/tables only when useful; never claim completion without a tool result showing it; never invent facts; report outcomes rather than narrating tool use.
  4. Context: current time (ISO), the user's name and email, comma-separated connected app slugs (or "none yet"; "unavailable" if lookup fails), the other visible bots on the team with label and a primary marker (or a statement that it is the only bot).
  5. Its routines: name, id, description (or "paused") and the first 120 chars of each prompt.
  6. Its memories: the bounded selection of REQ-740, plus a line saying how many older ones are not shown and that the recall tool can search them.
  7. Its skills: each as a heading and body.
  8. The user's standing instructions.
  Sections 5–8 are omitted when empty.

### 5.4 Tools offered and streaming

- REQ-530 Tool list per call: all built-in function tools (section 6), the app provider's meta-tools for this user's session (empty list if the provider is unavailable), and the model provider's two server-side search tools (web search and X search).
- REQ-531 Streaming into the transcript: on the first text delta create an assistant message row with streaming = true; rewrite it at most about every 120 ms as text accumulates. When a message output item completes, finalise the row (streaming = false) with citations extracted from the item's URL annotations (url + title), increment the bot's unread count by 1, and start a new row for any later message in the same response. If the stream ends with an unfinalised message, finalise it.
- REQ-532 Live activity during streaming: a web-search call item starting → "searching_web"; an X-search call item starting → "searching_web" with detail "X"; a message item starting → "working".
- REQ-533 The response is taken from the completed (or incomplete) terminal event. A failed/error event raises an error with the provider's message; a stream ending without a terminal response raises an error. After success, record the reported input token count together with the number of history items sent (used by REQ-701).

### 5.5 Tool execution, policy and approvals

- REQ-540 Calls in a batch are processed strictly in order. For each call, determine a decision:
  - Built-in tools: always allowed.
  - App-provider meta-tools other than multi-execute (search, schema lookup, etc.): always allowed.
  - Multi-execute: inspect the list of inner tool slugs in its arguments (the list may appear under several argument names, and each entry's slug under several key names — accept all plausible spellings). Any other non-built-in tool name is treated as a single slug.
  - For each slug: use the user's stored policy if present; otherwise "always allow" if the slug is read-only, else "needs approval". A slug is read-only when, upper-cased, it contains one of these words as an underscore-delimited token after the app prefix: GET, LIST, SEARCH, FETCH, FIND, READ, RETRIEVE, QUERY, LOOKUP, CHECK, DESCRIBE, VIEW, COUNT.
  - Any slug with policy "blocked" → the whole call is blocked. Else any slug needing approval → ask (the last such slug becomes the policy key). Else allow.
- REQ-541 Ask: create an approval card (title asking to allow the bot to perform the humanised action; detail per REQ-544; toolkit = lower-cased first underscore-segment of the slug, with catalogue name and logo if known), store a pending approval linked to the card and call, set the tool-call row to "awaiting-approval", persist the paused-turn state, set live state to not running with activity "waiting_for_you" and an awaiting reason = humanised slug ("App: action words"), emit a tasks event, and end the turn (paused).
- REQ-542 Block (by policy or by user denial): do not execute; the output tells the model the user declined, not to retry, and to find another way or report what could not be done; the row becomes "denied".
- REQ-543 Allow: set live activity from the tool (built-in tools declare an activity kind and label; all app-provider tools use "connecting_service"; the bot-messaging tool uses "messaging_named" with the target name as detail; app tools use the toolkit display name as detail). Execute. On success the row becomes "done" with the tool's short summary. On exception the output is a "tool error" message with the exception text and the row becomes "error" with the message clipped to 200 chars; the turn continues.
- REQ-544 Approval detail text: for multi-execute, each inner call's arguments; otherwise the call's arguments. For each, list up to 6 scalar (non-object) fields as "key: value" lines with values clipped to 160 chars; blocks separated by a blank line; whole text clipped to 1,200 chars.
- REQ-545 Resolving an approval: allow → status allowed; always → status always and store an always-allow policy for the policy key (this is the "remember my choice" feature; it applies to all the user's bots and persists until removed in settings); deny → status denied. Update the card to match, then enqueue a resume turn. On resume, the gated call runs (allowed/always) or is blocked (denied), and processing continues with the rest of the batch — which may pause again on a later call.
- REQ-546 When a batch completes, append all its outputs to history in call order, clear the paused state, and set live activity back to "thinking".
- REQ-547 App tool execution result: success is determined by the provider's result type (or absence of an error); the output is the JSON of the data (or of `{error, log id}`), truncated to 60,000 chars with a truncation marker; summary "done"/"failed".
- REQ-548 Tools may return either a string or a multi-part content list (text + image) as the function output, and may flag "end the turn after this batch".

### 5.6 Stop / cancel

- REQ-560 Interrupt aborts the in-flight model request and is checked at the top of each loop step; a tool call already executing runs to completion. The turn ends with the "stopped" notice. Any function calls left without outputs are repaired on the next model call (REQ-521). Interrupt does not clear a paused approval.

### 5.7 Effort and model selection

- REQ-570 Effort levels low / medium / high / xhigh map one-to-one to the provider's reasoning-effort parameter and are chosen per bot (UI labels: low, medium, high, max). Subagents inherit the parent's effort at creation.
- REQ-571 One model for all bots and all auxiliary text calls (summaries, memory extraction, call summaries), set by configuration (default: the provider's current flagship reasoning model). Auxiliary calls always use low effort and no server-side storage. There is no per-bot model picker.

---

## 6. Tool catalogue

Tool names below are descriptive placeholders; choose your own. Unless noted, parameters are strings and results are short JSON or text. "Screen tools" operate on the calling bot's own desktop, obtained (and if necessary leased, waking the VM) per REQ-820.

### 6.1 Computer use

- REQ-600 Take screenshot — no parameters. Waits ~0.7 s, captures the bot's screen (JPEG, quality 75, base64), returns a text part with a caption and the pixel dimensions plus the image at high detail. Activity: on_its_computer.
- REQ-601 Click — x, y (integers, required), button (left default | right | middle), double (boolean). Clicks, then returns a fresh screenshot captioned with the coordinates.
- REQ-602 Type text — text (required). Sent to the provider in chunks of 1,500 chars; returns a screenshot captioned with the character count.
- REQ-603 Press keys — a key or combination using X11 keysym names joined by "+" (e.g. Return, ctrl+l, Page_Down). Single-character parts are lower-cased before sending. Returns a screenshot.
- REQ-604 Scroll — x, y, direction (up | down) required; amount (default 3). Returns a screenshot.
- REQ-605 Drag — start x/y and end x/y (required), left button. Returns a screenshot.
- REQ-606 Open browser — url (required). Opens the URL in Chrome on the bot's display using the bot's persistent profile directory: reuse the running browser for that profile (new tab) or start one detached (clearing stale profile lock files first), maximised, with first-run prompts disabled; wait ~4 s; command timeout 40 s; return a screenshot. Single quotes in the URL are percent-encoded. Activity: browsing_web.
- REQ-607 Shell — command (required), timeout seconds (default 120, clamped 1–290). Runs as root on the VM in the bot's desktop context. Returns exit code and the last 20,000 chars of output; summary shows the exit code. Activity: running_commands.
- REQ-608 Save file — filename, content (both required). Filename is sanitised to letters, digits, dot, underscore, hyphen (others → underscore), max 120 chars, with a default if empty. Content is written as UTF-8 into the bot's library directory (created if needed); large content is transferred in base64 chunks of 60,000 chars per command so no single command is oversized. Returns the saved path. Activity: drafting_file.
- REQ-609 All screen tools run freely without approval. (Known limitation: browser and shell actions are not covered by the approval system.)

### 6.2 Memory

- REQ-620 Remember — text. Stores a memory with source "chat". Activity: remembering.
- REQ-621 Recall — query. Splits the query into lower-case words longer than 2 chars; returns up to 20 of the bot's memories (newest first) containing any of the words (all memories qualify if no usable words).

### 6.3 Routines and check-ins

- REQ-630 Create routine — name, prompt, schedule (5-field cron) required; timezone optional (default UTC). Validates the cron/timezone (returns an "invalid schedule" message to the model on failure), stores it enabled, schedules it, appends a "routine created" event row (name + human schedule), emits routines-changed.
- REQ-631 List event triggers — toolkit slug. Returns up to 40 trigger types the app provider offers for that toolkit: slug, name, description (clipped to 300), and the configuration schema (properties + required).
- REQ-632 Create event routine — name, prompt, trigger slug required; configuration as a JSON-object string (optional). Creates the provider trigger for this user (REQ-1010), stores the routine, appends an event row, emits routines-changed. Invalid JSON or provider failure returns an explanatory message (suggesting the app may need connecting).
- REQ-633 List routines — returns the bot's routines.
- REQ-634 Update routine — routine id required; optional name, prompt, schedule, timezone, enabled. Only the bot's own routines; validates the resulting schedule; reschedules or unschedules; appends a "routine updated" event row; emits routines-changed.
- REQ-635 Delete routine — routine id. Unschedules, deletes any provider trigger, removes it; emits routines-changed.
- REQ-636 Set check-ins — enabled (required), times (HH:MM list), timezone. Updates the user's check-in settings (REQ-381 rules); summary states the resulting schedule or "off". The description tells the model only the primary bot performs check-ins and to ask for the timezone if unknown.

### 6.4 Tasks

- REQ-640 Create task — title. Creates a task in state working; emits tasks-changed; returns its id.
- REQ-641 Update task — task id, state (working | needs_input | done) required; note optional (kept if omitted). Only the bot's own tasks; emits tasks-changed.

### 6.5 Delegation, subagents, groups

- REQ-650 Message a bot — bot name, message. Looks up the user's bot by name case-insensitively. Returns an explanatory message (no delivery) if: not found (lists team names), the target is itself, the target is a room (use the group tool), or the current hop depth is already 3 or more. Otherwise delivers per REQ-502 and tells the model the reply will arrive later as a message.
- REQ-651 Start subagent — goal (required, self-contained), label (optional). Refused if the caller's hop depth is 2 or more (subagents cannot nest further) or the parent already has 4. Creates the subagent (REQ-050) and delivers the goal to it as a bot message. Returns its id and name and a note that it will report back.
- REQ-652 List subagents — returns each with id, name, running flag, current activity kind, last message text (clipped to 300), start time.
- REQ-653 Message subagent — subagent id, message. Only the caller's own subagents.
- REQ-654 Stop subagent — subagent id. Interrupts its running turn and deletes it and its desktop lease.
- REQ-655 Create group — name, list of bot names. Resolves names (non-room bots only); needs at least 2 found, else returns a message listing the missing names. Creates the room, adds an event row in it naming the members, returns the group id and any missing names.
- REQ-656 Post to group — group name, text. Finds the user's room by name (case-insensitive); the caller must be a member. Appends an assistant message row in the room with origin = the posting bot, increments the room's unread count, and ends the bot's turn. Failure messages (no such group / not a member) do not end the turn.

### 6.6 User interaction and apps

- REQ-660 Ask user — question, options (list; first 6 kept). Appends a pending question card and ends the turn; the answer arrives as the next user message. Activity: waiting_for_you.
- REQ-661 Request app connection — toolkit slug, reason. Unknown slug → message advising to search for the right slug. Otherwise appends a pending connect card and ends the turn.
- REQ-662 Stay silent — optional reason. Ends the turn without any user-visible message; intended for check-ins, routines, group dispatches and bot-to-bot exchanges with nothing worth saying.

### 6.7 External tools

- REQ-670 App provider meta-tools (names dictated by the provider, e.g. `COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_GET_TOOL_SCHEMAS`, `COMPOSIO_MULTI_EXECUTE_TOOL`) are fetched per user session in Responses-API function format and passed through unchanged; execution goes through the same session.
- REQ-671 Web search and X search are provider-hosted server-side tools; the server only observes their progress events.

### 6.8 Activity labels

- REQ-680 Every built-in tool declares (a) an activity kind for live state and (b) a short present-participle label stored on its tool-call row (e.g. "looking at the screen", "clicking", "running commands", "saving notes", "setting up a routine", "messaging a bot", "starting a helper", "waiting on you"). All app-provider tools share one label meaning "using a connected app".

---

## 7. Memory

### 7.1 History compaction

- REQ-700 Automatic compaction is evaluated before every model call, inside the bot's queue. It compacts when the estimated history size exceeds the threshold (default 300,000 characters, i.e. about 75,000 tokens at 4 chars/token).
- REQ-701 Size estimation: if a real input-token count was recorded for this bot and generation at a point where the history had N items (N ≤ current length), size = tokens × 4 + estimate of items added since; otherwise estimate all items. Per-item estimate = length of its JSON with image data removed; each image adds a fixed 6,000 chars for the 3 most recent images and 30 for older ones; a provider compaction item counts as its encrypted payload length ÷ 22.
- REQ-702 Skip conditions (non-forced): a cooldown is active after a failed attempt; a turn is paused for approval (also applies when forced); since the previous compaction in this generation, less than 25% of the threshold has been added; the portion to be compacted is under 15% of the threshold; no valid split point exists (also applies when forced).
- REQ-703 Split point: history may only be cut where no function call is awaiting its output. Candidate cut points are (a) starts of user turns and (b) starts of model responses mid-turn (not directly after a reasoning or compaction item, not at a function output). Default: keep the last 4 user turns verbatim. If that tail exceeds 35% of the threshold, keep fewer turns (move the cut later one turn at a time). If even one turn is too large (or there is no turn boundary), cut mid-turn at the earliest response boundary whose tail fits in 35%.
- REQ-704 Method "auto": send the older portion to the model provider's compaction endpoint (`POST /v1/responses/compact` with model + input) and replace it with the returned items. If that fails or is disabled by configuration, fall back to a summary: render the older portion as plain text (user/assistant lines; tool calls with arguments clipped to 400 chars; tool results clipped to 600; images as a placeholder; reasoning and compaction items skipped; if over 200,000 chars keep the tail with a "cut" marker), ask the model (low effort) for a dense self-addressed summary under ~1,500 words covering who the user is, goals, preferences, standing instructions, decisions, facts, names, numbers, URLs, paths, IDs (never secrets), what was done with which tools and outcomes including failures and what not to retry, open tasks and promises; replace the older portion with any pre-existing compaction items carried over unchanged plus one user-role item containing the summary, prefixed with a marker saying it is an automatic summary to be treated as the bot's own notes. If the summary also fails, set a 10-minute cooldown and leave history untouched.
- REQ-705 Commit atomically only if the stored history still has exactly the item count that was compacted (otherwise abandon). Replace the stored items with compacted + kept items, write a compaction log entry, forget the recorded token usage, remember the new item count. Forced compaction (manual) bypasses the threshold, cooldown, growth and "not worth it" checks.
- REQ-706 The visible transcript is never altered by compaction.

### 7.2 Consolidation (automatic memory extraction)

- REQ-720 A background sweep runs every 60 s. A bot is due when its newest message row is at least 10 minutes old and newer than its last consolidation mark. Skip bots that are running, paused for approval, or already being consolidated.
- REQ-721 For a due bot: take up to 60 most recent message rows after the last mark (up to the newest message time), excluding empty or still-streaming ones. If none is a message typed by the user (i.e. user role without an origin), just advance the mark. Otherwise build a transcript — each line prefixed by who spoke (user; another bot or routine by name; this bot), each message clipped to 2,000 chars, whole transcript limited to the last 24,000 chars — and ask the model (low effort, strict JSON-schema output: a list of `{text}`) to extract durable facts, given the bot's 200 newest existing memories.
- REQ-722 The extraction instruction must convey: keep only facts worth remembering for weeks — facts about the user (role, company, team, location, timezone, key people, accounts/tools), preferences and standing instructions, lasting project facts; skip one-off requests, small talk, temporary states, things the bot said about itself, secrets, and anything already covered by existing memories even if worded differently; one short third-person standalone sentence each, under 200 chars; at most 8; empty list when nothing qualifies.
- REQ-723 Accept at most 8 proposals, each clipped to 300 chars. Drop any that is similar to an existing or just-added memory. Similarity: tokenise both texts to lower-case word sets (letters/digits only, words longer than 1 char, minus a common English stop-word list that also includes a few preference verbs); similar if Jaccard overlap ≥ 0.7, or if the smaller set has ≥ 3 words and ≥ 90% of it is contained in the other; if either set is empty, compare trimmed lower-cased strings for equality.
- REQ-724 Store accepted memories with source "learned", advance the mark to the newest considered message, save a result summary, and emit a memories event if any were added. Malformed model output yields no memories.

### 7.3 Prompt memory selection

- REQ-740 From the bot's 500 newest memories, score each: 2 × (number of its words that also appear in the bot's last 3 user-role messages among the 12 most recent message rows) + a recency bonus from 1 (newest) down toward 0 (oldest). Take memories in descending score while they fit a 4,000-character budget (each costs its length + 3; ones that do not fit are skipped, later smaller ones may still fit). Present the selection oldest-first as a bullet list and report how many were omitted.

### 7.4 Voice-prompt memory

- REQ-750 The voice agent's prompt includes only the 12 newest memories, each clipped to 200 chars.

---

## 8. Computers

### 8.1 VM lifecycle

- REQ-800 One VM per user, created lazily on first need (a screen tool, a viewer connection, an explicit wake, a library download or a library listing with wake). Creation parameters: Linux, configured RAM / CPU / resolution, in the configured provider workspace (if none configured, use the first workspace the key can see), a name derived from the email local part and user id, and an idempotency key derived from the user id so retries never create duplicates. Creation call timeout 300 s.
- REQ-801 After creation: record the provider id, run a one-time preparation command creating the profile and library root directories (non-fatal on failure), mark running.
- REQ-802 "Ensure running" is single-flight per user (concurrent callers share one in-progress attempt) and first waits for any in-progress suspend to settle. With an existing VM it queries the provider status:
  - running → done.
  - suspended / suspending / reported asleep → status "resuming"; while the provider still says suspending, poll every 3 s up to 40 times; call resume; wait until running.
  - frozen / stopped / error → status "starting"; call start; wait until running.
  - anything else → mirror the status and wait until running.
  Waiting polls every 3 s for up to 240 s, then fails with a timeout error.
- REQ-803 Failure handling: any failure sets status "error" with the message and propagates. If the provider says the VM no longer exists (404), forget the VM id, set absent, and drop all desktop leases so the next attempt recreates it.
- REQ-804 Provider status mapping for display: running, creating, suspended, suspending, resuming map directly; frozen/stopped → stopped; error → error; everything else → starting.
- REQ-805 Every status change is persisted and broadcast as a computer event.

### 8.2 Per-bot desktops

- REQ-820 Each bot works on its own provider "screen" (a separate X display with its own desktop) on the user's VM; at most 4 screens exist at once (provider limit).
- REQ-821 Resolving a bot's desktop: ensure the VM is running. If the bot has a lease and the provider confirms the screen exists, refresh its last-used time and use it; if the screen is gone, drop the lease and continue. Otherwise allocate:
  1. The primary bot takes the VM's default screen if no one holds it.
  2. Else any existing provider screen not leased (the default screen is only handed to a non-primary bot this way when there are no leases at all).
  3. Else, if fewer than 4 screens exist, create a new one.
  4. Else evict: choose the least-recently-used lease whose bot is not mid-turn and which is not the default screen; failing that the least-recently-used non-default lease; failing that the oldest lease. Remove that lease, kill that bot's browser processes on the screen (its profile stays on disk), and reuse the screen.
  Record the lease, prepare the screen if it is not the default one (start a desktop/wallpaper session for that display if not already running; cosmetic, failures ignored), and broadcast a computer event.
- REQ-822 Provider action calls target a screen by id (the default screen needs no selector). Display numbering: the default screen is display :99; an additional screen with id "screen-N" is display :N.
- REQ-823 Provider calls used: create/get/start/resume/suspend computer; get VNC password; list/create/get/delete screens; screenshot (base64 JPEG quality 75); click; drag; type; key; scroll; bash (with timeout; HTTP timeout = command timeout + 40 s); export file. Default HTTP timeout 120 s (start 320 s, resume 200 s, export 180 s). Provider control-call rate limit is roughly 600 per minute per computer.

### 8.3 Idle sleep and wake

- REQ-830 A watcher sweeps every 60 s over users whose VM is recorded as running. A user is "busy" if any of their bots has a queued/running turn or live running state, or at least one viewer connection is open. Otherwise idle time = now − max(last time seen busy by the watcher (initially server start), last viewer connect/disconnect, latest bot update time, computer record update time). After 20 idle minutes the VM is suspended.
- REQ-831 If suspend fails, status returns to running with the error noted and the watcher waits a full idle window before retrying. A dry-run mode only logs (once per idle period) instead of suspending.
- REQ-832 Suspend is single-flight per user; status goes suspending → suspended. A manual sleep uses the same path.
- REQ-833 Wake is automatic: the next screen tool, viewer connection, wake request or library download resumes the VM via REQ-802. Paused approvals (not running) do not keep the VM awake.

### 8.4 Live viewer relay and take-control

- REQ-840 The browser connects by WebSocket (binary subprotocol) to a per-bot screen endpoint with a mode parameter: watch (default) or control. The server authenticates by cookie and bot ownership.
- REQ-841 The server resolves the bot's desktop (leasing/waking as needed), fetches the VM's VNC password from the provider, and opens an upstream WebSocket to the provider's websockify endpoint for that VM (`wss://www.orgo.ai/desktops/<vm id>/ws/websockify`, password as token, screen selector for non-default screens).
- REQ-842 The server completes the RFB 3.8 handshake upstream itself (preferring VNC password authentication — a DES challenge/response keyed with the bit-reversed password — else "none"), then performs a separate handshake with the browser offering only the "no authentication" security type and replaying the upstream ServerInit. The VM password (root-equivalent) MUST never reach the browser. Bytes received during handshakes are buffered and flushed when piping starts.
- REQ-843 After the handshakes, bytes are piped both ways. In watch mode the server parses client→server RFB messages and drops key events, pointer events and clipboard messages (types 4, 5, 6), forwarding pixel-format, encodings, update requests, continuous-updates, fence and desktop-size messages; on an unknown message type it discards the buffered bytes (fail closed). In control mode everything is forwarded.
- REQ-844 Each open viewer connection counts as a viewer for idle tracking from connect until close. Upstream close or error closes the browser side with a reason (normal or internal-error code); relay setup failure closes with an internal-error code and message.
- REQ-845 The server SHOULD self-test its DES implementation at startup and refuse to start on failure.

### 8.5 Library of saved work

- REQ-850 Files a bot saves with the save-file tool (or places in its library directory by shell) are browsable and downloadable by the user per REQ-346/347, including sub-folders. Nothing is copied off the VM until a download is requested.

---

## 9. Connected apps

- REQ-900 Catalogue: fetched from the app provider's toolkit listing sorted by usage, 500 per page, up to 3 pages (≈1,500 apps), cached in memory for 1 hour, shared by all users. Each entry per REQ-120.
- REQ-901 Per-user provider session: created once with the user's id and with the provider's built-in connection-management prompts disabled (the product shows its own connect cards); its id is persisted and re-attached on later use, recreated if re-attachment fails; cached in memory and dropped on disconnect.
- REQ-902 Connected set = toolkit slugs of the user's ACTIVE connected accounts at the provider.
- REQ-903 Connect flow: REQ-361/362. The UI opens the provider's hosted page in a centred popup (about 520×680), opened synchronously on click and then navigated, to avoid popup blocking. The provider's managed OAuth apps are used by default.
- REQ-904 Disconnect: REQ-363.
- REQ-905 Read vs write classification and approval rules: REQ-540–545. Summary: read-looking actions run automatically; everything else pauses for an approval card with three choices (deny, always allow, allow once); a new user message expires a pending approval; "always allow" entries are listed and removable in settings.
- REQ-906 Triggers/events: see section 10.2. App events are received through the provider's realtime subscription (no public webhook URL needed).
- REQ-907 Apps flagged as needing no auth are shown as built in (no connect button).

---

## 10. Scheduling, routines and proactive check-ins

### 10.1 Cron routines

- REQ-1000 At server start (unless the scheduler is disabled by configuration) every enabled cron routine is scheduled in its timezone with overrun protection (a firing is skipped if the previous callback is still executing). Invalid schedules are logged and skipped.
- REQ-1001 Scheduling a routine replaces any existing job for it; unscheduling stops and removes the job.
- REQ-1002 Routines are created/changed by bots through tools (REQ-630–635); users can only enable/disable, run now, and delete.
- REQ-1003 Running a routine (scheduled, or manually "run now"): set last-run time, append a "running routine: <name>" event row to the bot's transcript, and enqueue a routine turn with the routine's prompt. Runs queue behind any in-progress turn of that bot.

### 10.2 Event routines

- REQ-1010 Creating one: create a trigger instance at the app provider for this user with the upper-cased trigger slug and configuration; store the routine with the returned trigger id; ensure the realtime subscription is active (it is started lazily once, and at server start if any event routine exists).
- REQ-1011 Enabling/disabling an event routine enables/disables the provider trigger; deleting deletes it. Failures are logged, not surfaced.
- REQ-1012 On an incoming event, match it by trigger id (several possible id fields are checked) against enabled routines; for each match: set last-run, append a "routine triggered: <name>" event row, and enqueue a routine turn whose prompt is the routine prompt followed by a marker with the trigger slug and the event payload as indented JSON clipped to 8,000 chars.

### 10.3 Proactive check-ins

- REQ-1020 Only the primary bot checks in. Settings per REQ-130; changed by the user-facing settings capability (REQ-380–382) or by the primary bot's tool (REQ-636).
- REQ-1021 A tick runs every 60 s. For each user with check-ins enabled, compute local date and HH:MM in their timezone; a slot fires if the current local time is 0–4 minutes after a configured time and that date+slot has not fired before (5-minute catch-up window, at most once per slot per day).
- REQ-1022 Firing is skipped (the slot is still marked fired) if the user sent any message to any of their bots within the last 20 minutes.
- REQ-1023 The check-in is a system turn for the primary bot. Its text must convey: this is a scheduled proactive check-in; look at what is going on (connected apps such as calendar/email, memories, other bots); if there is something genuinely useful (a decision owed, a change, today's schedule, a finished result) send ONE short message; otherwise call the stay-silent tool. If the silent-streak counter is 3 or more, add that repeated silence is fine. Append context lines: tasks waiting on the user (title + bot, max 10) or none; pending approvals (bot + tool) or none; routines that ran in the last 12 hours (name + bot) or none; the other bots with labels.
- REQ-1024 The silent-streak counter is meant to increase each time a check-in ends silently and reset when it produces a message. (In the reference the counter is stored and read but never updated; implement the intended behaviour or omit the nuance.)

---

## 11. Voice

### 11.1 Architecture

- REQ-1090 A voice call is a second, lightweight realtime voice agent that runs in the browser against the model provider's realtime API (`wss://api.x.ai/v1/realtime?model=<voice model>`), speaks as the bot, and relays real work to the bot's normal text agent loop. Audio never passes through the product's server. The server mints credentials, builds the voice agent's prompt and tool definitions, serves the relay tools, and records the call.

### 11.2 Starting a call

- REQ-1100 Start session: verify bot ownership; mint a short-lived client secret from the provider (`POST /v1/realtime/client_secrets`, expiry 300 s, request timeout 15 s; failure → 502 "could not start"). Build the session configuration: voice id, instructions (REQ-1110), server-side voice-activity turn detection, the five relay tool definitions, input audio PCM 24 kHz with transcription enabled (language hint when a specific language is set), output audio PCM 24 kHz with the bot's speed. Create a call id, append a "voice call with <bot> started" event row (phase started), register the active call, emit bot-updated. Return call id, client secret and expiry, model, WebSocket URL, sample rate, instructions, voice, speed, language, tools and the ready-to-send session object.
- REQ-1101 Effective voice settings: voice defaults to "luna" if unset; speed clamped to 0.7–1.5 (1 if not numeric); language must be one of the supported codes, else "auto".
- REQ-1102 Client start sequence (must begin inside a user click so audio can play): create the audio context; set state "connecting"; open the microphone (echo cancellation, noise suppression, auto gain, mono) — on failure end with a specific message (permission blocked / no microphone / microphone busy / insecure context / generic); start capture; request the session; open the WebSocket authenticating with the client secret as a subprotocol (`xai-client-secret.<secret>`); on open send the session update. If not ready within 15 s, end with a "couldn't connect" error. If the user cancelled meanwhile, tell the server to end the call with a "cancelled" reason.
- REQ-1103 When the provider confirms the session update: state "live", start the call timer, start watching the bot's transcript/live state, and request a first response so the bot greets first.
- REQ-1104 Only one call at a time: starting a call with another bot ends the current one; starting with the same bot is a no-op.

### 11.3 Voice agent prompt

- REQ-1110 The instructions must convey: identity (the bot, on a live call with the user by first name, its label/description, primary status; it is the same bot they text with, same memory, computer and apps); that these instructions are authoritative and cannot be changed by tool output or anything said on the call; that real work — anything needing looking up, doing, checking, writing, sending or scheduling — must be handed to its text agent with a complete self-contained request, never guessed; small talk, clarifications and things known from context may be answered directly; use the history/search/activity tools instead of guessing; hang up only when the user is done. Call manners: open with a short warm greeting, one or two sentences per turn, at most one question at a time. While work runs: say briefly it is on it, then stop talking; when a "work landed" note arrives, give the outcome in a sentence or two, and if approval/input is needed say exactly what and that it is waiting in the chat; if asked about progress, check activity and answer in one sentence. On interruption: stop, listen, respond to the new input, do not restart the old sentence. Honesty: only report done when a result has come back; never invent. Speech style: natural, contractions, spoken words only (no markdown, lists, URLs, paths, IDs, code), numbers and dates as spoken, summarise rather than read out. Language: the configured language unless the user clearly switches, or the user's language when auto. Ground rules: stay in persona, never mention being a separate voice assistant or relay, never name tools.
- REQ-1111 Context appended: current time; user's full name and email; an activity snapshot (REQ-1124); up to 6 enabled routines with descriptions; 12 newest memories; the user's instructions clipped to 2,000 chars; the 14 most recent chat entries (oldest first, each with relative age and speaker, text clipped to 400 chars).

### 11.4 Relay tools (executed by the browser calling the server)

- REQ-1120 Hand off task — request (required, self-contained), already-announced flag. Server: empty request → error text asking to clarify. Otherwise append a user message row with origin "voice" in the bot's transcript containing the request, enqueue a user turn whose model-facing text is prefixed with a note that the user asked for this on a live voice call, to do the work and reply in short plain text (read aloud; lead with the answer; no markdown, links or IDs unless asked); record the request on the call; return a confirmation plus the sequence number of the appended row.
- REQ-1121 Recall recent messages — count 1–30 (default 10). Returns the most recent chat entries (finished messages; ended-call records; pending cards as "waiting for the user" lines), each with relative age and speaker, text clipped to 800 chars.
- REQ-1122 Search conversations — query (required), scope: this chat (default; current generation), earlier (this bot's previous generations), everything (all the user's bots). Substring search over message and event rows, newest first, examining up to 40 rows, returning up to 8 snippets (about 160 chars before and 240 after the match) with relative age, speaker and — for the widest scope — which bot's chat. Call records are searched including their stored transcripts.
- REQ-1123 Peek at activity — returns the activity snapshot.
- REQ-1124 Activity snapshot: one line for state (paused waiting for the user with reason and since when; or busy with a plain-language activity phrase, detail, and since when; or idle); up to 6 open tasks with state and note (clipped 120); pending cards in the last 20 cards; the computer state in plain words (awake / not set up yet / raw status).
- REQ-1125 End the call — resolved locally; after sending the tool output the client waits for current speech to finish (max 8 s) and hangs up. Unknown tool names return an "unknown tool" text.

### 11.5 In-call behaviour (client)

- REQ-1130 Microphone audio is resampled to 24 kHz mono 16-bit PCM in 40 ms frames and appended to the provider's input buffer as base64; nothing is sent while muted or before ready. Muting disables the mic track, clears the provider's input buffer and clears the listening state.
- REQ-1131 Output audio deltas are queued for gapless playback with a ~60 ms lead-in when starting from silence; an output level meter drives the speaking animation.
- REQ-1132 Barge-in: when the provider reports user speech started, stop and discard queued playback, cancel the active response, and ignore late audio deltas belonging to that response.
- REQ-1133 Captions: maintain a list (max 200) of caption entries keyed by conversation item id with role, text and final flag; user captions come from input transcription events (cumulative "updated" or incremental "delta", then "completed"); assistant captions from output transcript/text deltas and done events.
- REQ-1134 State flags: speaking (audio playing), listening (provider VAD hears the user), thinking (response created, no audio yet), muted, working (list of hand-offs in progress).
- REQ-1135 Tool calls: collect function calls from argument-done events and from the response-done output (de-duplicated by call id); run them concurrently; when the response is done, send every function output first, then request exactly one new response — except when the only tools were hand-offs and the bot already spoke in that response (no follow-up needed). Before requesting a new response wait for current speech to end (max 8 s). Tool failures return an error text telling the bot to say it did not go through.
- REQ-1136 Hand-off tracking ("work landed"): for each hand-off, remember the row sequence returned. A hand-off is finished when the bot is not running, no reply is streaming, and either at least one finished assistant message exists after that row or a run was observed starting and ending (and the bot was not already busy when handed off), at least 1.5 s after hand-off, and this has stayed true for 1.2 s (to ride over back-to-back queued turns). Re-evaluate ~0.4–0.8 s after any change to the bot's live state or transcript.
- REQ-1137 When finished, inject a note into the call as a user-role text item clearly marked as an automatic note from the text agent (not spoken by the user) containing: the original request (clipped 200), the text agent's reply text (clipped 1,800) or a statement that it finished without a written reply, and any cards still pending after the hand-off; then request a response. If the bot pauses for approval, inject once a note that the work is paused and needs the user's OK in the chat, with the reason.
- REQ-1138 Notes are only injected when no response is active, the user is not speaking, no tools are in flight and playback is idle; otherwise they are held and retried at the next opportunity; multiple held notes are sent together.
- REQ-1139 Errors from the realtime API: cancellation-related and "no active response" errors are ignored; any error before ready ends the call with the message; a socket close ends the call with "dropped" (after ready) or "couldn't connect" (before).

### 11.6 Ending a call

- REQ-1140 Ending (user hang-up, tool hang-up, error, or page hide via a best-effort beacon): close the socket, stop mic and playback, post the end to the server with the caption transcript and optional error. Server: unknown/already-ended call id → OK flagged duplicate. Otherwise remove the active call; keep up to the last 200 valid transcript lines (each clipped to 2,000 chars); append a "voice call ended · <duration>" event row (plus the clipped error reason if any) carrying the call record (phase ended, duration, transcript, hand-off list); emit bot-updated. Then, in the background, ask the model (low effort, 45 s client timeout) for a one-sentence past-tense third-person summary (≤ 25 words) of the last 12,000 chars of transcript plus the hand-offs, and rewrite the row with the summary appended (clipped to 240 chars).
- REQ-1141 Duration format: seconds under a minute, else minutes and zero-padded seconds; minimum 1 s.
- REQ-1142 Calls never explicitly ended are closed by a sweeper every 10 minutes once older than 2 hours, with a plain "call ended" row.
- REQ-1143 After an error the call bar shows the error for 6 s, then clears.

### 11.7 Voice settings, preview, dictation

- REQ-1145 Voice list: fetched from the provider (`GET /v1/tts/voices`, 8 s timeout), cached 1 hour; on failure fall back to a built-in list of the provider's voice ids (about 28, with gender) and retry after ~10 minutes. Languages: auto-detect plus 20 fixed choices — English, Arabic (Egypt / Saudi Arabia / UAE), Bengali, Chinese, French, German, Hindi, Indonesian, Italian, Japanese, Korean, Portuguese (Brazil / Portugal), Russian, Spanish (Mexico / Spain), Turkish, Vietnamese. Speed presets: 0.7, 0.85, 1, 1.15, 1.3, 1.5.
- REQ-1150 Preview: synthesise a short sample through the provider's TTS (`POST /v1/tts`; 30 s timeout) using supplied or saved voice/speed/language; default sample text is a one-line self-introduction naming the bot; text max 400 chars; voice id max 80 chars; output as MP3 or raw 24 kHz PCM (client asks for PCM and plays it through the same player in 100 ms chunks). Failure → 502.
- REQ-1160 Dictation: accepts an uploaded audio file and optional language; > 25 MB → 413; < 200 bytes → empty text; language is forwarded only if it is a plain two-letter code; forwarded to the provider STT (`POST /v1/stt`, file field last, 60 s timeout); returns trimmed text; failure → 502.
- REQ-1161 Dictation client: press-and-hold the mic button records until release; a quick tap (< 350 ms) toggles recording on and a second tap stops; Enter/Space on the focused button toggles; Escape cancels; hard limit 120 s; recordings shorter than 250 ms are discarded. Recorded in the first supported container among WebM/Opus, Ogg/Opus, WebM, MP4. States: idle, recording, transcribing (button disabled). The transcript is inserted at the caret (or appended), adding single spaces around it as needed, and the caret moves after it. The bot's voice language is passed as the hint.

---

## 12. Web UI

### 12.1 Shell and layout

- REQ-1200 On load the app checks the session; while checking it shows a blank boot screen; signed out → sign-in screen; signed in → main shell.
- REQ-1201 Main shell: three columns — left sidebar (≈350 px, collapsible to a ≈88 px icon rail), centre main view (chat or tasks; min ≈424 px, content column max ≈960 px), optional right details panel (≈320 px, only in chat view with a bot selected). Overlays: modals (create bot, create group, search, connect apps), full-screen computer viewer, bot settings dialog, full-window app settings.
- REQ-1202 Persisted per-browser preferences: selected bot, details panel open (default open), sidebar collapsed (default expanded), theme, "hide suggested" flag.
- REQ-1203 Keyboard shortcuts (Cmd on macOS / Ctrl elsewhere): +K toggle search; +B toggle sidebar; +Shift+, toggle details panel; +, open app settings; +I focus the message box. Escape closes modals, menus, the app settings page (when no modal is above it), and the viewer (watch mode only). Enter sends; Shift+Enter inserts a newline.
- REQ-1204 Theme: system (default; follows OS and reacts to changes), light, dark; applied before first paint.
- REQ-1205 Each bot's colour themes its chat: user bubbles, send button, toggles and accents use tones derived from the bot colour; black adapts to light/dark theme.
- REQ-1206 Avatars: a coloured silhouette with white eye cut-outs on a white backing; optional star badge (primary bot); optional selection ring in pickers. 15 silhouettes have artwork (the 13 picker shapes plus egg and pebble); the remaining shape names fall back to the nearest available silhouette.

### 12.2 Sign-in screen

- REQ-1210 Centred card: mascot avatar, product name, one-line pitch, a "sign in with Google" button (navigates to the sign-in start), and — only when developer login is enabled — a divided section with email and optional name fields and a continue button (busy label while submitting; inline validation for a missing "@"). Shows an error if redirected back with the failure flag. A footer disclaimer notes the project is open source and unaffiliated.

### 12.3 Sidebar

- REQ-1220 Top bar: decorative window dots; collapse/expand button; when expanded also search and new-bot buttons.
- REQ-1221 Tasks entry: a row that toggles the Tasks view, highlighted when active, with a badge counting tasks waiting on the user (hidden at zero).
- REQ-1222 Primary bot: a large centred tile with a star-badged avatar (≈60 px, smaller when collapsed), a working dot while running, and its "name · label" caption.
- REQ-1223 Other bots and rooms: list sorted by most recent activity. Each row: avatar; status dot — attention style when waiting on the user, working style when running, unread style when unread > 0; "name · label"; one-line preview — "waiting for you: <reason>" when awaiting, a "working…" placeholder if running with no preview, the last preview, or a "no messages yet" placeholder. Collapsed mode shows avatars only. No bot is highlighted while the Tasks view is open; choosing any bot returns to chat.
- REQ-1224 Empty list (only the primary exists): a "create a bot" call-to-action row with a hint about giving it a job.
- REQ-1225 Footer: account button (initials + name; tooltip email) opening a menu headed by the email with: settings (shows shortcut), connect apps, log out (destructive; reloads the app). A separate round button opens Connect Apps. Account button hidden when collapsed.
- REQ-1226 Selecting a bot loads its rows (once) and routines, and marks it read if it had unread messages. On first load the previously selected bot is restored if it still exists, else the primary, else the first.

### 12.4 Chat view

- REQ-1230 Header: centred pill with avatar and "name · label" opening a menu — show/hide details (with shortcut hint), open computer, new conversation, bot settings. Right side: a button to reopen details when closed, and a "share" button that only shows a "not available yet" toast. Toasts disappear after 2 s.
- REQ-1231 Transcript rendering:
  - Time divider before the first row and whenever more than 60 minutes separate consecutive rows: "Today <time>", "Yesterday <time>", else weekday, month, day (plus year if not current) and time.
  - Consecutive messages from the same sender within 5 minutes are grouped with joined bubble corners. User-typed and voice-origin user messages are right-aligned plain-text bubbles; everything else is left-aligned and rendered as Markdown (GitHub-flavoured: lists, tables in a scroll wrapper, code, quotes; links open in a new tab). Each bubble has a clock time.
  - Messages with an origin show a small sender label above the group: the sending bot's avatar and "from <name>"; a clock icon and "routine · <name>"; or a voice icon and an "asked on a voice call" phrase.
  - Citations: up to 6 chips under the bubble showing the link's host name (without "www."), opening in a new tab.
  - Empty, non-streaming messages are not rendered. A streaming bubble shows a subtle in-progress indicator.
  - Consecutive tool-call rows collapse into one "N step(s)" toggle; expanding lists each step with a status dot, its label, summary, and "failed" / "not allowed" markers (and a thumbnail if present). While the bot is running, steps still in "running" status are hidden from the count.
  - Event rows: small centred muted text. Notice rows: centred pill tinted by tone. Cards: see 12.5.
- REQ-1232 Activity line (bottom of transcript): shown while the bot is running and not currently streaming a reply, or while waiting on the user. Contains a small avatar, a shimmering phrase, and after 1 s the elapsed time since turn start (seconds; minutes; hours + minutes). When waiting it shows the awaiting reason instead of a timer. Phrases: each activity kind maps to a friendly short phrase; "thinking" has 3 variants and "working" 5, rotating every 6 s; messaging shows "checking with <bot name>" (name taken from the running tool call's arguments or the activity detail); connected-app activity shows "working in <app name>" when a display name is known; fallback is a generic working phrase / "needs your input".
- REQ-1233 Scrolling: stays pinned to the bottom as content arrives unless the user has scrolled up more than ~40 px; a round "jump to bottom" button appears when more than ~200 px from the bottom; switching bots jumps to the bottom.
- REQ-1234 Empty conversation: large avatar, bot name, and its description or a default line that differs for personal vs teammate mode. No bot selected: a short "no bot selected" message. Rows not yet loaded: nothing shown.
- REQ-1235 Composer: a "+" menu (new conversation; connect apps); auto-growing text area (max ≈200 px then scrolls) with placeholder "message <name · label>"; per-bot unsent drafts kept in memory while the app is open; mic (dictation) button with idle/recording/transcribing visuals and tooltips; a single primary action button whose role changes — text present → send (disabled while sending); no text and a call active with this bot → end call; no text and the bot running → stop; otherwise → start voice chat. Send failures and dictation/microphone errors appear in a dismissible error strip above the composer; the text is kept on failure. Focus returns to the text area after sending and when switching bots.
- REQ-1236 Voice call bar (above the composer while a call is connecting, live or just failed): avatar with animated halo driven by output and mic levels; bot name; elapsed m:ss timer when live; status text by priority — connecting; error message; speaking; listening; working (with the current hand-off request text, shimmering); thinking; muted; default listening. Buttons: mute toggle and hang-up while active; dismiss after an error. When live: a strip with the last two caption lines (non-final ones styled as partial; placeholder inviting the user to say hi, or a "you're muted" note); clicking it expands a scrollable full transcript ("You" / bot name) with a hide control, auto-scrolled to the newest line.

### 12.5 Cards

- REQ-1240 Approval card: app logo tile (derived from the toolkit slug; first-letter fallback), title, app display name (well-known slugs get proper casing, e.g. Google Calendar, GitHub), detail text, and three buttons: deny, always allow, allow (primary). Buttons disable while a request is in flight; errors show inline. Once resolved, buttons are replaced by an outcome line: allowed once / always allowed / not allowed / expired.
- REQ-1241 Question card: the question, a hint (pick an option or reply in your own words / answered / skipped), option buttons lettered A, B, C…; a skip link while pending. After answering, the chosen option is highlighted with a check and all are disabled. Typing a free-text reply instead is also valid (it is just a normal message; the card then stays pending).
- REQ-1242 Connect card: app logo, "connect <app>" title, the bot's reason; buttons skip and connect. Connect opens the popup flow (REQ-903) and the button shows a "waiting for sign-in" label until a connections event arrives or the card resolves. Outcome line: "<app> connected" or skipped.
- REQ-1243 Draft card: channel label (email / Slack / chat), the user's handle (from their email local part), a copy-to-clipboard button (brief "copied" state), recipient with initial avatar, optional subject, body; buttons discard and send; outcome sent / discarded.

### 12.6 Details panel

- REQ-1250 Top: bot-settings (gear) and close buttons. Identity: large avatar and "name · label". Three tabs: Activity (default), Tasks, Library.
- REQ-1251 Activity tab sections:
  - Upcoming: the bot's routines, each with name, schedule description (or "paused"), tooltip showing the prompt, and an on/off toggle (optimistic; reverts on failure); a "manage" link opens bot settings on the routines tab; empty text suggests asking in chat with an example.
  - Members (rooms only): member rows with avatar, name, label and a remove button (disabled when only 2 remain); an "add a bot" control listing non-member bots (or a note that every bot is already in); a hint about @mentions; loading and empty states; inline errors.
  - Suggested (non-rooms; dismissible, remembered): one "add to Slack" shortcut that starts the Slack connect flow.
  - Computer (non-rooms): a row with status text (awake / waking up… / setting up… / going to sleep… / unreachable (+ error) / asleep) and a thumbnail — the bot's live screenshot refreshed every 4 s while the VM is running and the tab is visible; a pulsing dot when awake without an image or while transitioning; a sleeping face otherwise. Clicking opens the viewer. When not running and not transitioning, a "wake computer" action.
  - Voice chat (non-rooms): voice selector with a preview button ("playing…" while previewing), speed selector, language selector — each saved immediately and optimistically (rolled back with an inline error on failure); a start/end voice chat button. If the saved voice or speed is not in the option list it is added so it can be displayed. A small built-in option list is used until the server list loads.
- REQ-1252 Tasks tab: the bot's tasks sorted waiting-on-you, then working, then done, then newest; "see all" opens the Tasks view; loading and empty states.
- REQ-1253 Library tab: breadcrumb (root + folders, each clickable), refresh button (spins while loading), list of entries — folders (open on click) and files (download on click or via a download icon with a spinner) showing size (B / KB / MB) or "folder" and relative modified time. States: asleep (message + "wake and show files" button), loading, error (with provider message), empty root (explains saved reports/notes appear here), empty folder. Reloads when the bot, path, or VM awake state changes.

### 12.7 Tasks view

- REQ-1255 Replaces the chat column. Header with title and a filter: in progress (default; shows the open count), done, all. Rows across all bots sorted as in REQ-1252: check ring or done check, title, note, bot avatar + name, relative timing phrase (updated / asked / completed … ago), and a state chip (working on it / waiting on you / done). Clicking a row opens that bot's chat. Loading and empty states (empty text differs for the done filter). Refreshes on tasks events.

### 12.8 Modals

- REQ-1260 Modal behaviour: dimmed backdrop; click outside or Escape closes; first input focused; focus restored on close.
- REQ-1261 Create bot: live avatar preview; name field (max 60, required); shape grid of 13 shapes in rows of 5/5/3 (default heart) with a ring on the selection; colour swatches in rows of 6/5 (default orange); type choice — personal assistant (default) or teammate, each with a one-line explanation; footer link to create a group chat instead; cancel and create (disabled until named; busy label). On success the bot is added, selected and the modal closes; errors inline.
- REQ-1262 Create group: name field; checklist of all non-room bots (avatar, name · label, check when picked); create enabled with a name and at least 2 picks; on success reload bots and open the room.
- REQ-1263 Search: text field; results limited to bots/rooms (primary first, then recent), filtered by name, label and description; each row shows avatar, name · label and last preview (or description / placeholder); arrow keys move the highlight, Enter opens, hover highlights; "no match" state. (The placeholder promises chats and settings, but only bots are searched.)
- REQ-1264 Connect Apps (large dialog ≈900×700): title; a chip showing the connected count with up to 4 logos that toggles a connected-only view; search field (debounced 200 ms); a disabled "bot templates" chip (coming soon); category pills — All, five featured categories mapped to provider categories (password managers → security & identity tools; productivity; communication; design → images & design; code → developer tools), and a "More" menu with all remaining categories (title-cased, common acronyms upper-cased). Default view: a "picked for you" section (first 6 apps by popularity) and one section per featured category (up to 4 apps, with "view all" when it has more than 2). Search/category views show a two-column results grid; connected view lists connected apps. App row: logo (letter fallback), name, description (or error), and a state control: Connect → "opening…" → "waiting…"; Connected (hover reveals disconnect; first click asks to confirm, second click disconnects; moving the pointer away cancels); or a static "built in" marker for no-auth apps. Loading, error and empty states. Refreshes on connections events and on the popup's completion message.

### 12.9 Bot settings dialog (≈760×680)

- REQ-1270 Header with avatar and name; left nav with four tabs showing counts: General, Skills, Memories, Routines. Closes itself if the bot disappears. Load errors show inline.
- REQ-1271 General: look preview with a "change look" toggle revealing shape (rows of 7/6) and colour pickers; fields — name (required, max 60), label (max 60, with hint), about (max 500), instructions (max 8,000, with hint and example placeholder), thinking effort (low / medium / high / max, each with a one-line explanation of the speed-vs-depth trade-off), used as (personal assistant / teammate). A save bar shows "unsaved changes", discard and save (only changed fields are sent; disabled when unchanged or name empty; transient saved/error note ≈2.4 s). Conversation section: start a new conversation (two-step confirm; explains memories, skills and routines are kept) and, for non-primary bots, make primary. Danger zone: delete bot (two-step confirm; disabled for the primary with a note to make another bot primary first; explains chat, memories, skills and routines are removed).
- REQ-1272 Two-step confirm control: first click changes the button to a danger-styled confirm label; it reverts after 4 s without a second click; shows a busy label while running.
- REQ-1273 Skills: intro; "new skill" button; inline editor (name max 80, optional when-to-use max 300, steps textarea; cancel / save; errors inline); list items show name and description (or the first line of the body) with edit and delete (confirm) actions; loading and empty states.
- REQ-1274 Memories: intro explaining both explicit saving and automatic pick-up; a search box when more than 6 exist; list items show text, a chip distinguishing "picked up" (learned) from "saved in chat", the date, and a forget button (optimistic removal, restored on failure); loading / empty / no-match states; a "conversation memory" meter showing percent full (estimated history size ÷ compaction threshold, capped at 100) with an explanation that older messages get summarised when it fills and the date of the last summarisation. Refreshes on memories events.
- REQ-1275 Routines: intro noting routines are added or changed by asking in chat; list items show name, schedule description and next-run label ("next today/tomorrow/<weekday> <time>" in the routine's timezone) or "paused", the prompt, and actions: run now, delete (confirm), on/off switch; transient notes (resumed / paused / running now / deleted); loading and empty states.

### 12.10 App settings (full window)

- REQ-1280 Left nav: back button, heading, sections General, Computer, Permissions, Connected apps, Account; close button; Escape closes.
- REQ-1281 General: theme choice as three illustrated tiles (system / light / dark) with a note that system follows the device.
- REQ-1282 Computer: explanation that all bots share one cloud computer with a screen each; a status row (dot: on / transitioning / off; status text; the idle-sleep minutes and auto-wake behaviour) with a Sleep button when running or a Wake button otherwise (busy labels; disabled while transitioning); error text. "Screens in use": each lease with bot avatar and name (or "removed bot"), screen label (main screen, or a number derived from the display number so the first extra screen is "screen 2"), last-used relative time, and a reset button (two-step confirm; disabled with a hint when the computer is asleep); empty and loading states; a note that reset closes all windows and that up to 4 bots can have a screen at once.
- REQ-1283 Permissions: list of stored tool policies, each shown as "App · action" with its mode in words (always allowed / never allowed / asks first), the raw slug in monospace, and an "ask again" button that removes it; empty state explains entries appear after choosing "always allow".
- REQ-1284 Connected apps: summary row with count and a button opening the Connect Apps modal (closing settings first); a row per connected app with logo, name, description and a "connected" chip; note that bots ask before changing data.
- REQ-1285 Account: initials, name, email and a sign-out button (reloads).

### 12.11 Computer viewer (full-screen overlay)

- REQ-1290 Top bar: bot avatar, "<bot>'s computer", status text, close button. Stage: the live screen rendered by a VNC web client connected through the relay (REQ-840), scaled to fit, no remote resize, shared session.
- REQ-1291 Modes: starts in watch (view-only; clicking the backdrop or Escape closes). A bottom bar explains the user is watching and offers "take control", which reconnects in control mode (mouse/keyboard forwarded, focus captured on click, Escape goes to the remote desktop, backdrop click does nothing, a live indicator is shown) with a "done" button returning to watch.
- REQ-1292 Connection overlays: connecting; disconnected or unreachable with a reconnect button. When the VM is not running: a sleeping illustration with either the transitional status text or an "asleep" message plus a wake button; shows the last error if any. The viewer connects automatically once the VM reports running.

### 12.12 Developer aid

- REQ-1295 (Optional) In development builds a URL flag injects sample rows of every card type, state and row kind into the open transcript client-side for visual checks.

---

## 13. Configuration

Setting names are suggestions; behaviour and defaults are normative.

| # | Setting (suggested name) | Effect | Default |
|---|---|---|---|
| REQ-1300 | MODEL_API_KEY | Model-provider key for text, compaction, voice secrets, TTS, STT | required |
| REQ-1301 | MODEL_NAME | Text model for all bots and auxiliary calls | provider flagship reasoning model |
| REQ-1302 | APPS_API_KEY | App-provider key (sign-in, catalogue, connections, tools, triggers) | required |
| REQ-1303 | COMPUTER_API_KEY | Computer-provider key | required |
| REQ-1304 | COMPUTER_WORKSPACE_ID | Workspace for all users' VMs; if empty the first visible workspace is used | empty |
| REQ-1305 | COMPUTER_RAM_GB / COMPUTER_CPU | Size of each new VM (a larger size is advisable for 4 simultaneously active bots) | 8 GB / 2 vCPU |
| REQ-1306 | COMPUTER_RESOLUTION | Desktop resolution and colour depth | 1280x800x24 |
| REQ-1307 | PORT | Server listen port | 8787 |
| REQ-1308 | APP_URL | Public URL of the web app (post-sign-in redirects) | http://localhost:5173 |
| REQ-1309 | SERVER_URL | Public URL of the server (OAuth/connection callbacks) | http://localhost:<port> |
| REQ-1310 | SESSION_SECRET | Required at start-up | required |
| REQ-1311 | DEV_LOGIN | "1" enables developer email login; must be off when exposed | off |
| REQ-1312 | DB_PATH | Database file location (directory auto-created) | data folder beside the server |
| REQ-1313 | VOICE_MODEL | Realtime voice model | provider's latest voice model |
| REQ-1314 | STT_MODEL | Dictation transcription model | provider's current transcription model |
| REQ-1315 | NO_SCHEDULER | "1" disables cron routines, event triggers and check-ins (for secondary/test servers sharing a database) | off |
| REQ-1316 | IDLE_SUSPEND_MIN | Idle minutes before the VM sleeps | 20 |
| REQ-1317 | IDLE_SWEEP_SEC | Idle watcher interval | 60 |
| REQ-1318 | IDLE_DRY_RUN | "1" logs instead of suspending | off |
| REQ-1319 | COMPACT_CHARS | Compaction threshold in characters | 300,000 |
| REQ-1320 | COMPACT_TOKENS | Alternative threshold in tokens (×4 = chars); overrides the above when set | unset (75,000 equivalent) |
| REQ-1321 | COMPACT_KEEP_TURNS | User turns kept verbatim after compaction | 4 |
| REQ-1322 | COMPACT_METHOD | "summary" skips provider compaction and always summarises; otherwise auto | auto |
| REQ-1323 | CONSOLIDATE_IDLE_MIN | Quiet minutes before memory extraction | 10 |
| REQ-1324 | CONSOLIDATE_SWEEP_SEC | Consolidation sweep interval | 60 |
| REQ-1325 | PROMPT_MEMORY_CHARS | Character budget for memories in the system prompt | 4,000 |
| REQ-1326 | (web dev) API_TARGET | Where the dev web server proxies API and WebSocket calls | http://localhost:8787 |

- REQ-1330 Missing required settings abort start-up with a clear message. Numeric settings that are empty or non-numeric fall back to defaults. Secrets live only in server configuration, never in the database or the browser.
- REQ-1331 In development the web app runs on its own port (5173) and proxies API paths, including WebSockets, to the server; in production the server serves the built web app itself.

---

## 14. Edge cases, limits and constants

### 14.1 Notable edge cases

- REQ-1400 A free-text message while a question card is pending is handled as a normal user turn; the card remains pending until answered or skipped.
- REQ-1401 A new non-resume turn (user message, routine, bot message, system notice) while an approval is pending expires that approval and skips the whole remaining batch (REQ-511). Clicking a stale approval afterwards is a no-op.
- REQ-1402 Server restart mid-turn: live state resets to idle; the transcript may contain a row still flagged streaming or a tool-call row still "running"; the model history is repaired on the next call (REQ-521). A paused approval survives restart because its state is persisted; resolving it resumes the turn.
- REQ-1403 Two bots messaging each other are bounded by the hop-depth rule (no delivery at depth ≥ 3); subagents (depth ≥ 2 when working from a delegated goal chain) cannot spawn subagents.
- REQ-1404 Room dispatch: with no members, a warning notice is added to the room. Otherwise responders = members whose "@name" appears in the message (case-insensitive substring), or all members if none is mentioned, capped at the first 3. Each responder receives a system turn containing the group name, member names, whether it was mentioned or the whole group addressed, the last 12 room messages (speaker: text clipped to 600), and an instruction to reply only via the group-post tool (after doing any real work), keep it short, not repeat others, and stay silent if it has nothing to add. Members answer independently and in parallel; their own private transcripts show the dispatch turn's tool activity.
- REQ-1405 Deleting a bot that is a room member leaves its id in the member list; such ids are skipped when listing members and dispatching.
- REQ-1406 Deleting a bot does not delete its files or browser profile on the VM, nor its provider screen (the lease is dropped and the screen becomes reusable).
- REQ-1407 If the app provider is unreachable, bots still run with built-in tools and search; the prompt notes that the app list is unavailable.
- REQ-1408 Screenshot thumbnail and library listing never wake a sleeping VM implicitly; viewer, download, wake button and screen tools do.
- REQ-1409 Unread count increases by one per completed assistant message (and per group post in a room), including while the chat is open; the open, visible chat immediately marks itself read.
- REQ-1410 The subagent-message tool also works on a bot-to-bot basis: subagents report back using the general bot-messaging tool addressed to the parent by name, so a parent's name must stay resolvable.
- REQ-1411 The app-connection callback identifies the user from the browser's session cookie; if the popup has no session the page still renders but nothing is updated.
- REQ-1412 Security posture to preserve or improve: all bots of one user share one VM (no isolation between a user's bots); approvals cover only connected-app write actions, not browser or shell actions; bot patch fields are not validated server-side.

### 14.2 Constants

| Constant | Value | Role |
|---|---|---|
| Session lifetime | 30 days | cookie + server record |
| SSE keep-alive | 20 s | ping when idle |
| SSE reconnect backoff | 1 s → ×2 → max 15 s | client |
| Bot name max | 60 chars | create/patch |
| Label / about / instructions UI max | 60 / 500 / 8,000 chars | settings |
| Preview length | 140 chars | sidebar preview |
| Rows page | default 200, max 500 | transcript fetch |
| All-tasks list | max 200 | tasks view |
| Apps list default limit | 120 | catalogue page |
| Catalogue fetch | 500 × up to 3 pages; cache 1 h | app provider |
| Model steps per turn | 60 | loop cap |
| Model request timeout | 360 s (main), 300 s (memory/compaction), 45 s (call summary) | provider client |
| Streaming flush interval | ≈120 ms | transcript rewrites |
| Inline screenshots kept | 3 | image pruning |
| Screenshot settle delay | ≈0.7 s | before capture |
| Screenshot format | JPEG quality 75 | provider request |
| Type chunk | 1,500 chars | typing tool |
| Scroll default amount | 3 | scroll tool |
| Browser open | wait ≈4 s; timeout 40 s | open-browser tool |
| Shell timeout | default 120 s; clamp 1–290 s | shell tool |
| Shell output cap | last 20,000 chars | shell tool |
| Save-file name max / chunk | 120 chars / 60,000 base64 chars | save tool |
| Provider HTTP timeouts | default 120 s; create 300 s; start 320 s; resume 200 s; export 180 s; bash = cmd + 40 s | computer provider |
| Wait-for-running | poll 3 s, up to 240 s | VM start/resume |
| Suspend-settle wait | poll 3 s × up to 40 | before resume |
| Desktops per VM | 4 | lease cap |
| Subagents per parent | 4 | cap |
| Bot-to-bot hop limit | no send at depth ≥ 3; no subagent spawn at depth ≥ 2 | loop safety |
| Room responders | max 3 | dispatch |
| Room context | last 12 messages, 600 chars each | dispatch |
| Room/subagent name | 60 / 32-char goal excerpt | naming |
| Question options | max 6 | ask-user card |
| Recall results | max 20; words > 2 chars | recall tool |
| Trigger types listed | max 40; description 300 chars | event triggers |
| Event payload cap | 8,000 chars | event routine prompt |
| Routine prompt in system prompt | 120 chars | prompt |
| App tool output cap | 60,000 chars | tool result |
| Approval detail | 6 fields × 160 chars; total 1,200 | approval card |
| Tool error summary | 200 chars | tool-call row |
| Compaction threshold | 300,000 chars (≈75k tokens) | REQ-700 |
| Chars per token | 4 | estimates |
| Image cost estimate | 6,000 chars (recent 3), 30 (older) | size estimate |
| Compaction blob ratio | ÷22 | size estimate |
| Keep turns | 4 | compaction |
| Keep budget | 35% of threshold | split choice |
| Regrowth guard | 25% of threshold | compaction |
| Minimum worth compacting | 15% of threshold | compaction |
| Compaction failure cooldown | 10 min | compaction |
| Summary transcript cap | 200,000 chars; tool args 400; tool results 600 | fallback |
| Summary length target | ≈1,500 words | fallback |
| Consolidation idle / sweep | 10 min / 60 s | memory extraction |
| Consolidation window | 60 messages; 2,000 chars each; 24,000 total | extraction input |
| Existing memories shown | 200 | extraction input |
| New memories per run | max 8; 300 chars stored (200 requested) | extraction |
| Similarity thresholds | Jaccard ≥ 0.7; or ≥ 90% containment with ≥ 3 words | de-duplication |
| Prompt memory pool / budget | 500 newest / 4,000 chars | prompt |
| Relevance context | last 3 user messages within 12 recent | prompt |
| Idle suspend / sweep | 20 min / 60 s | hibernation |
| Check-in tick / window | 60 s / 5 min | scheduler |
| Check-in quiet guard | 20 min since last user message | scheduler |
| Check-in times | max 6; defaults 09:00 and 16:30 | settings |
| Check-in context | 10 waiting tasks; routines in last 12 h | prompt |
| Silent-streak hint | ≥ 3 | prompt |
| Voice sample rate | 24,000 Hz mono PCM16 | calls + preview |
| Mic frame | 40 ms | capture |
| Playback lead-in | ≈60 ms | player |
| Voice client secret | 300 s; mint timeout 15 s | session |
| Voice connect timeout | 15 s | client |
| Wait for speech end | up to 8 s (tools), 15 s default, 30 s (preview) | client |
| Hand-off completion debounce | ≥ 1.5 s after hand-off; stable 1.2 s; rechecks 0.4–0.8 s | work-landed |
| Work-landed note clips | request 200 (160 for approval note); reply 1,800 | note |
| Captions kept | 200 | client |
| Call transcript stored | last 200 lines × 2,000 chars | call record |
| Call summary | ≤ 25 words; 240 chars; input last 12,000 chars | call end |
| Hand-off record clip | 200 chars | call record |
| Stale call sweep | every 10 min; calls older than 2 h | server |
| Voice error display | 6 s | call bar |
| Voice speed range / presets | 0.7–1.5; 0.7, 0.85, 1, 1.15, 1.3, 1.5 | settings |
| Voices cache | 1 h; retry ≈10 min after failure; fetch timeout 8 s | options |
| Voice prompt context | 14 messages × 400 chars; 12 memories × 200; 6 routines; instructions 2,000 | voice prompt |
| Voice search | 40 rows scanned; 8 hits; snippet −160/+240 chars | search tool |
| Voice recall | 1–30 (default 10); 800 chars each | recall tool |
| TTS preview | 400 chars text; 30 s timeout | preview |
| STT upload | max 25 MB; < 200 bytes ignored; 60 s timeout | dictation |
| Dictation | hold threshold 350 ms; max 120 s; min 250 ms | client |
| Transcript divider gap | 60 min | UI |
| Bubble grouping gap | 5 min | UI |
| Citation chips | max 6 | UI |
| Activity phrase rotation | 6 s | UI |
| Auto-scroll stick / jump button | < 40 px / > 200 px from bottom | UI |
| Composer max height | ≈200 px | UI |
| Screenshot thumbnail refresh | 4 s | details panel |
| App search debounce | 200 ms | Connect Apps |
| Confirm button timeout | 4 s | settings |
| Toast / save note duration | 2 s / ≈2.4 s | UI |
| Connect popup size | ≈520 × 680 | UI |
| Callback page auto-close | ≈0.8 s | connect flow |
| Layout widths | sidebar ≈350 (collapsed ≈88); details ≈320; chat column ≤ 960; narrow breakpoint ≈760 | UI |
