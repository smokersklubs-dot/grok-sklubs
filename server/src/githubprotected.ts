import { createHash, randomUUID } from "node:crypto";
import { findSecrets } from "./shared.js";

// A reserved, random marker replaces an entire line, including its indentation.
const prefix = "[[SKLUBOT_PROTECTED_";
export interface ProtectedLines {
  blob: string;
  nonce: string;
  lines: number[];
}
export const gitBlobSha = (text: string) => {
  const data = Buffer.from(text, "utf8");
  return createHash("sha1")
    .update("blob " + data.byteLength + "\0")
    .update(data)
    .digest("hex");
};
export const privateValues = (texts: string[]): string[] => [
  ...new Set(texts.flatMap((text) => findSecrets(text).map((s) => s.value))),
];
export function hidePrivateValues(text: string, values: string[]): string {
  for (const value of values) if (text.includes(value)) text = text.split(value).join("[redacted]");
  return text;
}
const marker = (nonce: string, i: number) => prefix + nonce + "_" + i + "]]";
const badMarker = () => Error("Une ligne protégée a été déplacée, copiée ou modifiée.");
function projected(lines: string[], hidden: Set<number>, nonce: string) {
  return lines
    .map((line, i) => (hidden.has(i) ? marker(nonce, i) + (line.endsWith("\r") ? "\r" : "") : line))
    .join("\n");
}
/** No private line or its digest is embedded in the patch. The reference is GitHub's immutable whole-file blob. */
export function protectGithubText(raw: string, blob: string, clean: (s: string) => string, values: string[]) {
  if (raw.includes(prefix)) throw Error("Le fichier contient déjà un marqueur de protection réservé.");
  const lines = raw.split("\n"),
    hidden = new Set<number>(),
    nonce = randomUUID();
  // Cover token/password matches and every other occurrence of the same value, including in another selected file.
  const spans: { from: number; to: number }[] = [];
  for (const value of values) {
    let from = raw.indexOf(value);
    while (from >= 0) {
      spans.push({ from, to: from + value.length });
      from = raw.indexOf(value, from + Math.max(1, value.length));
    }
  }
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const end = offset + lines[i].length + (i < lines.length - 1 ? 1 : 0);
    if (spans.some((s) => s.from < end && s.to > offset)) hidden.add(i);
    offset = end;
  }
  const masked = (i: number) =>
    hidden.has(i) ? marker(nonce, i) + (lines[i].endsWith("\r") ? "\r" : "") : lines[i];
  // Locate account vault values without exporting them. A multiline value may cross two halves.
  const dirty = (start: number, end: number) => {
    const text = lines
      .slice(start, end)
      .map((_, n) => masked(start + n))
      .join("\n");
    return clean(text) !== text;
  };
  while (dirty(0, lines.length)) {
    let left = 0,
      right = lines.length - 1;
    while (left < right) {
      const mid = Math.ceil((left + right) / 2);
      if (dirty(mid, lines.length)) left = mid;
      else right = mid - 1;
    }
    const start = left;
    left = start + 1;
    right = lines.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (dirty(start, mid)) right = mid;
      else left = mid + 1;
    }
    const previousSize = hidden.size;
    for (let i = start; i < left; i++) hidden.add(i);
    if (previousSize === hidden.size) throw Error("Ce fichier ne peut pas être masqué intégralement.");
  }
  const before = projected(lines, hidden, nonce);
  if (clean(before) !== before || values.some((v) => before.includes(v)))
    throw Error("Ce fichier ne peut pas être masqué intégralement.");
  if (!hidden.size) return { before };
  if (gitBlobSha(raw) !== blob) throw Error("Le contenu GitHub ne correspond pas au blob d’origine.");
  return { before, protectedLines: { blob, nonce, lines: [...hidden].sort((a, b) => a - b) } };
}
export function verifyProtectedLines(before: string | null, after: string, protection?: ProtectedLines) {
  if (!protection) {
    if (after.includes(prefix)) throw badMarker();
    return;
  }
  if (
    !before ||
    !/^[0-9a-f-]{36}$/.test(protection.nonce) ||
    !/^[0-9a-f]{40}$/.test(protection.blob) ||
    !Array.isArray(protection.lines) ||
    !protection.lines.length
  )
    throw badMarker();
  const src = before.split("\n"),
    dst = after.split("\n"),
    protectedSet = new Set(protection.lines);
  if (protectedSet.size !== protection.lines.length) throw badMarker();
  for (const i of protectedSet) {
    if (!Number.isInteger(i) || i < 0 || i >= src.length) throw badMarker();
    const m = marker(protection.nonce, i);
    if (
      (src[i] !== m && src[i] !== m + "\r") ||
      dst[i] !== src[i] ||
      (i === src.length - 1) !== (i === dst.length - 1)
    )
      throw badMarker();
  }
  if (dst.some((s, i) => s.includes(prefix) && !protectedSet.has(i))) throw badMarker();
}
export function applyGithubEdits(before: string | null, proposal: { content?: unknown; edits?: unknown }): string {
  if (Array.isArray(proposal.edits)) {
    if (before === null || proposal.content !== undefined || !proposal.edits.length || proposal.edits.length > 12)
      throw Error("Liste de modifications invalide.");
    let text = before;
    for (const e of proposal.edits) {
      if (
        typeof e?.oldText !== "string" ||
        !e.oldText ||
        typeof e.newText !== "string" ||
        e.newText.length > 64000 ||
        e.oldText.includes(prefix) ||
        e.newText.includes(prefix)
      )
        throw badMarker();
      const index = text.indexOf(e.oldText);
      if (index < 0 || text.indexOf(e.oldText, index + 1) >= 0)
        throw Error("L’extrait public à remplacer doit être exact et unique.");
      text = text.slice(0, index) + e.newText + text.slice(index + e.oldText.length);
    }
    return text;
  }
  if (typeof proposal.content !== "string") throw Error("Le bot n’a pas renvoyé de correctif exploitable.");
  return proposal.content;
}
export function restoreGithubText(raw: string, before: string | null, after: string, protection: ProtectedLines) {
  verifyProtectedLines(before, after, protection);
  const original = raw.split("\n"),
    hidden = new Set(protection.lines);
  if (
    raw.includes(prefix) ||
    gitBlobSha(raw) !== protection.blob ||
    projected(original, hidden, protection.nonce) !== before
  )
    throw Error("Le fichier protégé ne correspond plus à la version relue.");
  return after
    .split("\n")
    .map((line, i) => (hidden.has(i) ? original[i] : line))
    .join("\n");
}
