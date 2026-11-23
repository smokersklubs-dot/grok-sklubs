import { seal, unseal } from "./auth.js";
import { q } from "./db.js";
import { operatorKeysAllowed } from "./hosted.js";
import { imageService, type ImageService } from "./images.js";
import { audit, now } from "./store.js";
import { videoService, videoServices, type VideoService } from "./video.js";

/**
 * Audit Open Generative AI §3.7 / §5 item 6 — the account's OWN keys for picture and video providers.
 *
 * Before: video.ts and images.ts read only the server's environment (the operator's keys); a hosted account on a
 * "bring your own key" plan had no native video or picture at all. Now each account can enter its own key in
 * Settings → Keys → « Création (images et vidéos) »:
 *  - xai (Grok Imagine video), gemini (Gemini Omni Flash video): a key; the API addresses are the official ones (video.ts);
 *  - image: a key for any service that speaks the common images/generations request, with its address and model;
 *  - wan2gp: no key — the owner's own GPU, through their Sklubot Relais on their PC, or a Wan2GP server address they type
 *    (self-hosted Sklubot only: a hosted server never reaches a private network for an account). See wan2gp.ts.
 *
 * Rules (same as model provider keys, providerkeys.ts):
 *  - sealed like every *_enc column (auth.ts seal; the data-key rotation finds `key_enc` by itself), never sent back to the
 *    browser (only "a key is saved"), never shown to a bot;
 *  - every query is by user id: a key is used only for the account that typed it. An operator's own keys are never used
 *    for another account;
 *  - an account's own key comes first; the server's keys (env) follow only when this account may use them
 *    (hosted.ts operatorKeysAllowed: never on a "byok" plan; the plan's budget is checked when the call is reserved).
 *    A call on the account's own key is never metered against the operator's budget (thirdparty.ts reserve `ownKey`).
 */
q.run(`CREATE TABLE IF NOT EXISTS media_keys (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL,
  key_enc TEXT, base_url TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', device_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, provider))`);

export const MEDIA_PROVIDERS = ["xai", "gemini", "image", "wan2gp"] as const;
export type MediaProvider = (typeof MEDIA_PROVIDERS)[number];
export const isMediaProvider = (v: unknown): v is MediaProvider => typeof v === "string" && (MEDIA_PROVIDERS as readonly string[]).includes(v);

/** What the owner sees: never the key itself. */
export interface MediaKeyView { provider: MediaProvider; hasKey: boolean; baseUrl: string; model: string; deviceId: string; updatedAt: number }
export class MediaKeyError extends Error { constructor(public status: 400 | 404, message: string) { super(message); } }

interface Row { user_id: string; provider: string; key_enc: string | null; base_url: string; model: string; device_id: string; created_at: number; updated_at: number }
const rowOf = (userId: string, provider: MediaProvider) => q.get<Row>("SELECT * FROM media_keys WHERE user_id = ? AND provider = ?", userId, provider) ?? null;
const view = (r: Row): MediaKeyView => ({ provider: r.provider as MediaProvider, hasKey: !!r.key_enc, baseUrl: r.base_url, model: r.model, deviceId: r.device_id, updatedAt: r.updated_at });
const LABEL: Record<MediaProvider, string> = { xai: "xAI", gemini: "Google Gemini", image: "Images", wan2gp: "Wan2GP" };

const cleanKey = (raw: unknown) => (typeof raw === "string" ? raw.trim() : "");
const cleanModel = (raw: unknown) => (typeof raw === "string" ? raw.trim().slice(0, 80) : "");
function cleanUrl(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim().replace(/\/+$/, "") : "";
  if (!s) return "";
  let u: URL;
  try { u = new URL(s); } catch { throw new MediaKeyError(400, "Give the full address (https://…)."); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new MediaKeyError(400, "Give the full address (https://…).");
  if (u.username || u.password) throw new MediaKeyError(400, "The address must not contain a user name or a password.");
  return u.toString().replace(/\/+$/, "");
}

export const mediaKeys = {
  list(userId: string): MediaKeyView[] {
    return q.all<Row>("SELECT * FROM media_keys WHERE user_id = ? ORDER BY provider", userId).map(view);
  },
  /**
   * Saves (or updates) one provider. An empty key keeps the saved one (editing the model or the address). The Wan2GP
   * address and device are checked by wan2gp.ts (wan2gpTarget) before they are saved here.
   */
  set(userId: string, provider: MediaProvider, input: { key?: unknown; baseUrl?: unknown; model?: unknown; deviceId?: unknown }): MediaKeyView {
    const prev = rowOf(userId, provider);
    const key = cleanKey(input.key);
    if (key && (key.length > 500 || /\s/.test(key))) throw new MediaKeyError(400, "Paste the API key (no spaces).");
    if (provider !== "wan2gp" && !key && !prev?.key_enc) throw new MediaKeyError(400, "Paste the API key (no spaces).");
    const baseUrl = provider === "image" || provider === "wan2gp" ? cleanUrl(input.baseUrl) : "";
    const deviceId = provider === "wan2gp" && typeof input.deviceId === "string" ? input.deviceId.trim().slice(0, 64) : "";
    if (provider === "wan2gp" && !baseUrl && !deviceId) throw new MediaKeyError(400, "Choose your computer (Relais) or type the address of your Wan2GP server.");
    const enc = provider === "wan2gp" ? null : key ? seal(key) : prev!.key_enc;
    const t = now();
    q.run(`INSERT INTO media_keys (user_id, provider, key_enc, base_url, model, device_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, provider) DO UPDATE SET key_enc = excluded.key_enc, base_url = excluded.base_url, model = excluded.model, device_id = excluded.device_id, updated_at = excluded.updated_at`,
      userId, provider, enc, baseUrl, cleanModel(input.model), deviceId, prev?.created_at ?? t, t);
    // The journal names the provider, never the key.
    audit(userId, "apps", `${prev ? "Updated" : "Added"} own media key: ${LABEL[provider]}`);
    return view(rowOf(userId, provider)!);
  },
  remove(userId: string, provider: MediaProvider): boolean {
    const done = q.run("DELETE FROM media_keys WHERE user_id = ? AND provider = ?", userId, provider).changes > 0;
    if (done) audit(userId, "apps", `Removed own media key: ${LABEL[provider]}`);
    return done;
  },
  /** The unsealed key and settings, for the server's own calls only (never returned by a route or shown to a bot). */
  secret(userId: string, provider: MediaProvider): { key: string; baseUrl: string; model: string; deviceId: string } | null {
    const r = rowOf(userId, provider);
    if (!r) return null;
    const key = r.key_enc ? unseal(r.key_enc) ?? "" : "";
    if (provider !== "wan2gp" && !key) return null;
    return { key, baseUrl: r.base_url, model: r.model, deviceId: r.device_id };
  },
};

/** The account's own video services, in order (xAI first, like the server's own chain). */
export function ownVideoServices(userId: string): VideoService[] {
  const e = process.env;
  const out: VideoService[] = [];
  const x = mediaKeys.secret(userId, "xai");
  if (x) out.push({ id: "xai", label: "xAI", model: x.model || e.XAI_VIDEO_MODEL || "grok-imagine-video-1.5", baseUrl: (e.XAI_BASE_URL || "https://api.x.ai/v1").replace(/\/$/, ""), apiKey: x.key, ownKey: true });
  const g = mediaKeys.secret(userId, "gemini");
  if (g) out.push({ id: "gemini", label: "Google Gemini", model: g.model || e.GEMINI_VIDEO_MODEL || "gemini-omni-1.2-flash", baseUrl: (e.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, ""), apiKey: g.key, ownKey: true });
  return out;
}

/** The paid video services for this account: its own keys first, then the server's when this account may use them. */
export function videoServicesFor(userId: string): VideoService[] {
  const own = ownVideoServices(userId);
  const server = operatorKeysAllowed(userId) ? videoServices() : [];
  // The server's demo clip stands alone (tests and demos); otherwise own keys come first, no provider twice.
  if (server[0]?.id === "demo" && !own.length) return server;
  return [...own, ...server.filter((s) => s.id !== "demo" && !own.some((o) => o.id === s.id))];
}

/** Whether this account has any paid video API (its own or the server's). */
export const anyVideoApi = (userId: string) => videoServicesFor(userId).length > 0 || (operatorKeysAllowed(userId) && !!videoService());

/** The picture service for this account: its own key first, else the server's when this account may use it. */
export function imageServiceFor(userId: string | undefined): ImageService | null {
  if (userId) {
    const own = mediaKeys.secret(userId, "image");
    if (own) return { baseUrl: own.baseUrl || "https://api.openai.com/v1", apiKey: own.key, model: own.model || "gpt-image-1", ownKey: true };
    if (!operatorKeysAllowed(userId)) return null;
  }
  return imageService();
}
