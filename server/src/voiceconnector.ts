import { randomUUID } from "node:crypto";
import { storeBytes } from "./computer.js";

/** VoiceStudio's default generate_speech response includes a base64 WAV.
 * Store it with the requesting bot before the generic MCP text excerpt is made.
 * In files mode the upstream returns an audio URL instead, so keep its usual result. */
export function saveVoiceResult(botId: string, input: string) {
  let data: unknown;
  try { data = JSON.parse(input); } catch { return null; }
  if (!data || typeof data !== "object" || !("wav_base64" in data)) return null;
  const encoded = data.wav_base64;
  if (typeof encoded !== "string" || !encoded || encoded.length > 32 * 1024 * 1024) {
    return { text: "VoiceStudio returned an empty or oversized recording. Split the script or use its files output mode.", isError: true };
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    return { text: "VoiceStudio returned an invalid WAV recording.", isError: true };
  }
  const saved = storeBytes(botId, "audio", "voice-" + randomUUID() + ".wav", bytes);
  return { text: JSON.stringify({ path: saved.path, mime: saved.mime, bytes: saved.size, next: "Use file_send to deliver the audio in chat. For a requested video, use this path as the studio project's audio track." }), isError: false };
}
