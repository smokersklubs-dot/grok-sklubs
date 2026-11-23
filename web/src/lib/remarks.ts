/**
 * L140, the rest of « corriger sans recopier » (pure, tested in scripts/remarks.test.mjs): the words sent to the bot when
 * you comment an element of a published page, annotate an image, point at a spot of its screen (« Montrer ») or leave a
 * remark on one changed file. Plain Markdown the bot reads as is; nothing is sent without the owner's click.
 * `head` is the sentence in the reader's language (from the dictionary), `remark` what the owner typed.
 * Our own code (ideas: Plannotator annotations, Timon T75, ECC).
 */
import { quoteLines } from "./passage.ts";
import type { PagePick } from "../../../server/src/clientshared/pagecomment";

/** Longest remark kept (characters, as Timon's T75 « consigne » limit). */
export const REMARK_MAX = 4000;
const cut = (s: string, max = REMARK_MAX) => (s.trim().length > max ? s.trim().slice(0, max - 1).trimEnd() + "…" : s.trim());

/** A remark on one element of a page: which page, which element (its CSS path), its words, then the remark. */
export function pageRemarkMessage(head: string, pick: PagePick, remark: string): string {
  const words = cut(remark);
  if (!words || !head.trim()) return "";
  const quoted = pick.selection || pick.text;
  return [head.trim(), `\`${pick.path.replace(/`/g, "")}\``, ...(quoted ? [quoteLines(quoted)] : []), "", words].join("\n");
}

/** A numbered pin on an image, in fractions of its width and height (0–1). */
export interface Pin { x: number; y: number; note: string }

/** Where a point is, in words any bot reads: x from the left and y from the top in percent, plus pixels when the size is known. */
export function where(x: number, y: number, size?: { w: number; h: number } | null): string {
  const px = Math.round(Math.min(1, Math.max(0, x)) * 100);
  const py = Math.round(Math.min(1, Math.max(0, y)) * 100);
  const pixels = size && size.w > 0 && size.h > 0 ? ` (px ${Math.round(x * size.w)},${Math.round(y * size.h)} / ${size.w}×${size.h})` : "";
  return `x ${px} %, y ${py} %${pixels}`;
}

/** The annotated image's message: one line per numbered pin (its place and note), then the general remark. */
export function imageRemarkMessage(head: string, pins: Pin[], remark: string, size?: { w: number; h: number } | null): string {
  const lines = pins.filter((p) => p.note.trim()).map((p) => `${pins.indexOf(p) + 1}. (${where(p.x, p.y, size)}) ${cut(p.note, 600)}`);
  const words = cut(remark);
  if (!head.trim() || (!lines.length && !words && !pins.length)) return "";
  return [head.trim(), ...lines, ...(words ? ["", words] : [])].join("\n");
}

/** « Montrer »: a spot of the bot's screen, in screen pixels when its size is known, and what to do there. */
export function screenPointMessage(head: string, x: number, y: number, size: { w: number; h: number } | null, remark: string): string {
  const words = cut(remark);
  if (!head.trim() || !words) return "";
  return `${head.trim()} ${where(x, y, size)}\n\n${words}`;
}

/** A remark on one file the bot changed: its path, then the remark. */
export function fileRemarkMessage(head: string, path: string, remark: string): string {
  const words = cut(remark);
  const p = path.trim().replace(/`/g, "");
  if (!head.trim() || !words || !p) return "";
  return `${head.trim()} \`~/${p}\`\n\n${words}`;
}

/** The point of an element where a click landed, in fractions of the element (clamped), or null outside it. */
export function fractionIn(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (x < 0 || y < 0 || x > 1 || y > 1) return null;
  return { x, y };
}
