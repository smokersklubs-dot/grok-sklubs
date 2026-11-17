import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 7 — a voice per bot (voice/botvoice.ts): the voice a bot speaks with in calls, chosen in its settings from
 * a speech provider's voices (Fish Audio's library by the voice's public id, or the self-hosted Kokoro by voice name).
 * Additive only: one new table. A bot without a row speaks with the account's default voice (Settings → Voice),
 * exactly as before; the previous version of the code ignores the table.
 *
 * - bot_voices: one row per bot. `provider` ('fish' | 'kokoro'); `voice_id` (Fish Audio's model `_id`, sent as
 *   `reference_id`; or a Kokoro voice such as 'ff_siwis', or a weighted mix); `name` / `author` (shown in the app, as
 *   the provider listed them); `language` (optional BCP-47 tag of what the bot speaks, "" = the bot's own setting).
 */
export function botVoices(db: DatabaseSync): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS bot_voices (
    bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, provider TEXT NOT NULL, voice_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
  );`);
}
