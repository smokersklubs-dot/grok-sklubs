import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { guardedFetch } from "./net.js";
import { labelAiVideo } from "./aivideo.js";

/**
 * Short video generation through a video API, chosen with environment variables (keys come from the
 * environment only). Every provider here was checked against its vendor's own documentation:
 *
 * - xAI — POST {base}/videos/generations returns a request_id; GET {base}/videos/{request_id} reports
 *   status "pending" | "done" | "failed", progress 0-100, video.url (temporary) and usage.cost_in_usd_ticks
 *   (1 USD = 10,000,000,000 ticks). Body: model, prompt, duration (1-15 s), aspect_ratio, resolution, image.url
 *   (a public URL or a base64 data URL).
 *   https://docs.x.ai/developers/model-capabilities/video/generation
 *   https://docs.x.ai/developers/rest-api-reference/inference/videos
 *   https://docs.x.ai/developers/model-capabilities/video/image-to-video
 * - Google Gemini API (Gemini Omni Flash) — POST {base}/v1beta/interactions with the x-goog-api-key header and
 *   { model, input, response_format: { type: "video", aspect_ratio "16:9"|"9:16", duration "3s".."15s", delivery: "uri" } };
 *   the video comes back in steps[type=model_output].content[type=video] as base64 `data` or a `uri`; with a uri,
 *   GET {base}/v1beta/files/{id} until state is ACTIVE (or FAILED), then download the uri. Reference images are
 *   { type: "image", data, mime_type } parts of `input`. The documented responses carry no price.
 *   https://aistudio.google.com/docs/omni (and https://aistudio.google.com/docs/video)
 *
 * OpenAI's Videos API (Sora) is not offered: its guide says it was shut down on 24 September 2026
 * (https://developers.openai.com/api/docs/guides/video-generation). Veo 3.1 preview in the Gemini API was shut down
 * on 22 October 2026 (https://aistudio.google.com/docs/video), hence Gemini Omni Flash.
 *
 * Settings: VIDEO_PROVIDER = xai | gemini | off (default: whichever has a key, xAI first); XAI_API_KEY or
 * VIDEO_XAI_API_KEY, XAI_VIDEO_MODEL (grok-imagine-video-1.5); GEMINI_API_KEY, GEMINI_VIDEO_MODEL
 * (gemini-omni-1.2-flash). DEMO_MODE=1 with VIDEO_PROVIDER=demo makes a test clip locally (needs ffmpeg).
 */
export type VideoProviderId = "xai" | "gemini" | "demo";
export interface VideoService { id: VideoProviderId; label: string; model: string; baseUrl: string; apiKey: string }

export function videoService(): VideoService | null {
  const e = process.env;
  const want = (e.VIDEO_PROVIDER ?? "").trim().toLowerCase();
  if (want === "off" || want === "none") return null;
  const xaiKey = e.VIDEO_XAI_API_KEY || e.XAI_API_KEY;
  const xai = (): VideoService | null => (xaiKey ? { id: "xai", label: "xAI", model: e.XAI_VIDEO_MODEL || "grok-imagine-video-1.5", baseUrl: (e.XAI_BASE_URL || "https://api.x.ai/v1").replace(/\/$/, ""), apiKey: xaiKey } : null);
  const gemini = (): VideoService | null => (e.GEMINI_API_KEY ? { id: "gemini", label: "Google Gemini", model: e.GEMINI_VIDEO_MODEL || "gemini-omni-1.2-flash", baseUrl: (e.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, ""), apiKey: e.GEMINI_API_KEY } : null);
  if (want === "demo") return e.DEMO_MODE === "1" ? { id: "demo", label: "Demo", model: "demo-video", baseUrl: "", apiKey: "" } : null;
  if (want === "xai") return xai();
  if (want === "gemini") return gemini();
  return xai() ?? gemini();
}

export interface VideoRequest {
  prompt: string;
  /** Seconds; each provider's own range applies. */
  duration?: number;
  aspect?: "16:9" | "9:16" | "1:1";
  /** A picture from the bot's library to start from. */
  image?: { mime: string; data: Buffer };
  signal?: AbortSignal;
  /** Called while the job runs: a percentage when the service reports one. */
  onProgress?: (pct: number | null) => void;
}
export interface VideoResult { bytes: Buffer; mime: string; model: string; provider: VideoProviderId; costUsd: number | null }

const MAX_BYTES = 200_000_000;

/** Waits, but gives up at once when the turn is stopped. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
    const stop = () => { clearTimeout(timer); reject(new Error("aborted")); };
    signal?.addEventListener("abort", stop, { once: true });
  });
}
/** Polite polling: every 5 s for the first minute, then every 10 s. */
const pollDelay = (startedAt: number) => Number(process.env.VIDEO_POLL_MS) || (Date.now() - startedAt < 60_000 ? 5000 : 10_000);
const POLL_LIMIT_MS = 20 * 60_000;
const short = async (res: Response) => (await res.text().catch(() => "")).slice(0, 300);

async function download(url: string, signal: AbortSignal | undefined, headers: Record<string, string> = {}): Promise<Buffer> {
  // The address comes from the service's answer: fetched like any outside address, never into the local network.
  const res = await guardedFetch(url, { headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`could not download the video (${res.status})`);
  const size = Number(res.headers.get("content-length") ?? 0);
  if (size > MAX_BYTES) throw new Error("the video is too large to keep");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("the video is too large to keep");
  return bytes;
}

async function viaXai(svc: VideoService, r: VideoRequest): Promise<VideoResult> {
  const auth = { authorization: `Bearer ${svc.apiKey}` };
  const body: Record<string, unknown> = { model: svc.model, prompt: r.prompt };
  if (r.duration) body.duration = Math.min(15, Math.max(1, Math.round(r.duration)));
  if (r.aspect) body.aspect_ratio = r.aspect;
  if (r.image) body.image = { url: `data:${r.image.mime};base64,${r.image.data.toString("base64")}` };
  const start = await fetch(`${svc.baseUrl}/videos/generations`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body), signal: r.signal ? AbortSignal.any([r.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) });
  if (!start.ok) throw new Error(`xAI answered ${start.status}: ${await short(start)}`);
  const id = ((await start.json()) as { request_id?: string }).request_id;
  if (!id) throw new Error("xAI did not return a request id");
  const began = Date.now();
  r.onProgress?.(0);
  while (Date.now() - began < POLL_LIMIT_MS) {
    await wait(pollDelay(began), r.signal);
    const res = await fetch(`${svc.baseUrl}/videos/${encodeURIComponent(id)}`, { headers: auth, signal: r.signal ? AbortSignal.any([r.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
    if (res.status >= 500 || res.status === 429) continue; // a hiccup: ask again at the next tick
    if (!res.ok) throw new Error(`xAI answered ${res.status}: ${await short(res)}`);
    const j = (await res.json()) as { status?: string; progress?: number | null; video?: { url?: string }; error?: { message?: string }; model?: string; usage?: { cost_in_usd_ticks?: number } };
    if (j.status === "failed") throw new Error(`xAI could not make the video: ${j.error?.message ?? "no detail"}`);
    if (j.status === "done") {
      if (!j.video?.url) throw new Error("xAI finished but sent no video address");
      r.onProgress?.(100);
      const ticks = j.usage?.cost_in_usd_ticks;
      return { bytes: await download(j.video.url, r.signal), mime: "video/mp4", model: j.model ?? svc.model, provider: "xai", costUsd: typeof ticks === "number" ? ticks / 10_000_000_000 : null };
    }
    r.onProgress?.(typeof j.progress === "number" ? j.progress : null);
  }
  throw new Error("the video took too long; xAI may still finish it, but I stopped waiting");
}

async function viaGemini(svc: VideoService, r: VideoRequest): Promise<VideoResult> {
  const key = { "x-goog-api-key": svc.apiKey };
  const format: Record<string, unknown> = { type: "video", delivery: "uri" };
  if (r.aspect === "16:9" || r.aspect === "9:16") format.aspect_ratio = r.aspect;
  if (r.duration) format.duration = `${Math.min(15, Math.max(3, Math.round(r.duration)))}s`;
  const input = r.image ? [{ type: "image", data: r.image.data.toString("base64"), mime_type: r.image.mime }, { type: "text", text: r.prompt }] : r.prompt;
  r.onProgress?.(null);
  // The documented call answers once the video is made, so it may take minutes.
  const res = await fetch(`${svc.baseUrl}/v1beta/interactions`, { method: "POST", headers: { ...key, "content-type": "application/json" }, body: JSON.stringify({ model: svc.model, input, response_format: format }), signal: r.signal ? AbortSignal.any([r.signal, AbortSignal.timeout(POLL_LIMIT_MS)]) : AbortSignal.timeout(POLL_LIMIT_MS) });
  if (!res.ok) throw new Error(`Gemini answered ${res.status}: ${await short(res)}`);
  const j = (await res.json()) as { status?: string; model?: string; steps?: { type?: string; content?: { type?: string; mime_type?: string; data?: string; uri?: string }[] }[] };
  const video = (j.steps ?? []).filter((s) => s.type === "model_output").flatMap((s) => s.content ?? []).find((c) => c.type === "video");
  if (!video) throw new Error(`Gemini returned no video (status ${j.status ?? "unknown"})`);
  const mime = video.mime_type || "video/mp4";
  if (video.data) return { bytes: Buffer.from(video.data, "base64"), mime, model: j.model ?? svc.model, provider: "gemini", costUsd: null };
  if (!video.uri) throw new Error("Gemini returned an empty video");
  const fileId = /files\/([A-Za-z0-9_-]+)/.exec(video.uri)?.[1];
  if (fileId) {
    const began = Date.now();
    for (;;) {
      const f = await fetch(`${svc.baseUrl}/v1beta/files/${fileId}`, { headers: key, signal: r.signal ? AbortSignal.any([r.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
      const state = f.ok ? ((await f.json()) as { state?: string }).state : undefined;
      if (state === "ACTIVE") break;
      if (state === "FAILED") throw new Error("Gemini could not finish the video");
      if (Date.now() - began > POLL_LIMIT_MS) throw new Error("the video took too long to be ready");
      await wait(pollDelay(began), r.signal);
    }
  }
  // The key goes only to the API's own address, never to wherever a link points.
  const sameHost = new URL(video.uri, svc.baseUrl).host === new URL(svc.baseUrl).host;
  return { bytes: await download(new URL(video.uri, svc.baseUrl).toString(), r.signal, sameHost ? key : {}), mime, model: j.model ?? svc.model, provider: "gemini", costUsd: null };
}

/** Demo mode only: a few seconds of a test pattern made locally with ffmpeg. Costs nothing. */
async function viaDemo(r: VideoRequest): Promise<VideoResult> {
  const dir = mkdtempSync(path.join(tmpdir(), "sklubot-video-"));
  try {
    for (const pct of [10, 35, 60, 85]) { r.onProgress?.(pct); await wait(400, r.signal); }
    const [w, h] = r.aspect === "9:16" ? [360, 640] : r.aspect === "1:1" ? [480, 480] : [640, 360];
    const seconds = Math.min(6, Math.max(2, Math.round(r.duration ?? 4)));
    const out = path.join(dir, "demo.mp4");
    await new Promise<void>((resolve, reject) => execFile("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `testsrc2=size=${w}x${h}:rate=24:duration=${seconds}`, "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", out], { timeout: 60_000 }, (err) => (err ? reject(new Error("the demo video needs ffmpeg on the server")) : resolve())));
    r.onProgress?.(100);
    return { bytes: readFileSync(out), mime: "video/mp4", model: "demo-video", provider: "demo", costUsd: null };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/**
 * Wave 7 (spec 08 A3): every configured video API, in the order the provider chain tries them (the preferred one first,
 * as videoService() picks it, then the others). Prices: none is documented in the responses we use before the call, so
 * an estimate comes only from VIDEO_PRICE_USD (per video, set by the admin); otherwise the price is unknown and the
 * user is asked.
 */
export function videoServices(): VideoService[] {
  const first = videoService();
  if (!first) return [];
  if (first.id === "demo") return [first];
  const e = process.env;
  const want = (e.VIDEO_PROVIDER ?? "").trim().toLowerCase();
  if (want === "xai" || want === "gemini") return [first];
  const others: VideoService[] = [];
  const xaiKey = e.VIDEO_XAI_API_KEY || e.XAI_API_KEY;
  if (first.id !== "xai" && xaiKey) others.push({ id: "xai", label: "xAI", model: e.XAI_VIDEO_MODEL || "grok-imagine-video-1.5", baseUrl: (e.XAI_BASE_URL || "https://api.x.ai/v1").replace(/\/$/, ""), apiKey: xaiKey });
  if (first.id !== "gemini" && e.GEMINI_API_KEY) others.push({ id: "gemini", label: "Google Gemini", model: e.GEMINI_VIDEO_MODEL || "gemini-omni-1.2-flash", baseUrl: (e.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, ""), apiKey: e.GEMINI_API_KEY });
  return [first, ...others];
}
export const videoPriceEstimate = (): number | null => { const v = Number(process.env.VIDEO_PRICE_USD); return Number.isFinite(v) && v > 0 ? v : null; };

export async function generateVideo(r: VideoRequest, via?: VideoService): Promise<VideoResult> {
  const svc = via ?? videoService();
  if (!svc) throw new Error("no video service is configured on this server");
  const v = svc.id === "xai" ? await viaXai(svc, r) : svc.id === "gemini" ? await viaGemini(svc, r) : await viaDemo(r);
  // L30: the IPTC "generated by AI" marker in the MP4's metadata (aivideo.ts); other formats come back unchanged.
  return { ...v, bytes: labelAiVideo(v.bytes, v.mime) };
}
