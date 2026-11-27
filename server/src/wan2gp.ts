/*
 * Portions adapted from Anil-matcha/Open-Generative-AI (https://github.com/Anil-matcha/Open-Generative-AI,
 * commit 6f726e6539b06bb2f4288f20480c116e7173a06d), Copyright (c) 2026 Open Generative AI Contributors, MIT License:
 * electron/lib/wan2gpMcp.js (MCP client: initialize, Streamable HTTP RPC, SSE answer parsing, phase → progress, gallery
 * upload/download, submit-and-poll), electron/lib/wan2gpCatalog.js (model catalogue, resolutions, settings builder) and
 * electron/lib/wan2gpModelAvailability.js (availability wording).
 * Modified for Sklubot: TypeScript; the transport is injected (a Wan2GP server address the owner typed, or the owner's
 * own PC through the Sklubot Relais, wan2gprelay.ts); polling split from submission so a run is resumed by its job id
 * after a restart (mediajobs.ts); an AbortSignal cancels the wait; same-origin check on the transfer addresses; the
 * client name is Sklubot's; image models kept, the catalogue only lists open-weight models Wan2GP serves itself.
 *
 * Wan2GP (https://github.com/deepbeepmeep/Wan2GP) is NOT bundled: the owner installs it on a machine with a GPU they
 * control and starts its MCP server (Wan2GP docs/API.md, "MCP Server"):
 *   python wgp.py --mcp --mcp-api-version 1 --mcp-transport streamable-http --mcp-host 127.0.0.1 --mcp-port 7866
 * Its Gradio web page is not an API. Tools used (names from Open Generative AI's client, which follows that doc):
 * wangp_generate, wangp_get_job, wangp_cancel_job, wangp_get_model_availability, wangp_create_gallery_upload,
 * wangp_create_gallery_download. MCP protocol version 2025-06-18 (https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).
 */

export const PROTOCOL_VERSION = "2025-06-18";
export const DEFAULT_WAN2GP_PORT = 7866;
const POLL_INTERVAL_MS = 2000;

/** The fetch the client uses: real fetch for an address, the Relais for the owner's PC. */
export type FetchLike = (url: string, init: { method: string; headers?: Record<string, string>; body?: Buffer | string; signal?: AbortSignal }) => Promise<Response>;

export function normalizeMcpUrl(url: string): string {
  const trimmed = (url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /\/mcp$/.test(trimmed) ? trimmed : `${trimmed}/mcp`;
}

interface RpcMessage { id?: number; result?: any; error?: { message?: string } }
function parseRpcResponse(text: string, contentType: string | null, id: number | undefined): RpcMessage | null {
  if ((contentType || "").includes("text/event-stream")) {
    const messages = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean).map((d) => JSON.parse(d) as RpcMessage);
    return messages.find((m) => m.id === id) || null;
  }
  return text ? (JSON.parse(text) as RpcMessage) : null;
}

/** WanGP phase names (its shared/api.py `_normalize_phase`) → our progress words. */
const PHASE_STATUS: Record<string, string> = {
  loading_model: "loading", encoding_text: "encoding", inference: "generating", inference_stage_1: "generating",
  inference_stage_2: "generating", inference_stage_3: "generating", decoding: "decoding", downloading_output: "saving",
};
export interface Wan2gpProgress { status: string; progress: number; step?: number; totalSteps?: number; message?: string }
export function toProgressEvent(event: any): Wan2gpProgress | null {
  const data = event?.data || {};
  if (event?.kind !== "progress" || typeof data.progress !== "number") return null;
  return {
    status: PHASE_STATUS[String(data.phase || "")] || "working",
    progress: Math.max(0, Math.min(1, data.progress / 100)),
    step: data.current_step ?? undefined, totalSteps: data.total_steps ?? undefined, message: data.status || undefined,
  };
}

export interface GalleryItem { media_id: string; media_type?: string; filename?: string }
export interface Wan2gpClient {
  endpoint: string;
  probe(): Promise<{ server: string; version: string }>;
  modelAvailability(modelType: string): Promise<string>;
  uploadImage(f: { name: string; bytes: Buffer; mime: string }): Promise<string>;
  download(mediaId: string): Promise<{ filename: string; bytes: Buffer }>;
  submit(settings: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
  poll(jobId: string, o?: { onProgress?: (p: Wan2gpProgress) => void; signal?: AbortSignal; untilMs?: number; intervalMs?: number }): Promise<GalleryItem | "waiting">;
  cancel(jobId: string): Promise<void>;
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new Error("Generation cancelled"));
  const t = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
  const stop = () => { clearTimeout(t); reject(new Error("Generation cancelled")); };
  signal?.addEventListener("abort", stop, { once: true });
});

export function createMcpClient(url: string, fetchImpl: FetchLike): Wan2gpClient {
  const endpoint = normalizeMcpUrl(url);
  let sessionId: string | null = null;
  let nextId = 1;
  let initialized: Promise<any> | null = null;

  async function rpc(method: string, params: unknown, o: { notify?: boolean; signal?: AbortSignal } = {}) {
    const body: Record<string, unknown> = o.notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: nextId++, method, params };
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": PROTOCOL_VERSION, ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
      body: JSON.stringify(body), signal: o.signal,
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) sessionId = sid;
    const text = await res.text();
    if (!res.ok) throw new Error(`Wan2GP MCP HTTP ${res.status}: ${text.slice(0, 200)}`);
    if (o.notify) return null;
    const msg = parseRpcResponse(text, res.headers.get("content-type"), body.id as number);
    if (!msg) throw new Error(`Wan2GP MCP returned no response to ${method}`);
    if (msg.error) throw new Error(`Wan2GP MCP error: ${msg.error.message || JSON.stringify(msg.error)}`);
    return msg.result;
  }
  function ensureInitialized() {
    if (!initialized) {
      initialized = (async () => {
        const result = await rpc("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "sklubot", version: "1" } });
        await rpc("notifications/initialized", {}, { notify: true });
        return result;
      })().catch((err) => { initialized = null; throw err; });
    }
    return initialized;
  }
  async function callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
    await ensureInitialized();
    const result = await rpc("tools/call", { name, arguments: args }, { signal });
    const payload = result?.structuredContent ?? (result?.content || []).map((c: { text?: string }) => c.text).join("\n");
    if (result?.isError) throw new Error(typeof payload === "string" ? payload : JSON.stringify(payload));
    return payload;
  }
  /** A transfer address Wan2GP gave back, on the SAME server only (never wherever a link points). */
  function transferUrl(relative: string): string {
    const u = new URL(relative, endpoint);
    if (u.origin !== new URL(endpoint).origin) throw new Error("Wan2GP gave a transfer address on another server: refused");
    return u.toString();
  }
  return {
    endpoint,
    async probe() {
      const info = await ensureInitialized();
      const tools = await rpc("tools/list", {});
      const names = new Set(((tools?.tools || []) as { name: string }[]).map((t) => t.name));
      if (!names.has("wangp_generate") || !names.has("wangp_get_job")) throw new Error("This MCP server does not expose WanGP generation tools (start it with --mcp-api-version 1).");
      return { server: info?.serverInfo?.name || "WanGP", version: info?.serverInfo?.version || "unknown" };
    },
    async modelAvailability(modelType) {
      try {
        const r = await callTool("wangp_get_model_availability", { model_type: modelType });
        return r.status || (r.available ? "available" : "missing");
      } catch (err) {
        if (/Unknown model_type/i.test((err as Error).message)) return "unknown-model";
        throw err;
      }
    },
    async uploadImage({ name, bytes, mime }) {
      const slot = await callTool("wangp_create_gallery_upload", { filename: name || "start.png" });
      const res = await fetchImpl(transferUrl(slot.upload_url), { method: "PUT", headers: { "content-type": mime || "application/octet-stream" }, body: bytes });
      const body = (await res.json().catch(() => ({}))) as { media_id?: string; detail?: string };
      if (!res.ok || !body.media_id) throw new Error(`Wan2GP upload failed: HTTP ${res.status} ${body.detail || ""}`.trim());
      return body.media_id;
    },
    async download(mediaId) {
      const slot = await callTool("wangp_create_gallery_download", { media_id: mediaId });
      const res = await fetchImpl(transferUrl(slot.download_url), { method: "GET" });
      if (!res.ok) throw new Error(`Wan2GP download failed: HTTP ${res.status}`);
      return { filename: String(slot.filename || ""), bytes: Buffer.from(await res.arrayBuffer()) };
    },
    async submit(settings, signal) {
      const job = await callTool("wangp_generate", { source: settings, wait: false, event_limit: 0 }, signal);
      if (!job?.job_id) throw new Error("Wan2GP did not return a job id");
      return String(job.job_id);
    },
    /** Polls a job until it is done ("waiting" when `untilMs` passes first: the job goes on, a background poller takes over). */
    async poll(jobId, o = {}) {
      let snapshot: any = { done: false };
      let lastKey = "";
      let maxProgress = 0;
      while (!snapshot.done) {
        if (o.untilMs && Date.now() > o.untilMs) return "waiting";
        await wait(o.intervalMs ?? POLL_INTERVAL_MS, o.signal);
        try { snapshot = await callTool("wangp_get_job", { job_id: jobId, event_limit: 20 }); }
        catch (err) { if (/HTTP 5\d\d|HTTP 429|fetch failed|ECONNRESET/i.test((err as Error).message)) continue; throw err; } // a hiccup: ask again
        const latest = ((snapshot.events || []) as unknown[]).map(toProgressEvent).filter(Boolean).pop() as Wan2gpProgress | undefined;
        // Post-processing phases restart their own percentage: keep the bar monotonic.
        if (latest && latest.progress >= maxProgress) {
          maxProgress = latest.progress;
          const key = `${latest.status}:${latest.step}:${Math.round(latest.progress * 100)}`;
          if (key !== lastKey) { lastKey = key; o.onProgress?.(latest); }
        }
      }
      const result = snapshot.result || {};
      if (result.cancelled) throw new Error("Generation cancelled");
      if (!result.success) {
        const errors = ((result.errors || []) as { message?: string }[]).map((e) => e.message || JSON.stringify(e)).join("\n");
        throw new Error(`Wan2GP generation failed${errors ? `: ${errors}` : ""}`);
      }
      const item = (result.gallery_items || [])[0] as GalleryItem | undefined;
      if (!item?.media_id) throw new Error("Wan2GP finished without a gallery item to download");
      return item;
    },
    async cancel(jobId) { if (jobId) await callTool("wangp_cancel_job", { job_id: jobId }); },
  };
}

// ── Catalogue (electron/lib/wan2gpCatalog.js) ────────────────────────────────
const RES_480P: Record<string, string> = { "16:9": "832x480", "9:16": "480x832", "1:1": "720x720", "4:3": "832x624", "3:4": "624x832" };
const RES_720P: Record<string, string> = { "16:9": "1280x720", "9:16": "720x1280", "1:1": "960x960", "4:3": "1104x832", "3:4": "832x1104" };
const RES_IMAGE: Record<string, string> = { "1:1": "1024x1024", "16:9": "1280x720", "9:16": "720x1280", "4:3": "1104x832", "3:4": "832x1104" };

export interface Wan2gpModel { id: string; name: string; description: string; type: "video" | "image"; family: string; modelType: string; needsImage?: boolean; resolutions: Record<string, string>; aspectRatios: string[]; vramGb?: number }
/** `modelType` is Wan2GP's own model_type (the basename of <Wan2GP>/defaults/<modelType>.json). */
export const WAN2GP_CATALOG: readonly Wan2gpModel[] = [
  { id: "wan2gp:wan21-t2v-1.3b", name: "Wan 2.1 1.3B (texte → vidéo)", description: "Video — lightest Wan model, 480p. Runs on ~8 GB VRAM; a 5 s clip takes a few minutes.", type: "video", family: "wan", modelType: "t2v_1.3B", resolutions: RES_480P, aspectRatios: ["16:9", "9:16", "1:1"], vramGb: 8 },
  { id: "wan2gp:wan22-t2v", name: "Wan 2.2 14B (texte → vidéo)", description: "Video — Wan 2.2 text-to-video, 480p. Slow on consumer GPUs.", type: "video", family: "wan", modelType: "t2v_2_2", resolutions: RES_480P, aspectRatios: ["16:9", "9:16", "1:1"] },
  { id: "wan2gp:wan22-i2v", name: "Wan 2.2 14B (image → vidéo)", description: "Video — Wan 2.2 image-to-video, 480p. Needs a start picture.", type: "video", family: "wan", modelType: "i2v_2_2", needsImage: true, resolutions: RES_480P, aspectRatios: ["16:9", "9:16", "1:1"] },
  { id: "wan2gp:hunyuan-video", name: "Hunyuan Video 1.5", description: "Video — Hunyuan Video 1.5 text-to-video, 480p.", type: "video", family: "hunyuan", modelType: "hunyuan_1_5_480_t2v", resolutions: RES_480P, aspectRatios: ["16:9", "9:16", "1:1"] },
  { id: "wan2gp:ltx-video", name: "LTX-2 Distilled", description: "Video — LTX-2 distilled, 8 steps, 720p. Fastest large video model in Wan2GP.", type: "video", family: "ltx", modelType: "ltx2_22B_distilled", resolutions: RES_720P, aspectRatios: ["16:9", "9:16", "1:1"] },
  { id: "wan2gp:flux-dev", name: "Flux.1 Dev", description: "Image — FLUX.1 dev (12B) served by Wan2GP.", type: "image", family: "flux", modelType: "flux", resolutions: RES_IMAGE, aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"] },
  { id: "wan2gp:qwen-image", name: "Qwen Image", description: "Image — Qwen-Image 20B text-to-image served by Wan2GP.", type: "image", family: "qwen", modelType: "qwen_image_20B", resolutions: RES_IMAGE, aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"] },
];
export const DEFAULT_VIDEO_MODEL = "wan2gp:wan21-t2v-1.3b";
export const DEFAULT_IMAGE_MODEL = "wan2gp:flux-dev";
export const getModelById = (id: string | null | undefined) => WAN2GP_CATALOG.find((m) => m.id === id) ?? null;

const toInt = (v: unknown): number | null => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; };

/**
 * The settings passed to `wangp_generate`. Only what was chosen is set; everything else keeps the model's own defaults
 * in Wan2GP (tuned per model). `fps`: frames per second used to turn a duration into `video_length` (Wan runs at 16 fps
 * by default in Wan2GP; a duration is a hint, Wan2GP rounds frame counts itself).
 */
export function buildWan2gpSettings(model: Wan2gpModel, params: { prompt?: string; negative_prompt?: string; aspect_ratio?: string; steps?: unknown; video_length?: unknown; seed?: unknown } = {}, o: { imageStart?: string } = {}): Record<string, unknown> {
  if (!model?.modelType) throw new Error("Unknown Wan2GP model");
  if (model.needsImage && !o.imageStart) throw new Error(`${model.name} needs a start picture.`);
  const settings: Record<string, unknown> = { model_type: model.modelType, prompt: params.prompt || "" };
  if (params.negative_prompt) settings.negative_prompt = params.negative_prompt;
  const resolution = model.resolutions[params.aspect_ratio ?? ""] || model.resolutions[model.aspectRatios[0]];
  if (resolution) settings.resolution = resolution;
  const steps = toInt(params.steps);
  if (steps && steps > 0) settings.num_inference_steps = steps;
  const frames = toInt(params.video_length);
  if (model.type === "video" && frames && frames > 0) settings.video_length = frames;
  const seed = toInt(params.seed);
  settings.seed = seed !== null && seed >= 0 ? seed : Math.floor(Math.random() * 2147483647);
  if (o.imageStart) settings.image_start = o.imageStart;
  return settings;
}

/** Availability wording (electron/lib/wan2gpModelAvailability.js): weights not on disk yet are still usable (downloaded on first run). */
export function availabilityNote(status: string, mode: "relay" | "url"): { ready: boolean; note?: string } {
  if (status === "installed" || status === "available") return { ready: true };
  if (status === "missing") return { ready: true, note: "Weights not downloaded yet: the first run downloads them (several GB)." };
  return { ready: false, note: `${mode === "url" ? "The Wan2GP server" : "The Wan2GP on your computer"} has no such model: update Wan2GP.` };
}
