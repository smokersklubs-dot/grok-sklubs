import { storeBytes } from "../computer.js";
import type { ToolSpec } from "../llm/types.js";
import { speechParts, speechText } from "../speechtext.js";
import { bots, clip, rows, users } from "../store.js";
import type { BuiltinTool } from "../agent/tools.js";
import { ttsFor, voiceSettings } from "./providers.js";

/**
 * L154 « note vocale envoyée par le bot » (backlog A-FAIRE): the bot says a short message in its own voice and posts it in
 * the chat as an audio file the owner plays there (web Transcript: an audio player under the message). Same voice and same
 * payer as « Écouter les réponses » (speak.ts): the owner's own speech service with the bot's voice (providers.ttsFor).
 * The text is cleaned for speech first (speechtext.ts) and cut in parts; WAV parts are joined into one recording, MP3
 * parts are concatenated (frames play one after the other). Nothing is sent outside the chat.
 */
export const VOICE_NOTE_MAX_CHARS = 1500;

/** The PCM data and format of a plain WAV (null when it is not one). */
function wavParts(b: Buffer): { fmt: Buffer; data: Buffer } | null {
  if (b.length < 44 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") return null;
  let at = 12, fmt: Buffer | null = null, data: Buffer | null = null;
  while (at + 8 <= b.length) {
    const id = b.toString("ascii", at, at + 4);
    const size = b.readUInt32LE(at + 4);
    const body = b.subarray(at + 8, Math.min(b.length, at + 8 + size));
    if (id === "fmt ") fmt = Buffer.from(body);
    if (id === "data") data = Buffer.from(body);
    at += 8 + size + (size % 2);
  }
  return fmt && data ? { fmt, data } : null;
}

/** Several synthesized parts as one recording, or null when they cannot be joined (different formats). */
export function joinAudio(parts: Buffer[]): { bytes: Buffer; ext: "wav" | "mp3" } | null {
  if (!parts.length) return null;
  const wavs = parts.map(wavParts);
  if (wavs.every((w) => w)) {
    const fmt = wavs[0]!.fmt;
    if (!wavs.every((w) => w!.fmt.equals(fmt))) return null;
    const data = Buffer.concat(wavs.map((w) => w!.data));
    const head = Buffer.alloc(20);
    head.write("RIFF", 0); head.writeUInt32LE(4 + 8 + fmt.length + 8 + data.length, 4); head.write("WAVE", 8); head.write("fmt ", 12); head.writeUInt32LE(fmt.length, 16);
    const dh = Buffer.alloc(8); dh.write("data", 0); dh.writeUInt32LE(data.length, 4);
    return { bytes: Buffer.concat([head, fmt, dh, data]), ext: "wav" };
  }
  const mp3 = (b: Buffer) => b.toString("latin1", 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
  if (parts.every(mp3)) return { bytes: Buffer.concat(parts), ext: "mp3" };
  return parts.length === 1 ? { bytes: parts[0], ext: "wav" } : null;
}

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });

export const voiceNoteTools: BuiltinTool[] = [{
  spec: {
    name: "voice_note_send",
    description: `Send the user a short voice note in your own voice, in the chat (an audio message they play there). Use it when they ask for a voice message or audio. At most ${VOICE_NOTE_MAX_CHARS} characters; write it as you would say it.`,
    inputSchema: obj({ text: { type: "string", description: "What to say, as spoken words" }, caption: { type: "string", description: "Optional short line shown with the audio" } }, ["text"]),
  },
  group: "files", activity: "saving", label: "Recording a voice note",
  run: async (a, c) => {
    const text = String(a.text ?? "").trim();
    if (!text) return { isError: true, content: "Write what to say first." };
    if (text.length > VOICE_NOTE_MAX_CHARS) return { isError: true, content: `A voice note is ${VOICE_NOTE_MAX_CHARS} characters at most: make it shorter, or write the long part in the chat.` };
    const owner = c.bot.userId;
    const tts = voiceSettings(owner).mode === "browser" ? null : ttsFor(owner, { botId: c.bot.id });
    if (!tts) return { isError: true, content: "No speech service is set up on this server (Settings → Voice): a voice note cannot be recorded. Tell the user, or write the message instead." };
    const lang = c.bot.voice.lang && c.bot.voice.lang !== "auto" ? c.bot.voice.lang : users.localeOf(owner);
    const parts = speechParts(speechText(text, lang));
    if (!parts.length) return { isError: true, content: "There is nothing to say in this text (only code or links)." };
    const audio: Buffer[] = [];
    try {
      for (const p of parts) { const b = await tts(p, AbortSignal.any([c.signal, AbortSignal.timeout(30_000)])); if (b.length) audio.push(b); }
    } catch (err) { return { isError: true, content: `The voice service did not answer: ${clip((err as Error).message, 200)}. Try again in a moment or write the message.` }; }
    const joined = joinAudio(audio);
    if (!joined) return { isError: true, content: "The voice service sent parts that cannot be joined into one recording. Send a shorter note." };
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const att = storeBytes(c.bot.id, "audio", `note-vocale-${stamp}.${joined.ext}`, joined.bytes);
    rows.append(c.bot, { kind: "message", role: "assistant", text: typeof a.caption === "string" ? clip(a.caption, 300) : "", attachments: [att] });
    bots.bumpUnread(c.bot.id);
    return { content: "The voice note is in the chat now; the user can play it there.", summary: att.name };
  },
}];
