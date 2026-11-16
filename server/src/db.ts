import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

// Idempotent schema: safe to run on every start, so existing databases upgrade in place.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
  pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'agent', name TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL DEFAULT '',
  shape TEXT NOT NULL, color TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'personal',
  is_primary INTEGER NOT NULL DEFAULT 0, effort TEXT NOT NULL DEFAULT 'medium',
  model TEXT NOT NULL DEFAULT '', autonomy TEXT NOT NULL DEFAULT 'careful',
  voice TEXT NOT NULL DEFAULT '{}', generation INTEGER NOT NULL DEFAULT 1,
  next_seq INTEGER NOT NULL DEFAULT 1, rev INTEGER NOT NULL DEFAULT 0, unread INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0, parent_id TEXT, members TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bots_user ON bots(user_id);
CREATE TABLE IF NOT EXISTS rows (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, generation INTEGER NOT NULL,
  seq INTEGER NOT NULL, rev INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (bot_id, generation, seq)
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS history_bot ON history(bot_id, generation, id);
CREATE TABLE IF NOT EXISTS paused (
  bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
  seq INTEGER NOT NULL, generation INTEGER NOT NULL, tool TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL, resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS policies (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, tool TEXT NOT NULL, mode TEXT NOT NULL,
  PRIMARY KEY (user_id, tool)
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  text TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'chat', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'working', note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, name TEXT NOT NULL,
  prompt TEXT NOT NULL, trigger TEXT NOT NULL DEFAULT 'cron', schedule TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'UTC', run_at INTEGER, hook_token TEXT, enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
  url TEXT NOT NULL, token_enc TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  checkins TEXT NOT NULL DEFAULT '{}', budget_usd REAL
);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, bot_id TEXT NOT NULL, at INTEGER NOT NULL,
  model TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cached_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_user ON usage(user_id, at);
CREATE TABLE IF NOT EXISTS consolidation (
  bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, mark INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS compactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL, at INTEGER NOT NULL, before_items INTEGER NOT NULL, after_items INTEGER NOT NULL
);
`);

CREATE_EXTRA();
function CREATE_EXTRA() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS vault (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
    site TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT '', password_enc TEXT, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  );`);
  // Columns added after the first release: add them only where they are missing.
  const has = (table: string, column: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
  if (!has("users", "locale")) db.exec("ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en'");
  const add = (table: string, column: string, decl: string) => { if (!has(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`); };
  add("bots", "character", "TEXT NOT NULL DEFAULT '{}'");
  add("bots", "room_rule", "TEXT NOT NULL DEFAULT 'lead'");
  add("bots", "disabled_tools", "TEXT NOT NULL DEFAULT '[]'");
  add("bots", "telegram_token_enc", "TEXT");
  add("bots", "telegram_username", "TEXT");
  add("bots", "telegram_chat_id", "TEXT");
  add("bots", "telegram_code", "TEXT");
  add("bots", "telegram_offset", "INTEGER NOT NULL DEFAULT 0");
  add("routines", "watch_kind", "TEXT");
  add("routines", "watch_target", "TEXT");
  add("routines", "watch_every_min", "INTEGER");
  add("routines", "watch_hash", "TEXT");
  add("routines", "watch_checked_at", "INTEGER");
  add("settings", "budget_warned", "TEXT NOT NULL DEFAULT ''");
  // Built-in app triggers: the account, what to look for (JSON), how often, and where the last check stopped (JSON).
  add("routines", "native_account_id", "TEXT");
  add("routines", "native_config", "TEXT");
  add("routines", "native_every_min", "INTEGER");
  add("routines", "native_state", "TEXT");
  add("routines", "native_checked_at", "INTEGER");
  // OAuth sign-in for connectors: "none" | "token" | "oauth" (empty on older rows: read from token_enc), and the sealed tokens.
  add("connectors", "auth", "TEXT NOT NULL DEFAULT ''");
  add("connectors", "oauth_enc", "TEXT");
  // Threads: a reply in a thread carries the seq of the message it hangs on (0 = the main chat). The model-facing
  // history of a thread is kept apart from the main one, under the same number.
  add("rows", "thread", "INTEGER NOT NULL DEFAULT 0");
  add("history", "thread", "INTEGER NOT NULL DEFAULT 0");
  db.exec(`
  CREATE INDEX IF NOT EXISTS rows_thread ON rows(bot_id, generation, thread, seq);
  CREATE INDEX IF NOT EXISTS history_thread ON history(bot_id, generation, thread, id);
  -- Light feedback for a bot (the user reacted to one of its messages), handed to its next turn in that chat or thread, then dropped.
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    generation INTEGER NOT NULL, thread INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL, emoji TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS feedback_bot ON feedback(bot_id, generation, thread);`);
  db.exec(`
  CREATE TABLE IF NOT EXISTS routine_runs (
    id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'running', note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS routine_runs_routine ON routine_runs(routine_id, at);
  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at INTEGER NOT NULL, bot_id TEXT, kind TEXT NOT NULL, text TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS audit_user ON audit(user_id, id);
  -- The activity log is a record: lines can be added, never changed.
  CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'the activity log cannot be edited'); END;
  CREATE TABLE IF NOT EXISTS sign_in_links (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pages (
    token TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
    title TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  -- OAuth sign-ins waiting for the browser to come back: one row per state, single use, 10 minutes.
  CREATE TABLE IF NOT EXISTS oauth_pending (
    state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE, verifier_enc TEXT NOT NULL,
    bot_id TEXT, seq INTEGER, expires_at INTEGER NOT NULL
  );
  -- Built-in apps. The OAuth client the user created in the vendor's console (secret and Slack app-level token sealed).
  CREATE TABLE IF NOT EXISTS native_clients (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, vendor TEXT NOT NULL, client_id TEXT NOT NULL,
    secret_enc TEXT, tenant TEXT NOT NULL DEFAULT '', app_token_enc TEXT, updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, vendor)
  );
  -- One signed-in account of a built-in app ("Gmail — perso"). tokens_enc: sealed JSON, never sent anywhere but the vendor.
  CREATE TABLE IF NOT EXISTS native_accounts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, app TEXT NOT NULL, label TEXT NOT NULL,
    identity TEXT, tokens_enc TEXT, meta TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'needs_auth', error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS native_accounts_user ON native_accounts(user_id, created_at);
  -- Sign-ins waiting for the browser to come back: one row per state, single use, 10 minutes.
  CREATE TABLE IF NOT EXISTS native_pending (
    state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES native_accounts(id) ON DELETE CASCADE, verifier_enc TEXT, expires_at INTEGER NOT NULL
  );
  -- Items a built-in app trigger already fired for (message id, event id + start, channel + ts): never twice.
  CREATE TABLE IF NOT EXISTS native_seen (
    routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE, item TEXT NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (routine_id, item)
  );
  -- A turn that is under way. Rows left here after a restart are turns that were cut off.
  CREATE TABLE IF NOT EXISTS active_turns (
    bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, started_at INTEGER NOT NULL, acted INTEGER NOT NULL DEFAULT 0
  );`);
  // Wave 3. Organising bots: pinned, filed under a section of the user's, hidden from the list by the user
  // (distinct from `hidden`, which marks helpers that never show in the sidebar).
  add("bots", "pinned", "INTEGER NOT NULL DEFAULT 0");
  add("bots", "section_id", "TEXT");
  add("bots", "list_hidden", "INTEGER NOT NULL DEFAULT 0");
  // Vault items of several kinds ("login" | "secret" | "totp"); `meta` holds the kind's settings as JSON
  // (secret: hosts, header, prefix; totp: digits, period). The value itself stays in password_enc, sealed.
  add("vault", "kind", "TEXT NOT NULL DEFAULT 'login'");
  add("vault", "meta", "TEXT NOT NULL DEFAULT '{}'");
  // Push notification preferences (kinds and quiet hours), JSON.
  add("settings", "push", "TEXT NOT NULL DEFAULT '{}'");
  db.exec(`
  CREATE TABLE IF NOT EXISTS bot_sections (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS bot_sections_user ON bot_sections(user_id, position);
  -- Keys this server generates once and keeps (the VAPID key pair for push). The private half is sealed.
  CREATE TABLE IF NOT EXISTS server_keys (
    name TEXT PRIMARY KEY, public TEXT NOT NULL, private_enc TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  -- One browser or phone subscribed to push notifications. p256dh and auth are the subscription's own keys (RFC 8291).
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL, auth_enc TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL, last_ok_at INTEGER, failures INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions(user_id);`);
  // Sklubot Relais (docs/RELAIS-PROTOCOLE.md): the user's own computers. Only hashes of the device token are kept: the
  // current one and, while a rotation waits for the relay's acknowledgement, the next one. Pending pairings live in
  // memory only: each is bound to one open connection and lapses with it.
  db.exec(`
  CREATE TABLE IF NOT EXISTS relay_devices (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT '', arch TEXT NOT NULL DEFAULT '', os_release TEXT NOT NULL DEFAULT '', app_version TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL, pending_hash TEXT, rotated_at INTEGER NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS relay_devices_user ON relay_devices(user_id, created_at);`);
  // Relay protocol 1.2: a linked device is a computer (Sklubot Relais) or a phone (the Android app).
  add("relay_devices", "kind", "TEXT NOT NULL DEFAULT 'computer'");
  // Wave 4. Reliability: a bot's own ordered backup models (JSON list; NULL = the account's list), and the account's
  // reliability settings (JSON: fallbackModels, maxRetries, maxContinuations).
  add("bots", "fallback_models", "TEXT");
  add("settings", "reliability", "TEXT NOT NULL DEFAULT '{}'");
  // Team: the bot that created this bot (bot_create), skills every bot of the user may read, and the shared profile.
  add("bots", "created_by", "TEXT");
  add("skills", "shared", "INTEGER NOT NULL DEFAULT 0");
  add("settings", "profile", "TEXT NOT NULL DEFAULT '{}'");
  db.exec(`
  -- A bot's change to its own settings (self_update): what it was before, so the user can undo it.
  CREATE TABLE IF NOT EXISTS bot_revisions (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, before TEXT NOT NULL, after TEXT NOT NULL,
    created_at INTEGER NOT NULL, undone_at INTEGER
  );
  -- Work left waiting (an open approval, a turn still running) that the user was already reminded of: once each.
  CREATE TABLE IF NOT EXISTS stuck_reminders (
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, key TEXT NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (bot_id, key)
  );`);
  // Wave 5. Authorisation grounded in the user's words, action-bound single-use approvals, rules and the reviewer,
  // background tasks, nudges, better-scoped memory.
  // An approval binds to a hash of the exact action (tool + canonical arguments) and executes at most once.
  add("approvals", "action_hash", "TEXT");
  add("approvals", "consumed_at", "INTEGER");
  // Memory notes: status (active | archived | contested), the user's words a learned note came from, a sensitive category.
  add("memories", "status", "TEXT NOT NULL DEFAULT 'active'");
  add("memories", "quote", "TEXT NOT NULL DEFAULT ''");
  add("memories", "category", "TEXT");
  // Account settings: memory (JSON: autoCapture, allowSensitive, style) and the reviewer (JSON: model).
  add("settings", "memory", "TEXT NOT NULL DEFAULT '{}'");
  add("settings", "review", "TEXT NOT NULL DEFAULT '{}'");
  // Per-bot nudges (JSON: enabled, perDay, budgetUsd, everyMin).
  add("bots", "nudges", "TEXT NOT NULL DEFAULT '{}'");
  db.exec(`
  -- One execution of a state-changing action (a "reservation"): written before it runs, closed after. Left "running" by a
  -- restart, it becomes "uncertain" and is never replayed automatically.
  CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
    approval_id TEXT, tool TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', action_hash TEXT NOT NULL,
    grant_by TEXT NOT NULL DEFAULT '', quote TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'running',
    generation INTEGER NOT NULL DEFAULT 0, thread INTEGER NOT NULL DEFAULT 0, card_seq INTEGER,
    started_at INTEGER NOT NULL, finished_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS executions_status ON executions(status);
  -- A single-use permission for one exact action (the user pressed "Retry" on an uncertain card). Used at most once.
  CREATE TABLE IF NOT EXISTS action_grants (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, action_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
  );
  -- Rules in the user's own words. bot_id NULL: every bot of the user.
  CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE,
    text TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS rules_user ON rules(user_id, created_at);
  -- Background tasks started from the chat: the hidden helper doing the work and the card that follows it.
  CREATE TABLE IF NOT EXISTS bg_tasks (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, helper_id TEXT,
    title TEXT NOT NULL, goal TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'running', steps INTEGER NOT NULL DEFAULT 0,
    result TEXT NOT NULL DEFAULT '', generation INTEGER NOT NULL, card_seq INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS bg_tasks_bot ON bg_tasks(bot_id, created_at);
  -- Nudges: one record per matter (a stable key), never raised twice; snoozed or refused for good.
  CREATE TABLE IF NOT EXISTS nudges (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, matter TEXT NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', snooze_until INTEGER,
    generation INTEGER NOT NULL DEFAULT 0, card_seq INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    UNIQUE (bot_id, matter)
  );
  -- What the preparation passes of a bot spent and raised, per UTC day (their own small budget and daily cap).
  CREATE TABLE IF NOT EXISTS nudge_days (
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, day TEXT NOT NULL, spent_usd REAL NOT NULL DEFAULT 0,
    raised INTEGER NOT NULL DEFAULT 0, passes INTEGER NOT NULL DEFAULT 0, last_pass_at INTEGER,
    PRIMARY KEY (bot_id, day)
  );`);
  // Wave 5b. Spend checkpoints (A5), cheaper routines (A7), learned skills (A9), card payments (A12), the detailed usage
  // journal (A14), API connectors on demand (A16), Telegram commands and reactions (A17), private pages.
  add("bots", "spend_checkpoint_usd", "REAL");
  add("settings", "spend", "TEXT NOT NULL DEFAULT '{}'");
  add("skills", "learned", "INTEGER NOT NULL DEFAULT 0");
  add("skills", "outside", "INTEGER NOT NULL DEFAULT 0");
  // Richer skills: what the skill needs (accounts, access, files), how to check the result, what to hand back, and which
  // steps need the user's approval. Empty for every skill saved before (they work exactly as they did).
  add("skills", "needs", "TEXT NOT NULL DEFAULT ''");
  add("skills", "check_how", "TEXT NOT NULL DEFAULT ''");
  add("skills", "output", "TEXT NOT NULL DEFAULT ''");
  add("skills", "approvals", "TEXT NOT NULL DEFAULT ''");
  // Routines: skip a run when nothing changed in what it waits for (inputs JSON, fingerprint of the last look), failed
  // runs in a row and why the server paused it, and the due slot already fired (never twice).
  add("routines", "skip_unchanged", "INTEGER NOT NULL DEFAULT 0");
  add("routines", "inputs", "TEXT NOT NULL DEFAULT '[]'");
  add("routines", "inputs_hash", "TEXT");
  add("routines", "failures", "INTEGER NOT NULL DEFAULT 0");
  add("routines", "paused_reason", "TEXT");
  add("routines", "last_slot", "TEXT");
  add("routine_runs", "cost_usd", "REAL NOT NULL DEFAULT 0");
  add("pages", "visibility", "TEXT NOT NULL DEFAULT 'link'");
  // Rules scoped to a routine or a trigger kind, and rules added from the chat (with the user's words).
  add("rules", "routine_id", "TEXT");
  add("rules", "trigger_kind", "TEXT");
  add("rules", "source", "TEXT NOT NULL DEFAULT 'user'");
  add("rules", "quote", "TEXT NOT NULL DEFAULT ''");
  // Memory confidence: mentioned once / confirmed by the user saying it again; when it was last found relevant.
  add("memories", "confidence", "TEXT NOT NULL DEFAULT 'once'");
  add("memories", "confirmed_at", "INTEGER");
  add("memories", "last_used_at", "INTEGER");
  db.exec(`
  CREATE TABLE IF NOT EXISTS rule_changes (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, action TEXT NOT NULL, rule_id TEXT NOT NULL,
    bot_id TEXT, text TEXT NOT NULL, before TEXT, snapshot TEXT NOT NULL DEFAULT '{}', quote TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, undone_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS rule_changes_user ON rule_changes(user_id, created_at);`);
  // Wave 6. Workspaces (bots shared among several people, roles), the bots' own email addresses, server-mediated voice.
  db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seats INTEGER NOT NULL DEFAULT 10, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (workspace_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS workspace_members_user ON workspace_members(user_id);
  -- An invitation by email link: only a hash of the token is kept; single use, expires.
  CREATE TABLE IF NOT EXISTS workspace_invites (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, email TEXT NOT NULL COLLATE NOCASE,
    role TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL
  );
  -- One of a user's bots shared to a workspace. members: JSON list of user ids when access = 'list'.
  CREATE TABLE IF NOT EXISTS bot_shares (
    bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    access TEXT NOT NULL DEFAULT 'all', members TEXT NOT NULL DEFAULT '[]', approvals TEXT NOT NULL DEFAULT 'owner', created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS bot_shares_ws ON bot_shares(workspace_id);
  -- Vault items and connectors a member shared to the workspace (names only travel; values stay sealed with their owner).
  CREATE TABLE IF NOT EXISTS workspace_resources (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, kind TEXT NOT NULL, resource_id TEXT NOT NULL,
    shared_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, PRIMARY KEY (workspace_id, kind, resource_id)
  );
  -- Per-member record of what was done in the workspace. A record: lines are added, never changed.
  CREATE TABLE IF NOT EXISTS workspace_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, at INTEGER NOT NULL,
    actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS workspace_audit_ws ON workspace_audit(workspace_id, id);
  CREATE TRIGGER IF NOT EXISTS workspace_audit_no_update BEFORE UPDATE ON workspace_audit BEGIN SELECT RAISE(ABORT, 'the workspace log cannot be edited'); END;
  -- A bot's own address (<local>@MAIL_DOMAIN). allowed: JSON list of addresses or @domains; empty = anyone.
  CREATE TABLE IF NOT EXISTS bot_email (
    bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, local_part TEXT NOT NULL UNIQUE COLLATE NOCASE,
    enabled INTEGER NOT NULL DEFAULT 1, allowed TEXT NOT NULL DEFAULT '[]', auto_reply INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS inbound_mail (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, from_addr TEXT NOT NULL, to_addr TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '', message_id TEXT, refs TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '', spf TEXT NOT NULL DEFAULT 'none',
    dkim TEXT NOT NULL DEFAULT 'none', dmarc TEXT NOT NULL DEFAULT 'none', spam REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'delivered',
    reason TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0, ip TEXT NOT NULL DEFAULT '', card_seq INTEGER, generation INTEGER, received_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS inbound_mail_bot ON inbound_mail(bot_id, received_at);
  -- The user's SMTP relay for outgoing mail; password and DKIM private key sealed.
  CREATE TABLE IF NOT EXISTS mail_relays (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, host TEXT NOT NULL, port INTEGER NOT NULL, secure INTEGER NOT NULL DEFAULT 0,
    username TEXT NOT NULL DEFAULT '', pass_enc TEXT, from_domain TEXT NOT NULL DEFAULT '', dkim_selector TEXT NOT NULL DEFAULT '', dkim_key_enc TEXT, updated_at INTEGER NOT NULL
  );`);
  // Voice settings of the account (JSON; API keys sealed inside), and who started the turn a usage line belongs to.
  add("settings", "voice", "TEXT NOT NULL DEFAULT '{}'");
  add("usage", "actor_id", "TEXT");
  // Wave 7: the credential relay per bot (off by default), the daily cap on paid third-party tools, the cache policy.
  add("bots", "relay_enabled", "INTEGER NOT NULL DEFAULT 0");
  add("bots", "third_party_cap_usd", "REAL");
  add("settings", "cache_policy", "TEXT NOT NULL DEFAULT '{}'");
  // A sign-in callback can reach the server twice (popup + tab, or the provider redirecting twice): the second one is told it is already done.
  add("oauth_pending", "used_at", "INTEGER");
  add("native_pending", "used_at", "INTEGER");
  // Wave 8: the account's team folder (JSON: enabled), off by default; and disk-full checks of the bots' computers.
  add("settings", "team", "TEXT NOT NULL DEFAULT '{}'");
  db.exec(`
  -- What a task spent since the user last spoke to it (worker bot + scope key: chat:<thread>, task:<id>, routine:<run>),
  -- and the checkpoint it stops at (NULL: the bot's or the account's setting).
  CREATE TABLE IF NOT EXISTS spend_scopes (
    worker_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, scope_key TEXT NOT NULL, spent_usd REAL NOT NULL DEFAULT 0,
    threshold_usd REAL, updated_at INTEGER NOT NULL, PRIMARY KEY (worker_id, scope_key)
  );
  -- A checkpoint card: which worker stopped, where the card is (card_bot_id: the worker, or a task's parent).
  CREATE TABLE IF NOT EXISTS spend_checkpoints (
    id TEXT PRIMARY KEY, worker_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, card_bot_id TEXT NOT NULL, scope_key TEXT NOT NULL,
    generation INTEGER NOT NULL, thread INTEGER NOT NULL DEFAULT 0, card_seq INTEGER, spent_usd REAL NOT NULL, threshold_usd REAL NOT NULL,
    tainted INTEGER NOT NULL DEFAULT 0, origin TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL
  );
  -- Payments made with a vault card: bound to amount, merchant, page host and card; counted against the card's caps.
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, bot_id TEXT NOT NULL, card_id TEXT NOT NULL,
    card_name TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL, merchant TEXT NOT NULL, host TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'approved', execution_id TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS payments_card ON payments(card_id, created_at);
  -- The detailed usage journal: one line per tool call. A record: lines are added, never changed.
  CREATE TABLE IF NOT EXISTS action_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, bot_id TEXT NOT NULL,
    at INTEGER NOT NULL, tool TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', decision TEXT NOT NULL, quote TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, cost_usd REAL NOT NULL DEFAULT 0, origin TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS action_journal_user ON action_journal(user_id, at);
  CREATE TRIGGER IF NOT EXISTS action_journal_no_update BEFORE UPDATE ON action_journal BEGIN SELECT RAISE(ABORT, 'the usage journal cannot be edited'); END;
  -- HTTP API connectors a bot proposed and the user approved. endpoints: JSON list of {method, path, description}.
  CREATE TABLE IF NOT EXISTS api_connectors (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, bot_id TEXT, name TEXT NOT NULL,
    base_url TEXT NOT NULL, host TEXT NOT NULL, secret TEXT NOT NULL, endpoints TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS api_connectors_user ON api_connectors(user_id, created_at);
  -- Wave 7 (spec 08). Credential relay: one token per bot computer (stored hashed), revocable.
  CREATE TABLE IF NOT EXISTS egress_tokens (
    bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, token_hash TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  -- Health of keys and connections (A2): the last state per item, and the state an alert was last sent for.
  CREATE TABLE IF NOT EXISTS credential_health (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, ref_id TEXT NOT NULL, name TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'never', detail TEXT NOT NULL DEFAULT '', how TEXT NOT NULL DEFAULT '', rate_limited INTEGER NOT NULL DEFAULT 0,
    checked_at INTEGER, alerted_state TEXT NOT NULL DEFAULT '', PRIMARY KEY (user_id, kind, ref_id)
  );
  -- Paid third-party tool calls (A4), in micro-dollars: reserved before the call, settled at the real cost after.
  -- idem_key: the same request sent again (a retry) is not charged twice and gets the same result back.
  CREATE TABLE IF NOT EXISTS tool_spend (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, bot_id TEXT NOT NULL, tool TEXT NOT NULL,
    provider TEXT NOT NULL, idem_key TEXT NOT NULL, reserved_micros INTEGER NOT NULL DEFAULT 0, actual_micros INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'reserved', result TEXT, created_at INTEGER NOT NULL, settled_at INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS tool_spend_idem ON tool_spend(user_id, idem_key);
  CREATE INDEX IF NOT EXISTS tool_spend_bot ON tool_spend(bot_id, created_at);
  -- Response cache for read-only data calls (A5); each account sees only its own entries.
  CREATE TABLE IF NOT EXISTS tool_cache (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, cache_key TEXT NOT NULL, tool TEXT NOT NULL, provider TEXT NOT NULL,
    response TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER, PRIMARY KEY (user_id, cache_key)
  );
  -- Temporary public links to one library file (A8). Only the token's hash is kept.
  CREATE TABLE IF NOT EXISTS public_links (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, bot_id TEXT NOT NULL, path TEXT NOT NULL,
    mime TEXT NOT NULL, size INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, revoked_at INTEGER,
    downloads INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS public_links_user ON public_links(user_id, created_at);
  -- A provider chain switched to a paid provider for a bot only once the user said yes (A3): remembered here.
  CREATE TABLE IF NOT EXISTS paid_consents (
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, capability TEXT NOT NULL, provider TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (bot_id, capability, provider)
  );
  -- Telegram messages the bot sent that mean something on a reaction: an approval it asked, or one of its replies.
  CREATE TABLE IF NOT EXISTS telegram_messages (
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, message_id INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL,
    created_at INTEGER NOT NULL, PRIMARY KEY (bot_id, message_id)
  );
  -- Work queued for a bot (a message, a routine run, a teammate's message, a system notice), in order: 'pending' until its
  -- turn starts, 'running', then 'done'; 'deferred' while a workspace member's message waits for the owner's approval.
  -- After a restart, pending and deferred work runs again in order; a 'running' one was the turn cut off (active_turns).
  CREATE TABLE IF NOT EXISTS bot_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, trigger TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, started_at INTEGER, done_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS bot_queue_status ON bot_queue(status, id);`);
  db.exec(`
  -- Local tool servers (localtools.ts): an MCP server a bot's owner starts with a command on that bot's own Linux
  -- computer, spoken to over standard input and output. \`args\`: JSON list of strings. \`tools\`: the tool list it gave
  -- the last time it started (JSON), so a turn can offer its tools without waking the computer. No secrets are stored.
  CREATE TABLE IF NOT EXISTS local_tool_servers (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, name TEXT NOT NULL, command TEXT NOT NULL,
    args TEXT NOT NULL DEFAULT '[]', tools TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS local_tool_servers_bot ON local_tool_servers(bot_id, created_at);`);
  db.exec(`
  -- Model providers a user set up in Settings → Models (apimodels.ts): an OpenAI-compatible address, its key (sealed,
  -- never sent back to the browser) and its models with their context window and prices (JSON). Per account only.
  CREATE TABLE IF NOT EXISTS user_providers (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
    base_url TEXT NOT NULL, key_enc TEXT, models TEXT NOT NULL DEFAULT '[]', preset TEXT NOT NULL DEFAULT '',
    images INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS user_providers_user ON user_providers(user_id, created_at);`);
}

type Param = string | number | null | bigint;
export const q = {
  all<T = Record<string, unknown>>(sql: string, ...p: Param[]): T[] {
    return db.prepare(sql).all(...p) as T[];
  },
  get<T = Record<string, unknown>>(sql: string, ...p: Param[]): T | undefined {
    return db.prepare(sql).get(...p) as T | undefined;
  },
  run(sql: string, ...p: Param[]) {
    return db.prepare(sql).run(...p);
  },
  tx<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  },
};
