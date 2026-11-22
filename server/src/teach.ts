import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { emit } from "./bus.js";
import { screen } from "./computer.js";
import { config } from "./config.js";
import { tr } from "./i18n.js";
import { defaultModelRef, listProviders, resolveModel, userProvidersOf, type Block } from "./llm/index.js";
import { describeKey, MODIFIERS, type RfbEvent } from "./rfb.js";
import type { Recording, SkillDraft } from "./shared.js";
import { audit, bots, clip, newId, now, rows, skills, users, type BotRecord } from "./store.js";
import { record } from "./usage.js";
import { isEngineRef } from "./agent/engine.js"; import { asBoxes, blackOut, maskUrl, secretBoxesScript } from "./teachmask.js";

/**
 * "Show me how": the user performs a task on a bot's screen while the server keeps a few screenshots and a
 * timeline of what they did; the bot then turns it into a skill the user checks before it is saved.
 *
 * Privacy: of the keyboard only counts and special keys are kept ("typed 12 characters", "Enter", "ctrl+l"),
 * never the characters, so a password typed during a demonstration is not recorded. Recordings live under
 * DATA_DIR/recordings (outside the bot's library and its computer) and are deleted once the skill is saved or
 * discarded, and at every start of the server.
 */
export const MAX_RECORDING_MS = 10 * 60_000;
const FRAME_EVERY_MS = 2500;
const MAX_FRAMES = 300;
const KEY_FRAMES = 6;
const root = path.join(config.dataDir, "recordings");
rmSync(root, { recursive: true, force: true });

interface Frame { t: number; file: string; title: string; url: string }
interface Step { t: number; text: string }
interface Rec {
  id: string; botId: string; userId: string; dir: string; startedAt: number; stoppedAt: number | null;
  status: Recording["status"]; error: string | null; draft: SkillDraft | null; note: string;
  frames: Frame[]; steps: Step[]; lastHash: string; where: { title: string; url: string }; lastWhereAt: number;
  timer: NodeJS.Timeout | null; limit: NodeJS.Timeout | null; capturing: boolean; announced: number;
  // Input state
  held: Set<string>; buttons: number; press: { x: number; y: number; t: number } | null; lastClick: { x: number; y: number; t: number } | null; pointer: { x: number; y: number };
}
const recs = new Map<string, Rec>();

const view = (r: Rec): Recording => ({ id: r.id, botId: r.botId, startedAt: r.startedAt, stoppedAt: r.stoppedAt, status: r.status, frames: r.frames.length, events: r.steps.length, maxMs: MAX_RECORDING_MS, error: r.error, draft: r.draft });
function announce(r: Rec, force = false) {
  if (!force && Date.now() - r.announced < 1000) return;
  r.announced = Date.now();
  emit(r.userId, { type: "recording", botId: r.botId, recording: recs.get(r.botId) === r ? view(r) : null });
}

export const recording = (botId: string): Recording | null => { const r = recs.get(botId); return r ? view(r) : null; };
export const isRecording = (botId: string) => recs.get(botId)?.status === "recording";

async function capture(r: Rec, force = false) {
  if (r.capturing || r.status !== "recording" || r.frames.length >= MAX_FRAMES) return;
  r.capturing = true;
  try {
    const raw = await screen.frame(r.botId).catch(() => null);
    if (!raw || r.status !== "recording") return;
    // L40 (teachmask.ts): secret fields and secret-looking text on the page are painted black before the picture is kept.
    const shot = await blackOut(raw, asBoxes(await screen.secretBoxes(r.botId, secretBoxesScript).catch(() => null)));
    const hash = createHash("sha1").update(shot).digest("hex");
    if (hash === r.lastHash && !force) return;
    r.lastHash = hash;
    const t = Date.now() - r.startedAt;
    const file = path.join(r.dir, `frame-${String(r.frames.length + 1).padStart(4, "0")}.jpg`);
    try { writeFileSync(file, shot); } catch { return; } // discarded meanwhile
    const frame: Frame = { t, file, title: r.where.title, url: r.where.url };
    r.frames.push(frame);
    announce(r);
    // Where the user is: window title and page address, at most every few seconds (the page's text is never kept).
    if (Date.now() - r.lastWhereAt > 4000) {
      r.lastWhereAt = Date.now();
      r.where = await screen.where(r.botId).then((w) => ({ ...w, url: maskUrl(w.url) })).catch(() => r.where); // L40: no token in a kept address
      frame.title = r.where.title; frame.url = r.where.url;
      const last = [...r.steps].reverse().find((s) => s.text.startsWith("page: "));
      const place = `page: ${clip(r.where.title || "(untitled)", 120)}${r.where.url ? ` — ${clip(r.where.url, 200)}` : ""}`;
      if ((r.where.title || r.where.url) && last?.text !== place && r.status === "recording") { r.steps.push({ t, text: place }); r.steps.sort((a, b) => a.t - b.t); }
    }
  } finally { r.capturing = false; }
}

export function startRecording(bot: BotRecord): Recording {
  if (bot.kind !== "agent") throw new Error("Only a bot with a computer can be shown a task.");
  if (!screen.isOpen(bot.id)) throw new Error("Switch the bot's computer on first.");
  const cur = recs.get(bot.id);
  if (cur?.status === "recording" || cur?.status === "processing") throw new Error("A demonstration is already under way for this bot.");
  if (cur) dropRecording(bot.id);
  const id = newId("rec");
  const dir = path.join(root, bot.id.replace(/[^\w-]/g, "_"), id);
  mkdirSync(dir, { recursive: true });
  const r: Rec = {
    id, botId: bot.id, userId: bot.userId, dir, startedAt: now(), stoppedAt: null, status: "recording", error: null, draft: null, note: "",
    frames: [], steps: [], lastHash: "", where: { title: "", url: "" }, lastWhereAt: 0, timer: null, limit: null, capturing: false, announced: 0,
    held: new Set(), buttons: 0, press: null, lastClick: null, pointer: { x: 0, y: 0 },
  };
  recs.set(bot.id, r);
  r.timer = setInterval(() => void capture(r), FRAME_EVERY_MS);
  r.limit = setTimeout(() => void stopRecording(bot.id, "").catch(() => undefined), MAX_RECORDING_MS);
  void capture(r, true);
  audit(bot.userId, "system", `${bot.name}: demonstration recording started`, bot.id);
  announce(r, true);
  return view(r);
}

const at = (r: Rec) => Date.now() - r.startedAt;
function step(r: Rec, text: string) {
  if (r.steps.length >= 2000) return;
  r.steps.push({ t: at(r), text });
  announce(r);
}
/** Typed characters are merged into one "typed N characters" line while the user keeps typing. */
function typed(r: Rec, n: number) {
  const last = r.steps[r.steps.length - 1];
  const m = last && at(r) - last.t < 4000 ? /^typed (\d+) characters?$/.exec(last.text) : null;
  if (m) { const total = Number(m[1]) + n; last.text = `typed ${total} character${total === 1 ? "" : "s"}`; last.t = at(r); }
  else step(r, `typed ${n} character${n === 1 ? "" : "s"}`);
}
/** A screenshot shortly after something happened, so the key moments are on record. */
const soon = (r: Rec) => setTimeout(() => void capture(r), 700);

/** Input seen by the screen proxy (VNC, control mode). */
export function noteRfb(botId: string, ev: RfbEvent) {
  const r = recs.get(botId);
  if (!r || r.status !== "recording") return;
  if (ev.type === "key") {
    const mod = MODIFIERS[ev.keysym];
    if (mod) { if (ev.down) r.held.add(mod); else r.held.delete(mod); return; }
    if (!ev.down) return;
    const k = describeKey(ev.keysym, r.held);
    if (k.kind === "typed") typed(r, 1);
    else if (k.kind === "named") { step(r, `pressed ${k.name}`); if (/Enter|Tab|\+/.test(k.name)) soon(r); }
    return;
  }
  const { buttons, x, y } = ev;
  const was = r.buttons;
  r.buttons = buttons;
  r.pointer = { x, y };
  const pressed = (bit: number) => (buttons & bit) && !(was & bit);
  const released = (bit: number) => !(buttons & bit) && (was & bit);
  if (pressed(1)) r.press = { x, y, t: at(r) };
  if (released(1) && r.press) {
    const p = r.press;
    r.press = null;
    if (Math.hypot(x - p.x, y - p.y) > 12) step(r, `dragged from (${p.x}, ${p.y}) to (${x}, ${y})`);
    else {
      const last = r.steps[r.steps.length - 1];
      if (r.lastClick && at(r) - r.lastClick.t < 450 && Math.hypot(x - r.lastClick.x, y - r.lastClick.y) < 8 && last?.text.startsWith("clicked at")) { last.text = `double-clicked at (${x}, ${y})`; r.lastClick = null; }
      else { step(r, `clicked at (${x}, ${y})`); r.lastClick = { x, y, t: at(r) }; }
    }
    soon(r);
  }
  if (pressed(4)) step(r, `right-clicked at (${x}, ${y})`);
  if (pressed(8) || pressed(16)) {
    const dir = pressed(8) ? "up" : "down";
    const last = r.steps[r.steps.length - 1];
    if (last && at(r) - last.t < 1500 && last.text.startsWith(`scrolled ${dir}`)) last.t = at(r);
    else step(r, `scrolled ${dir} at (${x}, ${y})`);
  }
}

/** Input sent through the screenshot viewer (computers without a live screen stream). */
export function noteInput(botId: string, input: { type: string; x?: number; y?: number; text?: string; key?: string; dy?: number; url?: string }) {
  const r = recs.get(botId);
  if (!r || r.status !== "recording") return;
  if (input.type === "click") { step(r, `clicked at (${Math.round(input.x ?? 0)}, ${Math.round(input.y ?? 0)})`); soon(r); }
  else if (input.type === "type") typed(r, [...String(input.text ?? "")].length);
  else if (input.type === "key") { step(r, `pressed ${clip(String(input.key ?? ""), 20)}`); soon(r); }
  else if (input.type === "scroll") step(r, `scrolled ${(input.dy ?? 0) < 0 ? "up" : "down"} at (${Math.round(input.x ?? 0)}, ${Math.round(input.y ?? 0)})`);
  else if (input.type === "goto") { step(r, `opened the address ${clip(maskUrl(String(input.url ?? "")), 200)}`); soon(r); }
}

const stamp = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

/** The handful of screenshots worth showing the model: the first, the last, and those right after a click or a key. */
export function keyFrames(frames: { t: number }[], steps: { t: number; text: string }[], max = KEY_FRAMES): number[] {
  if (!frames.length) return [];
  const picked = new Set<number>([0, frames.length - 1]);
  for (const s of steps) {
    if (!/^(clicked|double-clicked|right-clicked|pressed|dragged|opened)/.test(s.text)) continue;
    const i = frames.findIndex((f) => f.t >= s.t + 300);
    if (i >= 0) picked.add(i);
  }
  let list = [...picked].sort((a, b) => a - b);
  if (list.length > max) {
    // Keep the first and the last; spread the rest evenly.
    const inner = list.slice(1, -1);
    const keep = Array.from({ length: max - 2 }, (_, k) => inner[Math.floor(((k + 0.5) * inner.length) / (max - 2))]);
    list = [list[0], ...keep, list[list.length - 1]];
  }
  return [...new Set(list)];
}

export const SKILL_FROM_DEMO = "You turn a recorded demonstration into a reusable skill";

function parseDraft(text: string): SkillDraft | null {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const steps = Array.isArray(j.steps) ? j.steps.map((s, i) => `${i + 1}. ${String(s).replace(/^\d+[.)]\s*/, "")}`).join("\n") : String(j.steps ?? "");
    const name = clip(String(j.name ?? "").trim(), 80);
    if (!name || !steps.trim()) return null;
    return { name, when: clip(String(j.when ?? "").trim(), 300), steps: steps.trim().slice(0, 20_000) };
  } catch { return null; }
}

async function draftSkill(r: Rec) {
  const bot = bots.byId(r.botId);
  if (!bot) throw new Error("the bot no longer exists");
  // The bot's own model looks at the screenshots; a bot on a subscription tool uses the server's model for this.
  const ref = isEngineRef(bot.model) ? config.auxModel || defaultModelRef() : bot.model || defaultModelRef();
  if (!listProviders().some((p) => p.available()) && !userProvidersOf(bot.userId).length) throw new Error("turning a demonstration into a skill needs a model on the server");
  const { provider, model } = resolveModel(ref, bot.userId);
  const picks = keyFrames(r.frames, r.steps);
  const content: Block[] = [];
  for (const i of picks) {
    const f = r.frames[i];
    content.push({ type: "text", text: `Screenshot at ${stamp(f.t)}${f.title ? ` — window: ${f.title}` : ""}${f.url ? ` — ${f.url}` : ""}` });
    content.push({ type: "image", mediaType: "image/jpeg", data: readFileSync(f.file).toString("base64") });
  }
  const timeline = r.steps.map((s) => `${stamp(s.t)} ${s.text}`).join("\n") || "(no input was recorded)";
  const loc = users.localeOf(bot.userId);
  content.push({
    type: "text",
    text: `${r.note ? `What the user said about it: ${r.note}\n\n` : ""}Timeline of the demonstration (screen coordinates are pixels on a ${config.desktopResolution.split("x").slice(0, 2).join("×")} screen; for privacy, typed text is only counted):\n${timeline}\n\n` +
      `Write the skill as JSON only: {"name": "short name", "when": "when to use it, one line", "steps": ["step 1", "step 2", …]}. ` +
      `Steps must be concrete and reusable: name the site or program, the buttons, menus and fields by their visible labels (not coordinates), and say where the user must type something (for example "type the client's name"). ` +
      `Never include passwords or other secrets; for a sign-in, say to use the saved login from the vault. Write in ${loc === "fr" ? "French" : "English"}.`,
  });
  const res = await provider.runTurn({
    model, tools: [], effort: "low", maxTokens: 4000, signal: AbortSignal.timeout(180_000),
    system: `${SKILL_FROM_DEMO}. You are ${bot.name}, an AI teammate with your own computer; the user just showed you how to do a task on your screen. From the screenshots and the timeline, work out what they did and why, and write the procedure you will follow next time.`,
    messages: [{ role: "user", content }],
  });
  record(bot.userId, bot.id, res.model, res.usage);
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const draft = parseDraft(text);
  if (!draft) throw new Error("the model did not return a usable skill");
  return draft;
}

async function draftFrom(r: Rec) {
  r.status = "processing";
  r.error = null;
  announce(r, true);
  try {
    r.draft = await draftSkill(r);
    r.status = "review";
  } catch (err) {
    r.status = "error";
    r.error = clip(String((err as Error)?.message ?? err), 300);
  }
  announce(r, true);
}

/** Ends the recording (or it ends by itself after 10 minutes) and has the bot draft the skill. */
export async function stopRecording(botId: string, note: string): Promise<Recording> {
  const r = recs.get(botId);
  if (!r) throw new Error("Nothing is being recorded for this bot.");
  if (r.status !== "recording") return view(r);
  if (r.timer) clearInterval(r.timer);
  if (r.limit) clearTimeout(r.limit);
  r.timer = r.limit = null;
  r.note = clip(note.trim(), 2000);
  await capture(r, true).catch(() => undefined);
  r.status = "processing";
  r.stoppedAt = now();
  void draftFrom(r);
  return view(r);
}

/** Drafting failed: try again with the same recording. */
export function retryRecording(botId: string): Recording {
  const r = recs.get(botId);
  if (!r || r.status !== "error") throw new Error("There is no demonstration to try again.");
  void draftFrom(r);
  return view(r);
}

/** Saves the (possibly edited) skill with skill_save semantics: a skill with the same name is replaced. Then the recording is deleted. */
export function saveRecording(bot: BotRecord, draft: SkillDraft): { skillId: string; replaced: boolean } {
  const r = recs.get(bot.id);
  if (!r || (r.status !== "review" && r.status !== "error")) throw new Error("There is no skill waiting to be saved.");
  const name = clip(draft.name.trim(), 80), body = draft.steps.trim().slice(0, 20_000), when = clip(draft.when.trim(), 300);
  if (!name || !body) throw new Error("A skill needs a name and steps.");
  const existing = skills.list(bot.id).find((k) => k.name.toLowerCase() === name.toLowerCase());
  const saved = existing ? skills.update(existing.id, { name, description: when, body }) : skills.create(bot.id, name, when, body);
  emit(bot.userId, { type: "memories", botId: bot.id });
  rows.append(bot, { kind: "event", event: "computer", text: tr(users.localeOf(bot.userId), "Learned a skill from your demonstration: {name}", { name }) }, 0);
  audit(bot.userId, "system", `${bot.name}: skill learned from a demonstration — ${name}`, bot.id);
  dropRecording(bot.id);
  return { skillId: saved.id, replaced: !!existing };
}

/** Throws the recording away (files included). */
export function dropRecording(botId: string) {
  const r = recs.get(botId);
  if (!r) return;
  if (r.timer) clearInterval(r.timer);
  if (r.limit) clearTimeout(r.limit);
  recs.delete(botId);
  rmSync(r.dir, { recursive: true, force: true });
  emit(r.userId, { type: "recording", botId, recording: null });
}

/** Where a recording's files are (tests check they are gone). */
export const recordingDir = (botId: string) => recs.get(botId)?.dir ?? null;
