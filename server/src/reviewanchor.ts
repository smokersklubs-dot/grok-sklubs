/*
 * Portions adapted from alibaba/open-code-review (https://github.com/alibaba/open-code-review, commit
 * e74f2c6bd4422bd1e12d257d1725bcce1d6b9ddd), Copyright 2026 alibaba/open-code-review Contributors, Apache-2.0;
 * modified for Sklubot: internal/diff/hunk.go (ParseHunks, hunk header) and internal/diff/resolver.go
 * (resolveFromHunk: new side, new side without blank lines, then old side; resolveFromFileContent; RelocateAcrossFiles:
 * re-file a comment on the one other file of the lot that holds its quoted code, never on a guess) ported to
 * TypeScript; the fallback reads the whole new file through the snapshot instead of an in-memory copy; an unlocated
 * finding keeps line 0 instead of a model re-location task.
 */
import type { ReviewFinding } from "./peerreviewtypes.js";

interface HunkLine { type: "ctx" | "add" | "del"; content: string }
interface Hunk { oldStart: number; newStart: number; lines: HunkLine[] }
interface Indexed { line: number; content: string }

const HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  for (const line of diff.split("\n")) {
    const h = line.startsWith("@@ ") ? HEADER.exec(line) : null;
    if (h) { if (current) hunks.push(current); current = { oldStart: +h[1], newStart: +h[2], lines: [] }; continue; }
    if (!current || line.startsWith("\\ No newline at end of file")) continue;
    if (line.startsWith("diff --git ")) break;
    if (line.startsWith("+")) current.lines.push({ type: "add", content: line.slice(1) });
    else if (line.startsWith("-")) current.lines.push({ type: "del", content: line.slice(1) });
    else current.lines.push({ type: "ctx", content: line.startsWith(" ") ? line.slice(1) : line });
  }
  if (current) hunks.push(current);
  return hunks;
}

/** Trims the line and drops one leading diff marker, as upstream normalizeLine; Sklubot also folds runs of spaces. */
const normalize = (s: string) => s.trim().replace(/^[+-]/, "").trim().replace(/\s+/g, " ");
const target = (code: string) => code.split("\n").map(normalize).filter(Boolean);

function side(h: Hunk, newSide: boolean): Indexed[] {
  const out: Indexed[] = [];
  let oldLine = h.oldStart, newLine = h.newStart;
  for (const l of h.lines) {
    if (l.type === "ctx") { out.push({ line: newSide ? newLine : oldLine, content: normalize(l.content) }); oldLine++; newLine++; }
    else if (l.type === "add") { if (newSide) out.push({ line: newLine, content: normalize(l.content) }); newLine++; }
    else { if (!newSide) out.push({ line: oldLine, content: normalize(l.content) }); oldLine++; }
  }
  return out;
}

function consecutive(lines: Indexed[], want: string[]): [number, number] | null {
  for (let i = 0; i + want.length <= lines.length; i++)
    if (want.every((w, j) => lines[i + j].content === w)) return [lines[i].line, lines[i + want.length - 1].line];
  return null;
}

/** Where the quoted code sits in this file's diff: [start, end, side] or null. */
export function locateInDiff(diff: string, code: string): [number, number, "new" | "old"] | null {
  const want = target(code);
  if (!want.length) return null;
  const hunks = parseHunks(diff);
  for (const h of hunks) { const m = consecutive(side(h, true), want); if (m) return [...m, "new"]; }
  for (const h of hunks) { const m = consecutive(side(h, true).filter((l) => l.content !== ""), want); if (m) return [...m, "new"]; }
  for (const h of hunks) { const m = consecutive(side(h, false), want); if (m) return [...m, "old"]; }
  return null;
}

/** The quoted code in the whole new file (blank lines skipped, as upstream). */
export function locateInFile(content: string, code: string): [number, number] | null {
  const want = target(code);
  if (!want.length) return null;
  const lines: Indexed[] = [];
  content.split("\n").forEach((l, i) => { const n = normalize(l.replace(/\r$/, "")); if (n) lines.push({ line: i + 1, content: n }); });
  return consecutive(lines, want);
}

export interface Located { finding: ReviewFinding; code: string }

/**
 * Anchors each finding: in its own file's diff, else (unique hit only) in another file of the lot, else in the whole
 * new file read from the snapshot (`readNew`, bounded by the caller), else line 0.
 */
export async function anchorFindings(items: Located[], diffs: Map<string, string>, readNew: (path: string) => Promise<string | null>): Promise<ReviewFinding[]> {
  const out: ReviewFinding[] = [];
  for (const { finding, code } of items) {
    const f = { ...finding };
    const own = diffs.get(f.path);
    const hit = own !== undefined && code ? locateInDiff(own, code) : null;
    if (hit) { [f.line, f.endLine, f.side] = hit; out.push(f); continue; }
    if (code) {
      const others = [...diffs].filter(([p]) => p !== f.path).map(([p, d]) => [p, locateInDiff(d, code)] as const).filter(([, m]) => m);
      if (others.length === 1) { const [p, m] = others[0]; f.path = p; [f.line, f.endLine, f.side] = m!; out.push(f); continue; }
      const content = await readNew(f.path);
      const m = content ? locateInFile(content, code) : null;
      if (m) { [f.line, f.endLine] = m; f.side = "new"; out.push(f); continue; }
    }
    f.line = 0; f.endLine = 0;
    out.push(f);
  }
  return out;
}
