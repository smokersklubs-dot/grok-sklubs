import sharp from "sharp";
import { q } from "./db.js";
import { now } from "./store.js";

/**
 * L161 « Avatar photo » (Timon T54, Hermes row 12, OpenMausBot « avatar en image »; our own code): the owner gives a bot a
 * photo or a picture instead of its drawn character. The picture is decoded, turned upright, cropped to a square and
 * resized to 256 × 256 WebP with sharp (node_modules/sharp/lib/index.d.ts: rotate(), resize({ fit: "cover" }), webp());
 * re-encoding drops every metadata (place, camera, date). It is served by Sklubot itself (never an outside address) to
 * the bot's owner only. It is a picture and nothing else: it is never sent to a model, never used to make a face, a voice
 * or a video, and removing it brings the drawn character back.
 */
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTO_SIZE = 256;
const FORMATS = new Set(["jpeg", "png", "webp", "gif", "heif", "avif"]);

q.run("CREATE TABLE IF NOT EXISTS bot_photo (bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, user_id TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL)");

export class PhotoError extends Error { constructor(public status: 400 | 413, message: string) { super(message); } }

export async function photoFrom(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length) throw new PhotoError(400, "Choose a picture.");
  if (bytes.length > PHOTO_MAX_BYTES) throw new PhotoError(413, "This picture is too large (8 MB at most).");
  let meta: { format?: string };
  try { meta = await sharp(bytes, { failOn: "error", limitInputPixels: 50_000_000 }).metadata(); } catch { throw new PhotoError(400, "This file is not a picture Sklubot can read (JPEG, PNG or WebP)."); }
  if (!meta.format || !FORMATS.has(meta.format)) throw new PhotoError(400, "This file is not a picture Sklubot can read (JPEG, PNG or WebP).");
  try {
    return await sharp(bytes, { failOn: "error", limitInputPixels: 50_000_000, animated: false }).rotate().resize(PHOTO_SIZE, PHOTO_SIZE, { fit: "cover", position: "attention" }).webp({ quality: 85 }).toBuffer();
  } catch { throw new PhotoError(400, "This file is not a picture Sklubot can read (JPEG, PNG or WebP)."); }
}

export const botPhotos = {
  async set(userId: string, botId: string, bytes: Buffer) {
    const out = await photoFrom(bytes);
    const v = now();
    q.run("INSERT INTO bot_photo (bot_id, user_id, data, version) VALUES (?, ?, ?, ?) ON CONFLICT (bot_id) DO UPDATE SET data = excluded.data, version = excluded.version", botId, userId, out.toString("base64"), v);
    return { url: botPhotos.url(botId, v), bytes: out.length };
  },
  get(botId: string): Buffer | null { const r = q.get<{ data: string }>("SELECT data FROM bot_photo WHERE bot_id = ?", botId); return r ? Buffer.from(r.data, "base64") : null; },
  remove: (botId: string) => q.run("DELETE FROM bot_photo WHERE bot_id = ?", botId).changes > 0,
  url: (botId: string, v: number) => `/api/bots/${encodeURIComponent(botId)}/photo?v=${v}`,
  /** Every photo of the account's bots: { botId: address }. */
  all(userId: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of q.all<{ bot_id: string; version: number }>("SELECT p.bot_id, p.version FROM bot_photo p JOIN bots b ON b.id = p.bot_id WHERE b.user_id = ?", userId)) out[r.bot_id] = botPhotos.url(r.bot_id, r.version);
    return out;
  },
};
