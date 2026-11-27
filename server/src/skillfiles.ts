import { q } from "./db.js";
import { scanSkill } from "./skillscan.js";
import { clip, now } from "./store.js";

/**
 * Companion files of a skill (backlog L130, docs/COMPETENCES.md « Fichiers d'accompagnement »).
 *
 * A good skill often comes with files next to its SKILL.md: other Markdown pages, a CSS sheet, a small JS file, an HTML
 * template. They are kept here as TEXT, beside the skill, and never run on the server: the bot reads one with
 * skill_read and `file`, then copies or adapts it in its own work (its library, its computer, a page it publishes).
 * Only text formats are kept (COMPANION below), each file 100 KB at most, 30 files and 400 KB per skill; anything else
 * (pictures, archives, programs, fonts) is left out and named. Every kept file goes through the skill safety check like
 * the skill's own text: a "danger" there flags the skill.
 *
 * Also here: splitting a skill too long to keep in one piece into numbered parts (« découpage », L130), each part
 * saying which part it is and naming the others, cut at its "## " headings (then at paragraphs).
 *
 * Table created at module load (house pattern), removed with its skill (ON DELETE CASCADE).
 */

q.run(`CREATE TABLE IF NOT EXISTS skill_files (
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE, path TEXT NOT NULL, content TEXT NOT NULL,
  size INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (skill_id, path))`);

/** Text formats a skill may carry: documents, styles, scripts and templates (kept as text, never run here). */
export const COMPANION = /\.(md|markdown|txt|html?|css|js|mjs|cjs|jsx|ts|tsx|json|csv|svg|ya?ml|toml|xml)$/i;
export const MAX_COMPANION_FILE = 100_000;
export const MAX_COMPANION_FILES = 30;
export const MAX_COMPANION_TOTAL = 400_000;
const SEGMENT = /^[A-Za-z0-9._ @+-]{1,80}$/;

export interface CompanionFile { path: string; content: string }

/** A relative path inside the skill's folder, or null (absolute, "..", odd characters, too deep or too long). */
export function cleanCompanionPath(raw: string): string | null {
  const p = String(raw ?? "").replace(/\\/g, "/").replace(/^(\.\/)+/, "").trim();
  if (!p || p.length > 160 || p.startsWith("/") || /^[a-z]:/i.test(p)) return null;
  const parts = p.split("/");
  if (parts.length > 4 || parts.some((x) => !SEGMENT.test(x) || x === "." || x === "..")) return null;
  if (!COMPANION.test(p) || /^skill(\.fr)?\.md$/i.test(parts[parts.length - 1])) return null;
  return parts.join("/");
}

/** The files that may be kept (in order, within the limits) and the ones left out, by path. */
export function keepCompanions(files: CompanionFile[]): { kept: CompanionFile[]; left: string[] } {
  const kept: CompanionFile[] = [], left: string[] = [];
  let total = 0;
  for (const f of files) {
    const path = cleanCompanionPath(f.path);
    const content = String(f.content ?? "").replace(/\r\n/g, "\n");
    const size = Buffer.byteLength(content);
    // A text file has no NUL byte; one that does is a binary file with a text name.
    if (!path || content.includes("\u0000") || size > MAX_COMPANION_FILE || kept.length >= MAX_COMPANION_FILES || total + size > MAX_COMPANION_TOTAL || kept.some((k) => k.path === path)) { left.push(String(f.path ?? "")); continue; }
    kept.push({ path, content });
    total += size;
  }
  return { kept, left };
}

/** The worst finding of the safety check over the files (each read like a skill's text), and the files concerned. */
export function scanCompanions(skillName: string, files: CompanionFile[]): { worst: "danger" | "warning" | "info" | "none"; flagged: string[] } {
  const rank = { none: 0, info: 1, warning: 2, danger: 3 } as const;
  let worst: keyof typeof rank = "none";
  const flagged: string[] = [];
  for (const f of files) {
    const w = scanSkill({ name: `${skillName} / ${f.path}`, description: "", body: f.content }).worst as keyof typeof rank;
    if ((rank[w] ?? 0) > rank[worst]) worst = w;
    if (w === "danger") flagged.push(f.path);
  }
  return { worst, flagged };
}

export const skillFiles = {
  /** Replaces the skill's files with these (already kept by keepCompanions). */
  save(skillId: string, files: CompanionFile[]) {
    q.run("DELETE FROM skill_files WHERE skill_id = ?", skillId);
    const t = now();
    for (const f of keepCompanions(files).kept) q.run("INSERT INTO skill_files (skill_id, path, content, size, created_at) VALUES (?, ?, ?, ?, ?)", skillId, f.path, f.content, Buffer.byteLength(f.content), t);
  },
  list: (skillId: string) => q.all<{ path: string; size: number }>("SELECT path, size FROM skill_files WHERE skill_id = ? ORDER BY path", skillId),
  read(skillId: string, path: string): string | null {
    const p = cleanCompanionPath(path) ?? String(path ?? "").trim();
    return q.get<{ content: string }>("SELECT content FROM skill_files WHERE skill_id = ? AND path = ?", skillId, p)?.content ?? null;
  },
};

/** The note skill_read adds when a skill has files (none: ""). */
export function companionNote(skillId: string): string {
  const list = skillFiles.list(skillId);
  if (!list.length) return "";
  return `\n\nFiles kept with this skill (read one with skill_read and file; copy and adapt it in your own work — nothing here was run):\n${list.map((f) => `- ${f.path} (${f.size} bytes)`).join("\n")}`;
}

/** What skill_read gives for `file`: its text, or the list of files when there is no such file. */
export function readCompanion(skillId: string, skillName: string, file: string): { text: string; found: boolean } {
  const content = skillFiles.read(skillId, file);
  if (content === null) {
    const list = skillFiles.list(skillId);
    return { found: false, text: list.length ? `The skill "${skillName}" has no file "${clip(file, 160)}". Its files: ${list.map((f) => f.path).join(", ")}.` : `The skill "${skillName}" has no files.` };
  }
  return { found: true, text: `File ${cleanCompanionPath(file) ?? file} of the skill "${skillName}" (a template or reference to copy and adapt; it was never run):\n\n${content}` };
}

// ── Splitting a skill that is too long for one piece ────────────────────────────────────────────────────────────

/**
 * The parts of a skill longer than `max`: whole "## " sections packed in order, a section longer than `max` cut at its
 * paragraphs (a paragraph longer than that, at `max`). Each part starts with a line saying which part it is and naming
 * the others, and is named "<name> (i/n)". A skill that fits comes back as one part, unchanged.
 */
export function splitLongSkill(name: string, body: string, max = 20_000): { name: string; body: string }[] {
  const text = body.replace(/\r\n/g, "\n").trim();
  if (text.length <= max) return [{ name, body: text }];
  const room = max - 400; // the header line of each part
  const blocks: string[] = [];
  const pushPiece = (s: string) => { for (let i = 0; i < s.length; i += room) blocks.push(s.slice(i, i + room)); };
  for (const section of text.split(/\n(?=## )/)) {
    if (section.length <= room) { blocks.push(section); continue; }
    let cur = "";
    for (const para of section.split(/\n{2,}/)) {
      const next = cur ? `${cur}\n\n${para}` : para;
      if (next.length <= room) { cur = next; continue; }
      if (cur) blocks.push(cur);
      if (para.length <= room) cur = para; else { pushPiece(para); cur = ""; }
    }
    if (cur) blocks.push(cur);
  }
  const parts: string[] = [];
  for (const b of blocks) {
    const last = parts.length - 1;
    if (last >= 0 && parts[last].length + 1 + b.length <= room) parts[last] += `\n${b}`;
    else parts.push(b);
  }
  const n = parts.length;
  const base = clip(name, 72);
  const names = parts.map((_, i) => `${base} (${i + 1}/${n})`);
  return parts.map((p, i) => ({
    name: names[i],
    body: `> Part ${i + 1} of ${n} of the skill "${base}" (too long to keep in one piece). The other parts: ${names.filter((_, j) => j !== i).join(", ")}.\n\n${p.trim()}`,
  }));
}
