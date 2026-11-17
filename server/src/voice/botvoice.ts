import { q } from "../db.js";
import type { BotVoiceChoice } from "../shared.js";
import { validVoiceId } from "./fish.js";
import { validKokoroVoice } from "./kokoro.js";

/**
 * A voice per bot (migration 7, table bot_voices): the voice a bot speaks with in calls and spoken replies, chosen in
 * its settings: from Fish Audio's library (by the voice's public id) or the self-hosted Kokoro (by its voice name). A
 * bot without one speaks with the account's default voice (Settings → Voice). Fish Audio's key stays the account's own
 * (voice/providers.ts); Kokoro needs none.
 */
interface Row { provider: BotVoiceChoice["provider"] | string; voice_id: string; name: string; author: string; language: string }

export const botVoices = {
  get(botId: string): BotVoiceChoice | null {
    const r = q.get<Row>("SELECT provider, voice_id, name, author, language FROM bot_voices WHERE bot_id = ?", botId);
    return r && (r.provider === "fish" || r.provider === "kokoro") ? { provider: r.provider, voiceId: r.voice_id, name: r.name, author: r.author, language: r.language } : null;
  },
  /** Saves (or, with null, removes) the bot's voice. Throws on an id that is not a voice id. */
  set(botId: string, v: { provider?: unknown; voiceId: string; name?: unknown; author?: unknown; language?: unknown } | null): BotVoiceChoice | null {
    if (!v) { q.run("DELETE FROM bot_voices WHERE bot_id = ?", botId); return null; }
    const provider = v.provider === "kokoro" ? "kokoro" : "fish";
    if (provider === "fish" ? !validVoiceId(v.voiceId) : !validKokoroVoice(v.voiceId)) throw new Error(provider === "fish" ? "This is not a Fish Audio voice id." : "This is not a Kokoro voice.");
    const text = (x: unknown, max: number) => (typeof x === "string" ? x.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
    const lang = text(v.language, 16);
    q.run(
      "INSERT INTO bot_voices (bot_id, provider, voice_id, name, author, language, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET provider = excluded.provider, voice_id = excluded.voice_id, name = excluded.name, author = excluded.author, language = excluded.language, updated_at = excluded.updated_at",
      botId, provider, v.voiceId, text(v.name, 120), text(v.author, 80), /^[A-Za-z0-9_-]*$/.test(lang) ? lang : "", Date.now(),
    );
    return botVoices.get(botId);
  },
};
