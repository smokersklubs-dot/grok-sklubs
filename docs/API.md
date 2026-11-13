# Sklubot HTTP API

All paths are under `/api`. JSON in, JSON out. Errors: `{ "error": "message" }` with an HTTP status.
Authentication is an HTTP-only session cookie; every route except the auth routes, `/health` and `/hooks/*`
answers 401 without it. Types named below are defined in `server/src/shared.ts`.

## Account
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/me` | – | `{ user: User \| null, signupOpen: boolean }` |
| POST | `/auth/signup` | `{ email, name?, password }` | `{ user }` (403 when signup is closed) |
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
| POST | `/bots/:id/messages` | `{ text, origin?: "voice" }` | `{ row }` |
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
| GET | `/bots/:id/files/download?path=` | – | file bytes |

## Connectors (apps) and permissions
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/connectors` | – | `{ connectors: Connector[] }` |
| POST | `/connectors` | `{ name, url, token?, botId?, seq? }` | `{ connector }` (botId+seq resolve a connect card) |
| POST | `/connectors/:id/refresh` | – | `{ connector }` |
| DELETE | `/connectors/:id` | – | `{ ok }` |
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
