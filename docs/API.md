# Sklubot HTTP API

All paths are under `/api`. JSON in, JSON out. Errors: `{ "error": "message" }` with an HTTP status.
Authentication is an HTTP-only session cookie; every route except the auth routes, `/health` and `/hooks/*`
answers 401 without it. Types named below are defined in `server/src/shared.ts`.

## Account
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/me` | – | `{ user: User \| null, signupOpen: boolean, imageGeneration: boolean }` |
| PUT | `/prefs` | `{ locale?: "fr" \| "en", name?: string }` | `{ user }` — language used for server-written texts and bot replies |
| POST | `/auth/signup` | `{ email, name?, password, locale? }` | `{ user }` (403 when signup is closed) |
| POST | `/auth/login` | `{ email, password }` | `{ user }` (401 on bad credentials) |
| POST | `/auth/logout` | – | `{ ok: true }` |
| GET | `/events` | – | SSE stream of `ServerEvent` |
| GET | `/health` | – | `{ ok, model }` |
| GET | `/models` | – | `{ models: ModelOption[], defaultRef }` |

## Bots
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/bots` | – | `{ bots: Bot[], live: Record<botId, Live> }` |
| POST | `/bots` | `{ name, label?, description?, instructions?, shape?, color?, mode?, primary? }` | `{ bot }` |
| PATCH | `/bots/:id` | any of `name,label,description,instructions,shape,color,mode,effort,model,autonomy,voice` | `{ bot }` |
| DELETE | `/bots/:id` | – | `{ ok }` (409 for the primary bot) |
| POST | `/bots/:id/primary` | – | `{ ok }` |
| POST | `/bots/:id/read` | – | `{ ok }` |

## Conversation
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/bots/:id/rows?limit=&before=` | – | `{ generation, rows: Row[] }` (newest 200 by default, ascending) |
| POST | `/bots/:id/uploads` | multipart form, field `file` (max 25 MB) | `{ attachment: Attachment }` — stores the file in the bot's library under `uploads/` |
| POST | `/bots/:id/messages` | `{ text, origin?: "voice", attachments?: string[] }` | `{ row }` — `attachments` are `path` values returned by uploads; `text` may be empty when there is at least one |
| POST | `/bots/:id/stop` | – | `{ ok }` |
| POST | `/bots/:id/reset` | – | `{ generation }` |
| POST | `/approvals/:approvalId` | `{ decision: "allow" \| "always" \| "deny" }` | `{ ok }` |
| POST | `/bots/:id/cards/:seq/answer` | `{ answer }` | `{ ok }` |
| POST | `/bots/:id/cards/:seq/dismiss` | – | `{ ok }` |

## Bot knowledge and automation
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/bots/:id/bundle` | – | `BotBundle` |
| POST | `/bots/:id/skills` | `{ name, description?, body }` | `{ skill }` |
| PATCH | `/skills/:id` | partial skill | `{ skill }` |
| DELETE | `/skills/:id` | – | `{ ok }` |
| DELETE | `/memories/:id` | – | `{ ok }` |
| POST | `/bots/:id/consolidate` | – | `{ added: string[], considered: number }` |
| POST | `/bots/:id/compact` | – | `{ before, after, changed }` |
| GET | `/bots/:id/routines` | – | `{ routines: Routine[] }` |
| PATCH | `/routines/:id` | `{ enabled }` | `{ routine }` |
| POST | `/routines/:id/run` | – | `{ ok }` |
| DELETE | `/routines/:id` | – | `{ ok }` |
| GET | `/tasks` | – | `{ tasks: Task[] }` (all bots) |
| GET | `/bots/:id/tasks` | – | `{ tasks: Task[] }` |
| POST | `/hooks/:token` | any JSON | `{ ok }` — fires a webhook routine (no session needed) |

## Computer and files
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/computer` | – | `ComputerState` |
| GET | `/bots/:id/screen` | – | `image/jpeg`, or 204 when the bot's computer is off (never wakes it) |
| POST | `/bots/:id/screen/input` | `{ type: "click", x, y }` \| `{ type: "type", text }` \| `{ type: "key", key }` \| `{ type: "scroll", x, y, dy }` \| `{ type: "goto", url }` | `{ ok }` — take-control input; x/y are in screenshot pixels |
| POST | `/bots/:id/desktop/wake` | – | `{ ok }` — switch the bot's Linux computer on |
| POST | `/bots/:id/desktop/sleep` | – | `{ ok }` — put it to sleep (state is kept) |
| POST | `/bots/:id/desktop/reset` | – | `{ ok }` — Linux: erase the computer; browser: close it |
| GET | `/bots/:id/files?path=` | – | `{ entries: FileEntry[] }` |
| GET | `/bots/:id/files/download?path=` | – | file bytes (as a download) |
| GET | `/bots/:id/files/view?path=` | – | file bytes with their real content type, for showing images inline |

## Connectors (apps) and permissions
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/connectors` | – | `{ connectors: Connector[], oauthRedirectUri }` |
| POST | `/connectors` | `{ name, url, token?, botId?, seq? }` or `{ name, url, auth: "oauth", clientId?, clientSecret? }` | `{ connector }` (botId+seq resolve a connect card). An OAuth app starts with `status: "needs_auth"`; an app added by URL that answers 401 and publishes OAuth metadata is switched to `auth: "oauth"` |
| POST | `/connectors/:id/refresh` | – | `{ connector }` |
| DELETE | `/connectors/:id` | – | `{ ok }` |
| GET | `/connectors/catalog` | – | `{ apps: CatalogApp[], oauthRedirectUri }` — one-step apps; add one with `POST /connectors {name, url, token}` (or `auth: "oauth"`) |
| POST | `/connectors/:id/oauth/start` | `{ clientId?, clientSecret?, botId?, seq? }` | `{ authorizeUrl }` to open in a popup; `{ connector }` when the stored sign-in could just be renewed; `{ needsClientId: true, redirectUri }` when the app has no dynamic client registration (call again with `clientId`) |
| GET | `/connectors/oauth/callback?code&state[&iss][&error]` | – | HTML page (no session required: the single-use `state` identifies the sign-in). Exchanges the code with the PKCE verifier, stores the tokens sealed, tells the app (BroadcastChannel `sklubot-oauth`) and closes itself |
| POST | `/connectors/:id/oauth/disconnect` | – | `{ connector }` — forgets the tokens (a client ID the user pasted is kept) |
| GET | `/vault` | – | `{ items: VaultItem[] }` |
| POST | `/vault` | `{ name, site?, username?, password?, note? }` | `{ item }` |
| PATCH | `/vault/:id` | partial (omit `password` to keep it) | `{ item }` |
| DELETE | `/vault/:id` | – | `{ ok }` |
| GET | `/policies` | – | `{ policies: Policy[] }` |
| DELETE | `/policies/:tool` | – | `{ ok }` |

**OAuth sign-in for connectors** follows the MCP authorization spec through the SDK's `auth()`: protected-resource
metadata (RFC 9728) and authorization-server metadata discovery, PKCE (S256), dynamic client registration (RFC 7591)
when offered, resource indicators (RFC 8707). The redirect URI is `${PUBLIC_URL}/api/connectors/oauth/callback`, so
`PUBLIC_URL` must be the address the browser really uses. A pending sign-in (`oauth_pending`: hash of `state` → user,
connector, sealed code verifier) lives 10 minutes and is used once. Access and refresh tokens, client registration and
discovery state are sealed (AES-256-GCM, key from `SESSION_SECRET`) in `connectors.oauth_enc` and never returned by
any route. Tokens are refreshed before they expire and on a 401; when the refresh fails the connector shows
`status: "needs_auth"` and a "Sign in" button. Every step is written to the activity log.

## Rooms, check-ins, usage
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/rooms` | `{ name, botIds }` | `{ id }` |
| GET | `/rooms/:id/members` | – | `{ members: Bot[] }` |
| PUT | `/rooms/:id/members` | `{ botIds }` | `{ ok }` |
| GET | `/checkins` | – | `CheckinSettings` |
| PUT | `/checkins` | partial `CheckinSettings` | `CheckinSettings` |
| POST | `/checkins/now` | – | `{ ok }` |
| GET | `/usage` | – | `UsageSummary` |
| PUT | `/usage/budget` | `{ budgetUsd: number \| null }` | `UsageSummary` |

## Notes for clients

- Message rows may carry `attachments`. Images (`mime` starting with `image/`) are shown inline from `/files/view`; other files as a chip linking to `/files/download`.
- Approval cards for saved logins have `tool` = `vault: <item name>` and `source` = `Vault`.
- `User.locale` decides the language of texts the server writes (notices, event lines, approval titles). The web app should use the same locale for its own texts.

## Additions (second wave)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/bots/:id/calls` | – | `{ callId }` — a voice call starts; writes a "call started" event row |
| POST | `/bots/:id/calls/:callId/end` | `{ transcript: {role:"user"\|"assistant", text}[] }` | `{ ok }` — writes a "call ended" event row with `call` (duration, transcript); a one-line summary is added to it shortly after |
| GET | `/search?q=` | – | `{ hits: SearchHit[] }` — message search across all the user's bots, including earlier conversations (max 40, newest first; `q` needs 2+ characters) |
| GET | `/bots/:id/history/:generation` | – | `{ rows: Row[] }` — read-only rows of an earlier conversation of that bot |
| POST | `/bots/:id/memories` | `{ text }` | `{ memory }` — add (or restore) a memory |
| GET | `/routines/:id/runs` | – | `{ runs: RoutineRun[] }` — newest first, max 30 |
| GET | `/audit?before=&limit=` | – | `{ entries: AuditEntry[] }` — newest first; `before` is an entry id |
| GET | `/bots/:id/telegram` | – | `TelegramStatus` |
| PUT | `/bots/:id/telegram` | `{ token }` | `TelegramStatus` — 400 if Telegram rejects the token |
| DELETE | `/bots/:id/telegram` | – | `{ ok }` |
| GET | `/pages` | – | `{ pages: SharedPage[] }` |
| DELETE | `/pages/:token` | – | `{ ok }` — the public address stops working |
| PUT | `/account/password` | `{ current, next }` | `{ ok }` (401 if `current` is wrong; `next` needs 8+ characters) |
| DELETE | `/account` | `{ password }` | `{ ok }` — deletes the account and everything in it |
| GET | `/export/data` | – | JSON file download: everything the account holds (no passwords or tokens) |
| GET | `/export/team` | – | JSON file download: bots with their settings, skills and routines (no chats, memories or secrets) |
| POST | `/import/team` | the JSON from `/export/team` | `{ created: number }` |
| GET | `/usage.csv` | – | CSV download of this month's usage, one line per model call |

Notes:
- `PATCH /bots/:id` also accepts `roomRule` (rooms) and `disabledTools` (array of `ToolGroup`).
- Telegram linking: after `PUT`, the user opens `https://t.me/<username>` and sends `/start <linkCode>`; `linked` then becomes true (a `bot` event is emitted). Only that one Telegram chat can talk to the bot.
- Event rows with `event: "call"` carry `call` (`CallRecord`): show duration, summary, and the transcript on demand.
- Published pages appear in chat as ordinary assistant messages containing the link.
- Routines with `trigger: "watch"` have `watch` set; show what is watched and how often.

## Additions (third wave: screens)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/bots/:id/desktop/tidy` | – | `{ ok }` — closes every window on the bot's screen, keeps logins and files, reopens the browser on the home page |
| POST | `/bots/:id/desktop/handback` | – | `{ ok }` — call when the user stops controlling the screen; the bot's next turn is told to look before relying on what it saw earlier |
| GET | `/auth/link?token=` | – | one-time sign-in link printed by the server's command line; signs in and redirects to `/` (expired or used: redirects to `/?link=expired`) |

Notes:
- `Live.caption` (optional): a short line taken from the bot's reasoning while it works; show it under the activity line, muted.
- `POST /bots/:id/desktop/reset` still erases the whole Linux computer; "tidy" is the gentle fix.

## Additions (fourth wave: subscriptions)

A bot can run on the user's own subscription instead of an API key. `GET /models` lists, next to API
models (`kind: "api"`), subscription entries (`kind: "subscription"`, `engine: "claude-code" | "codex"`),
e.g. `claude-code:sonnet`, `claude-code:opus`, `codex:gpt-5`. Choosing one sets `bot.model` to that ref.
These need the bot's Linux computer: the tool runs there, signed in on that computer.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/bots/:id/engine` | – | `{ engines: EngineStatus[] }` — wakes the bot's computer to check |
| POST | `/bots/:id/engine/login` | `{ engine }` | `{ ok }` — opens a terminal on the bot's screen running the provider's sign-in; the page to sign in opens in the bot's browser. The UI then opens the viewer in control mode so the user can finish signing in and hand back |
| POST | `/bots/:id/engine/logout` | `{ engine }` | `{ ok }` |

Notes:
- `UsageSummary.subscriptions`: last known share used of the 5-hour and 7-day windows (Claude reports them; Codex does not, so its values are null). Turns on a subscription cost 0 in the usage table; their tokens are still counted.
- Approvals still apply: when a subscription bot calls a tool that needs the user's OK, the approval card appears as usual and the bot waits (up to 25 minutes).

## Additions (fifth wave: animated characters)

- `Bot.character` (`Character`, see shared.ts): eye style, mouth, cheeks, accessory, idle motion, intensity (0–1), follow-cursor, blink. Always complete (defaults filled in).
- `POST /bots` and `PATCH /bots/:id` accept `character` (partial objects are merged; unknown values are ignored).
- Team export/import carries `character`.
- `Character.type`: "mascot" | "dots" | "muse". `Character.customColor`: "#rrggbb" or null; when set it replaces the named colour for the character (and tints the bot's computer).

## Pépites (euphorie)

- Outil du bot `celebrate { kind, score, evidence, value?, reason }` : le bot l'appelle lui-même quand son analyse de données révèle une opportunité rare. Le serveur ne déclenche l'euphorie que si `evidence` contient des chiffres, si `score` ≥ `character.gemThreshold` (60–98, 85 par défaut), si `character.euphoria` est actif, et au plus `GEMS_PER_DAY` (2) fois par bot sur 24 h. Sinon la trouvaille est seulement notée.
- Événement SSE `{ type: "cheer", botId, reason, gem }` et ligne `{ kind: "event", event: "cheer", text, gem: { kind, score, why, value } }`.
- Quand le bot est relié à Telegram, la pépite y est aussi annoncée (« 💎 … a trouvé une pépite … », type, note, valeur, preuves). Dans le navigateur, une notification système apparaît si l’onglet est caché ou si un autre bot est ouvert.
- `GET /api/gems` : les 100 dernières pépites de l'utilisateur (`botId`, `botName`, `at`, `reason`, `gem`).
- `POST /api/bots/:id/gem-hunt { timezone?, time? "HH:MM" }` : crée la routine quotidienne « Chasse aux pépites » (une seule par bot ; `created: false` si elle existe déjà). Sans pépite, le bot termine en silence (`stay_quiet`).

## Built-in apps (Gmail, Google Calendar, Google Drive, Outlook, Slack)

Reached through the vendors' own REST APIs with an OAuth client the user creates in their own console (Google Cloud,
Microsoft Entra, Slack app settings). Several accounts per app, each with a label ("Gmail — perso", "Gmail — pro").

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/native` | – | `{ apps: NativeApp[], vendors: NativeVendorSetup[], accounts: NativeAccount[] }` — `vendors[]` carries the step-by-step client set-up, the exact `redirectUri`, the official docs, `configured`, `clientId` (never the secret), `tenant` (Microsoft), `hasAppToken` (Slack) |
| PUT | `/native/clients/:vendor` | `{ clientId, clientSecret?, tenant?, appToken? }` | `{ vendor }` — `vendor` is `google`, `microsoft` or `slack`. Secret and Slack app-level token (`xapp-…`, optional, for Socket Mode) are sealed; an empty secret keeps the saved one; `appToken: null` removes it |
| DELETE | `/native/clients/:vendor` | – | `{ ok }` |
| POST | `/native/accounts` | `{ app, label }` | `{ account, authorizeUrl }` — `app`: `gmail`, `gcalendar`, `gdrive`, `outlook`, `slack`. Labels are unique per app. Open `authorizeUrl` in a popup |
| POST | `/native/accounts/:id/signin` | – | `{ authorizeUrl }` — sign in again (label, routines and permissions are kept) |
| PATCH | `/native/accounts/:id` | `{ label }` | `{ account }` |
| DELETE | `/native/accounts/:id` | – | `{ ok }` — revokes the token at Google (`/revoke`) or Slack (`auth.revoke`), forgets it locally, pauses the routines bound to it |
| GET | `/native/:vendor/callback?code&state[&error]` | – | HTML page (no session required: the single-use `state` identifies the sign-in). Redirect URI to register: `${PUBLIC_URL}/api/native/google/callback`, `…/microsoft/callback`, `…/slack/callback` |
| POST | `/bots/:id/routines` | `{ kind: "email" \| "slack" \| "calendar", accountId, name, prompt, query?, channel?, mentionsOnly?, leadMin?, everyMin? }` | `{ routine }` — a routine fed by an account: a new email matching `query`; a new Slack message in `channel` (`#name`, an id, or `@dm`), optionally only mentions of the app; an event starting in `leadMin` minutes. `everyMin` ≥ 2 |

**Sign-in.** Google and Microsoft: authorization code with PKCE (S256) and the client secret (web clients);
Google asks `access_type=offline` and `prompt=consent select_account`, Microsoft uses `{tenant}` (default `common`)
and `offline_access`. Slack: OAuth v2 with bot scopes and the client secret through HTTP Basic, without PKCE (turning
PKCE on in a Slack app makes it a public client for good). A pending sign-in (`native_pending`) lives 10 minutes and
is used once. Tokens are sealed in `native_accounts.tokens_enc`, refreshed a minute before they expire and once on a 401;
a refused refresh puts the account in `status: "needs_auth"` with a "Sign in again" button.

**Tools.** Each signed-in account gets its own tools, `<app>_<label>__<action>` (e.g. `gmail_pro__mail_send`):
`mail_search`, `mail_read`, `mail_thread`, `mail_draft`, `mail_send`, `mail_label` (Gmail, Outlook);
`calendar_events`, `calendar_freebusy`, `calendar_create`, `calendar_update`, `calendar_delete` (Google Calendar,
Outlook); `drive_search`, `drive_read`, `drive_upload` (Drive); `slack_channels`, `slack_history`, `slack_post`,
`slack_react` (Slack). Reads run freely and their results are outside content (the turn becomes tainted); drafts and
reactions ask only a careful bot; send, label/archive, create/update/delete, upload and post ask like a connector
write (a trusted bot may go ahead) and always ask once the turn is tainted. Permission keys are per account:
`"Gmail — pro: mail_send"`.

**Triggers.** `Routine.trigger` can be `email`, `slack` or `calendar`, with `Routine.native` (account, query, channel,
mentionsOnly, leadMin, everyMin, lastCheckedAt, accountStatus). Each check asks only for what came after the previous
one (Gmail `after:<epoch>`, Outlook mail delta link, Slack `conversations.history?oldest=`), so items that arrived
while the server was off are caught up; every item is claimed in `native_seen` before it fires, so it never fires
twice. With a Slack app-level token, Socket Mode delivers messages within seconds (envelopes acknowledged) and a
reconnect runs a catch-up. The fired turn starts tainted, with the item as outside content; each run is in
`/routines/:id/runs`.

Test overrides: `GOOGLE_API_URL`, `MICROSOFT_API_URL`, `SLACK_API_URL` replace the scheme and host of every URL of
that vendor (with `ALLOW_PRIVATE_FETCH=1` for local fakes).
