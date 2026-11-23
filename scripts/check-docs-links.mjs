// L160 « contrôleur de liens des docs » (A-FAIRE L160; idea from AUDIT-APP-STORE-COMPLIANCE F16 « check-docs », written
// from its behaviour: fail when a document cites a link, a heading, a file or a line that does not exist. Our own code.)
//
//   node scripts/check-docs-links.mjs            checks README.md, docs/**/*.md, mobile/*.md, companion/*.md
//   node scripts/check-docs-links.mjs --paths    also lists `backticked/paths.ts` that match no file (advice, never fails)
//
// What fails (exit 1):
//   - a relative Markdown link [text](path) or [text](path#anchor) whose file does not exist;
//   - an anchor (#titre) that matches no heading of the target file (GitHub's heading ids);
//   - a cited line `file.ts:120` or `file.ts` l.120 past the end of that file.
// Web addresses (http, https, mailto) are not fetched: the check works offline.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** GitHub's heading id: lower case, punctuation dropped (letters with accents kept), spaces to hyphens. */
export function slugify(heading) {
  return heading.trim().toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

/** Every heading id of a Markdown text, with GitHub's "-1", "-2" suffixes for repeats, plus explicit <a id|name>. */
export function anchorsOf(md) {
  const seen = new Map();
  const out = new Set();
  let fence = false;
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const h = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (h) {
      const base = slugify(h[1]);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      out.add(n ? `${base}-${n}` : base);
    }
    for (const a of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) out.add(a[1]);
  }
  return out;
}

/** The links of a Markdown text outside code (fenced blocks and `inline code`), with their line numbers. */
export function linksOf(md) {
  const out = [];
  let fence = false;
  md.split("\n").forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return; }
    if (fence) return;
    const bare = line.replace(/`[^`]*`/g, "");
    for (const m of bare.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push({ target: m[1], line: i + 1 });
    for (const m of bare.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/g)) out.push({ target: m[1], line: i + 1 });
  });
  return out;
}

/** Cited lines: `path/file.ext:123` (or :12-30) and `path/file.ext` l.123 / l. 95-97. */
export function citedLines(md) {
  const out = [];
  md.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/`([\w./-]+\.[a-z]{1,5}):(\d+)(?:-(\d+))?`/g)) out.push({ path: m[1], n: Number(m[3] ?? m[2]), line: i + 1 });
    for (const m of line.matchAll(/`([\w./-]+\.[a-z]{1,5})`\s*(?:\(\s*)?l\.\s?(\d+)(?:-(\d+))?/g)) out.push({ path: m[1], n: Number(m[3] ?? m[2]), line: i + 1 });
  });
  return out;
}

/** Where a backticked path may live: next to the document, at the root, or under the usual source folders. */
export function resolveCited(root, docDir, p) {
  const bases = [docDir, root, join(root, "server/src"), join(root, "web/src"), join(root, "web"), join(root, "server"), join(root, "mobile"), join(root, "mobile/src"), join(root, "companion"), join(root, "docs")];
  for (const b of bases) { const f = resolve(b, p); if (existsSync(f) && statSync(f).isFile()) return f; }
  return null;
}

/**
 * Dated records (audits, clean-room notes, a plan « relevé fait le … ») cite lines of the code AS IT WAS that day: their
 * line numbers are not checked (their links and headings are).
 */
export function isDatedRecord(rel, md) {
  return /^docs\/(audits|cleanroom)\//.test(rel.replace(/\\/g, "/")) || /relevé fait le \d/i.test(md.split("\n").slice(0, 6).join(" "));
}

/** Problems of one document. `read(path)` returns a file's text (cached by the caller). */
export function checkDoc(root, file, md, read) {
  const problems = [];
  const dir = dirname(file);
  const rel = relative(root, file);
  for (const { target, line } of linksOf(md)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue; // http:, https:, mailto:, data:…
    const [rawPath, anchor] = target.split("#");
    let path;
    try { path = decodeURIComponent(rawPath); } catch { path = rawPath; }
    const dest = path ? (path.startsWith("/") ? join(root, path) : resolve(dir, path)) : file;
    if (!existsSync(dest)) { problems.push(`${rel}:${line}: link to a missing file: ${target}`); continue; }
    if (anchor && dest.endsWith(".md") && statSync(dest).isFile() && !anchorsOf(read(dest)).has(anchor.toLowerCase()) && !anchorsOf(read(dest)).has(anchor)) problems.push(`${rel}:${line}: no heading #${anchor} in ${relative(root, dest) || rel}`);
  }
  for (const { path, n, line } of isDatedRecord(rel, md) ? [] : citedLines(md)) {
    const f = resolveCited(root, dir, path);
    if (!f) continue; // an unknown path is advice (--paths), not a failure: docs also cite other projects' files
    const count = read(f).split("\n").length;
    if (n > count) problems.push(`${rel}:${line}: ${path} has ${count} lines, line ${n} is cited`);
  }
  return problems;
}

/** `backticked/paths.ext` that match no file anywhere (advice only). */
export function unknownPaths(root, file, md) {
  const out = [];
  md.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/`((?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|mjs|js|md|json|css|sh|yml|yaml|html))(?::\d+(?:-\d+)?)?`/g)) {
      if (!resolveCited(root, dirname(file), m[1])) out.push(`${relative(root, file)}:${i + 1}: ${m[1]}`);
    }
  });
  return out;
}

export function docFiles(root) {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".md")) out.push(p); } };
  for (const f of ["README.md", "THIRD_PARTY_NOTICES.md"]) if (existsSync(join(root, f))) out.push(join(root, f));
  if (existsSync(join(root, "docs"))) walk(join(root, "docs"));
  for (const d of ["mobile", "companion", "deploy"]) if (existsSync(join(root, d))) for (const e of readdirSync(join(root, d))) if (e.endsWith(".md")) out.push(join(root, d, e));
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const cache = new Map();
  const read = (p) => { if (!cache.has(p)) cache.set(p, readFileSync(p, "utf8")); return cache.get(p); };
  const files = docFiles(root);
  const problems = files.flatMap((f) => checkDoc(root, f, read(f), read));
  if (process.argv.includes("--paths")) {
    const unknown = files.flatMap((f) => unknownPaths(root, f, read(f)));
    console.log(`Paths cited in backticks that match no file (${unknown.length}, advice only):\n${unknown.map((u) => `  ${u}`).join("\n")}`);
  }
  if (problems.length) {
    console.error(`check:docs — ${problems.length} broken reference(s) in ${files.length} documents:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`check:docs — ${files.length} documents: every link, heading and cited line exists.`);
}
