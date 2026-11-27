import { GROK_EXPORT_FORMAT, GROK_EXPORT_VERSION, type GrokImportPreview } from "./shared.js";
import { GrokImportError, previewGrokImport } from "./grokimport.js";
import type { UserRecord } from "./store.js";

/**
 * L181 — « Venir d'un autre outil » : bring bots from a local Claude Code, Codex, OpenClaw or Hermes setup, with the same
 * two steps as « Importer depuis Grok Bot » (grokimport.ts): this file turns the chosen files into the "sklubot-bots" export
 * and hands it to previewGrokImport — so the same secret cleaning, the same preview (nothing created) and the same commit
 * (POST /import/grok/commit: careful bots, DRAFT skills, PAUSED routines, memories only when ticked, no key, no permission).
 *
 * The browser sends only text files the person picked (a folder or files, web/src/components/LocalImport.tsx), and it
 * already leaves out the files below; the server checks again and never reads them:
 *   - secret or sign-in files: .env*, auth.json (Codex), .credentials.json (Claude Code), credentials*, *.pem, *.key,
 *     id_rsa*, *token*, *.sqlite / *.db (OpenClaw keeps auth profiles and sessions in SQLite);
 *   - settings files that hold keys or tokens next to harmless settings: config.toml (Codex), config.yaml (Hermes),
 *     openclaw.json, settings*.json and .claude.json (Claude Code: MCP servers with tokens, OAuth account).
 * They are listed as « non lus » in the preview, with the reason.
 *
 * Formats read (each documented by its project; Hermes and OpenClaw are MIT, read from their docs and code — only the file
 * layout is used here, no code is copied):
 *   Claude Code  CLAUDE.md (instructions, https://code.claude.com/docs/en/memory); .claude/agents/<name>.md — one bot per
 *                subagent, YAML front matter name / description, the body is its prompt
 *                (https://code.claude.com/docs/en/sub-agents); skills/<name>/SKILL.md (front matter name, description;
 *                https://code.claude.com/docs/en/skills); .claude/commands/<name>.md (custom commands, become skills).
 *   Codex        AGENTS.md (instructions, https://developers.openai.com/codex/guides/agents-md); prompts/<name>.md (custom
 *                prompts, become skills, https://developers.openai.com/codex/custom-prompts); skills/<name>/SKILL.md.
 *   OpenClaw     the workspace (docs/concepts/agent-workspace.md, openclaw/openclaw): AGENTS.md (operating instructions),
 *                SOUL.md (persona and tone), IDENTITY.md (« **Name:** »), USER.md and MEMORY.md (one fact per list item),
 *                skills/<name>/SKILL.md. Daily logs memory/YYYY-MM-DD.md are not imported (too many, dated).
 *   Hermes       ~/.hermes (NousResearch/hermes-agent): SOUL.md (identity), memories/MEMORY.md and memories/USER.md (entries
 *                separated by a line with « § », tools/memory_tool_store.py ENTRY_DELIMITER), skills/<category>/<name>/SKILL.md,
 *                cron/jobs.json ({ jobs: [{ name, prompt, schedule: { kind: "cron", expr } }] }, cron/jobs.py).
 */
export type LocalSource = "claude-code" | "codex" | "openclaw" | "hermes";
export const LOCAL_SOURCES: LocalSource[] = ["claude-code", "codex", "openclaw", "hermes"];
export interface LocalFile { path: string; text: string }
export interface LocalExcluded { path: string; why: "secret" | "settings" | "not_text" | "too_large" | "daily_log" | "unknown" }
export type LocalImportPreview = GrokImportPreview & { source: LocalSource; excluded: LocalExcluded[]; read: string[] };

export const MAX_FILES = 300;
export const MAX_FILE_BYTES = 200_000;
export const MAX_TOTAL_BYTES = 2_000_000;
const SOURCE_LABEL: Record<LocalSource, string> = { "claude-code": "Claude Code", codex: "Codex", openclaw: "OpenClaw", hermes: "Hermes" };

/** Why a file is never read (secret or settings with keys), or null. Shared rule with the browser. */
export function excludedWhy(path: string): "secret" | "settings" | null {
  const name = (path.split(/[\\/]/).pop() ?? "").toLowerCase();
  if (/^\.env(\..*)?$|^auth\.json$|^\.credentials\.json$|credential|\.pem$|\.key$|^id_(rsa|ed25519|ecdsa)|token|secret|\.sqlite3?$|\.db$|\.kdbx$/.test(name)) return "secret";
  if (/^config\.toml$|^config\.ya?ml$|^openclaw\.json5?$|^settings(\.local)?\.json$|^\.claude\.json$|^\.mcp\.json$|^mcp\.json$/.test(name)) return "settings";
  return null;
}

/** YAML front matter (--- … ---) as flat key: value pairs, and the body after it. Only plain scalar lines are read. */
export function frontMatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv && kv[2] && !/^[|>]/.test(kv[2])) meta[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

/** Facts of a memory file: Hermes « § » entries, else list items, else paragraphs. Headings and empty lines dropped. */
export function memoryFacts(text: string): string[] {
  const body = frontMatter(text).body;
  const parts = /\n§\n/.test(`\n${body}\n`) ? body.split(/\r?\n§\r?\n/) : /^\s*[-*•]\s+/m.test(body) ? body.split(/\r?\n(?=\s*[-*•]\s+)/) : body.split(/\r?\n\s*\r?\n/);
  return parts.map((p) => p.replace(/^#+\s.*$/gm, "").replace(/^\s*[-*•]\s+/, "").replace(/\s+/g, " ").trim()).filter((p) => p.length > 2 && !/^_.*_$/.test(p)).slice(0, 50);
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.?\//, "");
const base = (p: string) => norm(p).split("/").pop() ?? "";
const lower = (p: string) => norm(p).toLowerCase();

/** Which tool a set of paths comes from (the person can also say it). */
export function detectSource(paths: string[]): LocalSource {
  const l = paths.map(lower);
  if (l.some((p) => /(^|\/)\.hermes\//.test(p) || /(^|\/)memories\/(memory|user)\.md$/.test(p) || /(^|\/)cron\/jobs\.json$/.test(p))) return "hermes";
  if (l.some((p) => /(^|\/)\.openclaw\//.test(p) || /(^|\/)(identity|soul)\.md$/.test(p))) return "openclaw";
  if (l.some((p) => /(^|\/)\.claude\//.test(p) || /(^|\/)claude\.md$/.test(p))) return "claude-code";
  return "codex";
}

interface ExportBot { name: string; role: string; personality: string; instructions: string; memories: string[]; skills: { name: string; when: string; steps: string }[]; routines: { name: string; schedule: string; cron: string; timezone: string; task: string }[]; apps: string[] }

/** The "sklubot-bots" export of a local setup (exported for the tests). */
export function localExport(files: LocalFile[], source: LocalSource, fallbackName: string): { bots: ExportBot[]; read: string[] } {
  const read: string[] = [];
  const at = (re: RegExp) => files.filter((f) => re.test(lower(f.path)));
  const one = (re: RegExp) => { const f = at(re)[0]; if (f) read.push(norm(f.path)); return f?.text ?? ""; };
  const clipTo = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n[…]` : s);
  const skills: ExportBot["skills"] = [];
  for (const f of at(/(^|\/)skills\/(.+\/)?[^/]+\/skill\.md$/)) {
    const { meta, body } = frontMatter(f.text);
    const dir = norm(f.path).split("/").slice(-2, -1)[0] ?? "skill";
    skills.push({ name: meta.name || dir, when: meta.description ?? "", steps: clipTo(body.trim(), 8000) }); read.push(norm(f.path));
  }
  for (const f of at(/(^|\/)(\.claude\/commands|prompts)\/[^/]+\.md$/)) {
    const { meta, body } = frontMatter(f.text);
    skills.push({ name: base(f.path).replace(/\.md$/i, ""), when: meta.description ?? "", steps: clipTo(body.trim(), 8000) }); read.push(norm(f.path));
  }
  const routines: ExportBot["routines"] = [];
  if (source === "hermes") {
    const raw = one(/(^|\/)cron\/jobs\.json$/);
    try {
      const jobs = (JSON.parse(raw || "{}") as { jobs?: unknown }).jobs;
      for (const j of Array.isArray(jobs) ? jobs.slice(0, 20) : []) {
        const s = (j as { schedule?: { kind?: string; expr?: string; display?: string } }).schedule ?? {};
        const job = j as { name?: unknown; prompt?: unknown; schedule_display?: unknown };
        routines.push({ name: String(job.name ?? "Routine"), schedule: String(s.display ?? job.schedule_display ?? ""), cron: s.kind === "cron" ? String(s.expr ?? "") : "", timezone: "", task: String(job.prompt ?? "") });
      }
    } catch { /* not JSON: ignored */ }
  }
  const main: ExportBot = { name: fallbackName, role: "", personality: "", instructions: "", memories: [], skills: skills.slice(0, 30), routines, apps: [] };
  if (source === "openclaw" || source === "hermes") {
    const identity = one(/(^|\/)identity\.md$/);
    const named = /\*\*name:\*\*\s*([^\n*_(][^\n]*)/i.exec(identity)?.[1]?.trim();
    if (named) main.name = named.slice(0, 60);
    main.personality = clipTo(frontMatter(one(/(^|\/)soul\.md$/)).body.trim(), 2000);
    main.instructions = clipTo(one(/(^|\/)agents\.md$/).trim(), 6000);
    main.memories = [...memoryFacts(one(/(^|\/)(memories\/)?user\.md$/)), ...memoryFacts(one(/(^|\/)(memories\/)?memory\.md$/))].slice(0, 50);
  } else {
    main.instructions = clipTo((source === "claude-code" ? one(/(^|\/)claude\.md$/) : "") || one(/(^|\/)agents\.md$/), 6000).trim();
  }
  const out = [main];
  if (source === "claude-code") {
    for (const f of at(/(^|\/)\.claude\/agents\/[^/]+\.md$/).slice(0, 19)) {
      const { meta, body } = frontMatter(f.text);
      out.push({ name: (meta.name || base(f.path).replace(/\.md$/i, "")).slice(0, 60), role: meta.description ?? "", personality: "", instructions: clipTo(body.trim(), 6000), memories: [], skills: [], routines: [], apps: [] });
      read.push(norm(f.path));
    }
  }
  return { bots: out.filter((b, i) => i > 0 || b.instructions || b.personality || b.memories.length || b.skills.length || b.routines.length), read: [...new Set(read)] };
}

/** Preview of a local setup: nothing is created; commit with POST /import/grok/commit and the same previewId. */
export function previewLocalImport(user: UserRecord, input: { files?: unknown; source?: unknown }): LocalImportPreview {
  const raw = Array.isArray(input.files) ? input.files : [];
  if (!raw.length) throw new GrokImportError("empty", "Choose the folder or the files of your setup first.");
  const excluded: LocalExcluded[] = [];
  const files: LocalFile[] = [];
  let total = 0;
  for (const f of raw.slice(0, MAX_FILES)) {
    const path = typeof f?.path === "string" ? norm(f.path).slice(0, 300) : "";
    const text = typeof f?.text === "string" ? f.text : null;
    if (!path) continue;
    const why = excludedWhy(path);
    if (why) { excluded.push({ path, why }); continue; }
    if (/(^|\/)memory\/\d{4}-\d{2}-\d{2}\.md$/i.test(path)) { excluded.push({ path, why: "daily_log" }); continue; }
    if (text === null || text.includes("\u0000")) { excluded.push({ path, why: "not_text" }); continue; }
    if (text.length > MAX_FILE_BYTES || total + text.length > MAX_TOTAL_BYTES) { excluded.push({ path, why: "too_large" }); continue; }
    total += text.length;
    files.push({ path, text });
  }
  const source = LOCAL_SOURCES.includes(input.source as LocalSource) ? (input.source as LocalSource) : detectSource(files.map((f) => f.path));
  const { bots, read } = localExport(files, source, SOURCE_LABEL[source]);
  for (const f of files) if (!read.includes(f.path)) excluded.push({ path: f.path, why: "unknown" });
  if (!bots.length) throw new GrokImportError("no_bots", "This block is not a bot export: it has no “bots” list.");
  const preview = previewGrokImport(user, JSON.stringify({ format: GROK_EXPORT_FORMAT, version: GROK_EXPORT_VERSION, source: SOURCE_LABEL[source], bots }));
  return { ...preview, source, excluded, read };
}
