import { workspaceOf } from "./computer.js";
import { q } from "./db.js";
import { linuxExec } from "./linux.js";
import { meetingInput } from "./meetings.js";
import { clip, type BotRecord } from "./store.js";
import { sttCost, sttFor } from "./voice/providers.js";
import { wavOf } from "./voice/vad.js";

/**
 * Telegram voice notes, optionally written out (owner setting per bot, OFF by default). When on, a voice note received
 * on Telegram is decoded on the bot's own computer (ffmpeg, the same locked-down decoder as meeting_transcribe:
 * meetings.ts, only the bot's uploads/ folder, no network demuxer) to 16 kHz mono, then sent to the account's configured
 * speech-to-text (voice/providers.ts sttFor). The bot then gets the text with the recording still attached.
 *
 * Cost: whatever that speech-to-text costs — nothing with the whisper.cpp bundled with the server or a free server of
 * the owner's; per minute with OpenAI (a key) or Fish Audio. The setting shows which one runs (sttCost).
 * Any failure (no computer, no speech-to-text, silence, timeout) leaves the message exactly as before: "(voice message)".
 * Only the first two minutes are written out (the decoder's window).
 */
q.run(`CREATE TABLE IF NOT EXISTS telegram_voice_text (
  bot_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
)`);

export const VOICE_TEXT_MAX_SECONDS = 120;

export const telegramVoiceText = {
  enabled(botId: string): boolean {
    return q.get<{ enabled: number }>("SELECT enabled FROM telegram_voice_text WHERE bot_id = ?", botId)?.enabled === 1;
  },
  set(botId: string, on: boolean) {
    q.run("INSERT INTO telegram_voice_text (bot_id, enabled, updated_at) VALUES (?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at", botId, on ? 1 : 0, Date.now());
  },
  view(bot: BotRecord) {
    return { enabled: telegramVoiceText.enabled(bot.id), ...sttCost(bot.userId), maxSeconds: VOICE_TEXT_MAX_SECONDS };
  },
};

/** Test seam: the decoder and the speech-to-text can be replaced. */
export const voiceTextDeps = {
  decode: async (bot: BotRecord, rel: string): Promise<Buffer | null> => {
    const input = meetingInput(rel, 0);
    const max = 16000 * 2 * VOICE_TEXT_MAX_SECONDS;
    const r = await linuxExec(bot.id, bot.userId, workspaceOf(bot.id), input.argv, 60, { binary: true, maxBytes: max + 4096 });
    if (r.code !== 0 || !r.raw.length || r.raw.length % 2) return null;
    return wavOf(new Int16Array(Uint8Array.from(r.raw.subarray(0, max)).buffer));
  },
  stt: (bot: BotRecord) => sttFor(bot.userId),
};

/**
 * The words of a voice note stored at `rel` (uploads/…), or null when the setting is off or anything fails.
 * Never throws.
 */
export async function voiceNoteText(bot: BotRecord, rel: string): Promise<string | null> {
  if (!telegramVoiceText.enabled(bot.id)) return null;
  try {
    const stt = voiceTextDeps.stt(bot);
    if (!stt) return null;
    const wav = await voiceTextDeps.decode(bot, rel);
    if (!wav) return null;
    const text = (await stt(wav, AbortSignal.timeout(45_000))).trim();
    return text ? clip(text, 4000) : null;
  } catch {
    return null;
  }
}
