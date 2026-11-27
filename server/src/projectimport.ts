import { randomBytes } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { seal } from "./auth.js";
import { emit } from "./bus.js";
import { checkSecret, recordHealth } from "./health.js";
import { scanSkill } from "./skillscan.js";
import type { ImportPreview, ImportReport, ImportSkill, ImportVariable } from "./shared.js";
import { audit, bots, clip, now, skills, vault } from "./store.js";
import { q } from "./db.js";

/**
 * Wave 7 (spec 08 A6) — importing a project: a .env file and a folder of skills (as a zip).
 *
 * First a preview — the variable names, which ones look like secrets, the provider and host(s) guessed from the name,
 * and the skills found — never a value. The values stay on the server, in memory, for 15 minutes, under a random preview
 * id. The user then binds each key to its host(s) (the guess, or their own), leaves out what they do not want, and
 * imports in one go: vault secrets bound to those hosts (each one goes through the health check of A2), and skills saved
 * as reviewed skills (shared with every bot, or for one bot). Importing twice creates no duplicates; "replace" updates
 * values that exist. Values never go through the chat or a model. A skill whose text seems to contain a key is flagged,
 * with the advice to move that key to the vault.
 */

interface KnownVar { re: RegExp; provider: string; hosts: string[]; header: string; prefix: string }
/**
 * Variable name → provider, host, header and prefix, for common providers. Headers are those each provider documents:
 * Bearer tokens (OpenAI, Stripe, GitHub, Mistral, Groq, xAI, OpenRouter, Replicate, Hugging Face, Resend, SendGrid,
 * Notion, Airtable, Slack, Perplexity, DeepSeek, Together, Firecrawl, Jina, Cohere, Fireworks), x-api-key (Anthropic,
 * Exa), xi-api-key (ElevenLabs), X-Subscription-Token (Brave Search), X-API-KEY (Serper), x-goog-api-key (Gemini).
 */
const KNOWN: KnownVar[] = [
  { re: /^ANTHROPIC_(API_)?KEY$/, provider: "Anthropic", hosts: ["api.anthropic.com"], header: "x-api-key", prefix: "" },
  { re: /^OPENAI_(API_)?KEY$/, provider: "OpenAI", hosts: ["api.openai.com"], header: "Authorization", prefix: "Bearer " },
  { re: /^(GEMINI|GOOGLE_AI|GOOGLE_GENAI)_(API_)?KEY$/, provider: "Google Gemini", hosts: ["generativelanguage.googleapis.com"], header: "x-goog-api-key", prefix: "" },
  { re: /^STRIPE_(SECRET_|API_)?KEY$/, provider: "Stripe", hosts: ["api.stripe.com"], header: "Authorization", prefix: "Bearer " },
  { re: /^(GITHUB|GH)_(TOKEN|PAT|API_KEY)$/, provider: "GitHub", hosts: ["api.github.com"], header: "Authorization", prefix: "Bearer " },
  { re: /^MISTRAL_(API_)?KEY$/, provider: "Mistral", hosts: ["api.mistral.ai"], header: "Authorization", prefix: "Bearer " },
  { re: /^GROQ_(API_)?KEY$/, provider: "Groq", hosts: ["api.groq.com"], header: "Authorization", prefix: "Bearer " },
  { re: /^(XAI|GROK)_(API_)?KEY$/, provider: "xAI", hosts: ["api.x.ai"], header: "Authorization", prefix: "Bearer " },
  { re: /^OPENROUTER_(API_)?KEY$/, provider: "OpenRouter", hosts: ["openrouter.ai"], header: "Authorization", prefix: "Bearer " },
  { re: /^REPLICATE_(API_)?(TOKEN|KEY)$/, provider: "Replicate", hosts: ["api.replicate.com"], header: "Authorization", prefix: "Bearer " },
  { re: /^(HF|HUGGINGFACE|HUGGING_FACE)_(TOKEN|API_KEY|HUB_TOKEN)$/, provider: "Hugging Face", hosts: ["huggingface.co"], header: "Authorization", prefix: "Bearer " },
  { re: /^ELEVEN_?LABS_(API_)?KEY$/, provider: "ElevenLabs", hosts: ["api.elevenlabs.io"], header: "xi-api-key", prefix: "" },
  { re: /^BRAVE_(SEARCH_)?(API_)?KEY$/, provider: "Brave Search", hosts: ["api.search.brave.com"], header: "X-Subscription-Token", prefix: "" },
  { re: /^EXA_(API_)?KEY$/, provider: "Exa", hosts: ["api.exa.ai"], header: "x-api-key", prefix: "" },
  { re: /^SERPER_(API_)?KEY$/, provider: "Serper", hosts: ["google.serper.dev"], header: "X-API-KEY", prefix: "" },
  { re: /^RESEND_(API_)?KEY$/, provider: "Resend", hosts: ["api.resend.com"], header: "Authorization", prefix: "Bearer " },
  { re: /^SENDGRID_(API_)?KEY$/, provider: "SendGrid", hosts: ["api.sendgrid.com"], header: "Authorization", prefix: "Bearer " },
  { re: /^NOTION_(API_)?(KEY|TOKEN|SECRET)$/, provider: "Notion", hosts: ["api.notion.com"], header: "Authorization", prefix: "Bearer " },
  { re: /^AIRTABLE_(API_)?(KEY|TOKEN|PAT)$/, provider: "Airtable", hosts: ["api.airtable.com"], header: "Authorization", prefix: "Bearer " },
  { re: /^SLACK_(BOT_|USER_)?TOKEN$/, provider: "Slack", hosts: ["slack.com"], header: "Authorization", prefix: "Bearer " },
  { re: /^PERPLEXITY_(API_)?KEY$/, provider: "Perplexity", hosts: ["api.perplexity.ai"], header: "Authorization", prefix: "Bearer " },
  { re: /^DEEPSEEK_(API_)?KEY$/, provider: "DeepSeek", hosts: ["api.deepseek.com"], header: "Authorization", prefix: "Bearer " },
  { re: /^TOGETHER_(AI_)?(API_)?KEY$/, provider: "Together AI", hosts: ["api.together.xyz"], header: "Authorization", prefix: "Bearer " },
  { re: /^FIRECRAWL_(API_)?KEY$/, provider: "Firecrawl", hosts: ["api.firecrawl.dev"], header: "Authorization", prefix: "Bearer " },
  { re: /^JINA_(API_)?KEY$/, provider: "Jina", hosts: ["r.jina.ai", "s.jina.ai"], header: "Authorization", prefix: "Bearer " },
  { re: /^(COHERE|CO)_(API_)?KEY$/, provider: "Cohere", hosts: ["api.cohere.com"], header: "Authorization", prefix: "Bearer " },
  { re: /^FIREWORKS_(API_)?KEY$/, provider: "Fireworks", hosts: ["api.fireworks.ai"], header: "Authorization", prefix: "Bearer " },
  { re: /^HIGGSFIELD_(API_)?KEY$/, provider: "Higgsfield", hosts: ["platform.higgsfield.ai"], header: "Authorization", prefix: "Bearer " },
];
/** Names that look like settings, not secrets (a port, a mode, an address without a key…). */
const NOT_SECRET = /^(PORT|HOST|NODE_ENV|ENV|DEBUG|LOG_LEVEL|TZ|LANG|MODE|.*_(URL|URI|HOST|PORT|MODE|ENV|REGION|MODEL|NAME|DIR|PATH|LEVEL|TIMEOUT|VERSION|ID))$/;
const SECRETISH = /(KEY|TOKEN|SECRET|PASSWORD|PASS|PAT|CREDENTIALS?|AUTH)$/;

/** KEY=value lines of a .env file (export, quotes and comments handled; no variable expansion). */
export function parseEnv(text: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    const quoted = /^(["'])(.*)\1(\s+#.*)?$/.exec(v);
    if (quoted) v = quoted[2];
    else v = v.replace(/\s+#.*$/, "");
    if (out.some((o) => o.name === m[1])) continue;
    out.push({ name: m[1], value: v });
  }
  return out.slice(0, 200);
}

export function guessVariable(name: string): Omit<ImportVariable, "exists"> {
  const k = KNOWN.find((x) => x.re.test(name));
  if (k) return { name, isSecret: true, provider: k.provider, hosts: k.hosts, header: k.header, prefix: k.prefix, reason: "known provider" };
  if (NOT_SECRET.test(name) && !SECRETISH.test(name)) return { name, isSecret: false, provider: null, hosts: [], header: "", prefix: "", reason: "a setting, not a secret" };
  if (SECRETISH.test(name)) return { name, isSecret: true, provider: null, hosts: [], header: "Authorization", prefix: "Bearer ", reason: "unknown provider: say which host it goes to" };
  return { name, isSecret: false, provider: null, hosts: [], header: "", prefix: "", reason: "not recognised as a secret" };
}

// ── Zip (skills folder) ─────────────────────────────────────────────────────
/**
 * Reads the files of a zip archive (stored or deflated entries, from the central directory; APPNOTE.TXT 4.3.12,
 * 4.3.16). Folders, links (Unix mode in the external attributes) and anything outside the archive's own tree are
 * skipped. Limits (by default): 300 entries, 1 MB per file, 5 MB in all; `want` keeps only the entries it accepts.
 */
export interface ZipLimits { maxEntries?: number; maxFile?: number; maxTotal?: number; want?: (path: string, size: number) => boolean }
export function readZip(buf: Buffer, limits: ZipLimits = {}): { path: string; data: Buffer }[] {
  const { maxEntries = 300, maxFile = 1_000_000, maxTotal = 5_000_000, want } = limits;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("This is not a zip file.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: { path: string; data: Buffer }[] = [];
  let total = 0;
  for (let n = 0; n < Math.min(count, maxEntries); n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const ext = buf.readUInt32LE(p + 38), local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    p += 46 + nlen + xlen + clen;
    const mode = (ext >>> 16) & 0o170000;
    if (name.endsWith("/") || mode === 0o120000 || name.includes("..") || name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.includes("\\")) continue;
    // Entries the caller does not want are skipped before they count (a repository's pictures, fonts…).
    if (want && !want(name, usize)) continue;
    if (usize > maxFile || (total += usize) > maxTotal) throw new Error(`The skills folder is too large (${Math.round(maxFile / 1e6)} MB per file, ${Math.round(maxTotal / 1e6)} MB in all).`);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw, { maxOutputLength: maxFile }) : null;
    if (data) out.push({ path: name, data });
  }
  return out;
}

/** Skills in the archive: SKILL.md files (folder name = skill name) and other .md files; front matter name/description read. */
export function skillsIn(files: { path: string; data: Buffer }[]): { name: string; description: string; body: string; path: string }[] {
  const out: { name: string; description: string; body: string; path: string }[] = [];
  for (const f of files) {
    if (!/\.md$/i.test(f.path) || /(^|\/)(README|LICENSE|CHANGELOG)\.md$/i.test(f.path)) continue;
    const text = f.data.toString("utf8");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    const meta = (k: string) => fm ? (new RegExp(`^${k}:\\s*(.+)$`, "m").exec(fm[1])?.[1] ?? "").trim().replace(/^["']|["']$/g, "") : "";
    const parts = f.path.split("/");
    const base = /^skill\.md$/i.test(parts[parts.length - 1]) ? parts[parts.length - 2] ?? "skill" : parts[parts.length - 1].replace(/\.md$/i, "");
    const name = clip((meta("name") || base).replace(/[-_]+/g, " ").trim(), 60);
    if (!name) continue;
    out.push({ name, description: clip(meta("description") || (text.replace(fm?.[0] ?? "", "").split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? ""), 200), body: clip(text, 20_000), path: f.path });
  }
  return out.slice(0, 50);
}
/** Something in a skill's text that looks like a key (long token-looking strings, or KEY=…). */
export const mentionsKey = (text: string) => /\b(sk|pk|rk|ghp|gho|xox[abp]|hf|AIza)[-_][A-Za-z0-9_-]{12,}|\b[A-Z][A-Z0-9_]*(KEY|TOKEN|SECRET)\s*[=:]\s*["']?[A-Za-z0-9_\-./+]{16,}/.test(text);

interface Pending { userId: string; vars: { name: string; value: string }[]; skills: { name: string; description: string; body: string; path: string }[]; until: number }
const pending = new Map<string, Pending>();
const sweep = () => { for (const [k, v] of pending) if (v.until < now()) pending.delete(k); };

export function previewImport(userId: string, envText: string, zip: Buffer | null): ImportPreview {
  sweep();
  const vars = envText ? parseEnv(envText) : [];
  const found = zip ? skillsIn(readZip(zip)) : [];
  const previewId = randomBytes(18).toString("base64url");
  pending.set(previewId, { userId, vars, skills: found, until: now() + 15 * 60_000 });
  const existingSkills = new Set(q.all<{ name: string }>("SELECT s.name FROM skills s JOIN bots b ON b.id = s.bot_id WHERE b.user_id = ?", userId).map((r) => r.name.toLowerCase()));
  const variables: ImportVariable[] = vars.map((v) => ({ ...guessVariable(v.name), exists: !!vault.byName(userId, v.name) }));
  const skillList: ImportSkill[] = found.map((s) => ({ name: s.name, description: s.description, path: s.path, mentionsKey: mentionsKey(s.body), exists: existingSkills.has(s.name.toLowerCase()), scan: scanSkill(s) }));
  return { previewId, variables, skills: skillList, ignored: variables.filter((v) => !v.isSecret).map((v) => v.name) };
}

export interface ImportBinding { name: string; import: boolean; hosts: string[]; header?: string; prefix?: string }

/** Imports what the user confirmed. Each secret is checked (A2) and its state reported. */
export async function commitImport(userId: string, previewId: string, bindings: ImportBinding[], opts: { replace: boolean; skills: string[]; skillScope: "shared" | string }): Promise<ImportReport> {
  const p = pending.get(previewId);
  if (!p || p.userId !== userId || p.until < now()) throw new Error("This preview has expired. Drop the files again.");
  const report: ImportReport = { created: [], updated: [], skipped: [], toComplete: [], skills: [], health: [] };
  const hostOk = (h: string) => /^[a-z0-9.-]+\.[a-z]{2,}$|^localhost$|^\d+\.\d+\.\d+\.\d+$/.test(h);
  for (const v of p.vars) {
    const b = bindings.find((x) => x.name === v.name);
    const guess = guessVariable(v.name);
    if (!b?.import) { report.skipped.push(v.name); continue; }
    const hosts = (b.hosts ?? []).map((h) => String(h).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "")).filter(hostOk).slice(0, 10);
    if (!hosts.length || !v.value) { report.toComplete.push(v.name); continue; }
    const header = (b.header ?? guess.header ?? "Authorization").trim() || "Authorization";
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(header) || ["host", "cookie", "content-length", "connection", "transfer-encoding"].includes(header.toLowerCase())) { report.toComplete.push(v.name); continue; }
    const prefix = (b.prefix ?? guess.prefix ?? "").slice(0, 40);
    const existing = vault.byName(userId, v.name);
    const fields = { kind: "secret" as const, name: v.name, site: "", username: "", passwordEnc: seal(v.value), note: guess.provider ? `Imported (${guess.provider})` : "Imported from a .env file", hosts, header, prefix };
    if (existing) {
      if (!opts.replace || existing.kind !== "secret") { report.skipped.push(v.name); continue; }
      vault.update(existing.id, { ...fields, checkUrl: existing.checkUrl });
      report.updated.push(v.name);
    } else { vault.create(userId, fields); report.created.push(v.name); }
    const saved = vault.byName(userId, v.name)!;
    const h = await checkSecret(saved, v.value);
    recordHealth(userId, "vault", saved.id, saved.name, h);
    report.health.push({ name: v.name, state: h.state, detail: h.detail });
  }
  for (const s of p.skills) {
    if (!opts.skills.includes(s.name)) continue;
    // Shared with every bot (kept by the main bot), or for one bot of this user. Reviewed by the user in the preview.
    const target = opts.skillScope === "shared" ? bots.primary(userId) : bots.byId(opts.skillScope);
    if (!target || target.userId !== userId || target.kind !== "agent") continue;
    if (skills.available(target.id).some((k) => k.name.toLowerCase() === s.name.toLowerCase())) { report.skipped.push(s.name); continue; }
    skills.create(target.id, s.name, s.description, s.body, opts.skillScope === "shared");
    report.skills.push(s.name);
  }
  pending.delete(previewId);
  audit(userId, "vault", `Project import: ${report.created.length} created, ${report.updated.length} updated, ${report.skipped.length} skipped, ${report.skills.length} skills`);
  emit(userId, { type: "vault" });
  emit(userId, { type: "health" });
  return report;
}
