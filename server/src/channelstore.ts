/**
 * L162: a bot's Slack, Discord and IMAP connections. The tokens and the mailbox password the owner types in the Sklubot
 * form are sealed with the data key (auth.ts seal → datakey.ts; the column ends in _enc, so data key rotation finds it)
 * and never written to a log, an audit line or an answer of the API. What is not secret (team name, bot user, the
 * owner's id on the service, the link code, the IMAP cursor) is plain JSON.
 */
import { q } from "./db.js";
import { seal, unseal } from "./auth.js";
import { now } from "./store.js";

q.run(`CREATE TABLE IF NOT EXISTS bot_channels (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, kind TEXT NOT NULL, secret_enc TEXT NOT NULL,
  info TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (bot_id, kind))`);

export type ChannelKind = "slack" | "discord" | "imap";

export const channelStore = {
  get<S, I>(botId: string, kind: ChannelKind): { secret: S; info: I } | null {
    const r = q.get<{ secret_enc: string; info: string }>("SELECT secret_enc, info FROM bot_channels WHERE bot_id = ? AND kind = ?", botId, kind);
    if (!r) return null;
    try { return { secret: JSON.parse(unseal(r.secret_enc) ?? "null") as S, info: JSON.parse(r.info || "{}") as I }; } catch { return null; }
  },
  info<I>(botId: string, kind: ChannelKind): I | null {
    const r = q.get<{ info: string }>("SELECT info FROM bot_channels WHERE bot_id = ? AND kind = ?", botId, kind);
    return r ? (JSON.parse(r.info || "{}") as I) : null;
  },
  set(botId: string, kind: ChannelKind, secret: unknown, info: unknown) {
    const t = now();
    q.run(`INSERT INTO bot_channels (bot_id, kind, secret_enc, info, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(bot_id, kind) DO UPDATE SET secret_enc = excluded.secret_enc, info = excluded.info, updated_at = excluded.updated_at`,
      botId, kind, seal(JSON.stringify(secret)), JSON.stringify(info), t, t);
  },
  /** Changes the plain part only (link, cursor, last check). */
  patch<I>(botId: string, kind: ChannelKind, change: (cur: I) => I) {
    const cur = channelStore.info<I>(botId, kind);
    if (!cur) return;
    q.run("UPDATE bot_channels SET info = ?, updated_at = ? WHERE bot_id = ? AND kind = ?", JSON.stringify(change(cur)), now(), botId, kind);
  },
  remove: (botId: string, kind: ChannelKind) => q.run("DELETE FROM bot_channels WHERE bot_id = ? AND kind = ?", botId, kind),
  botsWith: (kind: ChannelKind) => q.all<{ bot_id: string }>("SELECT bot_id FROM bot_channels WHERE kind = ?", kind).map((r) => r.bot_id),
};
