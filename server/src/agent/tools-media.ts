import sharp from "sharp";
import { labelSavedMedia, generatorHost } from "../aiprovenance.js";
import { setLive } from "../bus.js";
import { CAMERA_IDS, CAMERA_MOVE_IDS, cameraPrompt, LENS_IDS } from "../camerawords.js";
import { attachmentAt, botPathOf, isInlineImage, readLibraryFile, storeBytes } from "../computer.js";
import { connectors, slug } from "../connectors.js";
import { operatorBlock, toolRefusal, unitEstimate } from "../hosted.js";
import { tr } from "../i18n.js";
import { generateImage } from "../images.js";
import type { ToolSpec } from "../llm/types.js";
import { alwaysAllowed, costNote, imageCost, refundNotice, videoCost } from "../mediacost.js";
import { follow, keepResult, mediaJobs, pct, resumeJob } from "../mediajobs.js";
import { anyVideoApi, imageServiceFor, videoServicesFor } from "../mediakeys.js";
import { fetchProblem, guardedFetch } from "../net.js"; import { botFetch, exitProblem } from "../botroute.js"; // L169 the bot's exit
import { noteHost } from "../netjournal.js";
import { netGate } from "../netpolicy.js";
import type { Connector } from "../shared.js";
import { bots, clip, rows } from "../store.js";
import { idemKeyOf, release, reserve, settle } from "../thirdparty.js";
import { generateVideo } from "../video.js";
import { buildWan2gpSettings, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, getModelById, WAN2GP_CATALOG, type Wan2gpModel } from "../wan2gp.js";
import { RELAY_MAX_BODY, wan2gpClient, wan2gpReachable, wan2gpTarget, type Wan2gpTarget } from "../wan2gptarget.js";
import type { BuiltinTool, ToolContext, ToolOutput } from "./tools.js";

/**
 * The media tools (moved out of tools.ts for the audit Open Generative AI work, docs/audits/AUDIT-OPEN-GENERATIVE-AI.md):
 *  - image_generate: an approval card with its price when it costs money (never for Wan2GP on the owner's GPU), a
 *    spend reservation before the call, settled after (§5 item 3);
 *  - video_generate: a reservation of at least a conservative ceiling when the price is unknown (§5 item 1, mediacost.ts),
 *    the price on the card before each paid generation, a FREE engine on the owner's GPU (Wan2GP, §5 item 7), camera
 *    words (§5 item 14), the account's own keys first (§5 item 6, mediakeys.ts), and the face consent card when the start
 *    picture shows a real person (consent.ts);
 *  - media_save: the "généré par IA" marker on generated media, never stripping existing provenance (§5 item 2).
 */
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const bool = (description: string) => ({ type: "boolean", description });
const tool = (name: string, description: string, schema: ToolSpec["inputSchema"], rest: Omit<BuiltinTool, "spec">): BuiltinTool => ({ spec: { name, description, inputSchema: schema }, ...rest });
const hostOf = (url: unknown) => { try { return new URL(String(url)).hostname.replace(/^www\./, ""); } catch { return undefined; } };
/** Library paths as the bot writes them ("~/files/x", "/root/files/x" or "x") → path inside the library. */
const libraryPath = (p: string) => p.trim().replace(/^(~|\/root)\/files\//, "").replace(/^\.\//, "");
const ENGINE = { type: "string", enum: ["auto", "free_gpu", "paid"], description: "auto (default): the user's own GPU (Wan2GP) when they set it up — free —, else a paid service; free_gpu: only Wan2GP; paid: only a paid service" };

// ── Higgsfield (the user's app) ──────────────────────────────────────────────
/** The user's Higgsfield app, when it is connected and signed in (see catalog.ts). Video work then goes through it. */
export function higgsfieldFor(userId: string): Connector | null {
  return connectors.list(userId).find((k) => isHiggsfield(k) && k.status === "ready" && k.tools.length > 0) ?? null;
}
export const isHiggsfield = (k: { name: string; url: string }) => {
  try { if (new URL(k.url).hostname === "mcp.higgsfield.ai") return true; } catch { /* not a URL */ }
  return k.name.trim().toLowerCase() === "higgsfield";
};
/** How this user's bots make videos: their own GPU or a video API ("api"), through Higgsfield, or not at all. */
export function videoRoute(userId: string): "connector" | "api" | null {
  if (wan2gpTarget(userId)) return "api";
  return higgsfieldFor(userId) ? "connector" : anyVideoApi(userId) ? "api" : null;
}
/** The Higgsfield tools that look like they create or follow media, as the bot sees them (app_<app>__<tool>). Read at run time, never hard-coded. */
function higgsfieldTools(k: Connector): string[] {
  const prefix = `app_${slug(k.name)}__`;
  const names = k.tools.map((t) => t.name);
  const media = names.filter((n) => /video|image|generat|job|status|wait|result|media|model|animat|motion/i.test(n));
  return (media.length ? media : names).slice(0, 25).map((n) => (prefix + n).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64));
}

// ── Which engine a call uses ─────────────────────────────────────────────────
type Plan = { kind: "free"; target: Wan2gpTarget } | { kind: "connector"; via: Connector } | { kind: "paid" } | { kind: "none"; why: string };
function planVideo(userId: string, engine: unknown): Plan {
  const target = wan2gpTarget(userId);
  if (engine === "free_gpu") return target ? { kind: "free", target } : { kind: "none", why: "The user has not set up Wan2GP (their own GPU). They can do it in Settings → Keys → Creation." };
  if (engine !== "paid" && target) return { kind: "free", target };
  const via = engine === "paid" ? null : higgsfieldFor(userId);
  if (via) return { kind: "connector", via };
  return videoServicesFor(userId).length ? { kind: "paid" } : { kind: "none", why: "No video service is set up. Tell the user they can set up their own GPU (Wan2GP) or their own video key in Settings → Keys → Creation, connect Higgsfield in Settings → Apps, or ask the server's admin to add a video API key." };
}
function planImage(userId: string, engine: unknown): Plan {
  const target = wan2gpTarget(userId);
  const paid = !!imageServiceFor(userId);
  if (engine === "free_gpu") return target ? { kind: "free", target } : { kind: "none", why: "The user has not set up Wan2GP (their own GPU). They can do it in Settings → Keys → Creation." };
  if (engine === "paid") return paid ? { kind: "paid" } : { kind: "none", why: "No paid picture service is set up. The user can add their own key in Settings → Keys → Creation." };
  return target ? { kind: "free", target } : paid ? { kind: "paid" } : { kind: "none", why: "No picture service is set up. The user can add their own key or their own GPU (Wan2GP) in Settings → Keys → Creation." };
}
const ownerOf = (botId: string) => bots.byId(botId);

/** The free card (Wan2GP): "Always" allowed, no money. */
const freeCard = (botName: string, t: Wan2gpTarget) => ({
  key: `wan2gp: ${botName}`, title: "Allow {bot} to use Wan2GP on {where}? Free, it runs on your GPU.", reason: "use Wan2GP on your GPU", source: "Your GPU",
  vars: { where: t.label }, note: t.mode === "relay" ? "Free: nothing is paid. Your computer may be busy for several minutes; its Relais asks on its own screen the first time." : "Free: nothing is paid. Your Wan2GP server may be busy for several minutes.",
});

// ── Wan2GP (free, on the owner's GPU) ────────────────────────────────────────
/** Shrinks a start picture so it fits through the Relais (≤ 180 KiB); a server address takes it as is (≤ 15 MB). */
async function startPicture(img: { mime: string; data: Buffer; name: string }, relay: boolean) {
  if (!relay || img.data.length <= RELAY_MAX_BODY) return img;
  for (const [w, q] of [[1280, 80], [960, 75], [832, 70], [640, 65]] as const) {
    const out = await sharp(img.data).resize({ width: w, height: w, fit: "inside", withoutEnlargement: true }).jpeg({ quality: q }).toBuffer();
    if (out.length <= RELAY_MAX_BODY) return { mime: "image/jpeg", data: out, name: img.name.replace(/\.\w+$/, "") + ".jpg" };
  }
  throw new Error("the start picture is too large to send to your computer");
}
/** How long the tool follows a run in the turn before a background poller takes over (mediajobs.ts). */
const IN_TURN_MS = () => Number(process.env.WAN2GP_IN_TURN_MS) || 20 * 60_000;

async function runWan2gp(c: ToolContext, t: Wan2gpTarget, kind: "video" | "image", model: Wan2gpModel, f: { prompt: string; aspect?: string; seconds?: number; image?: { mime: string; data: Buffer; name: string }; filename: string }): Promise<ToolOutput> {
  const loc = c.user.locale;
  const free = tr(loc, "free, runs on your GPU");
  if (!wan2gpReachable(c.user.id, t)) return { content: `The user's computer ${t.label} is not connected (its Sklubot Relais must be running, version with "gpu.http"), so Wan2GP cannot be reached. Ask them to open the Relais, or use engine "paid" if they agree to pay.`, isError: true, summary: tr(loc, "computer not connected") };
  const client = wan2gpClient(c.user.id, t, { id: c.bot.id, name: c.bot.name });
  const jobRow = mediaJobs.start({ userId: c.user.id, botId: c.bot.id, kind, filename: f.filename });
  follow(jobRow, true);
  const show = (p: number | null) => setLive(c.user.id, c.bot.id, { running: true, activity: { kind: kind === "video" ? "filming" : "saving", detail: p === null ? free : `${p} % · ${free}`, since: Date.now() }, awaiting: null });
  let jobId = "";
  try {
    show(null);
    let imageStart: string | undefined;
    if (f.image) { const pic = await startPicture(f.image, t.mode === "relay"); imageStart = await client.uploadImage({ name: pic.name, bytes: pic.data, mime: pic.mime }); }
    // Wan runs at 16 frames per second in Wan2GP; a duration is a hint (it rounds frame counts itself).
    const frames = kind === "video" && f.seconds ? Math.min(161, Math.round(f.seconds * 16) + 1) : undefined;
    const settings = buildWan2gpSettings(model, { prompt: f.prompt, aspect_ratio: f.aspect, video_length: frames }, { imageStart });
    jobId = await client.submit(settings, c.signal);
    mediaJobs.running(jobRow, jobId);
    show(0);
    const item = await client.poll(jobId, { signal: c.signal, untilMs: Date.now() + IN_TURN_MS(), intervalMs: Number(process.env.WAN2GP_POLL_MS) || undefined, onProgress: (p) => show(pct(p)) });
    if (item === "waiting") {
      follow(jobRow, false);
      void resumeJob(mediaJobs.get(jobRow)!, "long", { target: t });
      return { content: `Still running on the user's GPU (Wan2GP job ${jobId}). It will be posted in the chat by itself when it is finished, even after a restart. Do not start it again.`, summary: `${free} · ${tr(loc, "in progress")}` };
    }
    const att = await keepResult(client, { bot_id: c.bot.id, kind, filename: f.filename }, item);
    mediaJobs.end(jobRow, "done", att.path);
    rows.append(c.bot, { kind: "message", role: "assistant", text: "", attachments: [att] });
    bots.bumpUnread(c.bot.id);
    return { content: `Created and shown to the user${kind === "video" ? " with a player" : ""}. Saved as ${botPathOf(att.path)}. Free: made on the user's own GPU with Wan2GP (${model.name}, job ${jobId}).`, summary: `${att.name} · ${free}` };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (c.signal.aborted) { if (jobId) await client.cancel(jobId).catch(() => {}); mediaJobs.end(jobRow, "cancelled", "stopped by the user"); throw err; }
    mediaJobs.end(jobRow, "failed", msg);
    return { content: `Wan2GP could not make it: ${clip(msg, 300)}. Nothing was charged (it runs on the user's own GPU).`, isError: true, summary: tr(loc, "Wan2GP failed") };
  } finally { follow(jobRow, false); }
}

const startImage = (c: ToolContext, ref: unknown): { mime: string; data: Buffer; name: string } | string | undefined => {
  if (typeof ref !== "string" || !ref.trim()) return undefined;
  const att = attachmentAt(c.bot.id, libraryPath(ref));
  if (!att || !isInlineImage(att.mime)) return `There is no picture at ${ref} in your library (PNG, JPEG or WebP).`;
  if (att.size > 15_000_000) return "That picture is too large (15 MB at most).";
  return { mime: att.mime, data: readLibraryFile(c.bot.id, att.path), name: att.name };
};

const mediaKind = (mime: string) => (mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : null);
const EXT: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const VIDEO_MODELS = WAN2GP_CATALOG.filter((m) => m.type === "video").map((m) => m.id);

export const imageTool: BuiltinTool = tool("image_generate", "Create a picture from a description. It is saved in your library and shown to the user in the chat. On the user's own GPU (Wan2GP) it is free; on a paid service the user approves the price first.",
  obj({ prompt: str("What the picture should show, in detail: subject, style, colours, framing"), filename: str("Short file name without extension"), engine: ENGINE }, ["prompt"]), {
  activity: "saving", label: "Creating an image", audited: true,
  gate: (a, ctx) => {
    const owner = ownerOf(ctx.botId);
    if (!owner) return null;
    const plan = planImage(owner.userId, a.engine);
    if (plan.kind === "free") return freeCard(owner.name, plan.target);
    if (plan.kind !== "paid") return null;
    const cost = imageCost();
    const ok = alwaysAllowed(cost);
    return { key: `image_generate: ${owner.name}`, title: "Allow {bot} to create a picture? It is billed by the picture service.", reason: "create a picture", source: "Paid picture", vars: { cost: cost.usd.toFixed(2) }, note: costNote(cost, "picture"), strict: !ok, once: !ok };
  },
  run: async (a, c) => {
    const name = `${String(a.filename ?? "image").trim() || "image"}`;
    const plan = planImage(c.user.id, a.engine);
    if (plan.kind === "none") return { content: plan.why, isError: true };
    if (plan.kind === "free") {
      const model = getModelById(DEFAULT_IMAGE_MODEL)!;
      return runWan2gp(c, plan.target, "image", model, { prompt: String(a.prompt), aspect: "1:1", filename: name });
    }
    const svc = imageServiceFor(c.user.id)!;
    // Hosted mode: a picture on the server's key — the plan must let it pay (reserve checks the budget too).
    if (!svc.ownKey) { const held = operatorBlock(c.user.id); if (held) return { content: toolRefusal(held), isError: true }; }
    const cost = imageCost();
    const r = reserve({ userId: c.user.id, botId: c.bot.id, tool: "image", provider: svc.ownKey ? "own" : "api", maxUsd: cost.usd, ownKey: svc.ownKey, idemKey: idemKeyOf(c.bot.id, "image", "api", { prompt: String(a.prompt), filename: name }) });
    if (r.kind === "refused") return { content: r.message, isError: true, summary: tr(c.user.locale, "budget refused") };
    if (r.kind === "busy") return { content: "This same picture is still being made. Wait for it; do not start another.", isError: true, summary: tr(c.user.locale, "in progress") };
    if (r.kind === "replay") return { content: `${r.result}\n(This is the same request as a moment ago: it was not made or charged again.)`, summary: tr(c.user.locale, "same request, not charged again") };
    let img: { bytes: Buffer; mime: string };
    try { img = await generateImage(String(a.prompt), c.signal, svc); }
    catch (err) { release(r.id); if (c.signal.aborted) throw err; return { content: refundNotice(`The picture service could not make it: ${clip(String((err as Error)?.message ?? err), 200)}.`, { reservedUsd: r.reservedUsd }), isError: true, summary: tr(c.user.locale, "nothing charged") }; }
    const ext = img.mime === "image/jpeg" ? "jpg" : img.mime === "image/webp" ? "webp" : "png";
    const att = storeBytes(c.bot.id, "images", `${name}.${ext}`, img.bytes);
    rows.append(c.bot, { kind: "message", role: "assistant", text: "", attachments: [att] });
    bots.bumpUnread(c.bot.id);
    const content = `Created and shown to the user. Saved as ${botPathOf(att.path)}.`;
    // Unknown price: the hosted plan's estimate when there is one, else the ceiling that was reserved (mediacost.ts).
    settle(r.id, cost.known ? cost.usd : (!svc.ownKey && unitEstimate("imageUsd")) || cost.usd, content, svc.model, !!svc.ownKey);
    return { content, summary: att.name };
  },
});

export const videoTools: BuiltinTool[] = [
  tool("video_generate", "Create a short video from a description (a few seconds). It is saved in your library and shown to the user in the chat with a player. On the user's own GPU (Wan2GP) it is free but slow; on a paid service it costs money and the user approves the price first: make one only when the user wants a video, and one at a time. If the start picture shows a real person, set real_person to true (the owner is asked for consent).",
    obj({
      prompt: str("What the video should show, in detail: subject, action, style, light, sound"),
      duration_seconds: int("Length in seconds (usually 3 to 15; default about 8)"),
      aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1"], description: "16:9 landscape (default), 9:16 portrait, 1:1 square" },
      reference_image: str("Optional: path of a picture in your library to start from"),
      real_person: bool("True when the start picture shows a real person's face (the owner must confirm consent)"),
      camera_move: { type: "string", enum: CAMERA_MOVE_IDS, description: "Optional camera movement (dolly_in, pan_left, orbit, crane_up, handheld…)" },
      camera: { type: "string", enum: CAMERA_IDS, description: "Optional camera look (film_16mm, modular_8k…)" },
      lens: { type: "string", enum: LENS_IDS, description: "Optional lens look (anamorphic, macro, vintage…)" },
      focal_mm: { type: "integer", enum: [8, 14, 24, 35, 50, 85], description: "Optional focal length in mm" },
      aperture: { type: "string", enum: ["f/1.4", "f/4", "f/11"], description: "Optional aperture (depth of field)" },
      engine: ENGINE,
      wan2gp_model: { type: "string", enum: VIDEO_MODELS, description: `Only on the user's GPU: which Wan2GP model (default ${DEFAULT_VIDEO_MODEL}; an image-to-video model is used with a start picture)` },
      filename: str("Short file name without extension"),
    }, ["prompt"]), {
    activity: "filming", label: "Creating a video", audited: true, detail: () => "0",
    gate: (a, ctx) => {
      const owner = ownerOf(ctx.botId);
      if (!owner) return null;
      const plan = planVideo(owner.userId, a.engine);
      if (plan.kind === "free") return freeCard(owner.name, plan.target);
      if (plan.kind !== "paid") return null;
      // The price before EACH paid generation (audit §3.1): "Always" only for a known, small price (mediacost.ts).
      const services = videoServicesFor(owner.userId);
      const cost = videoCost(services[0]?.id ?? "xai", Number(a.duration_seconds) || null);
      const ok = alwaysAllowed(cost);
      return { key: `video_generate: ${owner.name}`, title: "Allow {bot} to create a video? Each video is billed by {provider}.", reason: "create a video", source: "Paid video", vars: { provider: services.map((v) => v.label).join(", "), cost: cost.usd.toFixed(2) }, note: costNote(cost, "video"), strict: !ok, once: !ok };
    },
    run: async (a, c) => {
      const plan = planVideo(c.user.id, a.engine);
      if (plan.kind === "none") return { content: plan.why, isError: true };
      if (plan.kind === "connector") {
        // The user's Higgsfield subscription: the bot works with that app's own tools.
        return {
          content: `Videos are made through the user's Higgsfield app (it spends their Higgsfield credits, so make one video at a time and only what they asked for). Use its tools for this: ${higgsfieldTools(plan.via).join(", ")}. Start a generation with the tool that creates videos, follow it until it is finished, then call media_save with the finished video's address and ai_generated: true so the user can watch it here.`,
          summary: "via Higgsfield",
        };
      }
      const pic = startImage(c, a.reference_image);
      if (typeof pic === "string") return { content: pic, isError: true };
      const prompt = cameraPrompt(String(a.prompt), a);
      const aspect = a.aspect_ratio === "9:16" || a.aspect_ratio === "1:1" ? a.aspect_ratio : a.aspect_ratio === "16:9" ? "16:9" : undefined;
      const filename = String(a.filename ?? "video").trim() || "video";
      if (plan.kind === "free") {
        let model = getModelById(typeof a.wan2gp_model === "string" ? a.wan2gp_model : DEFAULT_VIDEO_MODEL) ?? getModelById(DEFAULT_VIDEO_MODEL)!;
        if (model.type !== "video") model = getModelById(DEFAULT_VIDEO_MODEL)!;
        if (pic && !model.needsImage) model = WAN2GP_CATALOG.find((m) => m.needsImage)!;
        if (!pic && model.needsImage) return { content: `${model.name} needs a start picture (reference_image).`, isError: true };
        return runWan2gp(c, plan.target, "video", model, { prompt, aspect, seconds: Number(a.duration_seconds) || undefined, image: pic, filename });
      }
      const services = videoServicesFor(c.user.id);
      // Hosted mode: the server's keys need the plan to pay; the account's own key does not (reserve checks the budget too).
      if (!services.some((s) => s.ownKey)) { const held = operatorBlock(c.user.id); if (held) return { content: toolRefusal(held), isError: true }; }
      const show = (p: number | null) => setLive(c.user.id, c.bot.id, { running: true, activity: { kind: "filming", detail: p === null ? undefined : String(Math.round(p)), since: Date.now() }, awaiting: null });
      // Spec 08 A3/A4: the video APIs in order; each paid call reserves its most first (never 0: mediacost.ts) and settles
      // the real cost after (no double charge for the same request sent again); a provider error moves on to the next
      // one, but a job that may still finish is never doubled with another paid provider.
      const reqArgs = { prompt, duration: Number(a.duration_seconds) || null, aspect: aspect ?? null, image: a.reference_image ?? null };
      const tried: string[] = [];
      for (const svc of services) {
        const cost = videoCost(svc.id, Number(a.duration_seconds) || null);
        const r = reserve({ userId: c.user.id, botId: c.bot.id, tool: "video", provider: svc.id, maxUsd: cost.usd, ownKey: svc.ownKey, idemKey: idemKeyOf(c.bot.id, "video", svc.id, reqArgs, typeof a.request_id === "string" ? a.request_id : undefined) });
        if (r.kind === "refused") return { content: r.message, isError: true, summary: tr(c.user.locale, "budget refused") };
        if (r.kind === "busy") return { content: "This same video is still being made. Wait for it; do not start another.", isError: true, summary: tr(c.user.locale, "in progress") };
        if (r.kind === "replay") return { content: `${r.result}\n(This is the same request as a moment ago: it was not made or charged again.)`, summary: tr(c.user.locale, "same request, not charged again") };
        let v: Awaited<ReturnType<typeof generateVideo>>;
        try { v = await generateVideo({ prompt, duration: Number(a.duration_seconds) || undefined, aspect, image: pic, signal: c.signal, onProgress: show }, svc); }
        catch (err) {
          release(r.id);
          if (c.signal.aborted || /timed out|took too long/i.test(String((err as Error)?.message))) throw err;
          tried.push(refundNotice(`${svc.label}: ${clip(String((err as Error)?.message ?? err), 120)}.`, { reservedUsd: r.reservedUsd }));
          continue;
        }
        const att = storeBytes(c.bot.id, "videos", `${filename}.${EXT[v.mime] ?? "mp4"}`, v.bytes);
        rows.append(c.bot, { kind: "message", role: "assistant", text: "", attachments: [att] });
        bots.bumpUnread(c.bot.id);
        const content = `Created and shown to the user with a player. Saved as ${botPathOf(att.path)}.${v.costUsd ? ` It cost $${v.costUsd.toFixed(2)}.` : ""}${tried.length ? ` (Served by ${svc.label}; tried first: ${tried.join(" ")})` : ""}`;
        settle(r.id, v.costUsd ?? (cost.known ? cost.usd : (!svc.ownKey && unitEstimate("videoUsd")) || cost.usd), content, v.model, !!svc.ownKey);
        return { content, summary: `${att.name}${v.costUsd ? ` · $${v.costUsd.toFixed(2)}` : ""}${tried.length ? ` · ${tr(c.user.locale, "served by {who}", { who: svc.label })}` : ""}` };
      }
      return { content: `No video service could make it: ${tried.join(" ") || "none is configured."} Nothing was charged.`, isError: true, summary: tr(c.user.locale, "nobody answered") };
    },
  }),
  tool("media_save", "Download a finished video or picture from its address (for example one an app such as Higgsfield just made) into your library and show it to the user in the chat, with a player for videos. Set ai_generated to true when an AI made it: it gets the « généré par IA » label.",
    obj({ url: str("The http(s) address of the video or picture"), filename: str("Short file name without extension"), caption: str("A line to go with it"), ai_generated: bool("True when the media was made by an AI generator (an app such as Higgsfield, another AI service)") }, ["url"]), {
    activity: "saving", label: "Saving a video", audited: true, detail: (a) => hostOf(a.url),
    run: async (a, c) => {
      const url = String(a.url);
      if (!/^https?:\/\//i.test(url)) return { content: "Only http and https addresses can be saved.", isError: true };
      let res: Response;
      const net = netGate(c.bot, url, "media_save"); if (net) return { content: net, isError: true, summary: "blocked" }; noteHost(c.bot, url, "media", { tainted: c.tainted }); try { res = await botFetch(c.bot, url, { signal: AbortSignal.any([c.signal, AbortSignal.timeout(300_000)]), redirect: "follow" }); } // L39
      catch (err) { const why = exitProblem(err) ?? fetchProblem(err); if (why) return { content: `Could not download ${url}: ${why}`, isError: true, summary: "not saved" }; throw err; }
      if (!res.ok) return { content: `Could not download it (status ${res.status}).`, isError: true, summary: `${res.status}` };
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const fromName = /\.(mp4|webm|mov|png|jpe?g|webp|gif)(?:$|\?)/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
      const mime = mediaKind(type) ? type : fromName ? ({ mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" } as Record<string, string>)[fromName] : "";
      if (!mime || !mediaKind(mime)) { await res.body?.cancel().catch(() => {}); return { content: `That address is not a video or a picture (${type || "unknown type"}).`, isError: true }; }
      if (Number(res.headers.get("content-length") ?? 0) > 200_000_000) { await res.body?.cancel().catch(() => {}); return { content: "That file is too large (200 MB at most).", isError: true }; }
      const raw = Buffer.from(await res.arrayBuffer());
      if (raw.length > 200_000_000) return { content: "That file is too large (200 MB at most).", isError: true };
      const kind = mediaKind(mime)!;
      // Audit OGAI §5 item 2: generated media get the AI marker; existing provenance is never stripped (aiprovenance.ts).
      const generated = a.ai_generated === true || !!generatorHost(url) || !!higgsfieldFor(c.user.id) && /higgsfield/i.test(url);
      const label = await labelSavedMedia(raw, mime, generated);
      const att = storeBytes(c.bot.id, kind === "video" ? "videos" : "images", `${String(a.filename ?? kind).trim() || kind}.${EXT[mime] ?? (kind === "video" ? "mp4" : "png")}`, label.bytes);
      rows.append(c.bot, { kind: "message", role: "assistant", text: typeof a.caption === "string" ? a.caption : "", attachments: [att] });
      bots.bumpUnread(c.bot.id);
      const note = label.outcome === "labelled" ? " It carries the « généré par IA » label." : label.outcome === "already" ? " It already carried an AI label (kept)." : label.outcome === "kept" ? " It already had provenance metadata (kept as is, never stripped)." : "";
      return { content: `Saved as ${botPathOf(att.path)} and shown to the user${kind === "video" ? " with a player" : ""}.${note}`, summary: att.name };
    },
  }),
];
