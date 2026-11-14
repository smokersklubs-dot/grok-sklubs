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
| GET | `/connectors` | – | `{ connectors: Connector[] }` |
| POST | `/connectors` | `{ name, url, token?, botId?, seq? }` | `{ connector }` (botId+seq resolve a connect card) |
| POST | `/connectors/:id/refresh` | – | `{ connector }` |
| DELETE | `/connectors/:id` | – | `{ ok }` |
| GET | `/connectors/catalog` | – | `{ apps: CatalogApp[] }` — one-step apps; add one with `POST /connectors {name, url, token}` |
| GET | `/vault` | – | `{ items: VaultItem[] }` |
| POST | `/vault` | `{ name, site?, username?, password?, note? }` | `{ item }` |
| PATCH | `/vault/:id` | partial (omit `password` to keep it) | `{ item }` |
| DELETE | `/vault/:id` | – | `{ ok }` |
| GET | `/policies` | – | `{ policies: Policy[] }` |
| DELETE | `/policies/:tool` | – | `{ ok }` |

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
