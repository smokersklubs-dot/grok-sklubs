import type { FishVoice } from "./shared.js";

/** Wire types of the bots' voices (re-exported by shared.ts, so the app sees them too). */

/**
 * One free voice of the bundled Piper (voice/piper.ts): `id` = "<model>" or "<model>#<speaker id>"; `speaker` -1 for a
 * single-speaker model; `f0` the measured median pitch (Hz).
 */
export interface PiperVoiceInfo { id: string; model: string; speaker: number; name: string; gender: "female" | "male"; language: string; licence: string; f0: number }
/**
 * A bot's voice as Settings → Voice lists it (GET /voice/bots): its own choice, or the free voice given automatically
 * (voice/autovoice.ts) — `auto` true —, or the account's default voice (`provider` the account's, `voiceId` "").
 */
export interface BotVoiceRow { botId: string; name: string; provider: string; voiceId: string; voiceName: string; auto: boolean; gender: "female" | "male" | ""; licence: string }
/** "Give a Fish Audio voice to all my bots": one proposal per bot (nothing is saved or spent before the owner confirms). */
export interface FishBulkProposal { botId: string; botName: string; voice: FishVoice }
