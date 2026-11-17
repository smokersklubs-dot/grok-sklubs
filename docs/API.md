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
| GET | `/auth/password/status` | – | `{ mail: boolean }` — whether the server can send its own e-mails (SMTP set up) |
| POST | `/auth/password/forgot` | `{ email, locale? }` | `{ ok: true }` — always the same answer whether the address has an account; the link (`/?reset=<token>`, 30 min, single use) is sent afterwards. 409 when no SMTP account is set up; 403 when throttled |
| POST | `/auth/password/reset/check` | `{ token }` | `{ valid: boolean }` — does not use the link up |
| POST | `/auth/password/reset` | `{ token, password }` | `{ user }` + session cookie — every other session of the account is deleted; 400 for a used/expired link |
| POST | `/auth/email/confirm` | `{ token }` | `{ ok, email }` — applies a change of address (link `/?email_change=<token>` sent to the new address); 409 if the address was taken meanwhile |
| GET | `/account/email` | – | `{ email, pending: { email, expiresAt } \| null, mail: boolean, hasPassword: boolean }` |
| POST | `/account/email` | `{ email, password }` | `{ applied, pending, user? }` — with SMTP: confirmation link to the new address, notice to the old one; without: applied at once. 401 wrong password, 409 no password yet (Google account) or address taken (no SMTP only) |
| DELETE | `/account/email/pending` | – | `{ pending: null }` |
| GET/PUT/DELETE | `/settings/smtp` | PUT: `{ host, port, tlsMode: "tls"\|"starttls"\|"none", username?, password?, from }` | `{ configured, source: "env"\|"saved"\|null, host, port, tlsMode, username, hasPassword, from }` — owner only (403 otherwise); 409 on PUT when `SMTP_HOST` is set in the environment |
| POST | `/settings/smtp/test` | – | `{ ok, to }` — test e-mail to the owner's own address; 502 with the SMTP server's answer |
| GET/PUT/DELETE | `/settings/backup` | PUT: `{ provider: "ovh"\|"hetzner"\|"scaleway"\|"other", endpoint, region, bucket, pathStyle, prefix, accessKey?, secretKey?, recipient: "age1…", hour: 0–23, timezone, keepDaily: 1–60, keepWeekly: 0–52, enabled? }` | `{ configured, enabled, provider, endpoint, region, bucket, pathStyle, prefix, recipient, accessKeyHint, hasSecret, hour, timezone, keepDaily, keepWeekly, failures, nextRun, running, last, lastOk, history }` — the automatic off-server backup (autobackup.ts), owner only (403 otherwise). The keys are sealed and never returned (empty keeps the saved ones); `recipient` is the owner's age public key; DELETE keeps the backups in the bucket |
| POST | `/settings/backup/test` | same body as PUT (saved keys fill the empty ones), nothing saved | `{ ok, steps: ["write","read","list","delete"] }`; 502 with the step and the storage's reason |
| POST | `/settings/backup/run` | – | 202 `{ started, id, view }` — "Sauvegarder maintenant" (background); 409 while one runs or before set-up |
| GET | `/settings/backup/remote` | – | `{ backups: [{ name, size, at }] }` — the archives in the bucket, newest first |
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

## Wave 3 — comfort (push, takeover, vault, organising, palette)

### Push notifications (Web Push)
Implemented from RFC 8030 (delivery), RFC 8291 + RFC 8188 (`aes128gcm` encryption) and RFC 8292 (VAPID, ES256) in
`server/src/push.ts`, without a third-party library; delivery goes through `guardedFetch`. The VAPID key pair is made
once (table `server_keys`, private half sealed). `VAPID_SUBJECT` (`mailto:` or `https:`) sets the contact sent to push
services; default: `PUBLIC_URL` when it is https.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/push?endpoint=` | – | `PushState & { currentId }` — `publicKey` to subscribe with; `currentId`: the device holding that endpoint |
| POST | `/push/subscribe` | `{ subscription: PushSubscriptionJSON, label }` | `{ device: PushDevice }` (400 on a non-https endpoint or bad keys) |
| POST | `/push/unsubscribe` | `{ endpoint }` | `{ ok }` |
| PATCH | `/push/devices/:id` | `{ enabled?, label? }` | `{ device }` — per-device on/off |
| DELETE | `/push/devices/:id` | – | `{ ok }` |
| PUT | `/push/settings` | `{ kinds?: Partial<Record<PushKind, boolean>>, quiet?: { enabled?, start?, end?, timezone? } }` | `{ settings: PushSettings }` |
| POST | `/push/test` | – | `{ sent }` — ignores kinds and quiet hours |
| POST | `/presence` | `{ clientId, visible }` | `{ ok }` — open windows report visibility; a finished reply is pushed only when none is visible |

Pushed: `needs` (approval, question, `ask_takeover`, `secret_request`), `gem` (celebrate), `reply` (a reply to the user
while no window is visible), `routine` (a routine's result). Payload (encrypted): `{ kind, title, body, botId, tag, url }`;
`sw.js` shows it and opens `/?bot=<id>` (or focuses an open window and posts `{ type: "sklubot-open-bot", botId }`).
A subscription answered 404/410 by its push service is deleted.

### The bot asks for help and waits
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/bots/:id/takeover/:takeoverId/done` | – | `{ ok }` — "I'm done, hand it back": the waiting `ask_takeover` call returns; after a restart a new turn is started instead |
| POST | `/bots/:id/desktop/control` | `{ on: boolean }` | `{ ok }` — the viewer is in control mode (renew every 30 s; lease 75 s) |
| POST | `/bots/:id/desktop/handback` | – | `{ ok }` — also ends the control lease |

Card `{ type: "takeover", takeoverId, reason: TakeoverReason, detail, status, expiresAt }`. The tool waits up to 30 min
(`TAKEOVER_TIMEOUT_MS` overrides it). While the user drives the screen — a live screen open in control mode (counted in
`vnc.ts`) or a control lease — the bot's screen actions (`browser_open`, `screen_click/type/key/scroll/drag`,
`vault_type`) are refused server-side; `Live.driving` tells the UI.

### Vault
`VaultItem` now has `kind: "login" | "secret" | "totp"`, plus `hosts`, `header`, `prefix` (secret) and `digits`, `period` (totp).

| Method | Path | Body | Returns |
|---|---|---|---|
| POST/PATCH | `/vault`, `/vault/:id` | `{ kind, name, site?, username?, password?, note?, hosts?, header?, prefix? }` — `password` is the value (password, key, base32 seed or `otpauth://` URI) | `{ item }` — values are never returned |
| POST | `/vault/import` | `{ csv, mapping?: { name, url, username, password, note, totp } }` (column indexes) | `VaultImportResult` — `{ needsMapping: true, headers }` when columns are unknown (header names only) |
| POST | `/bots/:id/cards/:seq/secret` | `{ value, host?, header?, prefix? }` | `{ ok }` — the secure card of `secret_request`; the value is sealed, never written to the chat, history or log |

Tools: `secret_request` (card, ends the turn), `secret_use` (HTTP request with the secret injected into its header, only
to its bound hosts, https only, redirects not followed; asks before the first use of each secret and every time after
outside content), `totp_code` (current code, only while the bound site is open; asks every time after outside content),
`password_generate` (saves a new login, returns only its name). Every vault value is redacted (exact match) from tool
results and from chat rows. Secrets are not offered to shell commands: an environment variable can be copied anywhere,
so it cannot be bound to a host.

### Organising bots
`Bot` has `pinned`, `sectionId`, `listHidden`. `PATCH /bots/:id` accepts them (`sectionId` must be one of the user's).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/sections` | – | `{ sections: BotSection[] }` |
| POST | `/sections` | `{ name }` | `{ section }` |
| PATCH | `/sections/:id` | `{ name?, position? }` | `{ section }` |
| DELETE | `/sections/:id` | – | `{ ok }` — its bots go back to the default list |
| POST | `/bots/:id/unread` | – | `{ bot }` — mark as unread |
| POST | `/bots/:id/duplicate` | `{ name?, memories?: boolean, conversation?: boolean }` | `{ bot }` — copies settings, look, instructions, tools, skills; memories and the current conversation only when asked |

Server events: `{ type: "sections" }`, `{ type: "vault" }`.

## Sklubot Relais — the user's own computers

Server side of protocol v1 ([`RELAIS-PROTOCOLE.md`](RELAIS-PROTOCOLE.md)), in `server/src/relay.ts`; the bots' tools in
`server/src/agent/mycomputer.ts`. Table `relay_devices` (owner, name/OS/version from the relay's `hello`, last seen,
SHA-256 of the current token and of the token being rotated). Pending pairings live in memory: each is bound to its open
connection and lapses with it.

### WebSocket endpoints (same server, one upgrade listener in `vnc.ts`)
| Path | Who | Notes |
|---|---|---|
| `GET /api/relay/connect` | the relay app | Refused (403) when an `Origin` header is present: browsers always send one, the relay never does. `maxPayload` 5 MiB (over it: 1009), pings every 30 s (dead peers cut), `hello` within 10 s, >200 messages/s → 4008, binary/bad JSON/missing `type`/anything before `hello` → 4400, `v` ≠ 1 → 4009, unknown or wrong token → 4001, revoked → `revoke` then 4003, a newer connection of the same device closes the older with 4010, at most 10 connections not yet authenticated per address (and 5 pairings) → 1013. Unknown types and stray answers are ignored. Works through Caddy/Coolify (`wss://`); set `TRUST_PROXY=1` there so limits apply per client. |
| `GET /api/relay/devices/:id/view` | the web app (session cookie, same origin) | Live view: `{type:"status", view:"idle"|"starting"|"live"|"stopped"|"offline"}` and `{type:"frame", seq, width, height, data(base64 JPEG), still?}`; the browser answers `{type:"ack", seq}`. The server sends `view.start` (as the session's bot, 3 fps, ≤ 1280 px) when the first viewer joins during a control session, acknowledges each frame to the relay once every viewer has shown it (5 s at most), and sends `view.stop` when the last viewer leaves. |

Pairing: `hello` with `auth: null` → `pair.code` (8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, CSPRNG, shown
`XXXX-XXXX`, 10 min, single use; a new code on the same connection when it expires, 3 at most, then 4004). Once typed in
the web app: the device is created with the token's hash, `paired { deviceId, token, serverName }` is sent, then
`welcome` on `token.ack`. A known device gets `welcome` then `token.rotate` on every connection (and every 24 h on a
long one); the old token stays valid until `token.ack`, and a relay that saved the new token but lost its ack is let in
with it.

### HTTP
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/relay/devices` | – | `{ devices: RelayDevice[], downloads: RelayDownloads }` — `downloads.files`: `Sklubot-Relais-*` files under `web/dist/download/` (served at `/download/…`), `releasesUrl`: the project's GitHub releases page |
| POST | `/relay/pairings` | `{ code }` (case, spaces and dash ignored) | `{ device }` — 400 when no pending code matches (compared in constant time), 429 after 5 tries per account (20 per address) in 10 min; audited, pushed |
| DELETE | `/relay/devices/:id` | – | `{ ok }` — sends `revoke`, closes 4003, deletes the device (its token stops working) |
| POST | `/relay/devices/:id/stop` | – | `{ ok }` — "Stop": cancels running commands, sends `session.end` as the session's bot, and keeps that bot from taking control of that computer on its own for 10 min (until the user writes to it) |
| GET | `/relay/devices/:id/last` | – | the last picture seen (a bot's screenshot or the live view), `image/jpeg`, or 204 |

`RelayDevice`: `{ id, name, platform, arch, osRelease, appVersion, kind: "computer"|"phone", status: "online"|"offline"|"paused", locked, session: { botId, botName, grant, since } | null, asking: { botId, botName, kind, since } | null, screen, capabilities, createdAt, lastSeenAt }`.
Server event `{ type: "relay", devices }` on every change. Chat rows `{ kind: "event", event: "relay", text, tone }` for
session started/ended (with the reason, or "you stopped it from Sklubot"), Stop pressed on the computer (`relay.locked`),
and refusals on the computer. Push kind `computer` (linked, control asked/taken/ended, Stop, a command ran) and audit
kind `computer` (pairing, wrong codes, sessions, every command with its text, removal).

### Bot tools (group `mycomputer`, offered only once the user has linked a computer; can be switched off per bot)
`my_computers`, `my_screen` (screenshot as an image to the model), `my_click`, `my_drag`, `my_scroll`, `my_type`,
`my_key`, `my_open` (URL or app), `my_windows`, `my_window_focus`, `my_command` (`shell.run`), `my_release`
(`session.end`). Optional `device` (name) when several computers are connected. Coordinates are in the pixels of the
last screenshot and are scaled to screen points (§6). Actions return a fresh screenshot.
- Approval cards, on top of the relay's own questions: taking control (`mycomputer: control: <bot>`) when the bot has no
  session on that computer; every command (`mycomputer: command: <bot>`); both ask every time after outside content
  (strict), and a command after outside content gets a card without "Always" (`Card.once`; choosing it anyway counts as
  once). Opening a URL after outside content asks every time (`mycomputer: url: <bot>`).
- Results from the computer (screenshots, window titles, command output) are outside content: the turn becomes careful.
- No automatic retry on `consent_*`, `command_refused`, `locked`, `rate_limited`, `busy`, `permission_missing`: the bot
  is told not to insist (with `retryAfterMs` when given) and the user sees a line in the chat. `locked` and `busy` are
  answered by the server without bothering the computer. `no_session` from the relay: `session.start` (with the bot's
  reason) then the request once more, only when "Always" covers control and the turn is not tainted; otherwise the bot is
  sent back through the approval card.

### Phones (relay protocol 1.2 — `docs/RELAIS-PROTOCOLE.md` §13)
The Sklubot Android app is a relay client too: its `hello` says `device.kind: "phone"` and `platform: "android"`. The
kind is stored at pairing (`relay_devices.kind`, default `computer`) and never changed by a later `hello`. The same tools
are mapped to the phone's operations:

| Tool | Phone operation |
|---|---|
| `my_screen` | `screen.capture` (≤ 720 px wide) |
| `my_click` (`long_press`, `double`; `button: "right"` = long press) | `touch.tap { x, y, long, double }` |
| `my_scroll` | `touch.swipe` the other way (`down` → finger moves up; `amount` 1–10, 3 ≈ half a screen) |
| `my_drag` | `touch.swipe { …, hold: true }` |
| `my_type` | `keyboard.type` |
| `my_key` (`back`, `home`, `recents`, `notifications`, `quick_settings`, `enter`; `escape` = back) | `global.action { action }` — anything else is refused without a request |
| `my_open` (`app` = shown name or package; `url`) | `app.open` / `url.open` |
| `my_windows` | `screen.read` → the app in front and its on-screen text and controls, positions converted to the last screenshot's pixels |
| `my_command`, `my_files`, `my_file_*`, `my_window_focus` | not offered when every linked device is a phone; refused (nothing sent, no card) for a phone otherwise |

New refusals from the phone: `blocked_app` (an app the user blocked is on screen, or a tap/typing in Sklubot itself) and
`screen_locked`; `permission_missing` means the accessibility service is off. All are told to the bot (never retried)
and to the user in the chat. A phone has no live view: viewers of `/api/relay/devices/:id/view` get `view: "idle"` and
each screenshot a bot takes as a `still` frame.

## Wave 4 — reliability and team

### Turns that hold up (`server/src/agent/reliability.ts`, `modelLoop` in `server/src/agent/loop.ts`)
- **Model chain.** A turn uses the bot's model, then its backups in order: `Bot.fallbackModels` when set, else the account's list (`/reliability`), else the server's `FALLBACK_MODELS` (comma-separated; the older single `FALLBACK_MODEL` is still read). Subscription engines and models whose provider is not set up are left out. Each switch writes a `notice` line and an activity-log entry; the rest of the turn (and a resumed approval) stays on the new model.
- **New tries.** Passing errors (`ProviderError.transient`: 408/409/429/5xx, 529 overloaded, network failures) are tried again up to `maxRetries` times with exponential backoff and equal jitter (`RETRY_BASE_MS`, default 1000, doubling, capped at `RETRY_MAX_WAIT_MS`, default 60000). A `Retry-After` (seconds or HTTP date, RFC 9110 §10.2.3) or `retry-after-ms` header is honoured as given; one longer than the cap moves on to the next model at once. The Anthropic SDK's own silent retries are switched off (`maxRetries: 0`) so they do not pile up.
- **Mid-stream failure.** What the failed call had started to write is taken back (the row becomes a light "interrupted, trying again" notice) before the next try.
- **Cut by the output limit.** Continued automatically up to `maxContinuations` times; the pieces are written into the same chat message.
- **Empty reply.** Nudged once (only when the turn has neither spoken nor run a tool), then a notice.
- **Step limit (`MAX_STEPS`).** The notice carries `action: { kind: "continue" }`; a routine's turn carries on once by itself (`resumeOf: "steps"`).
- **Anti-loop.** On top of the identical-call limit: the same tool failing `LOOP_FAIL_STREAK` times in a row (default 4), or returning exactly the same result `LOOP_SAME_RESULT` times in a row (default 4), stops the turn with an explanatory notice. Subscription turns get a "stop now" tool error instead.
- **Stuck work.** Every minute the scheduler (`remindStuck`, `server/src/agent/stuck.ts`) sends one reminder (chat line + push of kind `needs`) for an approval left pending, a turn running, or a bot waiting on the user for more than `STUCK_REMINDER_HOURS` (default 4). Reminders already sent are kept in `stuck_reminders`.
- **Approvals inside subscription turns** lapse after `APPROVAL_EXPIRE_MIN` (default 30) and at once when the user sends a new message to that bot.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/reliability` | – | `ReliabilitySettings` (`fallbackModels`, `maxRetries` 0–6, `maxContinuations` 0–5, `envFallbacks`) |
| PUT | `/reliability` | any of `fallbackModels: string[]` (at most 5, deduplicated, invalid refs dropped), `maxRetries`, `maxContinuations` | `ReliabilitySettings` (400 out of range) |
| PATCH | `/bots/:id` | `fallbackModels: string[] \| null` (null: follow the account's list) | `{ bot }` |
| POST | `/bots/:id/rows/:seq/continue` | – | `{ ok }` — resumes after a step-limit notice, once (409 otherwise) |

Rows: `notice.action = { kind: "continue", status: "pending" \| "done" }`; `event.event = "progress"` (a `progress_update` line, not the reply).

### Team
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/bots/:id/skills` | `{ name, description?, body, shared? }` | `{ skill }` — `Skill.shared`: every bot of the user can read it |
| PATCH | `/skills/:id` | any of `name, description, body, shared` | `{ skill }` |
| GET | `/bots/:id/skills/available` | – | `{ skills: SkillRef[] }` — its own, then the ones teammates shared (own wins on a name clash) |
| POST | `/bots/:id/skills/import` | `{ url, name?, shared? }` | `{ skill, replaced }` — a public markdown file (https, 200 kB at most, `guardedFetch`); front matter `name:` / `description:` or the first heading. 400 for a web page or a bad address |
| GET | `/profile` | – | `{ profile: Profile }` |
| PUT | `/profile` | any of `name` (80), `timezone` (IANA, checked), `company` (120), `preferences` (2000) | `{ profile }` — emits `{ type: "profile" }` |
| POST | `/bots/:id/rows/:seq/undo` | – | `{ bot }` — puts back what a `self_update` changed (409 if already undone) |
| GET | `/x-search` | – | `{ provider: "x" \| "xai" \| null }` |

Messages starting with `/skill <name>` make the bot follow that skill (its own or a shared one; the longest matching name wins): the chat shows the text as typed and the model gets the skill's steps alongside it. `Bot.createdBy` is the bot that created it with `bot_create`.

### New bot tools
| Tool | What it does | Permission |
|---|---|---|
| `progress_update` | A light interim line during long work; at most one per `PROGRESS_GAP_S` (20 s) per bot | none |
| `profile_update` | Updates the shared profile (injected into every bot's prompt) | asked every time once the turn read outside content |
| `skill_import` | Imports a skill from a public markdown file | asked every time (strict: "Always" does not skip it) |
| `skill_save` | gains `shared` | as before (asked after outside content) |
| `bot_create` | Creates a bot (name, role, instructions, look, model; starts `careful`); `BOT_CREATE_PER_DAY` (3) per user; helpers cannot | always asked (strict after outside content) |
| `self_update` | Changes its own instructions, look, tool families on/off (never autonomy, model or name); one-click undo | asked when switching a family back on, and after outside content |
| `x_search` | Recent posts on X (outside content), only offered with a key | none |

### X search — which official API
- **X API v2 recent search** when `X_BEARER_TOKEN` is set (preferred: the posts themselves, last 7 days): `GET https://api.x.com/2/tweets/search/recent` with `query`, `max_results` (10–100), `sort_order`, `start_time`/`end_time`, `expansions=author_id`, `user.fields=username,name`, `post.fields=created_at,author_id,public_metrics` — https://docs.x.com/x-api/posts/search-recent-posts. Handle filters become `from:` / `-from:` operators. `X_API_BASE_URL` can point elsewhere for tests.
- **xAI `x_search` tool** when only `XAI_API_KEY` is set: `POST https://api.x.ai/v1/responses` with `tools: [{ type: "x_search", from_date?, to_date?, allowed_x_handles? | excluded_x_handles? }]` and the model `XAI_SEARCH_MODEL` (default `grok-4.7`, the model of xAI's examples); the answer and its `url_citation` annotations / `citations` are returned — https://docs.x.ai/developers/tools/x-search, https://docs.x.ai/developers/tools/citations.

## Spec 06 — bot HQ update

### Accounts
- `GET /api/me` also returns `firstBot: { name, label }`: what a new account's first bot will be called (server
  settings `FIRST_BOT_NAME` / `FIRST_BOT_LABEL`, defaults "Juno" and "Chief of staff", translated). `?locale=fr|en`
  picks the language before sign-in.
- `POST /api/auth/signup` accepts `botName` and `botLabel` (optional, 60 characters each): the first bot's name and
  role; empty → the defaults above.
- `GET /api/auth/link?token=…` (one-time sign-in link, 15 minutes, single use, deleted at the first visit): a used,
  expired or unknown link answers **410** with a plain page asking for a new link (was a redirect).
- `MAX_BOTS` (0 = no limit): agent bots across every account, rooms and hidden helpers not counted. Past it, any
  creation (`POST /bots`, duplicate, team import, `bot_create`, sign-up) answers **409** "the team is full: this
  installation holds at most N bots. Remove one to create another." Nothing is ever evicted.

### Live state (`live` events, `GET /bots`)
- `Live.steps`: tool calls announced since the running turn started (0 at the start; progress lines count, the engine's own
  tool-finding calls do not). Updated on each call, also while the bot waits for the user.

### Subscription engine (Claude Code / Codex)
- `GET /api/bots/:id/engine` → `{ engines, runtime }`; `?runtime=1` → `{ runtime }` only (cheap, for polling).
  `runtime: { engine, model, status: "ready" | "working" | "starting" | "error" | "stopped", error, since }`.
- `POST /api/bots/:id/engine/restart` → `{ runtime }` (usually `starting`): stops the running turn and every engine
  process on the bot's computer, lets the bot's pending approvals lapse, then wakes the computer and checks it in the
  background (the panel polls every 3 s). 409 for a bot that does not run on a subscription engine; 502 on failure
  (message ≤ 300 characters). The conversation (engine session) is kept.
- Tool endpoint `/mcp/:botId`: each call is matched with the oldest unclaimed, unfinished tool row of the bot's
  running turn with that tool name (FIFO; looked for every 40 ms for 600 ms; names compared without regard to case,
  the engine's `mcp__<server>__` prefix removed). The row shows "waiting for your OK" during an approval and the
  result our side knows (done + summary, denied "not allowed" / "skipped", error + message ≤ 200 characters), which
  wins over a guess from the raw output when the stream's result arrives. A call with no row still runs.
- Approvals inside an engine call lapse on: a new message from the user (not a routine, a bot's message or a system
  notice), "restart the engine", stopping or deleting the bot, 25 minutes without an answer (`APPROVAL_EXPIRE_MIN`),
  and a server restart (pending ones are marked expired at start-up; a click on such a card expires it). The tool
  timeout given to the engines is 30 minutes (Claude Code: per-server `timeout` in its MCP config; Codex:
  `mcp_servers.sklubot.tool_timeout_sec`).

### Computer
- Before each engine turn the screen is checked (computer on — re-checked with Docker at most every 120 s —, look
  applied once per server run, the bot's browser answering on its debugging port within 1.5 s, else restarted). For a
  turn of our own loop this runs in the background, only when the computer is already on.
- `GET /api/computer/desk-test` → `{ run: DeskTestRun | null }` (the latest run since the server started).
- `POST /api/computer/desk-test` → `{ run }`: starts the desk test (one at a time per server; 409 without Linux
  computers). `DeskTestRun: { id, status: "running" | "passed" | "failed" | "error", startedAt, finishedAt, checks:
  [{ id, label, ok, detail, ms }], shots: string[], error }`. Check ids: `create`, `screen`, `dress`, `browser`,
  `greeting`, `redress`, `rename`, `read`, `click`, `typing`, `files`, `reset`, `sleep`.
- `GET /api/computer/desk-test/shots/:name` → a JPEG picture of the latest run.
- Operator command: `npm run desk:test [-- --keep] [-- --shots <folder>]`, or `node server/dist/desk-cli.js` in the
  production container. Exit code 0 = all passed, 1 = a check failed, 2 = stopped on an error.

### Deleting a bot (`DELETE /api/bots/:id`)
Steps, in order, each failure logged in the activity log and never blocking the next ones or the deletion: stop its
turn (its approvals lapse); routines off the schedule and their triggers dropped (a Slack live connection with no
routine left closes); its helpers; its engine (processes stopped, saved sessions forgotten); its screen (computer and
home volume deleted); its library (only for ids that are safe folder names); the record.

## Wave 5 — authorisation from the user's words, single-use actions, rules and "Auto", background tasks, nudges, memory, private codes

Spec: `docs/cleanroom/07-n8n-nod.md` (A1, A2, A3, A4, A6, A8, A11). Contract: `server/src/shared.ts`.

### Authorisation grounded in the user's words (`server/src/agent/grounding.ts`, `authorize.ts`)
- Every tool that changes something (app writes, connector writes, built-in sensitive/gated tools, `routine_*`, `page_publish`, `self_update`, `bot_create`, the user's-computer actions…) gets an extra string argument **`user_quote`**: the user's exact words that ask for the action. It is stripped before the tool runs and is never one of the tool's arguments in the transcript.
- The server checks the quote against the messages the user typed in that conversation (no `origin`, or `voice`; the last 8 within 24 h; a background task's helper also counts its parent's main chat) after normalisation (case, accents, punctuation, spacing). Never tool results, mails, pages, other bots, routines, webhooks or the bot's own text.
- Scope (deterministic): the action's kind (from the tool's name: send, draft, post, organize, calendar, delete, pay, publish, routine, command, upload, settings) must be asked by a verb of the quote (French and English lists); every recipient/target argument (`to`, `cc`, `bcc`, `attendees`, `channel`, `bot`…) must be named in the quote (whole address, or a meaningful part of its name: `camille.martin@…` is named by "Camille"); an amount may not exceed one the quote states. A reply covers its draft. Unknown action kind, an amount the quote does not mention, a send whose recipient cannot be read from the call (`reply_to_id` only) → **ambiguous**.
- The layer runs only where the existing `judge` would ask (policies, autonomy, taint, strict gates unchanged). Asks from a per-call gate, an explicit "needs approval" policy, a command on the server itself or a new web host after outside content are never lifted.
- **Floor** (always asks, any mode): payments, deletions, writing to someone the user never named once the turn read outside content (or to an unreadable recipient), actions on the user's own computer after outside content.
- `careful` → card. `balanced` / `trusted` → valid and in scope: runs without a card; ambiguous: the reviewer (below) if one is available; otherwise the card. `auto` → the reviewer.
- Rows: `step.grant = { by: "words" | "reviewer" | "approval" | "retry", quote?, reason? }`; approval cards gain `why` (why it asks) and `quote` (the words the bot cited). Activity log: `… — parce que tu as dit « … »` / `autorisé par le relecteur : …`.

### Rules and the automatic reviewer ("Auto" mode)
`Autonomy` gains `"auto"`. The reviewer model is `settings.review.model`, else `AUX_MODEL`, else the bot's own model (never a subscription tool). It receives the rules that apply to the bot, the action (tool + arguments), the user's own recent messages, the quote and how it checked out, and only **whether** outside content was read — never that content — and must answer JSON `{decision: allow|ask|deny, reason}`. Unavailable or unusable answer → ask. Deny → nothing runs; the bot gets `… Why: <reason>`; the step shows the reason.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/rules` | – | `RulesState` (`rules`, `reviewerModel`, `auxModel`) |
| POST | `/rules` | `{ text, botId? }` (null/absent: every bot) | `{ rule }` — 60 at most; emits `{ type: "rules" }` |
| PATCH | `/rules/:id` | `{ text?, enabled? }` | `{ rule }` |
| DELETE | `/rules/:id` | – | `{ ok }` |
| PUT | `/rules/reviewer` | `{ model }` (`""` = AUX_MODEL / the bot's model) | `RulesState` |

Rules also go into every concerned bot's system prompt ("a rule that says to ask first wins over everything").

### Action-bound, single-use approvals and uncertain outcomes (`server/src/agent/executions.ts`)
- An approval stores `action_hash` = sha256(tool + canonical JSON of the arguments, keys sorted, `user_quote` left out). Executing needs `approvals.consume(id, hash)`: true once, only for that exact action (two tabs pressing "Allow" run it once). The card shows `outcome: done | failed | uncertain`.
- Every external action (app/connector writes, `page_publish`, `vault_type`, `email_code_type`, `secret_use`, `video_generate`, `my_*` actions) gets a reservation in `executions` (running → done / failed / **uncertain**). Uncertain = a timeout, a connection dropped mid-way (`ECONNRESET`, `UND_ERR_SOCKET`…), the turn stopped while it ran, or the server restarted (`sweepUncertain()` at start-up). Never replayed; the chat gets a card `{ type: "uncertain", executionId, title, detail, status }`.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/executions/:id` | `{ action: "done" \| "check" \| "retry" \| "dismiss" }` | `{ ok }` — once (409 after). `check`: the bot looks without redoing; `retry`: one single-use grant (30 min) for exactly that action, then the bot is told to check and call it again |

### Background tasks (`server/src/agent/bgtasks.ts`)
Tool `task_start { title, goal }` (also `task_list`, `task_stop`): a hidden helper does the work in its own conversation; a card `{ type: "task", taskId, helperId, title, state: running|waiting|done|failed|stopped, steps, result?, question?, approval? }` in the main chat follows it (live step counter from `live[helperId]`). At most **3** running or waiting per bot. Its question (`ask_user`) and its approval are answered on the card; the report comes back as a system turn to the parent ("tell the user the main conclusion"). After outside content, `task_start` asks first.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/bots/:id/bgtasks` | – | `{ tasks: BgTask[] }` (also in `/bots/:id/bundle` as `bgTasks`) |
| POST | `/bots/:id/bgtasks/:taskId/stop` | – | `{ task }` |
| POST | `/bots/:id/bgtasks/:taskId/reply` | `{ text }` | `{ task }` — routed to the task (reopens a finished one; counts as the user's words) |

### Proactive nudges (`server/src/agent/nudges.ts`)
`Bot.nudges: { enabled, perDay (1–10), budgetUsd (0.01–5 a day), everyMin (15–1440) }`, off by default, set with `PATCH /bots/:id { nudges }`. Every 5 min the scheduler runs due passes: read-only tools only (reads of the user's app accounts, the bot's memory) plus `nudge_raise { matter_key, title, body }`; at most 6 model calls; its own daily budget (`nudge_days`); nothing during push quiet hours; one nudge per matter key, ever. Card `{ type: "nudge", nudgeId, title, body, status: pending|doing|later|never }`; push kind `nudge`. "Do it" starts a turn marked as having read outside content (the nudge's words authorise nothing); "Later" snoozes 3 h (it comes back outside quiet hours); "Never for this" closes the matter.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/bots/:id/nudges` | – | `{ settings, stats: { spentUsd, raised, passes, lastPassAt }, nudges }` |
| POST | `/bots/:id/nudges/run` | – | `{ result: { status: raised \| nothing \| skipped, … }, stats }` — "Try now" (still within cap, budget, quiet hours) |
| POST | `/bots/:id/nudges/:nudgeId` | `{ action: "do" \| "later" \| "never" }` | `{ nudge }` (409 once answered) |

### Memory (`server/src/agent/memory.ts`, `sensitive.ts`)
`Memory` gains `status: active | archived | contested`, `quote` (the user's words a learned note came from), `category` (a sensitive category it touches, kept only when allowed), `source: chat | learned | import`. Automatic learning reads only messages the user typed; each fact must cite an excerpt that is really in one of them. Sensitive categories (`SENSITIVE_CATEGORIES`: health, religion, politics, sexuality, origin, location, financial, legal) are excluded unless allowed in settings or (for `memory_save`) the user's last message explicitly asks to remember; secrets (passwords, keys, Luhn-valid card numbers, IBAN-like tokens) never. Archived notes are not used; contested ones are shown to the bot as uncertain.

| Method | Path | Body | Returns |
|---|---|---|---|
| PATCH | `/memories/:id` | `{ status }` | `{ memory }` |
| GET | `/bots/:id/memories/export?format=md\|json` | – | a download |
| POST | `/bots/:id/memories/import` | `{ text }` → preview; `{ text, commit: true, chosen?: string[], allowSensitive? }` | `{ candidates: { text, skip: duplicate\|secret\|sensitive\|null, category }[] }` / `{ imported, skipped }` |
| GET / PUT | `/memory-settings` | `{ autoCapture?, allowSensitive?: { <category>: bool }, style?: { enabled?, clear? } }` | `{ settings: MemorySettings }` — emits `{ type: "memorySettings" }` |
| POST | `/memory-settings/style/learn` | – | `{ settings, source: "mail" \| "chat", samples }` — writing style from the user's sent mail (Gmail `in:sent`, Outlook `sentitems`; quoted replies and signatures stripped), else from their chat messages; no quotes, names or facts; replaced each time; injected into prompts when enabled |

### Private verification codes and masked access emails (`server/src/native/access.ts`)
- Mail reads (`mail_search`, `mail_read`, `mail_thread`, and the email trigger's snippet) replace the body of an email that grants account access (one-time codes, magic links, password resets, temporary passwords, backup codes, API keys) by `[contenu masqué : accès à un compte]` / `[content hidden: account access]`; the subject stays.
- Tool `email_code_type { site, from?, mailbox? }` (vault group, needs the bot's browser): checks the page in front is on `site`, waits up to `CODE_WAIT_MS` (60 s, polling `CODE_POLL_MS` 5 s) for an access email from that site's domain (or `from`) received after the turn started (2 min margin), extracts the code and types it; the model only learns that it was typed. The code is then hidden from anything the model reads for 30 min (`hideForAWhile`). After outside content it asks every time (strict).


## Wave 5b — spend checkpoints, cheaper routines, learned skills, guides, card payments, committing clicks, usage journal, files on the user's computer, API connectors, Telegram commands, first-task ideas, rich replies, private pages, rules from the chat, memory confidence

All routes are under `/api` and need the session cookie.

### Spend checkpoints (`server/src/agent/spend.ts`)
- `GET /spend` → `{ settings: { checkpointUsd } }` (default 5; 0 = off). `PUT /spend { checkpointUsd }` (0–10 000).
- `PATCH /bots/:id { spendCheckpointUsd: number | null }` — the bot's own checkpoint (null: the account's).
- Card `{ type: "spend", checkpointId, title, scope: "chat" | "task" | "routine", spentUsd, thresholdUsd, status }`.
- `POST /spend/:checkpointId { action: "continue" | "raise" | "stop" }` → 409 when already answered.

### Routines
- `Routine` gains `skipUnchanged`, `inputs` (labels), `failures`, `pausedReason`, `running`, `projectedMonthlyUsd`. `RoutineRun.status` may be `"skipped"`; runs carry `costUsd`.
- Tool `routine_create` takes `only_if_new: string[]` (mail account names or http(s) addresses) for cron routines.
- `POST /routines/:id/run` → 409 while a run is under way.

### Learned skills and guides
- Tool `skill_propose { name, when?, steps }` → card `{ type: "skill", name, when, steps, outside, status }`; `POST /bots/:id/cards/:seq/skill { action: "save" | "dismiss", name?, when?, steps? }`. `Skill` gains `learned`, `outside`.
- `GET /guides` → `{ guides: Guide[] }`; tool `guide_read { name }`.

### Vault cards and payments (`server/src/agent/payments.ts`)
- `POST /vault { kind: "card", name, number, expiry: "MM/YY", cvc, holder?, dailyCapUsd?, monthlyCapUsd?, note? }`; `PATCH /vault/:id` (number etc. only to replace the card; caps alone otherwise). `VaultItem.card = { brand, last4, dailyCapUsd, monthlyCapUsd, spentTodayUsd, spentMonthUsd }`; nothing else of the card is ever returned.
- `GET /payments` → `{ payments: Payment[] }`.
- Tool `card_fill { card, amount, currency, merchant, fields: [{ field, x, y }], submit?: { x, y } }` — always an approval (`card: <name>`, once), bound to the page host the server read (`seen_host`).

### Committing clicks (`server/src/agent/bind.ts`)
- `screen_click` gets `user_quote`; the server adds `seen_target: { label, host, form }` read in the page. Committing words → grounding/reviewer/card with policy key `click: <host>`; payments and deletions always ask, once.

### Usage journal (`server/src/journal.ts`)
- `GET /journal?bot=&decision=&tool=&days=&from=&to=&limit=&before=` → `{ entries: JournalEntry[], totals: { lines, costUsd, byDecision } }`.
- `GET /journal.csv?…` → `time,bot,tool,action,decision,quote,reason,status,cost_usd,origin`.

### Files on the user's computer (relay protocol 1.1 — `docs/RELAIS-PROTOCOLE.md` §12)
- Tools (group `mycomputer`): `my_files { folder?, path?, device? }`, `my_file_read { folder, path }`, `my_file_write { folder, path, text, mode? }`, `my_file_trash { folder, path }`. Writes and trash: approval `myfiles: write: <bot>`, once. Only in turns the user started.

### API connectors (`server/src/apiconnectors.ts`)
- Tools `api_connector_propose { name, base_url, secret, header?, prefix?, endpoints?, openapi? }`, `api_get { connector, path, query? }`, `api_send { connector, method, path, body? }`.
- Card `{ type: "apiconnector", connectorId, name, baseUrl, host, secret, secretSaved, endpoints, status }`; `POST /bots/:id/cards/:seq/apiconnector { action: "approve", token? } | { action: "dismiss" }`.
- `GET /api-connectors`, `DELETE /api-connectors/:id`. Server event `{ type: "apiConnectors" }`.

### Telegram (linked chat)
- Commands `/taches`, `/etat`, `/stop`, `/usage`, `/memoire`, `/aide` (answered by the server). Reactions: 👍/👎 on an approval message answer it (not for `card:`, `myfiles:`, `mycomputer:`, vault keys); other reactions on replies become feedback. Bot API: `getUpdates` with `allowed_updates: ["message", "message_reaction"]`, `setMessageReaction`.

### First-task ideas
- `GET /ideas?mail=1` → `{ ideas: TaskIdea[], source: "mail" | "default", sampled }` (subjects only, matched on the server, no model call).

### Pages
- `SharedPage.visibility: "link" | "private"`; `PATCH /pages/:token { visibility }`; `GET /p/:token` of a private page → 404 unless the owner's session cookie. Tools: `page_publish { …, visibility? }`, `page_edit { name, edits: [{ find, replace }] }`.

### Rules from the chat and scoped rules (`server/src/rules.ts`, `agent/ruletools.ts`)
- `Rule` gains `routineId`, `trigger` (`cron | once | webhook | watch | email | slack | calendar`), `source: "user" | "chat"`, `quote`. `POST /rules { text, botId? | routineId? | trigger? }`, `PATCH /rules/:id { …, routineId?, trigger? }`.
- `GET /rules` adds `changes: RuleChange[]`; `POST /rules/changes/:id/undo` → the new state (409 when already undone).
- Tool `rule_propose { action: "add" | "change" | "remove", text?, rule?, scope?: "account" | "bot" | "routine" | "trigger", bot?, routine?, trigger?, user_quote }` — always a card (`rules: <bot>`, once); refused without the user's own words (`seen_quote`).

### Memory confidence
- `Memory` gains `confidence: "once" | "confirmed"`, `confirmedAt`, `lastUsedAt`. `PATCH /memories/:id { confidence }`.
- Card `{ type: "memory", memoryId, oldText, newText, quote, status }`; `POST /bots/:id/cards/:seq/memory { choice: "old" | "new" }`.

## Wave 6

### Workspaces, roles, shared bots (`server/src/workspaces.ts`)
- Roles `owner | admin | member | viewer`; what each may do: `ROLE_PERMISSIONS` in `shared.ts` (checked on the server on every route; the web app only hides buttons).
- `GET /workspaces` → `{ workspaces: Workspace[] }` (with your `role`); `POST /workspaces { name }`; `PATCH /workspaces/:wid { name?, seats? }` (name: admins; seats: owner only, between members+pending invitations and `WORKSPACE_MAX_SEATS`); `DELETE /workspaces/:wid` (owner; shared bots go back to private).
- `GET /workspaces/:wid/members` (any member) → `{ members: WorkspaceMember[] }`; `PUT /workspaces/:wid/members/:uid { role }` (owner: admin/member/viewer for anyone but the owner and themselves; admin: member ↔ viewer only); `DELETE /workspaces/:wid/members/:uid[?purge=1]` (yourself = leave; owner never; admin: members and viewers; `purge=1`: also replaces what they wrote in the workspace's shared bots with `[deleted]`).
- Invitations: `POST /workspaces/:wid/invites { email, role }` → `{ invite: { …, link } }` — single use, 7 days, bound to that address, only a SHA-256 of the token stored; admins invite members/viewers, only the owner invites admins; `DELETE /workspaces/:wid/invites/:iid`. Public `GET /invites/:token` → `{ invite: { workspaceName, email, role } }` or 404. `POST /invites/accept { token }` (signed in, same email; else 403). `POST /auth/signup { …, invite }` creates the account even when sign-ups are closed (or `ALLOWED_EMAILS` does not list it) when the invitation is for that email, and joins.
- Admin console: `GET /workspaces/:wid/admin` (owner/admin) → `WorkspaceAdmin` (members, pending invitations, usage per member over 30 days — messages, cost of the turns they started (`usage.actor_id`), approvals —, shared bots, shared items, last 200 log lines). `GET /workspaces/:wid/export` → JSON attachment (members, shares, full log, members' messages in shared bots).
- Shared items (names only, values stay sealed with their owner): `POST /workspaces/:wid/resources { kind: "vault" | "connector", id }` (your own item; owner/admin), `DELETE /workspaces/:wid/resources/:kind/:rid` (who shared it, or owner/admin).
- Sharing a bot: `PUT /bots/:id/share { workspaceId, access: "all" | "list", memberIds?, approvals: "owner" | "owner_or_admins" }` (owner of the bot, member of that workspace; `memberIds` filtered to members), `DELETE /bots/:id/share`. `Bot.sharing: BotShare | null` on your own bots.
- What others see: `GET /bots` adds the bots shared with you, each with `access: SharedAccess` (`ownerName`, `workspaceName`, `role`, `canTalk`, `canManage`, `canApprove`) and the owner's private fields blanked. Routes open to them: `GET /bots/:id/rows` (view), `POST /bots/:id/messages` (talk: text only; row `origin: { kind: "member", id, name }`), `POST /bots/:id/calls*` and the voice WebSocket (talk), `PATCH /bots/:id` (admins: `name, label, description, instructions, color, shape, character, voice` only), `POST /approvals/:id` (admins when the bot's rule is `owner_or_admins`; "always" counts as once). Every other bot route stays owner-only (404 for anyone else). No access at all → 404; access without the right → 403.
- Security model: a member's message is never the owner's words (grounding ignores `origin.kind = "member"`), the turn it starts is tainted from its first step, it never joins a running turn and never makes the owner's pending approvals lapse (it waits for them). Live events of a shared bot (`rows`, `reset`, `live`, `bot`, `cheer`, `mail`) also reach the people who may see it. Log: `workspace_audit` (immutable). Server event `{ type: "workspaces" }`.
- SSO (SAML/OIDC) is out of scope: everyone has their own Sklubot account.

### A bot's own email address (`server/src/botmail.ts`)
- Receiver: `smtp-server` (receive only, no AUTH; STARTTLS only with `MAIL_TLS_CERT`/`MAIL_TLS_KEY`), `size` = `MAIL_MAX_BYTES` with `rejectOversized`, at most 5 recipients, `MAIL_PER_IP_MINUTE`, `MAIL_PER_SENDER_HOUR`; unknown address → 550. SPF/DKIM/DMARC with `mailauth.authenticate` (results stored), parsed with `mailparser.simpleParser`, spam heuristics (`spamScore`, held at 5). Held: sender not on the allowed list, DMARC fail, spam.
- `GET /mail` → `{ domain, receiving, relay: MailRelay | null }`; `PUT /mail/relay { host, port, secure, username, password?, fromDomain, dkimSelector, dkimKey? }` (password and PEM key sealed, never returned; "" keeps, `null` removes); `DELETE /mail/relay`.
- `GET /bots/:id/email` → `{ email: BotEmail, mails: InboundMail[], routine }`; `PUT /bots/:id/email { localPart?, enabled?, allowedSenders?, autoReply? }` (auto-reply off by default); `DELETE /bots/:id/email`; `POST /bots/:id/mail/:mailId/release` (a held mail); `POST /bots/:id/email/routine { name?, prompt? }` → a routine with `trigger: "botmail"` ("new email to this bot"; also a rule trigger kind).
- Card `{ type: "mail", mailId, from, subject, snippet, auth: { spf, dkim, dmarc }, spam, status: "delivered" | "held" | "released" | "replied" }`. Server event `{ type: "mail", botId }`.
- Tools (only for a bot with an address): `bot_email_inbox { limit? }`, `bot_email_read { id }` (outside content; held mails never listed; account-access mails masked), `bot_email_send { to[], subject, body, reply_to_id? }` — asks like an app send (`appWrite`): grounded in the owner's words, reviewer, or a card; after outside content always a card unless the owner named that recipient; reserved (`executions`), DKIM-signed when a key is set, `In-Reply-To`/`References` on replies, 50 sends a day, relay on a private address refused.

### Server-mediated voice (`server/src/voice/`)
- `GET /voice` → `{ status: VoiceStatus, settings: VoiceSettings }`; `PUT /voice { mode?, stt?, tts?, bargeIn?, sttKey?, ttsKey? }` (keys sealed; "" keeps, `null` removes); `POST /voice/test` → `{ ok, heard, ttsMs, sttMs }`; `GET /bots/:id/voice` → the status of the bot owner's services (`mode: "server" | "browser"`).
- Providers: STT `whisper-cpp` (`POST {url}/inference`, multipart `file`, `response_format=json`, `language`) or `openai` (`POST /v1/audio/transcriptions`); TTS `piper` (`POST {url}/synthesize {text, voice?}` → WAV) or `openai` (`POST /v1/audio/speech {model, input, voice, response_format: "wav"}`). Operator addresses `VOICE_STT_URL`/`VOICE_TTS_URL`; user addresses go through `guardedFetch`.
- WebSocket `GET /api/voice/:botId` (same-site Origin + session cookie; owner or a workspace member who may talk; 409 when no service → the app falls back to browser speech). Client → server: text `{"type":"hello","sampleRate":16000,"lang":"fr-FR"}`, binary PCM 16-bit LE mono 16 kHz frames (≤ 32 KiB, ≤ 400 messages/s), `{"type":"played","id"}`, `{"type":"interrupt"}`, `{"type":"mute","on"}`, `{"type":"bye"}`. Server → client: `{"type":"ready","callId","stt","tts"}`, `{"type":"vad","speaking"}`, `{"type":"partial","text"}` (whisper.cpp only), `{"type":"final","text"}`, `{"type":"audio","id","text","mime":"audio/wav","ms"}` followed by one binary WAV message, `{"type":"barge_in"}`, `{"type":"error","message"}`. Close codes: 4400 bad message/format, 4409 services unavailable, 4008 flood, 4000 call over 1 h.
- Barge-in: energy VAD with adaptive noise floor (`vad.ts`); while the bot talks the user must speak `bargeIn.minSpeechMs` (default 250 ms); then audio not yet played is dropped (epoch), `barge_in` is sent and the bot's turn is interrupted. The reply is read sentence by sentence as it streams (`takeSentences`, `speakableText`). The call is recorded like browser calls (`calls.ts`: started/ended rows, transcript, summary).

## Wave 7 — Agent Reach, credential relay, key health, provider chains, paid tools, cache, project import, temporary links

### Agent Reach (`server/src/reach.ts`, `docker/desktop/Dockerfile`)
- Installed in the desktop image with `uv tool install` from the pinned GitHub release asset `https://github.com/Panniantong/Agent-Reach/releases/download/v1.6.1/agent-reach.zip` (SHA-256 checked; not PyPI), `/opt/agent-reach/tools`, `/usr/local/bin/agent-reach`; `agent-reach setup` at build time; `REACH_BROWSER_PORT=9333` (off Chromium's 9222). Outbound: `r.jina.ai`, Exa (`mcp.exa.ai`), the sites.
- Tool group `"reach"` (`TOOL_GROUPS`, switchable per bot; offered only on Linux computers): `reach_search { channel, query, limit?, fresh? }` → `agent-reach <channel> search <query> --limit N`; `reach_read { url, fresh? }` → `agent-reach read <url>`; `reach_status {}` → `agent-reach doctor` + `channels`. Run with `docker exec … timeout N agent-reach <argv…>` (argument array, no shell); the envelope `{ ok, items | result, error: { code, message, hint } }` is parsed and trimmed (1 500 chars per item, 15 000 in all); results are outside content. `PLATFORM_BLOCKED` / "Sign in to confirm you're not a bot" on YouTube → a clear message and, when the user has a paired Relais computer, the suggestion to open it from there (no new relay op). No posting/commenting tool exists.
- `GET /bots/:id/reach` → `ReachState { available, reason, version, logins: ReachLogin[], channels }`; `POST /bots/:id/reach/:channel/login|logout` (channel ∈ reddit, twitter, instagram, facebook) → Agent Reach opens its browser window on the bot's desktop (`DISPLAY=:1`) at the sign-in page; the bot's screen actions are held (control lease) while the user signs in. Server event `{ type: "reach", botId }`.

### Credential relay (`server/src/egress.ts`, `docker/desktop/sklubot-api`)
- `Bot.relayEnabled` (`PATCH /bots/:id { relayEnabled }`, off by default; off revokes the token).
- On a `shell_run` with the relay on, the computer gets `/root/.sklubot/relay.env` with `SKLUBOT_RELAY_URL=${ENGINE_BASE_URL}/egress/<botId>` and `SKLUBOT_RELAY_TOKEN` (random, stored as SHA-256 in `egress_tokens`, one per computer, reissued per server run) — never a secret value.
- `ANY /egress/:botId/:secret/:host[:port]/<path>?<query>` with `X-Sklubot-Relay-Token` (internal network only: refused with `X-Forwarded-For`/`Forwarded`; `deploy/Caddyfile` answers 404). Checks: token (401), relay on (403), secret exists (410, not sent), host bound to the secret or a subdomain (403), 60 req/min per bot and secret (429), approval (policy key `relay: <secret>`: first use asks, "Always" remembered; after outside content — or with no command of the bot running — any method other than GET/HEAD/OPTIONS asks every time, `once`), https only (`x-sklubot-relay-scheme: http` honoured only with `ALLOW_PRIVATE_FETCH`), `guardedFetch` with `redirect: "manual"`. Forwarded as is: method, path, repeated query parameters, headers (minus transport headers, `x-sklubot-*`, `x-forwarded-*` and the secret's own header), body ≤ 20 MB. The secret's header is set server-side; the secret is scrubbed from the response body (text types) and headers under every form (`scrubSecret`). Journal: `action_journal` tool `api_relay` (method, host, path, secret name, status) + audit line.
- Helper in the image: `sklubot-api "<secret>" <METHOD> <url> [curl options]` (token passed to curl through a file descriptor). A failing command that names a bound host without the relay gets a hint appended (`relayHint`).

### Credential health (`server/src/health.ts`)
- `VaultItem.checkUrl` (secrets): optional read-only https address on one of the secret's hosts. Known free checks: OpenAI `GET /v1/models`, Anthropic `GET /v1/models` (+ `anthropic-version`), GitHub `GET /user`, Stripe `GET /v1/balance`, Mistral, Groq, xAI `models`, ElevenLabs `GET /v1/user`, Hugging Face `GET /api/whoami-v2`, Notion `GET /v1/users/me`, Slack `auth.test` (`ok:true`). Otherwise `never`.
- `POST /vault` / `PATCH /vault/:id` with a secret value: checked first; refused by the provider → `422 { error, health }` and nothing saved; `force: true` saves anyway (no alert). Answers carry `health` when a check ran.
- `GET /health/credentials` → `{ items: CredentialHealth[] }` (vault secrets, API connectors, built-in app accounts, MCP connectors); `POST /health/credentials/check` (all); `POST /health/credentials/:kind/:id/check` (`vault` | `api`). States `ok | broken | reconnect | uncertain | never`; 429 keeps the previous state (`rateLimited`), 5xx/timeout → `uncertain`. Daily round (`HEALTH_EVERY_MIN`, not with `NO_SCHEDULER`). On a transition to broken/reconnect: one notice in the main bot's chat with `action: { kind: "settings", section: "keys" }`, a push (`needs`), an audit line, and the enabled routines that use it (native account, or its name in the prompt) pause with `pausedReason` "connection to redo". Table `credential_health`. Server event `{ type: "health" }`.

### Provider chains (`server/src/providers.ts`)
- `runChain(capability, providers, args, ctx, { allowPaid, maxCostUsd = 1, prefer, exclude })`: order owned → free → paid (by estimate, unknown last); provider error or empty → next; `ProviderFailure(final)` (bad request) stops; at most 2 extra providers; paid only with a yes for this bot (`paid_consents`), else `needsConsent`; paid steps reserve then settle (A4); over the cap → `too_expensive`. `servedLine` (shown as the step summary, e.g. "servi par Agent Reach · essayé : SearXNG (vide)") and `attemptsText` (for the model).
- `search_web { query, allow_paid?, max_cost_usd?, prefer?, exclude?, fresh? }` (offered when the model has no native search and Brave, SearXNG or Agent Reach is available): Brave with the user's vault key bound to `api.search.brave.com` (owned), Brave `BRAVE_API_KEY` (owned), SearXNG (free), Agent Reach web search (free), a connected MCP app named "treg" with a search tool (paid, price unknown, never cached).
- `transcribe { url, lang?, … }`: YouTube subtitles via Agent Reach (free) → the user's whisper.cpp (owned; audio fetched on the bot's computer with yt-dlp + ffmpeg, address passed as `$1`) → OpenAI transcription (paid, price unknown).
- `video_generate`: Higgsfield first (unchanged), else every configured video API in order (`videoServices()`), falling through on a provider error, never while a job may still finish.
- `allow_paid: true` raises an approval card (`paid: <capability>: <bot>`, `once`) that names the provider and the estimated cost; the yes is remembered per bot and capability. `DELETE /bots/:id/paid-consents` asks again.

### Paid tools (`server/src/thirdparty.ts`)
- `tool_spend` in micro-dollars (integers): `reserve` (refuses with a readable message over `Bot.thirdPartyDailyCapUsd` or the monthly budget; `busy` for the same request in flight; `replay` of the stored result for the same idempotency key within 10 minutes — not charged again), `settle` (real cost → `usage` row, so the budget, spend checkpoint and journal count it), `release` (failure not billed).
- `video_generate`: the approval card's note announces `VIDEO_PRICE_USD` per video when set ("price not known in advance" otherwise); optional `request_id` argument as idempotency key.
- `PATCH /bots/:id { thirdPartyDailyCapUsd: number | null }`; `GET /thirdparty?bot=` → `{ spend: ThirdPartySpend, consents }`.

### Response cache (`server/src/thirdparty.ts`)
- `tool_cache` per account; key = tool, provider and arguments in a stable order; only real results (never errors, empty answers, actions, job states). Policies `forbid | temp | keep` with a TTL: `search_web` 1 h, `reach_search` 1 h, `reach_read` 6 h, `transcribe` kept 30 days, `api_get` 15 min, `provider:treg` forbid, default 15 min. `fresh: true` forces a call. The model sees "[Cached answer, obtained 2 h ago …]"; the step summary says "réponse en mémoire · 2 h". `GET /cache-policy` → `{ policies, defaults }`; `PUT /cache-policy { policies: { <tool | provider:<id>>: { mode, ttlSec } } }`.

### Project import (`server/src/projectimport.ts`)
- `POST /import/project/preview { env?, zip? (base64, ≤ 5 MB) }` → `ImportPreview { previewId, variables: ImportVariable[], skills: ImportSkill[], ignored }` — names, `isSecret`, guessed `provider`/`hosts`/`header`/`prefix`, `exists`; never a value (values kept in memory 15 min). Zip read from its central directory (stored/deflated; folders, links, `..` and absolute paths skipped; 300 entries, 1 MB per file, 5 MB in all); skills = `SKILL.md` (folder name) or `.md` files with front matter `name`/`description`; `mentionsKey` flags a key in the text.
- `POST /import/project/commit { previewId, bindings: [{ name, import, hosts, header?, prefix? }], replace?, skills: string[], skillScope: "shared" | botId }` → `ImportReport { created, updated, skipped, toComplete, skills, health }`. No duplicates (`replace` updates values); each key is checked (A2); skills saved as reviewed skills (shared through the main bot, or for one bot).

### Temporary public links (`server/src/publiclinks.ts`)
- Tool `file_public_link { path, minutes? }` (group `files`; asks first, `once`, after outside content): images, audio, video ≤ 50 MB, 60 min by default, 1 440 at most. Public `GET|HEAD /l/<id>.<hmac>` (HMAC-SHA256 of id and expiry with `SESSION_SECRET`; only a hash of the token stored; read through the library guard; `no-store`, `noindex`; 410 once expired or removed).
- `GET /public-links` (active), `POST /bots/:id/public-links { path, minutes? }` → `{ link }` (with `url`, shown once), `DELETE /public-links/:id`. Creation, downloads and removal are audited. Server event `{ type: "publicLinks" }`.
