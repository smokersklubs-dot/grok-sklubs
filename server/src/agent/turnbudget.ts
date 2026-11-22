/**
 * L90 — three bounds on an API turn (ideas from OpenClaw and the timon clean-room spec T25; our own code):
 *
 * - The size of one tool result follows the model's context window: at most RESULT_SHARE of the window (≈ 4 characters a
 *   token), between RESULT_MIN_CHARS and RESULT_MAX_CHARS; a longer text keeps its head and tail with a marker between.
 *   (Long results are already kept whole on the bot's computer by the tools that can — tools.ts spillIfLong; this is the
 *   last line of defence for every other tool and app.)
 * - A big picture in a tool result (over IMAGE_MAX_BYTES once decoded) is reduced before it is sent (visionpayload.ts
 *   imagePreview: same sizes as the pictures the user sends). A picture that cannot be read is replaced by a short note.
 * - The total time of one API turn: past TURN_TIME_BUDGET_MINUTES (default 60, 0 = none) the turn stops at its next
 *   step, between two steps, with the same « Continuer » as a subscription turn at its time limit. A turn resumed after
 *   an approval starts a new count (waiting for the user is not the turn's time).
 */
import { config } from "../config.js";
import { rows, type BotRecord, type UserRecord } from "../store.js";
import type { ImageBlock, TextBlock } from "../llm/index.js";
import { imagePreview } from "../visionpayload.js";
import { contextWindowOf } from "./context.js";
import type { ToolOutput } from "./tools.js";
import { lt } from "./looptext.js";

export const RESULT_SHARE = 0.3;
export const RESULT_MIN_CHARS = 20_000;
export const RESULT_MAX_CHARS = 400_000;
export const IMAGE_MAX_BYTES = 1_500_000;
export const RESULT_CUT = "\n\n[... the middle of this result was cut to fit the model's context window ...]\n\n";

const minutes = (): number => { const n = Number(process.env.TURN_TIME_BUDGET_MINUTES); return Number.isFinite(n) && n >= 0 ? n : 60; };
export const turnTimeBudgetMs = (): number => minutes() * 60_000;

/** Characters one tool result may take for this model. */
export function resultCharsFor(userId: string, modelRef: string): number {
  const tokens = contextWindowOf(userId, modelRef) || config.contextWindowTokens;
  return Math.round(Math.min(RESULT_MAX_CHARS, Math.max(RESULT_MIN_CHARS, tokens * 4 * RESULT_SHARE)));
}

/** A text kept to `max` characters: its head (3/4) and its tail (1/4) around a marker. */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = Math.max(0, max - RESULT_CUT.length);
  const head = Math.floor(room * 0.75);
  return text.slice(0, head) + RESULT_CUT + text.slice(text.length - (room - head));
}

/** The text parts of a tool result capped for the turn's model (pictures untouched). */
export function capParts<T extends TextBlock | ImageBlock>(turn: { user: UserRecord; modelRef: string }, parts: T[]): T[] {
  const max = resultCharsFor(turn.user.id, turn.modelRef);
  return parts.map((p) => (p.type === "text" && p.text.length > max ? { ...p, text: capText(p.text, max) } : p));
}

/** Big pictures of a tool result reduced before they are sent. Never throws. */
export async function shrinkImages(out: ToolOutput): Promise<ToolOutput> {
  if (typeof out.content === "string" || !out.content.some((b) => b.type === "image" && approxBytes(b) > IMAGE_MAX_BYTES)) return out;
  const content = await Promise.all(out.content.map(async (b): Promise<TextBlock | ImageBlock> => {
    if (b.type !== "image" || approxBytes(b) <= IMAGE_MAX_BYTES) return b;
    try {
      const small = await imagePreview(Buffer.from(b.data, "base64"), IMAGE_MAX_BYTES);
      return { ...b, mediaType: "image/jpeg", data: small.toString("base64") } as ImageBlock;
    } catch { return { type: "text", text: "[A picture was here; it was too big to send and could not be reduced.]" }; }
  }));
  return { ...out, content };
}
const approxBytes = (b: ImageBlock) => Math.floor((b.data?.length ?? 0) * 3 / 4);

const started = new WeakMap<object, number>();

/**
 * At a safe point between two steps: true when the turn used up its time budget — it then stops with a notice and
 * « Continuer » (what it did is kept).
 */
export function overTimeBudget(turn: { bot: BotRecord; user: UserRecord; thread: number }, now = Date.now()): boolean {
  const budget = turnTimeBudgetMs();
  if (!started.has(turn)) started.set(turn, now);
  if (!budget || now - started.get(turn)! < budget) return false;
  rows.append(turn.bot, { kind: "notice", tone: "warn", text: lt(turn.user.locale, "I stopped this turn after {min} minutes: that is the time budget for one turn. What I did so far is kept. Press Continue, or just tell me to continue, to pick it back up.", { min: Math.round(budget / 60_000) }), action: { kind: "continue", status: "pending", reason: "timeout" } }, turn.thread);
  return true;
}
