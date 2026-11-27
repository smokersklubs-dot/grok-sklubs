import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Audit Open Generative AI (docs/audits/AUDIT-OPEN-GENERATIVE-AI.md): the media gaps (A1–A5) and the Wan2GP / studio
// integration (B), with fake providers only. A fresh data folder: the repo's own database is never opened.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-ogai-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "https://sklubot.example";
process.env.VIDEO_POLL_MS = "20";
process.env.WAN2GP_POLL_MS = "20";
for (const k of ["XAI_API_KEY", "VIDEO_XAI_API_KEY", "GEMINI_API_KEY", "VIDEO_PROVIDER", "OPENAI_API_KEY", "IMAGE_API_KEY", "VIDEO_PRICE_USD", "IMAGE_PRICE_USD", "HOSTED_MODE"]) delete process.env[k];

/** A tiny but well-formed MP4: an `ftyp` box and an `mdat` box (the AI marker is appended after them). */
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0]), Buffer.from([0, 0, 0, 12]), Buffer.from("mdat"), Buffer.from("abcd")]);
/** The same with a C2PA manifest box (uuid d8fec3d6-…): existing provenance that must never be stripped or shadowed. */
const C2PA_BOX = Buffer.concat([Buffer.from([0, 0, 0, 28]), Buffer.from("uuid"), Buffer.from("d8fec3d61b0e483c92975828877ec481", "hex"), Buffer.from("c2pa")]);
const MP4_C2PA = Buffer.concat([MP4, C2PA_BOX]);

// ── Fake outside services: xAI video, an images/generations service, a Wan2GP MCP server ──
const xai = { created: 0, auth: [] as string[] };
const img = { calls: 0, auth: [] as string[] };
const wan = { generate: [] as any[], polls: 0, cancels: 0, uploads: 0, stuck: false, doneAfter: 2, sessions: 0 };
const local = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", "http://x");
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString();
  const json = (v: unknown, headers: Record<string, string> = {}) => { res.writeHead(200, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(v)); };
  if (url.pathname === "/v1/videos/generations") { xai.created++; xai.auth.push(String(req.headers.authorization)); return json({ request_id: "req_1" }); }
  if (url.pathname.startsWith("/v1/videos/req_")) return json({ status: "done", progress: 100, model: "grok-imagine-video-1.5", video: { url: `${base}/files/x.mp4` }, usage: { cost_in_usd_ticks: 3_000_000_000 } });
  if (url.pathname === "/files/x.mp4") { res.setHeader("content-type", "video/mp4"); return res.end(MP4); }
  if (url.pathname === "/img/images/generations") { img.calls++; img.auth.push(String(req.headers.authorization)); return json({ data: [{ b64_json: PNG.toString("base64") }] }); }
  if (url.pathname === "/gen/clip.mp4") { res.setHeader("content-type", "video/mp4"); return res.end(MP4); }
  if (url.pathname === "/gen/c2pa.mp4") { res.setHeader("content-type", "video/mp4"); return res.end(MP4_C2PA); }
  // Wan2GP MCP (Streamable HTTP, JSON answers) and its gallery transfers.
  if (url.pathname === "/wan/mcp") {
    const m = JSON.parse(raw);
    if (m.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
    if (m.method === "initialize") { wan.sessions++; return json({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "WanGP", version: "9.9" }, capabilities: {} } }, { "mcp-session-id": "s-1" }); }
    if (m.method === "tools/list") return json({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "wangp_generate" }, { name: "wangp_get_job" }] } });
    const ok = (structuredContent: unknown) => json({ jsonrpc: "2.0", id: m.id, result: { structuredContent, content: [] } });
    const { name, arguments: args } = m.params;
    if (name === "wangp_generate") { wan.generate.push(args.source); return ok({ job_id: `job${wan.generate.length}` }); }
    if (name === "wangp_get_job") { wan.polls++; if (wan.stuck || wan.polls % (wan.doneAfter + 1) !== 0) return ok({ done: false, events: [{ kind: "progress", data: { progress: 40, phase: "inference", current_step: 4, total_steps: 10 } }] }); return ok({ done: true, result: { success: true, gallery_items: [{ media_id: "m1", filename: "out.mp4" }] } }); }
    if (name === "wangp_cancel_job") { wan.cancels++; return ok({ cancelled: true }); }
    if (name === "wangp_create_gallery_upload") return ok({ upload_url: "/wan/upload/1" });
    if (name === "wangp_create_gallery_download") return ok({ download_url: "/wan/gallery/m1", filename: "out.mp4" });
    return json({ jsonrpc: "2.0", id: m.id, error: { message: "unknown" } });
  }
  if (url.pathname === "/wan/upload/1") { wan.uploads++; return json({ media_id: "img1" }); }
  if (url.pathname === "/wan/gallery/m1") { res.setHeader("content-type", "video/mp4"); return res.end(MP4); }
  res.statusCode = 404; res.end();
});
await new Promise<void>((r) => local.listen(0, "127.0.0.1", () => r()));
const base = `http://127.0.0.1:${(local.address() as { port: number }).port}`;
after(() => { local.closeAllConnections(); local.close(); });

const sharp = (await import("sharp")).default;
const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#3366ff" } }).png().toBuffer();
const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { hasAiVideoLabel } = await import("../src/aivideo.js");
const { hasAiLabel } = await import("../src/aimedia.js");
const { isCloneAction, cloneTarget } = await import("../src/agent/consent.js");
const { videoCost, imageCost, alwaysAllowed, refundNotice } = await import("../src/mediacost.js");
const { cameraPrompt } = await import("../src/camerawords.js");
const { labelSavedMedia } = await import("../src/aiprovenance.js");
const { mediaJobs, startMediaJobs } = await import("../src/mediajobs.js");
const { relayFetch } = await import("../src/wan2gptarget.js");
const { readLibraryFile } = await import("../src/computer.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
    const last = req.messages[req.messages.length - 1];
    const results = last.content.filter((b) => b.type === "tool_result");
    const texts = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    let content: Block[];
    if (results.length && !texts.length) { const r = results[0]; content = [{ type: "text", text: `Tool said: ${r.type === "tool_result" ? r.content.map((c) => (c.type === "text" ? c.text : "")).join(" ") : ""}` }]; }
    else {
      const said = (texts[texts.length - 1] ?? "").replace(/^(\[[^\]\n]*\]\n)+/, "");
      const m = /call (\w+) (\{.*\})\s*$/.exec(said);
      content = m ? [{ type: "tool_use", id: `c${Date.now()}`, name: m[1], input: JSON.parse(m[2]) }] : [{ type: "text", text: `Echo: ${said}` }];
    }
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "script-1", usage };
  },
});

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie"); if (set) cookie = set.split(";")[0];
  const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const rowsOf = async (botId: string): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows`)).json.rows;
async function until<T>(probe: () => Promise<T | undefined | false | null>, label: string): Promise<T> {
  for (let i = 0; i < 1200; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const lastText = (list: Row[]) => [...list].reverse().find((r) => r.body.kind === "message" && r.body.role === "assistant" && r.body.text);
/** Only rows after the last message the test sent count (no stale match on an earlier reply). */
let mark = 0;
const replied = (bot: Bot, part: string) => until(async () => { const r = lastText((await rowsOf(bot.id)).filter((x) => x.seq > mark)); return r?.body.kind === "message" && r.body.text.includes(part) && r; }, `reply "${part}"`);
const say = async (bot: Bot, text: string) => { const r = await call("POST", `/bots/${bot.id}/messages`, { text }); mark = r.json?.row?.seq ?? mark; return r; };
const pendingCard = (bot: Bot) => until(async () => { const r = (await rowsOf(bot.id)).find((x) => x.body.kind === "card" && x.body.card.type === "approval" && x.body.card.status === "pending"); return r?.body.kind === "card" && r.body.card.type === "approval" ? r.body.card : null; }, "approval card");
const lastAttachment = async (bot: Bot) => { const m = [...(await rowsOf(bot.id))].reverse().find((r) => r.body.kind === "message" && r.body.attachments?.length); return m?.body.kind === "message" ? m.body.attachments![0] : null; };

let bot: Bot; let userId = "";
test("setup", async () => {
  const r = await call("POST", "/auth/signup", { email: "lea@example.com", name: "Léa", password: "password123", locale: "fr" });
  assert.equal(r.status, 200, r.text);
  userId = r.json.user.id;
  bot = (await call("GET", "/bots")).json.bots.find((b: Bot) => b.primary);
  await call("PATCH", `/bots/${bot.id}`, { model: "script:script-1" });
});

// ── A1 ──
test("A1: with no admin price, a video reserves a conservative ceiling, so the budget stops it BEFORE the provider is called", async () => {
  assert.deepEqual(videoCost("xai", 8), { usd: 0.8, known: false, free: false });
  assert.equal(videoCost("gemini", 30).usd, 3, "15 s at most, 0.20 $/s");
  assert.equal(videoCost("wan2gp", 8).usd, 0);
  process.env.VIDEO_USD_PER_SECOND_XAI = "0.05"; assert.equal(videoCost("xai", 10).usd, 0.5, "overridable"); delete process.env.VIDEO_USD_PER_SECOND_XAI;
  process.env.VIDEO_PRICE_USD = "0.07"; assert.deepEqual(videoCost("xai", 8), { usd: 0.07, known: true, free: false }); assert.equal(alwaysAllowed(videoCost("xai", 8)), true); delete process.env.VIDEO_PRICE_USD;
  assert.equal(alwaysAllowed(videoCost("xai", 8)), false, "an unknown price asks every time");

  process.env.XAI_API_KEY = "sk-fake-for-tests"; process.env.XAI_BASE_URL = `${base}/v1`;
  q.run("INSERT INTO settings (user_id, budget_usd) VALUES (?, 0.5) ON CONFLICT(user_id) DO UPDATE SET budget_usd = 0.5", userId);
  await say(bot, 'call video_generate {"prompt": "A paper boat", "duration_seconds": 8}');
  const card = await pendingCard(bot);
  assert.match(card.title, /créer une vidéo/);
  assert.match(card.detail ?? "", /Prix inconnu.*0\.80 \$/);
  assert.equal(card.once, true, "no « Toujours » for an unknown price");
  await call("POST", `/approvals/${card.approvalId}`, { decision: "allow" });
  await replied(bot, "Budget refusal");
  assert.equal(xai.created, 0, "the provider was never called");
  q.run("UPDATE settings SET budget_usd = NULL WHERE user_id = ?", userId);
  // Without a budget it goes through; the real cost reported by xAI (0.30 $) is what is recorded.
  await say(bot, 'call video_generate {"prompt": "A paper boat", "duration_seconds": 8}');
  await call("POST", `/approvals/${(await pendingCard(bot)).approvalId}`, { decision: "allow" });
  await replied(bot, "Created and shown");
  assert.equal(xai.created, 1);
  assert.equal(q.get<{ c: number }>("SELECT cost_usd AS c FROM usage WHERE model = 'grok-imagine-video-1.5'")!.c, 0.3);
  // The next paid video asks again, with its price (an earlier yes does not cover an unknown price).
  await say(bot, 'call video_generate {"prompt": "Again", "duration_seconds": 4}');
  const again = await pendingCard(bot);
  assert.match(again.detail ?? "", /0\.40 \$/);
  await call("POST", `/approvals/${again.approvalId}`, { decision: "deny" });
  await replied(bot, "Tool said");
  delete process.env.XAI_API_KEY; delete process.env.XAI_BASE_URL;
});

// ── A2 ──
test("A2: image_generate asks with its price when it costs money, reserves before the call, and a budget stops it first", async () => {
  assert.deepEqual(imageCost(), { usd: 0.25, known: false, free: false });
  process.env.IMAGE_API_KEY = "sk-fake-for-tests"; process.env.IMAGE_BASE_URL = `${base}/img`;
  q.run("INSERT INTO settings (user_id, budget_usd) VALUES (?, 0.4) ON CONFLICT(user_id) DO UPDATE SET budget_usd = 0.4", userId);
  // The month already spent 0.30 $ on the video above: the 0.10 $ left cannot cover a 0.25 $ picture.
  await say(bot, 'call image_generate {"prompt": "a red fox", "filename": "renard"}');
  const card = await pendingCard(bot);
  assert.match(card.title, /créer une image/);
  assert.match(card.detail ?? "", /0\.25 \$/);
  await call("POST", `/approvals/${card.approvalId}`, { decision: "allow" });
  await replied(bot, "Budget refusal");
  assert.equal(img.calls, 0, "never called");
  q.run("UPDATE settings SET budget_usd = NULL WHERE user_id = ?", userId);
  process.env.IMAGE_PRICE_USD = "0.04";
  await say(bot, 'call image_generate {"prompt": "a red fox", "filename": "renard"}');
  const known = await pendingCard(bot);
  assert.notEqual(known.once, true, "a known small price may be « Toujours »");
  await call("POST", `/approvals/${known.approvalId}`, { decision: "always" });
  await replied(bot, "Created and shown");
  assert.equal(img.calls, 1);
  assert.equal(q.get<{ s: string }>("SELECT status AS s FROM tool_spend WHERE tool = 'image' ORDER BY created_at DESC LIMIT 1")!.s, "settled");
  await say(bot, 'call image_generate {"prompt": "a blue fox", "filename": "renard2"}');
  await replied(bot, "Created and shown");
  assert.equal(img.calls, 2, "« Toujours » for a known small price");
  delete process.env.IMAGE_API_KEY; delete process.env.IMAGE_BASE_URL; delete process.env.IMAGE_PRICE_USD;
});

// ── A3 ──
test("A3: media_save labels generated media, leaves other media alone, and never strips existing provenance", async () => {
  process.env.XAI_API_KEY = "sk-fake-for-tests"; // media_save comes with the video tools
  await say(bot, `call media_save {"url": "${base}/gen/clip.mp4", "filename": "hf", "ai_generated": true}`);
  await replied(bot, "généré par IA");
  const att = (await lastAttachment(bot))!;
  assert.equal(hasAiVideoLabel(readLibraryFile(bot.id, att.path)), true);
  await say(bot, `call media_save {"url": "${base}/gen/clip.mp4", "filename": "mine"}`);
  await replied(bot, "Saved as");
  assert.equal(hasAiVideoLabel(readLibraryFile(bot.id, (await lastAttachment(bot))!.path)), false, "not said to be generated, not a generator's host");
  await say(bot, `call media_save {"url": "${base}/gen/c2pa.mp4", "filename": "signed", "ai_generated": true}`);
  await replied(bot, "never stripped");
  assert.deepEqual(readLibraryFile(bot.id, (await lastAttachment(bot))!.path), MP4_C2PA, "byte for byte");
  // Pictures: labelled when bare; a picture with EXIF (or XMP / C2PA) is kept as is.
  const bare = await labelSavedMedia(PNG, "image/png", true);
  assert.equal(bare.outcome, "labelled"); assert.equal(await hasAiLabel(bare.bytes), true);
  const withExif = await sharp(PNG).jpeg().withMetadata({ exif: { IFD0: { Copyright: "Léa" } } }).toBuffer();
  const kept = await labelSavedMedia(withExif, "image/jpeg", true);
  assert.equal(kept.outcome, "kept"); assert.deepEqual(kept.bytes, withExif);
  assert.equal((await labelSavedMedia(bare.bytes, "image/png", false)).outcome, "already");
  delete process.env.XAI_API_KEY;
});

// ── A4 ──
test("A4: recast, body swap, motion transfer, character replacement, dubbing and lip-sync endpoints ask for consent", () => {
  for (const n of ["recast", "process_recast", "body_swap", "swap_body", "motion_control", "hf_mult_motion_control", "objects_swap", "replace_character", "replace_person", "head_swap", "face_replace", "lipsync", "infinite_talk", "voice_conversion", "speech_to_speech", "dubbing", "talking_video", "animate_portrait", "character_swap", "create_voice_clone", "face_swap"]) assert.ok(isCloneAction(n), n);
  for (const n of ["list_voices", "get_motion_control_status", "estimate_video_cost", "text_to_speech", "generate_image", "dubai_weather", "generate_video", "replace_object"]) assert.ok(!isCloneAction(n), n);
  const turn = { remote: new Map() } as any;
  assert.match(cloneTarget(turn, { name: "api_send", input: { connector: "Sync", method: "POST", path: "/v2/lipsync/generate" } })!, /lipsync/);
  assert.match(cloneTarget(turn, { name: "api_send", input: { connector: "X", method: "POST", path: "/api/face-swap?x=1" } })!, /face_swap/);
  assert.equal(cloneTarget(turn, { name: "api_send", input: { connector: "X", method: "POST", path: "/v1/invoices" } }), null);
  assert.match(cloneTarget(turn, { name: "video_generate", input: { prompt: "x", reference_image: "uploads/me.png", real_person: true } })!, /real person/);
  assert.equal(cloneTarget(turn, { name: "video_generate", input: { prompt: "x", reference_image: "uploads/cat.png", real_person: false } }), null);
});

test("A4: video_generate from a picture of a real person stops on the consent card first", async () => {
  process.env.XAI_API_KEY = "sk-fake-for-tests"; process.env.XAI_BASE_URL = `${base}/v1`;
  const form = new FormData(); form.append("file", new File([new Uint8Array(PNG)], "moi.png", { type: "image/png" }));
  const path = ((await (await api.request(`/bots/${bot.id}/uploads`, { method: "POST", headers: { cookie }, body: form })).json()) as any).attachment.path;
  await say(bot, `call video_generate {"prompt": "me waving", "reference_image": "${path}", "real_person": true}`);
  const card = await pendingCard(bot);
  assert.match(card.title, /C'est toi, ou la personne a donné son accord écrit/);
  await call("POST", `/approvals/${card.approvalId}`, { decision: "deny" });
  await replied(bot, "Tool said");
  assert.equal(xai.created, 1, "nothing was generated");
  delete process.env.XAI_API_KEY; delete process.env.XAI_BASE_URL;
});

// ── A5 ──
test("A5: the account's own video and picture keys: sealed, never shown back, used before the server's", async () => {
  process.env.XAI_BASE_URL = `${base}/v1`;
  assert.equal((await call("PUT", "/media-keys/xai", { key: "" })).status, 400);
  const saved = await call("PUT", "/media-keys/xai", { key: "sk-fake-own-xai" });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.keys[0].hasKey, true);
  assert.ok(!saved.text.includes("sk-fake-own-xai"), "never sent back");
  assert.ok(!(await call("GET", "/media-keys")).text.includes("sk-fake-own-xai"));
  const enc = q.get<{ k: string }>("SELECT key_enc AS k FROM media_keys WHERE user_id = ? AND provider = 'xai'", userId)!.k;
  assert.ok(enc && !enc.includes("sk-fake-own-xai"), "sealed");
  process.env.XAI_API_KEY = "sk-fake-server";
  await say(bot, 'call video_generate {"prompt": "own key please", "duration_seconds": 3}');
  await call("POST", `/approvals/${(await pendingCard(bot)).approvalId}`, { decision: "allow" });
  await replied(bot, "Created and shown");
  assert.equal(xai.auth.at(-1), "Bearer sk-fake-own-xai", "the account's own key first");
  assert.equal(q.get<{ p: string | null }>("SELECT price_status AS p FROM usage WHERE model = 'grok-imagine-video-1.5' ORDER BY rowid DESC LIMIT 1")!.p, "reported");
  // A picture key with its own address; a second account never sees or uses the first one's keys.
  await call("PUT", "/media-keys/image", { key: "sk-fake-own-img", baseUrl: `${base}/img`, model: "img-1" });
  assert.equal((await call("GET", "/me")).json.imageGeneration !== undefined, true);
  const { imageServiceFor, videoServicesFor } = await import("../src/mediakeys.js");
  assert.equal(imageServiceFor(userId)?.apiKey, "sk-fake-own-img");
  assert.notEqual(imageServiceFor("someone-else")?.apiKey, "sk-fake-own-img", "another account never gets it");
  assert.ok(!videoServicesFor("someone-else").some((s) => s.ownKey));
  assert.equal((await call("DELETE", "/media-keys/xai")).status, 200);
  assert.equal(videoServicesFor(userId)[0].apiKey, "sk-fake-server");
  await call("DELETE", "/media-keys/image");
  delete process.env.XAI_API_KEY; delete process.env.XAI_BASE_URL;
});

// ── B: Wan2GP on the owner's GPU, free ──
test("B1: Wan2GP on a server address: a free card, the job polled with its progress, the video kept with the AI label", async () => {
  assert.equal((await call("PUT", "/media-keys/wan2gp", { baseUrl: "http://169.254.169.254/" })).status, 400, "metadata refused");
  const set = await call("PUT", "/media-keys/wan2gp", { baseUrl: `${base}/wan` });
  assert.equal(set.status, 200, set.text);
  const check = await call("POST", "/media-keys/wan2gp/check");
  assert.equal(check.json.ok, true); assert.match(check.json.message, /WanGP 9\.9/);
  await say(bot, 'call video_generate {"prompt": "A lantern in the fog", "duration_seconds": 5, "aspect_ratio": "9:16", "camera_move": "dolly_in", "filename": "lanterne"}');
  const card = await pendingCard(bot);
  assert.match(card.title, /Gratuit, ça tourne sur ta carte graphique/);
  assert.notEqual(card.once, true, "« Toujours » allowed: it costs nothing");
  await call("POST", `/approvals/${card.approvalId}`, { decision: "always" });
  await replied(bot, "Free: made on the user's own GPU with Wan2GP");
  const sent = wan.generate.at(-1);
  assert.equal(sent.model_type, "t2v_1.3B"); assert.equal(sent.resolution, "480x832"); assert.equal(sent.video_length, 81);
  assert.match(sent.prompt, /camera movement: slow dolly in toward the subject/);
  const att = (await lastAttachment(bot))!;
  assert.match(att.path, /^videos\/lanterne.*\.mp4$/);
  assert.equal(hasAiVideoLabel(readLibraryFile(bot.id, att.path)), true);
  const step = [...(await rowsOf(bot.id))].reverse().find((r) => r.body.kind === "tool" || (r.body as any).summary);
  assert.ok(JSON.stringify(await rowsOf(bot.id)).includes("gratuit, sur ta carte graphique"), String(step && JSON.stringify(step.body)).slice(0, 200));
  assert.equal(q.get<{ s: string }>("SELECT status AS s FROM media_jobs ORDER BY created_at DESC LIMIT 1")!.s, "done");
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM tool_spend WHERE provider = 'wan2gp'")!.n, 0, "no money reserved");
});

test("B1: a run that outlasts the turn, or a restart, is picked up by its job id and posted in the chat", async () => {
  process.env.WAN2GP_IN_TURN_MS = "60";
  wan.stuck = true;
  await say(bot, 'call video_generate {"prompt": "A long one", "filename": "longue"}');
  await replied(bot, "Still running on the user's GPU");
  wan.stuck = false;
  await replied(bot, "Ta création Wan2GP est prête");
  delete process.env.WAN2GP_IN_TURN_MS;
  // A restart: a run written down as running is followed again from its job id.
  const id = mediaJobs.start({ userId, botId: bot.id, kind: "video", filename: "apres-redemarrage" });
  mediaJobs.running(id, "job-restart");
  startMediaJobs();
  await replied(bot, "reprise après un redémarrage");
  assert.equal(mediaJobs.get(id)!.status, "done");
});

test("B1: through the Relais, long answers come back in pieces and a body that does not fit is refused", async () => {
  const sent: any[] = [];
  const big = Buffer.alloc(5000, 1);
  const send = async (_d: string, _b: unknown, op: string, args: any) => {
    sent.push({ op, args: JSON.parse(JSON.stringify(args)) });
    if (!args.read) return { ok: true as const, result: { status: 200, headers: { "content-type": "video/mp4" }, data: big.subarray(0, 3000).toString("base64"), token: "a".repeat(32) } };
    return { ok: true as const, result: { status: 200, headers: {}, data: big.subarray(args.read.offset).toString("base64"), token: null } };
  };
  const f = relayFetch("dev1", 7866, { id: "b", name: "B" }, send as any);
  const res = await f("http://127.0.0.1:7866/wan/gallery/m1", { method: "GET" });
  assert.equal((await res.arrayBuffer()).byteLength, 5000);
  assert.equal(res.headers.get("content-type"), "video/mp4");
  assert.deepEqual(sent.map((s) => s.op), ["gpu.http", "gpu.http"]);
  assert.equal(sent[0].args.path, "/wan/gallery/m1"); assert.equal(sent[0].args.port, 7866);
  assert.deepEqual(sent[1].args.read, { token: "a".repeat(32), offset: 3000 });
  await assert.rejects(f("http://127.0.0.1:7866/x", { method: "PUT", body: Buffer.alloc(200 * 1024) }), /too large/);
});

test("B1: stopping the turn cancels the run on the GPU; nothing is charged", async () => {
  wan.stuck = true;
  await say(bot, 'call video_generate {"prompt": "Stop me", "filename": "stop"}');
  await until(async () => (await call("GET", "/bots")).json.live?.[bot.id]?.activity?.kind === "filming", "filming");
  await until(async () => q.get<{ s: string }>("SELECT status AS s FROM media_jobs ORDER BY created_at DESC LIMIT 1")?.s === "running" || null, "running");
  await call("POST", `/bots/${bot.id}/stop`);
  await until(async () => wan.cancels > 0 || null, "cancel sent");
  assert.equal(q.get<{ s: string }>("SELECT status AS s FROM media_jobs ORDER BY created_at DESC LIMIT 1")!.s, "cancelled");
  wan.stuck = false;
  await call("DELETE", "/media-keys/wan2gp");
});

// ── B2: studio words, refund notice ──
test("B2: camera words append to the prompt; a failed paid call says the reservation was released", async () => {
  assert.equal(cameraPrompt("A cat", {}), "A cat");
  assert.equal(cameraPrompt("A cat", { camera_move: "orbit", camera: "film_16mm", lens: "anamorphic", focal_mm: 35, aperture: "f/1.4" }),
    "A cat, camera movement: camera orbits 360 degrees around the subject, shot on a classic 16mm film camera, using a classic anamorphic lens at 35mm (natural cinematic perspective), aperture f/1.4, shallow depth of field, creamy bokeh");
  assert.equal(cameraPrompt("A cat", { camera_move: "nope" }), "A cat");
  assert.match(refundNotice("Failed.", { reservedUsd: 0.8 }), /0\.80 \$ reserved for it was released: nothing was charged/);
  assert.match(refundNotice("Failed.", { reservedUsd: 0, providerRefund: { refunded: true, amount: 3, unit: "credit" } }), /refunded 3 credits/);
  const words = await call("GET", "/camera-words");
  assert.ok(words.json.moves.some((m: any) => m.id === "dolly_in" && m.fr === "Travelling avant"));
  assert.ok(readFileSync(new URL("../src/camerawords.ts", import.meta.url), "utf8").includes("Portions adapted from Anil-matcha/Open-Generative-AI"));
});

// ── A5 in hosted mode ──
test("A5 (hosted): a « byok » account uses only its own media key, is never metered on the operator's budget, and never sees another account's keys", async () => {
  const hosted = await import("../src/hosted.js");
  const { users } = await import("../src/store.js");
  const { imageServiceFor, videoServicesFor, mediaKeys } = await import("../src/mediakeys.js");
  const { reserve } = await import("../src/thirdparty.js");
  const bob = users.create("bob@example.com", "Bob", "x", "fr").id;
  const cara = users.create("cara@example.com", "Cara", "x", "fr").id;
  process.env.HOSTED_MODE = "1"; process.env.XAI_API_KEY = "sk-fake-operator"; process.env.IMAGE_API_KEY = "sk-fake-operator-img";
  try {
    if (!hosted.plans.get("byok")) hosted.plans.save({ id: "byok", kind: "byok", nameFr: "Mes clés", nameEn: "My keys" }, userId);
    for (const u of [bob, cara]) { hosted.subscriptions.ensure(u); hosted.subscriptions.update(u, { planId: "byok", status: "active" }); }
    assert.deepEqual(videoServicesFor(bob), [], "the operator's video key is never offered on a byok plan");
    assert.equal(imageServiceFor(bob), null);
    // The operator (first account) has an own key: it is never used for another account.
    mediaKeys.set(userId, "xai", { key: "sk-fake-operator-own" });
    assert.ok(!videoServicesFor(bob).some((s) => s.apiKey === "sk-fake-operator-own"));
    mediaKeys.set(bob, "xai", { key: "sk-fake-bob" });
    const bobs = videoServicesFor(bob);
    assert.deepEqual(bobs.map((s) => [s.apiKey, s.ownKey]), [["sk-fake-bob", true]]);
    assert.deepEqual(videoServicesFor(cara), [], "Cara never gets Bob's key");
    const bobBot = (await import("../src/store.js")).bots.create(bob, { name: "Bobot" });
    assert.equal(reserve({ userId: bob, botId: bobBot.id, tool: "video", provider: "xai", maxUsd: 0.8, idemKey: "byok-1" }).kind, "refused", "the operator's keys: refused on byok");
    assert.equal(reserve({ userId: bob, botId: bobBot.id, tool: "video", provider: "xai", maxUsd: 0.8, idemKey: "byok-2", ownKey: true }).kind, "reserved", "the account's own key: not the operator's budget");
    mediaKeys.remove(userId, "xai");
  } finally { delete process.env.HOSTED_MODE; delete process.env.XAI_API_KEY; delete process.env.IMAGE_API_KEY; }
});
