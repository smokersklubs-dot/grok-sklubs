import { randomBytes } from "node:crypto";
import { emit } from "./bus.js";
import { accessOf, hostedMode, suspended } from "./hosted.js";
import { guardedFetch } from "./net.js";
import { mentionsKey, readZip } from "./projectimport.js";
import { scanSkill } from "./skillscan.js";
import { splitSkill } from "./skillslibrary.js";
import type { GithubImportReport, GithubPreview, GithubSkillFound, LicenceKind } from "./skillstypes.js";
import { audit, bots, clip, now, skills, type BotRecord } from "./store.js";
import { q } from "./db.js";

/**
 * « Importer depuis GitHub » (docs/COMPETENCES.md): skills (SKILL.md files) from a PUBLIC github.com repository.
 *
 * The owner pastes https://github.com/<owner>/<repo>[/tree/<ref>/<path>]. The server downloads the repository's source
 * archive from GitHub (https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives
 * — /archive/refs/heads/<branch>.zip, /archive/refs/tags/<tag>.zip, /archive/<commit>.zip; HEAD.zip for the default
 * branch), through the network guard (guardedFetch: public addresses only), following redirects only to github.com and
 * codeload.github.com, 15 MB at most. Nothing in it is run: only SKILL.md files, small texts (annexes) and licence/README texts are read out of
 * the zip (the zip reader of projectimport.ts: no links, no "..", no absolute paths); every other file is counted and
 * left out.
 *
 * The preview lists each SKILL.md with its licence (its folder's LICENSE, else its front matter, else the repository's
 * LICENSE, else its README), and flags: a key-like string, too long (over 20 000 characters, with the count), files left
 * out. Files the text cites (citedFiles: links and paths of its own folder) are joined at the end as "Annex: …" sections
 * when they are small texts and the whole stays under the limit; anything else it cites is named in the preview and in
 * the imported text, so neither the owner nor the bot believes a missing file is there (backlog L26). Nothing is
 * saved until the owner picks skills; they arrive as DRAFTS (the bot does not get them until the owner activates each one
 * in the bot's Skills tab), marked as coming from outside, with their source and licence at the end of their text.
 *
 * Who: anyone on a self-hosted server (it is their own installation); in hosted mode, operators and paid plans only.
 */

export class GithubError extends Error { constructor(public status: 400 | 403 | 404 | 413 | 429 | 502, message: string, public vars: Record<string, string | number> = {}) { super(message); } }

export interface RepoRef { owner: string; repo: string; ref: string; path: string }
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const REF = /^[A-Za-z0-9._-]{1,100}$/;
const SEGMENT = /^[A-Za-z0-9._ @+-]{1,100}$/;

/** https://github.com/<owner>/<repo>[/tree|blob/<ref>[/<path>]] → its parts. Anything else is refused. */
export function parseGithubUrl(input: string): RepoRef {
  let s = String(input ?? "").trim();
  if (/^(www\.)?github\.com\//i.test(s)) s = `https://${s}`;
  // Dot segments (plain or encoded) are refused before the URL parser folds them away.
  if (/(^|\/)(\.|%2e){1,2}(\/|$|[?#])/i.test(s.replace(/^https:\/\//i, ""))) throw new GithubError(400, "That GitHub address is not a repository or one of its folders.");
  let u: URL;
  try { u = new URL(s); } catch { throw new GithubError(400, "Paste the address of a GitHub repository, like https://github.com/owner/repository."); }
  if (u.protocol !== "https:" || !/^(www\.)?github\.com$/i.test(u.hostname) || u.port || u.username || u.password) throw new GithubError(400, "Only public repositories on github.com can be imported.");
  const parts = u.pathname.split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return "\u0000"; } });
  const [owner, rawRepo, kind, ref, ...rest] = parts;
  const repo = (rawRepo ?? "").replace(/\.git$/i, "");
  if (!owner || !OWNER.test(owner) || !REPO.test(repo) || repo === "." || repo === "..") throw new GithubError(400, "Paste the address of a GitHub repository, like https://github.com/owner/repository.");
  if (kind === undefined) return { owner, repo, ref: "", path: "" };
  if ((kind !== "tree" && kind !== "blob") || !ref || !REF.test(ref) || ref.includes("..")) throw new GithubError(400, "That GitHub address is not a repository or one of its folders.");
  let path = rest;
  if (kind === "blob" && path.length && /\.md$/i.test(path[path.length - 1])) path = path.slice(0, -1);
  if (path.some((p) => !SEGMENT.test(p) || p === "." || p === "..")) throw new GithubError(400, "That GitHub address is not a repository or one of its folders.");
  return { owner, repo, ref, path: path.join("/") };
}

// ── Download (through the network guard, GitHub hosts only) ─────────────────────────────────────────────────────
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
let fetcher: Fetcher = guardedFetch;
/** Tests: answer GitHub's requests from a fake server. null puts the real network back. */
export function setGithubFetch(f: Fetcher | null) { fetcher = f ?? guardedFetch; }
const GITHUB_HOSTS = new Set(["github.com", "codeload.github.com"]);
export const MAX_ARCHIVE = 15_000_000;

async function readCapped(res: Response, max: number): Promise<Buffer> {
  if (Number(res.headers.get("content-length") ?? 0) > max) { await res.body?.cancel().catch(() => {}); throw new GithubError(413, "This repository is too large to import (15 MB at most). Point to the folder of the skills you want."); }
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); throw new GithubError(413, "This repository is too large to import (15 MB at most). Point to the folder of the skills you want."); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** GET on GitHub, following redirects only between GitHub's own hosts. null on 404. */
async function githubGet(url: string, signal: AbortSignal): Promise<Buffer | null> {
  let at = new URL(url);
  for (let hop = 0; hop < 5; hop++) {
    if (at.protocol !== "https:" || !GITHUB_HOSTS.has(at.hostname)) throw new GithubError(502, "GitHub sent the download somewhere else: it was refused.");
    let res: Response;
    try { res = await fetcher(at.toString(), { redirect: "manual", signal, headers: { accept: "application/zip, application/octet-stream" } }); }
    catch (err) { if (err instanceof GithubError) throw err; throw new GithubError(502, "GitHub could not be reached. Try again in a moment."); }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!loc) throw new GithubError(502, "GitHub could not be reached. Try again in a moment.");
      at = new URL(loc, at);
      continue;
    }
    if (res.status === 404) { await res.body?.cancel().catch(() => {}); return null; }
    if (res.status === 429 || res.status === 403) { await res.body?.cancel().catch(() => {}); throw new GithubError(429, "GitHub is limiting downloads right now. Try again in a few minutes."); }
    if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new GithubError(502, "GitHub answered with an error (status {status}).", { status: res.status }); }
    return await readCapped(res, MAX_ARCHIVE);
  }
  throw new GithubError(502, "GitHub could not be reached. Try again in a moment.");
}

async function downloadArchive(r: RepoRef, signal: AbortSignal): Promise<Buffer> {
  const base = `https://github.com/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}/archive/`;
  const tries = r.ref ? [`refs/heads/${r.ref}.zip`, `refs/tags/${r.ref}.zip`, `${r.ref}.zip`] : ["HEAD.zip"];
  for (const t of tries) {
    const buf = await githubGet(base + t, signal);
    if (buf) return buf;
  }
  throw new GithubError(404, "This repository was not found, or it is private. Only public repositories can be imported.");
}

// ── Licences ─────────────────────────────────────────────────────────────────────────────────────────────────────
const PERMISSIVE = new Set<LicenceKind>(["Apache-2.0", "MIT", "BSD", "ISC", "CC0-1.0", "Unlicense", "CC-BY"]);
export const isPermissive = (k: LicenceKind) => PERMISSIVE.has(k);

/** The licence a text states (a LICENSE file, an SPDX id, a README's licence line). */
export function classifyLicence(text: string): LicenceKind {
  const t = text.slice(0, 20_000);
  if (/^\s*Apache-2\.0\s*$/i.test(t) || /Apache License[,\s]+Version 2\.0/i.test(t)) return "Apache-2.0";
  if (/GNU AFFERO GENERAL PUBLIC LICENSE|^\s*AGPL/i.test(t)) return "AGPL";
  if (/GNU LESSER GENERAL PUBLIC LICENSE|^\s*LGPL/i.test(t)) return "LGPL";
  if (/GNU GENERAL PUBLIC LICENSE|^\s*GPL-[23]/i.test(t)) return "GPL";
  if (/Mozilla Public License[,\s]+(Version|v\.?)\s*2\.0|^\s*MPL-2\.0\s*$/i.test(t)) return "MPL-2.0";
  if (/Permission is hereby granted, free of charge|^\s*MIT\s*(License)?\s*$/i.test(t)) return "MIT";
  if (/Redistribution and use in source and binary forms|^\s*BSD-[23]-Clause\s*$/i.test(t)) return "BSD";
  if (/Permission to use, copy, modify, and\/or distribute this software for any purpose|^\s*ISC\s*$/i.test(t)) return "ISC";
  if (/This is free and unencumbered software released into the public domain|^\s*Unlicense\s*$/i.test(t)) return "Unlicense";
  if (/CC0[- ]1\.0|Creative Commons Zero/i.test(t)) return "CC0-1.0";
  if (/NonCommercial|NoDerivatives|CC[- ]BY[- ](NC|ND)/i.test(t)) return "restrictive";
  if (/Creative Commons Attribution 4\.0|CC[- ]BY[- ]4\.0/i.test(t)) return "CC-BY";
  if (/All rights reserved|proprietary|may not (be )?(copied|copy|redistribute|distribute)/i.test(t)) return "restrictive";
  return "unknown";
}
/** A README's own licence line ("Licensed under the MIT License", "## License … Apache 2.0"), or unknown. */
function readmeLicence(text: string): LicenceKind {
  const m = /(?:^#+\s*licen[cs]e\b[^\n]*\n+([^\n]+(?:\n[^\n#]+){0,3}))|(?:licensed under (?:the )?([^\n.]{0,80}))/im.exec(text);
  if (!m) return "unknown";
  const line = (m[1] ?? m[2] ?? "").replace(/Apache[- ]2\.0/i, "Apache License, Version 2.0").replace(/\bMIT\b/, "MIT License");
  return /MIT License/.test(line) ? "MIT" : classifyLicence(line);
}

// ── Preview and import ───────────────────────────────────────────────────────────────────────────────────────────
interface Found extends GithubSkillFound { body: string }
interface Pending { userId: string; repo: string; ref: string; path: string; skills: Found[]; until: number }
const pending = new Map<string, Pending>();
const sweep = () => { for (const [k, v] of pending) if (v.until < now()) pending.delete(k); };
const LICENCE_FILE = /^(LICEN[CS]E|COPYING)(\.(md|txt|rst))?$/i;
const README_FILE = /^README(\.(md|txt|rst))?$/i;
export const MAX_SKILL_CHARS = 20_000;
/** Texts that can be joined to a skill as annexes (L26/L130): Markdown or plain text of its own folder, 60 KB at most. */
const ANNEX_FILE = /\.(md|markdown|txt)$/i;
const MAX_ANNEX = 60_000;

/**
 * The files of its own folder a skill's text cites: Markdown links ("[format](./FORMAT.md)") and file paths written in
 * the text ("references/eeat.md", "`scripts/check.py`"), relative to the skill's folder, in order, once each. Web
 * addresses, absolute paths, "..", and the skill's own SKILL.md are left out (an import never reads outside the folder).
 */
export function citedFiles(body: string): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    let p = raw.trim().replace(/^<|>$/g, "").split("#")[0].split("?")[0];
    if (!p || /^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith("/") || p.startsWith("~") || p.includes("\\")) return;
    p = p.replace(/^(\.\/)+/, "");
    const parts = p.split("/");
    if (parts.some((x) => !x || x === "." || x === "..") || !/\.[A-Za-z0-9]{1,8}$/.test(p) || /^skill\.md$/i.test(p)) return;
    if (!out.includes(p)) out.push(p);
  };
  for (const m of body.matchAll(/\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) add(m[1]);
  const FILE = /(?<![\w./:@-])((?:\.\/)?(?:[\w-][\w.-]*\/)*[\w-][\w.-]*\.(?:md|markdown|txt|py|sh|bash|js|mjs|cjs|ts|json|ya?ml|html?|css|csv|toml|xml|svg|png|jpe?g|pdf))(?![\w/-])/g;
  for (const m of body.replace(/\]\([^)]*\)/g, "]").replace(/https?:\/\/\S+/g, " ").matchAll(FILE)) {
    add(m[1]);
  }
  return out;
}

/** Who may import from GitHub: anyone on a self-hosted server; in hosted mode, operators and accounts on a paid plan. */
export function githubImportAllowed(userId: string): boolean {
  if (!hostedMode()) return true;
  const a = accessOf(userId);
  if (a.operator) return true;
  return !!a.plan && a.plan.kind !== "free" && !suspended(userId);
}

export async function previewGithub(userId: string, address: string, signal: AbortSignal): Promise<GithubPreview> {
  if (!githubImportAllowed(userId)) throw new GithubError(403, "Importing skills from GitHub is not included in your plan.");
  const r = parseGithubUrl(address);
  const zip = await downloadArchive(r, signal);
  const all: { path: string; size: number }[] = [];
  const prefix = r.path ? `${r.path}/` : "";
  const strip = (p: string) => p.split("/").slice(1).join("/");
  let files: { path: string; data: Buffer }[];
  try {
    files = readZip(zip, {
      maxEntries: 50_000, maxFile: 300_000, maxTotal: 12_000_000,
      want: (name, size) => {
        const rel = strip(name);
        if (!rel) return false;
        all.push({ path: rel, size });
        const base = rel.split("/").pop()!;
        const inScope = !prefix || rel.startsWith(prefix);
        // The repository's own licence and README are read even outside the chosen folder.
        if (!rel.includes("/") && (LICENCE_FILE.test(base) || README_FILE.test(base))) return size <= 300_000;
        if (!inScope) return false;
        // Small texts of the folder are read too: a skill's annexes (see citedFiles).
        if (ANNEX_FILE.test(base) && size <= MAX_ANNEX) return true;
        return (/^skill\.md$/i.test(base) || LICENCE_FILE.test(base)) && size <= 300_000;
      },
    }).map((f) => ({ path: strip(f.path), data: f.data }));
  } catch (err) { throw new GithubError(400, "This download is not a readable archive: {detail}", { detail: (err as Error).message }); }
  const text = (p: string) => files.find((f) => f.path === p)?.data.toString("utf8") ?? null;
  const rootLicenceFile = files.find((f) => !f.path.includes("/") && LICENCE_FILE.test(f.path));
  const rootLicence = rootLicenceFile ? classifyLicence(rootLicenceFile.data.toString("utf8")) : "none";
  const readme = files.find((f) => !f.path.includes("/") && README_FILE.test(f.path));
  const readmeKind = readme ? readmeLicence(readme.data.toString("utf8")) : "unknown";
  const existing = new Set(q.all<{ name: string }>("SELECT s.name FROM skills s JOIN bots b ON b.id = s.bot_id WHERE b.user_id = ?", userId).map((x) => x.name.toLowerCase()));

  const skillFiles = all.filter((f) => (!prefix || f.path.startsWith(prefix)) && /(^|\/)skill\.md$/i.test(f.path));
  const found: Found[] = [];
  for (const f of skillFiles.slice(0, 100)) {
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
    const raw = text(f.path);
    const parsed = raw === null ? { name: "", description: "", body: "" } : splitSkill(raw);
    const folderName = dir.split("/").pop() || r.repo;
    const name = clip((parsed.name || folderName).replace(/[-_]+/g, " ").trim(), 80) || "skill";
    let licence: LicenceKind = "none", licenceFrom: GithubSkillFound["licenceFrom"] = "none";
    const own = files.find((x) => x.path.startsWith(dir ? `${dir}/` : "") && x.path.split("/").length === (dir ? dir.split("/").length + 1 : 1) && LICENCE_FILE.test(x.path.split("/").pop()!));
    const fmLicence = raw ? (/^---\n[\s\S]*?^license:\s*(.+)$/im.exec(raw.replace(/\r\n/g, "\n"))?.[1] ?? "").trim() : "";
    if (own && dir) { licence = classifyLicence(own.data.toString("utf8")); licenceFrom = "skill"; }
    else if (fmLicence && classifyLicence(fmLicence) !== "unknown") { licence = classifyLicence(fmLicence); licenceFrom = "front matter"; }
    else if (rootLicence !== "none") { licence = rootLicence; licenceFrom = "repository"; }
    else if (readmeKind !== "unknown") { licence = readmeKind; licenceFrom = "readme"; }
    const ignoredFiles = all.filter((x) => (dir ? x.path.startsWith(`${dir}/`) : true) && x.path !== f.path && !LICENCE_FILE.test(x.path.split("/").pop()!) && !README_FILE.test(x.path.split("/").pop()!) && !/(^|\/)NOTICE(\.txt)?$/i.test(x.path)).length;
    // Files its text cites: small texts of its own folder are joined as annexes while the whole stays under the limit;
    // anything else it cites (scripts, pictures, missing or too large files) is named so the owner knows it is not there.
    const annexes: string[] = [], referencedFiles: string[] = [];
    let body = parsed.body;
    for (const ref of citedFiles(parsed.body)) {
      const full = dir ? `${dir}/${ref}` : ref;
      const data = ANNEX_FILE.test(ref) ? text(full) : null;
      const annex = data === null ? "" : `\n\n## Annex: ${ref}\n\n${data.replace(/\r\n/g, "\n").trim()}`;
      if (data !== null && body.length + annex.length <= MAX_SKILL_CHARS) { body += annex; annexes.push(ref); }
      else referencedFiles.push(ref);
    }
    found.push({
      path: f.path, name, description: clip(parsed.description, 300), size: f.size, licence, licenceFrom, permissive: isPermissive(licence),
      mentionsKey: mentionsKey(raw ?? ""), tooLarge: raw === null || body.length > MAX_SKILL_CHARS, chars: raw === null ? f.size : body.length, annexes, referencedFiles, ignoredFiles: dir ? Math.max(0, ignoredFiles - annexes.length) : 0,
      exists: existing.has(name.toLowerCase()), body: raw === null ? "" : body,
      scan: scanSkill({ name, description: clip(parsed.description, 300), body: body.slice(0, MAX_SKILL_CHARS) }),
    });
  }
  if (!found.length) throw new GithubError(404, "No SKILL.md file was found at this address.");
  sweep();
  for (const [k, v] of pending) if (v.userId === userId) pending.delete(k);
  const previewId = randomBytes(18).toString("base64url");
  pending.set(previewId, { userId, repo: `${r.owner}/${r.repo}`, ref: r.ref, path: r.path, skills: found, until: now() + 15 * 60_000 });
  return { previewId, repo: `${r.owner}/${r.repo}`, ref: r.ref, path: r.path, skills: found.map(({ body: _b, ...s }) => s), truncated: skillFiles.length > found.length };
}

/** Imports the skills the owner picked, as drafts, on every assistant bot ("all") or one of them. */
export function commitGithub(userId: string, previewId: string, paths: string[], target: string): GithubImportReport {
  const p = pending.get(previewId);
  if (!p || p.userId !== userId || p.until < now()) throw new GithubError(400, "This preview has expired. Look the repository up again.");
  if (!githubImportAllowed(userId)) throw new GithubError(403, "Importing skills from GitHub is not included in your plan.");
  let targets: BotRecord[];
  if (target === "all") targets = bots.list(userId).filter((b) => b.kind === "agent");
  else { const b = bots.owned(userId, target); if (!b || b.kind !== "agent" || b.hidden) throw new GithubError(404, "That bot does not exist."); targets = [b]; }
  if (!targets.length) throw new GithubError(400, "Create a bot first.");
  const report: GithubImportReport = { imported: [], skipped: [], bots: targets.length, flagged: [] };
  const tree = p.ref || "HEAD";
  for (const s of p.skills) {
    if (!paths.includes(s.path)) continue;
    if (s.tooLarge || !s.body) { report.skipped.push(s.name); continue; }
    const dir = s.path.includes("/") ? s.path.slice(0, s.path.lastIndexOf("/")) : "";
    const source = `https://github.com/${p.repo}/tree/${tree}${dir ? `/${dir}` : ""}`;
    const missing = s.referencedFiles.length ? `\nFiles this skill refers to were not imported (you cannot open them): ${s.referencedFiles.join(", ")}.` : "";
    const footer = `\n\n---\nSource: ${source} — licence: ${s.licence === "none" ? "none found" : s.licence} (${s.licenceFrom}). Imported from GitHub: check it before activating it.${missing}`;
    let any = false;
    for (const b of targets) {
      if (skills.list(b.id).some((k) => k.name.toLowerCase() === s.name.toLowerCase())) continue;
      skills.create(b.id, s.name, s.description, s.body.slice(0, MAX_SKILL_CHARS) + footer, false, { outside: true, draft: true });
      emit(userId, { type: "memories", botId: b.id });
      any = true;
    }
    (any ? report.imported : report.skipped).push(s.name);
    if (any && s.scan.worst === "danger") report.flagged.push(s.name);
  }
  pending.delete(previewId);
  audit(userId, "account", `Skills imported from GitHub (${p.repo}${p.path ? `/${p.path}` : ""}): ${report.imported.length} as drafts, ${report.skipped.length} skipped`);
  return report;
}
