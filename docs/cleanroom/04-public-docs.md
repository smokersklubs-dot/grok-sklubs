# 04 — Public documentation: clean-room functional inventory

Source: the public product documentation section rooted at `https://docs.x.ai/grok-bot/overview` (31 pages, fetched 2026-11-13 as the site's own markdown renditions). Everything below is a behavioural description in our own words. Branded feature names are replaced by generic terms; third-party integrations, numeric limits and plan facts are recorded as public facts. Nothing here is copied UI text.

Generic vocabulary used below:

| Generic term | Meaning |
| --- | --- |
| agent | a named, long-lived AI worker with its own conversation and memory |
| lead agent | the one agent designated as the user's main contact and coordinator |
| shared agent | an agent published to a team; everyone chats with the same instance |
| workspace machine | the persistent cloud Linux computer all of a user's agents work on |
| connector | a structured integration with an external service (OAuth / MCP style) |
| credential store | the per-account store for logins, payment cards, contact details |
| secure form | an in-chat form whose values go straight into the target web page, bypassing the model |
| action reviewer | the automated risk check that runs before each agent action |
| routine | a saved instruction run by one agent on a schedule or on an event |
| skill | a reusable written procedure for a task |
| page | an agent-built, hosted, shareable read-only document/dashboard |
| library | per-agent index of everything the agent produced |

---

## 1. Concepts

- **DOC-001** The product is a set of persistent AI agents that perform work (not only answer questions) using a cloud computer, connected services, websites and files; work continues when the user's own devices are off.
- **DOC-002** Each agent has a name, a job, one ongoing conversation with the user and memory that accumulates. The recommended pattern is one narrowly scoped job per agent, plus one generalist lead agent.
- **DOC-003** All of one user's agents share a single workspace machine (browser, shell, filesystem). Isolation is strict between users (one hardware-isolated micro-VM per user) but deliberately absent between a user's own agents: files, browser sessions and CLI credentials are common.
- **DOC-004** Each agent gets its own screen (display) on the shared machine so several can do GUI work in parallel; one agent can run only one computer-use task on its screen at a time.
- **DOC-005** Agents have no identity of their own: they act as the signed-in user with the accounts that user connected, so every action is attributable to a person. Exception: team-managed connectors may use a team/service account.
- **DOC-006** Desktop and mobile apps are thin clients for chat, review and approvals; execution is server-side.
- **DOC-007** The system chooses the model per task; there is no user-facing model picker and the model used is not displayed. Usage is metered as product usage, not per model.
- **DOC-008** Suggested adoption path: (1) connect apps and use an agent as an assistant, (2) give repeated tasks their own agent, (3) assemble several agents into a team for a bigger goal.
- **DOC-009** Worked example flow in the docs: check memory → search a connected mailbox → browse and buy on a site without a connector (using stored login/card) → stop for approval before sending email → log to a connected spreadsheet → report back; each step visible in the transcript.
- **DOC-010** Only the user's own messages count as instructions; content read from web pages, emails, tool output is tagged as untrusted data and cannot grant permission.
- **DOC-011** A marketplace/gallery of prebuilt agent templates exists (e.g. mention monitor, household inbox helper, meeting-recap deck maker, pitch-deck reviewer, a "team builder" agent that interviews the user and creates several agents, and a "connector builder" agent that wraps an API as a connector plus skills).

## 2. Agent setup and customisation

- **DOC-020** First run: short intro, automatic creation of a first agent, chat opens. Alternative: start from a prebuilt template.
- **DOC-021** Create an agent from a sidebar button or shortcut: enter a name, pick an avatar shape and colour. Job, sources and limits are given in the first chat message, not in a form.
- **DOC-022** Personal agents have no description field or settings page; behaviour is changed only by telling the agent in chat and asking it to remember. Shared agents keep an editable description.
- **DOC-023** Per-agent identity fields: name, short label/title, avatar. Avatar options: stock character variations, AI-generated from a text description, or uploaded image (max 25 MB, with crop). Only the owner can rename.
- **DOC-024** Lead agent: prompt to create one or promote an existing agent; can be replaced later; marked with a star; a shared agent cannot be the lead.
- **DOC-025** Agents may propose or create new specialised agents themselves; the lead agent can set up a whole team on request.
- **DOC-026** Roster organisation: pin agents; group into named sections (synced across devices); hide from the list without stopping routines or losing history; a "hidden" list to restore.
- **DOC-027** Duplicate an agent (mobile): copies profile, settings, enabled skills, routines, avatar; does not copy history, memory, attachments.
- **DOC-028** Export an agent as a template: the agent builds a template, the user publishes it and gets a link; recipients preview on the web and import their own copy. Template carries identity, description, skills and routines only — never the machine, logins or history. Owner can view details, push updates, or delete (which kills the link). Links are public by default; teams can restrict to team-only or disable.
- **DOC-029** Import an agent from a template gallery or a template link.
- **DOC-030** Delete an agent: irreversibly removes profile, conversations, memory, routines, attachments, shared facts it stored, and any template published from it. Files and sessions on the shared machine are not removed.
- **DOC-031** Deep link scheme to open a specific agent's chat (or the lead agent) with pre-filled, unsent text (max 1,000 chars, only if the composer is empty); web-link variant for places where custom schemes are not clickable; a link-builder helper.
- **DOC-032** Interface language applies to menus; new agents write in that language unless the user writes in another. 38 UI languages on desktop and mobile.

## 3. Chat and cards

- **DOC-040** Composer inputs: text, pasted text/links/images, file attachments (drag-drop or picker), dictation, `@` mentions of agents/groups/routines/connectors, invoking a skill by name, reply-to-specific-message, emoji reactions.
- **DOC-041** New messages may be sent while work is running; a user message outranks background work and can redirect the current turn. A plain "stop" message halts work (no undo of completed actions).
- **DOC-042** Transcript shows inline: tool activity, computer use, created files, questions, approval requests, forms, voice memos, call cards.
- **DOC-043** Threads: reply in a thread to scope feedback to one result or approval. Reactions are acknowledgement only.
- **DOC-044** Outgoing-message draft cards: email and chat-app messages prepared by an agent appear as editable drafts (recipients + body, listing attached files) with send / discard. If an attached file changed after the draft was prepared the send is blocked and the card reopens.
- **DOC-045** Drafting is the default. Per-agent owner-only toggle to skip drafts and send directly (still subject to the action reviewer); not offered in group chats; mail from the agent's own address that was not requested in chat always stays a draft.
- **DOC-046** Result cards: files, images, links and tool results render as cards with preview, save, open-source-link.
- **DOC-047** Link handling: links open in the system browser; hover preview on link cards.
- **DOC-048** Shopping cards: product cards (photos, options, rationale, where to buy, buy-now or out-of-stock); "notify me" creates a back-in-stock routine. Order card shows store, items, shipping address, payment method, total, optional gift details; pay button shows the total; cancel charges nothing; card can expire; only the owner can pay.
- **DOC-049** Question and form cards from the agent; answers return to the asking agent (also works in group chats).
- **DOC-050** Connect cards: in-chat prompt to authorise a connector, with reopen/retry; sign-in must complete within ~10 minutes.
- **DOC-051** Permission cards for device capabilities (mobile) naming the app and the device; must be answered on the named device; agent waits up to 5 minutes and can resume if granted within an hour.
- **DOC-052** Search / command palette: switch between agents and groups, find messages, files, links, routines, pages, settings and actions; jump to the matching place in a conversation; "search older" to extend beyond recent messages; find-in-chat.
- **DOC-053** Extensive keyboard shortcuts on desktop (palette, new agent, new group, focus composer, quote selected text into composer, switch agents 1–9, history back/forward, zoom, fullscreen, settings, shortcut cheat-sheet).
- **DOC-054** Attention states in the sidebar: needs attention (question/approval/handoff), unread result, working/typing; manual mark read/unread.
- **DOC-055** In-app error notices above the composer, dismissible, some with a copyable request ID.
- **DOC-056** Accent option: colour each agent's messages and cards with that agent's colour, or neutral.
- **DOC-057** Agents can report plan/usage details when asked by the owner in a private chat (source of allowance, amount used, reset time); declined elsewhere.
- **DOC-058** Offline behaviour: client shows cached messages and auto-refreshes; cloud work is unaffected.

## 4. Computer use (workspace machine)

- **DOC-070** Persistent cloud Linux machine with browser, shell and filesystem; files, cookies and sign-ins persist between tasks; shared workspace directory for durable project files.
- **DOC-071** Live view: open the machine from a conversation side panel to watch clicks, typing, navigation and status; viewing is optional and closing it does not stop work. Available on mobile too.
- **DOC-072** Human takeover: the agent requests control hand-over when a step needs a human (SSO, passkey, unsolved CAPTCHA, approval on another device, QR code, bank card verification, human-only sites). User takes control, does the step, signals done, tells the agent to continue.
- **DOC-073** Login resolution order: credential store → connected password manager → secure form → human takeover.
- **DOC-074** One-time codes sent by email can be read from a connected mailbox or the agent's own inbox.
- **DOC-075** Hardware security key passthrough: the machine's browser can use a key plugged into the user's desktop (macOS/Windows; default on; each use needs approval; not on Linux).
- **DOC-076** Egress via user's desktop: per-desktop toggle to route the machine's web traffic through the user's own device so sites see the user's IP; applies to new connections; private/VPN addresses blocked unless allowed by the org; only one device routes at a time; shows a count of blocked sites.
- **DOC-077** Local execution: separate, opt-in capability for agents to run commands, read files and transfer files on the user's own desktop through the desktop app. Policy per device: ask every time (default, card shows the exact command), always allow, never allow. First request shows a four-way prompt (always / once / never / deny once).
- **DOC-078** Device registry: list of phones and computers where the app is used, with online state/last seen; rename; per-computer execution policy; remove an offline computer.
- **DOC-079** Machine lifecycle controls: update (software-only keeps everything; full image update keeps agents, files, logins but drops user-installed packages; may be schedulable), recover (save what is possible, rebuild from saved data), reset (rebuild from last snapshot). Recommended escalation order; background continuation; retry options.
- **DOC-080** Durable sync of machine data with restore on reopen; dependency folders (package caches, virtual envs) are excluded and must be reinstalled; conversation history is stored outside the machine so deleting files never deletes chats.
- **DOC-081** Low-disk handling: agent notifies once, lists biggest files/folders with sizes, deletes only on confirmation.
- **DOC-082** Idle machines hibernate automatically and wake on demand; stale images are rebuilt with files preserved.
- **DOC-083** Public-web X/social read access built in without an account (search posts, read accounts/mentions, quotes/reposts, trends/news, count posts); account-private data requires a connector.
- **DOC-084** Agents can delegate coding tasks to separate cloud coding-agent machines; on completion, files cited in the sub-run's report are copied back and attached; card shows run state (done/error/expired), view-PR link, and open-in-IDE link.
- **DOC-085** Agents can spawn background helper tasks/subagents inside their own run; these can also produce images/videos that the parent posts.

## 5. Connected apps / integrations

- **DOC-100** Connector catalogue browsable/searchable from the sidebar and from mobile; install then authorise via the provider's OAuth in the browser; states: installed, needs auth, disconnected, connected, disabled by admin.
- **DOC-101** Agents can install a connector on request (search catalogue, install, surface a connect card); tools are usable from the next message.
- **DOC-102** Custom connectors: add by remote HTTPS URL (optional headers, OAuth client ID/secret) or as a command run on the workspace machine (command + args). Agents can add these too; private-network or private-CA servers require approval. Team policy may block saving.
- **DOC-103** Connections are account-wide (every agent can use them) and tokens are held server-side; the agent calls tools without ever receiving the token.
- **DOC-104** Multiple accounts per connector where supported, each with a user-chosen label ("work", "personal"); user tells the agent which label to use. Some connectors allow only one account (e.g. Gmail).
- **DOC-105** Individual connector tools can be enabled/disabled.
- **DOC-106** If a site has a connector, the agent prefers it or offers the connect card instead of signing in through the browser.
- **DOC-107** Removing a connector signs the user out and removes everything it added; team-required connectors cannot be removed.
- **DOC-108** Named integrations in the docs: Gmail, Google Calendar, Drive, Docs, Sheets, Slides, BigQuery, Google Ads; Outlook, Outlook Calendar, OneDrive, SharePoint, Microsoft Teams, Power BI (read-only, renders reports as images); Slack (posts as the connected user); Notion; Granola; Linear; GitHub; Sentry; PagerDuty; Asana; Stripe (periodic re-auth) and Link wallet; Shop Pay; X Money; X (private data needs the user's own API credits); Databricks Genie (admin-configured OAuth app); Vanta (region choice US/EU/AU); 1Password; Zoom; Intercom; Robinhood; Postiz; Adapter; Tailscale; QuickBooks Online; Workday; WhatsApp Business; Zoho CRM/Books/Desk; an "Origin" first-party connector.
- **DOC-109** Connector capability notes: calendar read/create/update/free-busy/RSVP; spreadsheet cell read/write respecting source permissions; mail search/read/draft/send/label with native signature preserved; connectors never exceed the connected account's own permissions and cannot change sharing.
- **DOC-110** Password-manager integration (1Password, personal/family accounts): per-login approval inside the password manager app, which fills the page itself; shared logins stay available later; cards not supported; only the personal vault.
- **DOC-111** Proactive health: the agent tells the user when a connector's auth has lapsed and offers reconnection.
- **DOC-112** Some providers cannot complete auth on a phone; the app directs the user to finish on desktop.
- **DOC-113** Guidance pages for corporate Google Workspace / Microsoft 365 admin-consent blocks.
- **DOC-114** Agents can be asked to connect any MCP server; a helper agent can build one from a plain API, test it, and publish only on approval.

## 6. Skills

- **DOC-130** A skill is a named reusable procedure: when to use, required inputs/access, steps, validation, expected output, approval boundaries.
- **DOC-131** Create by asking an agent to save the just-completed process as a named skill.
- **DOC-132** Private skills form one library shared by all the user's agents, with per-agent enable/disable; on teams a skill can also be saved for a single agent (and travels with it if shared).
- **DOC-133** Invoke a skill by naming it in chat.
- **DOC-134** Packaged skills can be installed from the same catalogue as connectors.
- **DOC-135** Publish a private skill to a team (requires a description); later sync edits, copy link, unpublish. Admins can disable member publishing. Built-in/template-bundled skills cannot be published.
- **DOC-136** Teach by demonstration: in a one-to-one chat with the machine view open, record up to 10 minutes of the user performing a browser workflow (no audio); the agent drafts a skill from the recording for review and testing. Desktop only, gradual rollout.

## 7. Memory

- **DOC-150** Each agent keeps its own memory: user preferences and working style, standing rules, facts about the user, and a dated work log.
- **DOC-151** A small set of profile facts (e.g. name, time zone) is shared across all the user's agents; learned by one, known by all.
- **DOC-152** The agent decides autonomously what to save (often mentioning it); the user can explicitly ask it to remember, correct or forget. No memory management screen for personal agents — inspection is conversational.
- **DOC-153** Memory spans all chats with that agent, voice calls included; in group chats an agent can use what it knows privately unless told not to; agents' memories are not shared with each other.
- **DOC-154** Resetting a conversation clears history but keeps memory, files, routines, settings. Deleting the agent deletes its memory; deleting the account deletes all.
- **DOC-155** Memory import: settings flow gives a prompt to paste into another assistant, the user pastes the answer back, and it is sent to the lead agent to absorb.
- **DOC-156** Secrets, cards, contact details are steered to the credential store, not memory.
- **DOC-157** Shared agents keep team-level memory and skills; anything learned from a non-manager teammate is queued as a suggestion for owner/manager approve/reject; personal facts about an individual stay private to that individual's chat.

## 8. Routines, scheduling and triggers

- **DOC-170** A routine binds one agent to an instruction plus a schedule and/or event triggers; created and edited conversationally; runs in the cloud.
- **DOC-171** Natural-language schedules ("every weekday at 8", "every 2 hours") rendered back in words for verification; minimum spacing 5 minutes; uses the account time zone (auto-detect or fixed).
- **DOC-172** A new schedule waits for its next occurrence; a "test now" action runs it immediately (real side effects) — desktop only, not available on every routine.
- **DOC-173** Event triggers: chat-app message (agent mentioned, phrase match, emoji reaction, any message; one channel or workspace-wide), GitHub / Linear / Sentry / PagerDuty events, email arriving at the agent's own address (any sender, specific addresses, whole domain; plus-alias scoped; authenticated senders only by default; no subject filter), and inbound webhooks. Only events after trigger creation count.
- **DOC-174** Webhook trigger: per-routine URL plus bearer secret; POST with optional JSON body passed to the agent with the instruction; HTTP 200 means accepted/started, not finished.
- **DOC-175** Routine management UI: list per agent with name, timing or paused state, toggle; detail with instruction, when-to-run, webhook fields; pause/resume, test, edit-in-chat, delete. Mobile adds next run and run history (running/succeeded/failed with reason).
- **DOC-176** Limits: 50 routines per agent; last 20 run records kept per routine; 300 runs/hour across all routines and 200/hour per routine; over-limit runs fail and are not retried.
- **DOC-177** Each run consumes usage; the system may ask whether to keep routines running after long absence and pause them if unanswered.
- **DOC-178** Approvals raised by unattended runs expire after ~30 minutes.
- **DOC-179** Routines can create or update pages, and can be created from UI affordances (e.g. back-in-stock watcher).
- **DOC-180** Shared-agent routines: per-routine visibility (only me / everyone with access); setting for whether collaborators may create routines; when a shared-agent routine replies in a chat-app thread it keeps following that thread without further mentions.
- **DOC-181** Proactive behaviour: the lead agent checks in unprompted, offers to take on tasks it notices, flags connector problems; always offers before acting. Notification toggle silences alerts but not the check-ins.

## 9. Teams, groups, delegation and subagents

- **DOC-200** Group chat: 2–6 agents in one conversation with an editable name and membership; created from a button, shortcut or palette.
- **DOC-201** Addressing: unaddressed messages let agents decide who answers; `@agent` targets one; reply targets the author; `@everyone` broadcasts.
- **DOC-202** Agents in a group can post and pass work among themselves. Approval requests, secret/login requests and outgoing drafts do not appear in groups; agent-to-group handoffs are text-only.
- **DOC-203** Agent-to-agent direct messaging: asynchronous; the recipient wakes, handles the request, may reply later; visible in the conversation. No global off switch — governed by instructions/memory.
- **DOC-204** All agent replies, including inter-agent messages, consume usage.
- **DOC-205** Shared (team) agents: publish an agent to the whole team, the whole organisation, or invited people/groups; no copy is made; each person's chat is private even from owner and managers. Requires a team plan and at least two members; shared agents are cloud-only.
- **DOC-206** Roles on a shared agent: owner, manager (can change behaviour and sharing), collaborator (chat only). Draft state until published.
- **DOC-207** Discovery: browse list (with popularity, user counts, creator), palette search, ask your own agent to find one by purpose, or open a share link. Add to / remove from sidebar; admins can auto-add to members' sidebars (not removable).
- **DOC-208** Shared-agent resources: its own connectors, named secrets (env var name + description visible to agent, value write-only), skills, files, and its own stored website logins (manager-only) — all usable in every member's chat. Personal credential store is never available to shared agents.
- **DOC-209** In a member's own chat a shared agent may also use that member's personal connectors after asking (once / always for this agent / always for all shared agents / skip); a setting clears those remembered choices.
- **DOC-210** Shared connector modes per app: each member connects individually; a manager shares their own account for everyone (requires admin opt-in); or a dedicated agent-owned account.
- **DOC-211** Execution context: in a member's own chat or DM the shared agent works on that member's machine (or an isolated one if privacy settings conflict); in channels, threads, group DMs and group chats it uses a machine of its own.
- **DOC-212** Billing attribution: replies are charged to the person being answered; unlinked/non-member chat-app users are charged to the team.
- **DOC-213** Approvals on shared agents go to the person being answered only.
- **DOC-214** Manager console for a shared agent: general settings, channels, agent accounts, knowledge (team memory, skills, review queue), analytics (active users, messages, estimated hours saved, top users over 7/30/90 days).
- **DOC-215** Converting a personal agent for team use: move it with history and memory, copy it, or start a fresh shared agent.
- **DOC-216** Delegation matrix: personal agents can hand work to other agents from the app or a private DM but not from shared channel threads; shared agents in a thread act for whoever mentioned them and can hand work to that person's own agents with replies returning to the same thread.
- **DOC-217** Delegation to cloud coding agents and in-run subagents (see DOC-084/085); admins can disable coding-agent delegation.

## 10. Voice

- **DOC-230** Dictation: speech-to-text into the composer for review before sending (desktop shortcut, push-to-talk hold; mobile button).
- **DOC-231** Live voice conversation with a single agent (desktop and mobile; not in group chats): mute, hang up, live transcript, settings for voice, speed and language (with auto-detect). One call at a time; navigating elsewhere keeps the call with a return control.
- **DOC-232** Automatic reconnect on brief network drops; clear failure states otherwise. On phones, another audio session ends the call.
- **DOC-233** After a call: a card with duration and full transcript; the agent may post follow-up work; thumbs up/down call feedback. Agents recall earlier calls and recent chat during calls.
- **DOC-234** Voice memos: agents can reply with playable audio including an expandable transcript.
- **DOC-235** Microphone selection in settings.
- **DOC-236** Voice calls with a teammate's shared agent are possible on desktop.

## 11. Channels

- **DOC-250** Desktop apps: macOS (ARM + Intel), Windows (x64 + ARM64), Linux (x64 + ARM64; deb, rpm, AppImage). Auto-update with install-while-idle; forced update when a build is too old (>14 days with a newer release). Multi-account switching.
- **DOC-251** Mobile apps: iOS 18+/iPadOS 18+, Android 9+. Same agents, chats, routines, connectors and machine. Capabilities: chat, dictation, voice calls, photo capture/attach, threads, reactions, per-conversation saved drafts, text selection quoting, machine live view and takeover, approvals, routine pause/resume/delete and run history, search across messages/agents/groups/files/routines, pages and library, settings, snapshot reset of the machine, feedback.
- **DOC-252** OS share-sheet target on mobile: send photos, files, links, text (plus video/audio/PDF on Android) to a chosen agent with an optional note, without leaving the source app.
- **DOC-253** iOS system integration: voice-assistant/shortcut actions (list agents, send message, start dictation, start voice call), lock-screen live activities for dictation and calls, hardware action-button binding.
- **DOC-254** On-device tools (mobile, owner's own chat only, app must be foreground): calendar read/write (no recurring-event edits, never invites), contacts read, current location, alarms/timers (≤24h); iOS only: reminders CRUD and smart-home accessory control. Per-capability OS permission management screen.
- **DOC-255** Team chat app (Slack): shared agents get their own app/handle; DM or mention in channels; account linking once per workspace; approval cards in-thread answerable only by the requester; agent records who requested each post; optional access for workspace members outside the team (not guests or externally shared channels). Personal agents are reachable only by their owner.
- **DOC-256** Microsoft Teams: admin enables org-wide; owner/manager connects the shared agent; Teams admin approves; supports channel mentions, group chats, DMs, reading the thread and joined channels, reading attached files, delivering files via the user's cloud drive; account-link card; update name/avatar; remove.
- **DOC-257** Meetings: agent joins Google Meet, Zoom or Teams calls from a pasted link (after approval) or automatically from the calendar; host admits it; labelled as transcribing; takes notes; answers in meeting chat when addressed by name (private chat replies privately); can be muted to listen-only; upcoming-meetings list with cancel/quit; post-meeting summary and action items, long report as a page; transcripts retrievable later; will not disclose credentials. Plan-gated (team, enterprise, top individual tier).
- **DOC-258** Own email address: one address per account on a product mail domain; claim via chat (with approval) or settings; plus-aliases; receive/read/search/send/forward; no inbox UI — query the agent; spam/virus-failed mail kept without body; incoming limits 10 attachments, 10 MB each, 25 MB total; mail never wakes an agent except through a routine. Address is permanent and never reissued; reserved names blocked; name rules (≤64 chars, lowercase/digits/dot/hyphen/underscore).
- **DOC-259** Outbound email limits: ≤50 recipients; ≤10 attachments, 10 MB each, 25 MB total, no executables; newsletters/first-contact go one recipient per message with one-click unsubscribe; automatic suppression after bounce/unsubscribe/spam complaint; caps on new recipients. Unattended sending is impossible — non-chat-initiated mail waits as a draft.
- **DOC-260** Outbound phone calls (US only): agent phones a business; first-use terms consent; per-call confirmation of callee; live status and transcript; end call; human take-over/transfer; mid-call question card with countdown; agent asks before adding details mid-call; afterwards transcript, recording playback, copy/export transcript, download recording.
- **DOC-261** Social-network DM surface: the same agents available inside a social app's chat (personal accounts only, gradual rollout); agents may follow up proactively there.
- **DOC-262** Public mention handoff: tagging a product handle in a public post forwards the post (plus replied-to and quoted posts and still images) to the user's lead agent as a task; only a brief confirmation is posted publicly, results stay in the app. Region-restricted; ignored for posts with video/GIF or failing moderation.
- **DOC-263** Notifications: per-agent toggle (finished or waiting); desktop-first routing when the desktop is actively in use, with phone escalation ~3 minutes later for items needing input; focused-conversation suppression; dock/sidebar badges; no per-agent switch for group chats.

## 12. Permissions, approvals and safety

- **DOC-280** Action reviewer: an independent model evaluates each risky action before execution (shell commands, connector calls, computer use, routine/trigger changes, delegation). Outcomes: proceed, ask the user, deny. On by default; user can switch it off unless an admin enforces it. It does not review every side effect (e.g. memory writes, most settings changes).
- **DOC-281** Approval card shows the proposed operation and inputs, sometimes with warnings (irreversible, changes security settings, shares data externally). Choices: allow once; always allow (saves an allow rule); deny (agent will not retry until a new message). Variants for terminal commands (allow/skip/manage settings) and rule-triggered cards (allow/not now/edit rule).
- **DOC-282** Custom rules in plain language, two kinds: ask-first (always stops matching actions) and allow-automatically (proceeds only if the reviewer sees no other concern). Ask-first wins conflicts. Limits: 20 of each kind, 1,000 characters each; when full, "always allow" evicts the oldest allow rule. Rules sync across devices.
- **DOC-283** Built-in safety checks apply regardless of rules.
- **DOC-284** Approval lifetime: chat-initiated cards wait indefinitely; cards from routines/inbound messages/other agents expire after 30 minutes. Sending a new message or changing reviewer settings closes open cards. Expired cards can still save an "allow next time" rule.
- **DOC-285** Group chat approvals: only the person being answered can approve; no "always allow".
- **DOC-286** Credential store: logins (site, username, password), cards (number, expiry, CVC, name, billing address), contact info; plus per-entry nickname and usage hints the agent follows. Account-wide, not scoping per agent. Passwords never visible to the model; card number/CVC are visible to the agent in first-party app chats for checkout.
- **DOC-287** Credential store management: add/edit/remove; card capture by camera scan or photo upload; CSV import from major password managers/browsers (parsed locally, <5 MB, duplicates and invalid rows skipped); passwords can only be changed/removed in settings, while the agent may edit contact info, nicknames, hints and card details on request. Values are write-only (cards show last four).
- **DOC-288** Auto-generated passwords for new sign-ups are saved without the agent seeing them. Contact details given in chat are saved after the task and reported.
- **DOC-289** Secure forms: one per step, name the destination site, fill directly into the page; optional "save to store" checkbox; unsaved values live only for that chat.
- **DOC-290** Secure secret card for API keys and other non-login secrets: masked input, excluded from transcript and model, write-only afterwards.
- **DOC-291** Payments: saved cards fill without per-use approval (to force approval, do not save the card); wallets (Link, X Money, Shop Pay) connectable with a default payment method; one-time virtual card approval via wallet; batch order card for up to 500 card payments under a single approval valid 24 hours, processed sequentially and halted on decline; wallets need one card per payment.
- **DOC-292** Prompt-injection posture: untrusted-content tagging, reviewer compares actions against the user's actual request, plus model-independent layers (per-action approval, network policy, per-user isolation).
- **DOC-293** Guidance baked into product: least privilege, start read-only, keep send/publish/purchase/delete/production behind approval; steps to revoke access (pause routines, sign out on machine, uninstall connectors, delete workspace files, hide/delete agents).
- **DOC-294** Image/video generation is subject to content rules with explicit refusal messages.

## 13. Files, library and artifacts

- **DOC-310** Attachments accepted: images, audio, video, PDF, plain text, Office documents, CSV/JSON/YAML, source code, HTML, email files, notebooks. Desktop limits: 20 attachments per message; images 25 MB each and 200 MB per message; documents/audio/other 250 MB each; video 1 GB each.
- **DOC-311** Transfer files between the workspace machine and connected storage/mail (Drive, OneDrive, SharePoint, Gmail, Outlook) without passing contents through chat; Google-native docs arrive as Office formats/PNG; Drive saves always create new files; OneDrive/SharePoint refuse name collisions unless told to overwrite.
- **DOC-312** Image generation on request from text or reference images, including real people from supplied photos; aspect ratios 1:1, 4:3, 3:4, 16:9, 9:16; real-reference lookup for known people/places/products; not used for charts.
- **DOC-313** Video generation: from text, a first-frame image, first+last frames (same image = loop), up to 14 reference images, up to 4 images pinned to moments; 1–15 s (default 6); 480p default, 720p on request; ratios 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3; inputs JPEG/PNG/WebP up to ~35 MB total; output MP4.
- **DOC-314** Media viewer: full-screen with zoom, gallery navigation, download, copy image; video player with seek and speed (0.5×–2×); bulk download; mobile forward/share/save.
- **DOC-315** Pages: agent-built hosted documents (reports, memos, dashboards, trackers, explainers) with text, tables, charts and interactive view-only controls (filters, toggles). Posted as a card; opens full-window with a side chat scoped to that page; edits happen only via the agent and update in place for all viewers; superseded cards point to the latest; user can rename the title. Can be produced/updated by routines.
- **DOC-316** Page sharing levels: private (default), invited people/groups (viewer role), whole team, organisation (some teams), anyone-with-link at a stable public URL derived from the title (no sign-in). Copy link, open in browser, native share. Public sharing disabled on enterprise plans; personal-space pages cannot be team-shared.
- **DOC-317** Web dashboard listing all shared pages with visibility, date, change visibility, copy link, delete.
- **DOC-318** Library per agent: lists pages, files and apps the agent made plus images, videos and links it sent; grouped today / this week / older, five at a time with show-more; type filters (pages, media, links, files, apps, pinned); pin/unpin; share marker on shared pages. Shared agents split "private to you" and "agent's files".
- **DOC-319** Inter-agent file handoff through the shared workspace directory.

## 14. Admin, sharing, plans and limits

- **DOC-340** Access model: included in paid individual tiers (three tiers with increasing weekly allowance), team seats, and enterprise (admin must enable; can scope to directory groups). No separate product subscription. Lowest paid tier and free tier excluded.
- **DOC-341** Usage model: weekly allowance that resets weekly; overflow via prepaid credits with auto top-up and monthly cap, or on-demand billing with a monthly limit (a running task may slightly exceed the cap). Enterprise members see a spend limit instead. No separate per-product spend cap.
- **DOC-342** Usage views: plan and billing management, percent of weekly allowance and reset time, usage chart by agent or by source, additional-usage controls, one-shot "allowance reset" tokens (with expiry and cooldown) earnable via referrals.
- **DOC-343** Trial: credit-based with a 7-day window, metered by agent steps and tokens, never converts to paid; cancellable. Mobile in-app purchase for monthly individual plans only; store-managed subscriptions.
- **DOC-344** Team admin controls (all plans with teams): team rules injected into every member's agents (non-removable), coding-agent delegation on/off, public template sharing on/off, who may share agents (everyone/admins), shared-login permission, chat-workspace access for non-members, manage/delete any shared agent and its access, auto-add agents to sidebars, Microsoft Teams enablement, meetings on/off, page sharing scope (anyone on team / specific teammates / off), agent email on/off (default off on teams), connector policy (inherits the org's connector allow/block list), local-execution ceiling, team icon, invite flow.
- **DOC-345** Enterprise-only controls: org-wide enable switch and group access; SCIM provisioning; enforced action reviewer and team-wide ask-first/allow rules; network egress policy (allow all / block-list up to 50 hostnames best-effort / defaults + allowlist / allowlist only; domains and IP ranges with ports; per-group policies; lock; optional application to connectors); setup-script manifests run on every member machine at start and ~daily (setup + check script, 30-minute timeout, sequential, non-blocking on failure); team secrets as env vars for those scripts (≤100, ≤32 KB each, ≤96 KB total, redacted from logs); sudo on machines on/off; egress-through-desktop mode (always on / members decide / always off); bulk recreate / terminate / delete machines and delete all of a member's data (≤1,000 and ≤100 members per operation, one operation per team at a time, per-member results); retention periods for idle agents (60–365 days, 30-day warning email), idle machines (30–365 days), messages (30–365 days); action recording of sanitised metadata with 90-day retention and OpenTelemetry export; audit log with SIEM streaming; admin API and organisation API; conversation-insight analytics by type of work and automation level.
- **DOC-346** Group-level overrides (enterprise): groups can widen capabilities, carry their own network policy (most restrictive wins across groups), add group rules and group setup scripts.
- **DOC-347** Model-request inspection webhook (enterprise, beta): each model request (and optionally each batch of tool calls before execution) is POSTed, signed (Standard Webhooks HMAC), to a customer endpoint that returns allow/deny. Modes: shadow (log only), fail-open, fail-closed. Settings: timeout 1–10,000 ms (default 5,000), percentage rollout sticky per turn, up to 16 custom headers (write-only), secret rotation, connection test, circuit breaker with auto-recovery after 10 minutes, custom block message (≤500 chars). Blocked users get edit-and-resend or reset-conversation options. Covers subagents, summaries and routines; excludes system prompts, hidden reasoning and ancillary calls.
- **DOC-348** Identity: SAML SSO via existing identity provider (Okta, Entra ID, Google Workspace, OneLogin); device-aware sign-in policies apply to the client, not the hosted machine; documented patterns for letting the hosted Linux browser pass IdP policies, including a shipped setup script for an IdP desktop authenticator.
- **DOC-349** Deployment: versioned installers and a JSON release feed per platform, silent Windows install, MDM distribution guidance, package repositories for Linux; no way to disable client update checks.
- **DOC-350** Network prerequisites: client needs API domains and nested per-machine hostnames exempt from TLS inspection and response buffering (streaming).
- **DOC-351** Hosting facts: provider-hosted only (no on-prem / BYO image); machines run in the US with optional US-only residency; shared static egress IPs (no dedicated IPs); daily encrypted control-plane backups; no customer point-in-time restore; ISO 27001 and ISO 42001 certifications; deletion within 30 days per DPA.
- **DOC-352** Account deletion is self-serve and permanent (data removed within 30 days); account email cannot be changed.
- **DOC-353** Private-network reach: either route through a member's desktop or install the customer's own networking client (e.g. Tailscale exit node, Cloudflare Tunnel) via setup scripts.

## 15. Anything else

- **DOC-370** Settings structure: general (account, appearance light/dark/system, accent, language, spell-check, microphone, hardware acceleration, time zone, reviewer + rules, memory import, security key), computer (your devices, agent machine), credential store, usage and billing, updates.
- **DOC-371** Service status page with a dedicated component; app does not show status itself.
- **DOC-372** Feedback/support flow attaches conversation or agent ID; copyable request IDs per message; copyable version info.
- **DOC-373** Mobile extras: haptics toggle, appearance, shorter language list.
- **DOC-374** Troubleshooting guidance documents known failure classes: sign-in loops, machine unreachable, sites blocking datacentre IPs, connector auth lapses, expired approvals, routine not firing, attachment unreadable, update required.
- **DOC-375** Team-level "work with my team" card on mobile offering share / copy / start fresh.

---

## Capabilities list for gap analysis

- [ ] Multiple named persistent agents per user
- [ ] One conversation per agent with full history
- [ ] Designated lead/coordinator agent, replaceable
- [ ] Agent creation with name, avatar shape/colour
- [ ] Avatar: stock variants, AI-generated, uploaded (25 MB, crop)
- [ ] Agent label/title field
- [ ] Behaviour configured only via chat + memory (no settings form)
- [ ] Agents can create other agents / build a team on request
- [ ] Pin agents
- [ ] Sidebar sections (grouping), synced
- [ ] Hide/unhide agents without stopping them
- [ ] Duplicate agent (config without history/memory)
- [ ] Publish agent as shareable template link (public or team-only)
- [ ] Update / delete published template
- [ ] Import agent from template gallery or link
- [ ] Prebuilt agent marketplace
- [ ] Delete agent (cascade profile, chats, memory, routines)
- [ ] Deep links to open agent chat with prefilled text
- [ ] Text chat with paste of text, links, images
- [ ] File attachments with size/count limits
- [ ] @mention agents, groups, routines, connectors
- [ ] Invoke skill by name
- [ ] Reply to specific message
- [ ] Threads
- [ ] Reactions
- [ ] Send while agent is working; redirect / stop
- [ ] Transcript shows tool activity and computer use
- [ ] Editable outgoing draft cards (email, chat message) with send/discard
- [ ] Draft invalidation when attached file changed
- [ ] Per-agent toggle to skip drafts
- [ ] File/image/link/tool result cards with preview
- [ ] Link hover preview
- [ ] Product cards and shopping flow
- [ ] Order/checkout card with pay/cancel and expiry
- [ ] Back-in-stock notify routine
- [ ] Question and form cards
- [ ] In-chat connector connect cards
- [ ] Global search / command palette across messages, files, links, routines, pages
- [ ] Find in chat
- [ ] Keyboard shortcuts set
- [ ] Sidebar attention states and unread badges
- [ ] Dismissible error notices with request ID
- [ ] Per-agent colour accent
- [ ] Agent can report plan/usage on request
- [ ] Offline cached view
- [ ] Persistent per-user cloud Linux machine (browser, shell, files)
- [ ] Per-user hardware isolation; shared across the user's agents
- [ ] Separate screen per agent for parallel GUI work
- [ ] Live view of machine screen
- [ ] Human takeover and hand-back
- [ ] Login resolution chain (store → password manager → secure form → takeover)
- [ ] Read emailed one-time codes
- [ ] Hardware security key passthrough from desktop
- [ ] Route machine traffic through user's desktop
- [ ] Local command/file execution on user's desktop with per-device policy
- [ ] Device registry (rename, remove, per-device policy)
- [ ] Machine update / recover / reset
- [ ] Durable sync and restore of machine data
- [ ] Low-disk notice with guided cleanup
- [ ] Auto-hibernate and wake
- [ ] Built-in public social-network read tools
- [ ] Delegate coding tasks to separate cloud coding agents with result attachment
- [ ] In-run subagents / background helpers
- [ ] Connector catalogue with search, install, OAuth
- [ ] Agent-initiated connector install
- [ ] Custom connector by URL (headers, OAuth client) or command
- [ ] Server-side token custody (agent never sees tokens)
- [ ] Multiple labelled accounts per connector
- [ ] Per-tool enable/disable
- [ ] Prefer connector over browser sign-in
- [ ] Connector health alerts and reconnect
- [ ] Password-manager integration with per-login approval
- [ ] Payment wallet connectors and default payment method
- [ ] Agent-built connector from an arbitrary API
- [ ] Mail / calendar / drive / docs / sheets / slides connectors
- [ ] Team chat connector posting as the user
- [ ] Notes/project/issue/incident tool connectors
- [ ] BI / data warehouse connectors (read-only rendering, NL query)
- [ ] Skills: save process as named skill
- [ ] Shared private skill library with per-agent enablement
- [ ] Agent-specific skills
- [ ] Installable packaged skills
- [ ] Publish/sync/unpublish skill to team
- [ ] Teach-by-demonstration screen recording → draft skill (10 min)
- [ ] Per-agent memory (preferences, rules, facts, dated work log)
- [ ] Cross-agent shared profile facts
- [ ] Autonomous memory saving plus explicit remember/correct/forget
- [ ] Conversational memory inspection
- [ ] Memory persists across chats and voice calls
- [ ] Conversation reset that keeps memory
- [ ] Memory import from another assistant
- [ ] Team memory with approve/reject review queue
- [ ] Routines created/edited via chat
- [ ] Natural-language schedules with time zone setting
- [ ] Minimum 5-minute interval
- [ ] Test-run a routine now
- [ ] Trigger: chat-app mention / phrase / reaction / any message, channel-scoped
- [ ] Trigger: GitHub, Linear, Sentry, PagerDuty events
- [ ] Trigger: inbound email with sender/domain/alias filter
- [ ] Trigger: webhook with bearer secret and JSON payload
- [ ] Routine list, detail, pause/resume, delete
- [ ] Run history with status and failure reason
- [ ] Routine quotas and hourly rate limits
- [ ] Auto-pause prompt after long absence
- [ ] Proactive check-ins and task offers from lead agent
- [ ] Group chats of 2–6 agents with rename and membership edit
- [ ] Addressing rules (@agent, reply, @everyone)
- [ ] Agent-to-agent async messaging/handoff
- [ ] Shared team agent (single instance, private per-user chats)
- [ ] Share scopes: team, organisation, invited people/groups
- [ ] Roles: owner, manager, collaborator
- [ ] Draft/publish state for shared agents
- [ ] Browse/search shared agents; ask an agent to find one
- [ ] Admin auto-add agents to sidebars
- [ ] Shared-agent secrets, connectors, skills, files, stored logins
- [ ] Shared agent asks before using a member's personal connectors
- [ ] Shared connector modes (individual / manager's account / agent account)
- [ ] Per-requester execution context and billing attribution
- [ ] Shared-agent analytics
- [ ] Routine visibility on shared agents; collaborator routine permission
- [ ] Dictation into composer
- [ ] Live voice conversation with transcript, mute, voice/speed/language
- [ ] Call auto-reconnect
- [ ] Post-call transcript card and feedback
- [ ] Agent voice memos with transcript
- [ ] Microphone selection
- [ ] Desktop apps for macOS, Windows, Linux with auto-update
- [ ] Multi-account switching
- [ ] iOS and Android apps with feature parity for chat, approvals, takeover
- [ ] Mobile share-sheet target
- [ ] OS voice-assistant shortcuts, live activities, action button
- [ ] On-device phone tools (calendar, contacts, location, alarms, reminders, smart home)
- [ ] Shared agent inside Slack (DM, mentions, thread approvals, account linking)
- [ ] Shared agent inside Microsoft Teams
- [ ] Meeting attendance (Meet, Zoom, Teams): notes, in-meeting chat Q&A, summary, transcript
- [ ] Upcoming meeting management, listen-only mode
- [ ] Agent-owned email address with aliases
- [ ] Email send limits, unsubscribe, suppression
- [ ] Forced draft for unattended email
- [ ] Outbound phone calls with live transcript, takeover, recording
- [ ] Agents inside a social app's DM surface
- [ ] Public @mention handoff to lead agent
- [ ] Notification routing desktop-first with phone escalation
- [ ] Per-agent notification toggle
- [ ] Automated action reviewer before risky actions
- [ ] Approval cards: allow once / always allow / deny, with risk warnings
- [ ] Plain-language ask-first and allow rules (20 each, 1,000 chars)
- [ ] Ask-first precedence; rules synced across devices
- [ ] Approval expiry for unattended work (30 min)
- [ ] Requester-only approvals in shared contexts
- [ ] Credential store: logins, cards, contact info, hints
- [ ] Card scan/photo capture
- [ ] CSV import of logins (local parsing)
- [ ] Write-only secrets; model never sees passwords
- [ ] Auto-generated passwords on sign-up
- [ ] Secure forms filling pages directly
- [ ] Secure secret card for API keys
- [ ] Batch payments under one approval (≤500, 24h)
- [ ] One-time virtual card via wallet
- [ ] Untrusted-content tagging / prompt-injection defences
- [ ] Wide attachment type support
- [ ] File transfer between machine and cloud storage/mail
- [ ] Image generation with reference images and aspect ratios
- [ ] Video generation (1–15 s, 480p/720p, frames and references)
- [ ] Media viewer with zoom, gallery, speed control, download
- [ ] Hosted pages (reports, dashboards, trackers) with interactive controls
- [ ] Page side-chat for agent edits; in-place updates
- [ ] Page sharing: private, invited, team, org, public link
- [ ] Shared-pages management dashboard
- [ ] Per-agent library with type filters and pins
- [ ] Shared workspace directory for inter-agent files
- [ ] Weekly usage allowance with reset
- [ ] Prepaid credits / on-demand overflow with monthly cap
- [ ] Usage charts by agent and source
- [ ] Allowance reset tokens and referrals
- [ ] Credit-based trial
- [ ] Team rules injected into all agents
- [ ] Admin toggles: delegation, template sharing, agent sharing, shared logins, meetings, email, page sharing
- [ ] Connector allow/block policy
- [ ] Local-execution ceiling for team
- [ ] Enforced reviewer and team-wide rules
- [ ] Network egress policy (allowlist / blocklist, per group, lockable)
- [ ] Setup scripts on every member machine with check scripts
- [ ] Team secrets for setup scripts
- [ ] Sudo on/off for machines
- [ ] Bulk recreate/terminate/delete machines; delete member data
- [ ] Retention policies for agents, machines, messages
- [ ] Action recording and OpenTelemetry export
- [ ] Audit log with SIEM streaming
- [ ] Admin API / organisation API
- [ ] Conversation-insight analytics
- [ ] Group-level setting overrides
- [ ] Model-request inspection webhook (shadow / fail-open / fail-closed, tool-call validation)
- [ ] SSO (SAML) and SCIM
- [ ] Versioned installers, release feed, MDM deployment
- [ ] US data residency option
- [ ] Self-serve account deletion
- [ ] Private-network access via customer networking client
- [ ] Settings: appearance, language (38), spell-check, time zone
- [ ] Status page, feedback with IDs, version info
