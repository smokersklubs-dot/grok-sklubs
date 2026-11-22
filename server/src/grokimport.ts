import { randomBytes } from "node:crypto";
import { emit } from "./bus.js";
import { describeCron, isValidTimezone, parseCron } from "./cron.js";
import { planLimitError, planRoom } from "./hosted.js";
import { tr } from "./i18n.js";
import { routines } from "./routines.js";
import {
  GROK_EXPORT_FORMAT, GROK_EXPORT_VERSION, maskSecrets,
  type GrokImportBot, type GrokImportChoice, type GrokImportPreview, type GrokImportReport, type GrokImportRoutine,
  type GrokImportSkill, type GrokImportStripped, type GrokImportWarning, type Locale,
} from "./shared.js";
import { withScan } from "./skillscan.js";
import { audit, bots, clip, memories, now, rows, settings, skills, TeamFullError, type UserRecord } from "./store.js";
import { q } from "./db.js";

/**
 * "Importer depuis Grok Bot": the user asks the assistant they use elsewhere to describe its bots with Sklubot's own
 * prompt (GROK_EXPORT_PROMPT_FR / _EN in shared.ts), then pastes the reply here. Format: docs/IMPORT-GROK.md.
 *
 * 1. Parse: the ```json block is found in the reply (prose around it, several blocks, a missing closing fence, no fence
 *    at all), read as JSON with small repairs (trailing commas, comments, raw line breaks in strings, curly quotes), then
 *    checked field by field. 200 KB at most. Only the documented fields are read; everything else is ignored.
 * 2. Clean: anything that looks like a secret (shared.ts findSecrets: keys, tokens, passwords, private keys; plus
 *    cookies, bearer values and card numbers) is replaced by a marker, and a field named like a credential is dropped.
 *    The preview says where (never the value).
 * 3. Preview: kept in memory for 15 minutes under a random id, for this account only. Nothing is created.
 * 4. Commit: only what the user ticked, with their names, as a safe package: careful autonomy, the account's default
 *    model, draft skills (not given to the bot until activated), paused routines, memories only when ticked, no key, no
 *    permission, no approval granted; apps become a to-do notice in each bot's chat. All or nothing (one transaction).
 */

export const GROK_MAX_CHARS = 200_000;
const MAX_BOTS = 20, MAX_SKILLS = 30, MAX_ROUTINES = 20, MAX_MEMORIES = 50, MAX_APPS = 30;

/** A refusal with its English text (the key of i18n.ts) and the HTTP status to answer with. */
export class GrokImportError extends Error {
  constructor(public code: string, public english: string, public vars: Record<string, string | number> = {}, public status: 400 | 404 | 413 = 400) {
    super(tr("en", english, vars));
    this.name = "GrokImportError";
  }
  text(locale: Locale | undefined) { return tr(locale, this.english, this.vars); }
}

// ── 1. Finding the block ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The fenced code blocks of a Markdown reply (``` or ~~~, any language tag), in order; a block whose closing fence is
 * missing (a reply cut off, or copied in part) runs to the end of the text.
 */
export function fencedBlocks(text: string): { lang: string; body: string }[] {
  const out: { lang: string; body: string }[] = [];
  const lines = text.split(/\r?\n/);
  let open: { fence: string; lang: string; start: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/.exec(lines[i]);
    if (!open) {
      if (m) open = { fence: m[1], lang: m[2].toLowerCase(), start: i + 1 };
    } else if (m && m[1][0] === open.fence[0] && m[1].length >= open.fence.length && !m[2]) {
      out.push({ lang: open.lang, body: lines.slice(open.start, i).join("\n") });
      open = null;
    }
  }
  if (open) out.push({ lang: open.lang, body: lines.slice(open.start).join("\n") });
  return out;
}

/** The first balanced {...} or [...] in a text, read with strings in mind (so a brace inside a string does not count). */
export function balancedJson(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start < 0) return null;
  const stack: string[] = [];
  let inStr: string | null = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"') inStr = ch;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return text.slice(start, i + 1);
      if (!stack.length) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

// ── 2. Reading JSON with small repairs ───────────────────────────────────────────────────────────────────────────

/**
 * One pass over the text that fixes what assistants commonly get wrong in a JSON block, without touching the content of
 * strings: // and /* *\/ comments and trailing commas outside strings are removed; raw line breaks and tabs inside
 * strings are escaped; an unfinished document (cut off) is closed.
 */
function repairJson(src: string): string {
  let out = "";
  let inStr = false;
  const stack: string[] = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === "\\") { out += ch + (src[i + 1] ?? ""); i++; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") continue;
      if (ch === "\t") { out += "\\t"; continue; }
      out += ch;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; continue; }
    if (ch === "/" && src[i + 1] === "*") { const end = src.indexOf("*/", i + 2); i = end < 0 ? src.length : end + 1; continue; }
    if (ch === ",") {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === "}" || src[j] === "]" || j >= src.length) continue;
    }
    if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    if (ch === "}" || ch === "]") stack.pop();
    out += ch;
  }
  if (inStr) out += '"';
  // Cut off: drop a dangling comma or key, then close what is still open.
  if (stack.length) out = out.replace(/,\s*$/, "").replace(/,\s*"[^"]*"\s*:?\s*$/, "") + stack.reverse().join("");
  return out;
}

/** JSON.parse, then the same after repairs, then after curly quotes used as JSON quotes are straightened. */
export function looseJsonParse(src: string): { value: unknown; repaired: boolean } {
  const text = src.replace(/^﻿/, "").trim();
  try { return { value: JSON.parse(text), repaired: false }; } catch (first) {
    try { return { value: JSON.parse(repairJson(text)), repaired: true }; } catch { /* next try */ }
    // Some chat apps turn "…" into “…”; inside a document whose quotes are all curly, they are the JSON quotes.
    if (/[“”]/.test(text) && !/"/.test(text.replace(/\\"/g, ""))) {
      try { return { value: JSON.parse(repairJson(text.replace(/[“”]/g, '"'))), repaired: true }; } catch { /* reported below */ }
    }
    throw new GrokImportError("bad_json", "The export could not be read ({detail}). Ask for it again, or correct the block and paste it again.", { detail: clip((first as Error).message, 120) });
  }
}

// ── 3. Checking and cleaning ─────────────────────────────────────────────────────────────────────────────────────

/** Field names that hold a credential: dropped wherever they appear, and reported. */
export const CREDENTIAL_KEY = /pass(word|wd|phrase)?$|^pwd$|mot.?de.?passe|api.?key|secret|token|cookie|credential|^session|bearer|^auth(orization)?$|^otp$|^pin$|card.?number|iban/i;
/** Formats findSecrets does not cover, worth catching here: cookies, bearer values, card numbers (Luhn-checked). */
const EXTRA: { kind: GrokImportStripped["kind"]; re: RegExp; group?: number; check?: (v: string) => boolean }[] = [
  // "mot de passe Gmail : …", "password for the bank is …": a few words may sit between the word and the value.
  { kind: "password", re: /(?<![\p{L}\p{N}_])(?:password|passwd|passcode|mot de passe|mdp|code pin|code secret)(?:[ \t]+[\p{L}\p{N}'’.-]+){0,3}[ \t]*(?:[:=]|\best\b|\bis\b)[ \t]*["'«]?[ \t]*([^\s"'»]{4,200})/giu, group: 1, check: (v) => !/^\[|^\*+$/.test(v) },
  { kind: "cookie", re: /\b(?:set-)?cookie\s*[:=]\s*([^\n"]{8,})/gi, group: 1 },
  { kind: "token", re: /\bbearer\s+([A-Za-z0-9._~+/=-]{16,})/gi, group: 1 },
  { kind: "card", re: /\b(?:\d[ -]?){13,19}\b/g, check: (v) => luhn(v.replace(/\D/g, "")) },
];
function luhn(d: string): boolean {
  if (d.length < 13 || d.length > 19 || /^(\d)\1+$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) { let n = +d[d.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; }
  return sum % 10 === 0;
}

const LABELS: Record<string, { fr: string; en: string }> = {
  role: { fr: "rôle", en: "role" }, personality: { fr: "personnalité", en: "personality" }, instructions: { fr: "consignes", en: "instructions" },
  memory: { fr: "souvenir", en: "memory" }, skill: { fr: "compétence", en: "skill" }, routine: { fr: "routine", en: "routine" },
  app: { fr: "application", en: "app" }, name: { fr: "nom", en: "name" }, field: { fr: "champ", en: "field" },
};
const label = (k: string, l: Locale) => (l === "fr" ? LABELS[k]?.fr : LABELS[k]?.en) ?? k;

export interface Cleaner { stripped: GrokImportStripped[]; placeholder: string }
/** The text without its secrets (each replaced by the placeholder and reported under `where`). */
export function scrub(text: string, where: string, cx: Cleaner): { text: string; found: boolean } {
  const masked = maskSecrets(text, cx.placeholder);
  let out = masked.text;
  for (const s of masked.secrets) cx.stripped.push({ where, kind: s.kind });
  let found = masked.secrets.length > 0;
  for (const x of EXTRA) {
    out = out.replace(x.re, (...m) => {
      const whole = m[0] as string;
      const value = x.group ? (m[x.group] as string) : whole;
      if (x.check && !x.check(value)) return whole;
      if (value.includes(cx.placeholder)) return whole;
      cx.stripped.push({ where, kind: x.kind });
      found = true;
      return whole.replace(value, cx.placeholder);
    });
  }
  return { text: out, found };
}

/** A text field: a string, or a list of strings (joined by line), or a number; anything else is empty. */
function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(textOf).filter((s) => s.trim()).join("\n");
  return "";
}
const pick = (o: Record<string, unknown>, ...keys: string[]) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const tidy = (s: string, n: number) => clip(s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim(), n);

const BOT_KEYS = { name: ["name", "nom"], role: ["role", "rôle", "job", "description"], personality: ["personality", "personnalite", "personnalité", "tone", "ton"], instructions: ["instructions", "consignes", "systemPrompt"], memories: ["memories", "souvenirs", "facts", "memory"], skills: ["skills", "competences", "compétences"], routines: ["routines", "schedules", "tasks"], apps: ["apps", "applications", "connectedApps", "integrations"] };
const SKILL_KEYS = { name: ["name", "nom"], when: ["when", "whenToUse", "quand", "trigger", "description"], steps: ["steps", "etapes", "étapes", "procedure", "how"] };
const ROUTINE_KEYS = { name: ["name", "nom"], schedule: ["schedule", "when", "quand", "frequency"], cron: ["cron"], timezone: ["timezone", "tz", "fuseau"], task: ["task", "tache", "tâche", "prompt", "what", "action"] };
const known = (map: Record<string, string[]>) => new Set(Object.values(map).flat());
const KNOWN_ROOT = new Set(["format", "version", "bots", "exportedAt", "generatedAt", "source"]);

export interface ParsedExport { bots: Omit<GrokImportBot, "nameTaken">[]; stripped: GrokImportStripped[]; warnings: GrokImportWarning[] }

/** Reads a pasted reply into bots, cleaned of secrets. Throws GrokImportError when there is nothing usable. */
export function parseGrokExport(raw: string, opts: { locale?: Locale; timezone?: string } = {}): ParsedExport {
  const locale: Locale = opts.locale ?? "en";
  const fallbackTz = opts.timezone && isValidTimezone(opts.timezone) ? opts.timezone : "UTC";
  const text = typeof raw === "string" ? raw : "";
  if (!text.trim()) throw new GrokImportError("empty", "Paste the assistant's reply first.");
  if (text.length > GROK_MAX_CHARS) throw new GrokImportError("too_large", "This reply is too long ({kb} KB; 200 KB at most). Ask for fewer bots at a time.", { kb: Math.ceil(text.length / 1000) }, 413);
  const warnings: GrokImportWarning[] = [];

  // The block: a fenced one that reads as an export (a json-tagged one first), else the first JSON in the text.
  const blocks = fencedBlocks(text);
  const candidates = [...blocks.filter((b) => b.lang === "json" || b.lang === "jsonc"), ...blocks.filter((b) => b.lang !== "json" && b.lang !== "jsonc")]
    .map((b) => balancedJson(b.body)).filter((s): s is string => !!s);
  const bare = balancedJson(text);
  if (bare && !candidates.includes(bare)) candidates.push(bare);
  if (!candidates.length) throw new GrokImportError("no_block", "No export was found in this text. Check that you pasted the whole reply, with its ```json block.");
  if (blocks.length > 1) warnings.push({ code: "several_blocks", n: blocks.length });
  let root: unknown = undefined, repaired = false, firstError: GrokImportError | null = null;
  for (const c of candidates) {
    try {
      const r = looseJsonParse(c);
      const looks = Array.isArray(r.value) || (isObj(r.value) && (Array.isArray(r.value.bots) || typeof r.value.name === "string"));
      if (!looks) continue;
      root = r.value; repaired = r.repaired;
      break;
    } catch (e) { firstError ??= e as GrokImportError; }
  }
  if (root === undefined) {
    if (firstError) throw firstError;
    throw new GrokImportError("no_bots", "This block is not a bot export: it has no “bots” list.");
  }
  if (repaired) warnings.push({ code: "repaired" });

  const cx: Cleaner = { stripped: [], placeholder: locale === "fr" ? "[secret retiré]" : "[secret removed]" };
  let list: unknown[];
  if (Array.isArray(root)) { list = root; warnings.push({ code: "no_version" }); }
  else if (isObj(root) && Array.isArray(root.bots)) {
    list = root.bots;
    if (root.format !== undefined && root.format !== GROK_EXPORT_FORMAT) warnings.push({ code: "unknown_fields", detail: `format: ${clip(textOf(root.format), 40)}` });
    const v = Number(root.version);
    if (root.version === undefined || !Number.isFinite(v)) warnings.push({ code: "no_version" });
    else if (v > GROK_EXPORT_VERSION) warnings.push({ code: "newer_version", n: v });
    for (const k of Object.keys(root)) if (!KNOWN_ROOT.has(k) && CREDENTIAL_KEY.test(k)) cx.stripped.push({ where: `${label("field", locale)} “${clip(k, 40)}”`, kind: "field" });
  } else { list = [root]; warnings.push({ code: "no_version" }); }

  const objs = list.filter(isObj);
  if (!objs.length) throw new GrokImportError("no_bots", "This block is not a bot export: it has no “bots” list.");
  if (objs.length > MAX_BOTS) warnings.push({ code: "too_many_bots", n: MAX_BOTS });
  const unknown = new Set<string>();
  let cut = false;
  /** Fields of `o` outside `allowed`: a credential-like one is reported as stripped, any other as unknown (ignored). */
  const extraFields = (o: Record<string, unknown>, allowed: Set<string>, where: string) => {
    for (const [k, v] of Object.entries(o)) {
      if (allowed.has(k)) continue;
      if (CREDENTIAL_KEY.test(k) && textOf(v).trim()) cx.stripped.push({ where: `${where} › ${label("field", locale)} “${clip(k, 40)}”`, kind: "field" });
      else unknown.add(k);
    }
  };

  const out = objs.slice(0, MAX_BOTS).map((o, bi): Omit<GrokImportBot, "nameTaken"> => {
    const name = tidy(scrub(textOf(pick(o, ...BOT_KEYS.name)), `#${bi + 1} › ${label("name", locale)}`, cx).text.replace(/\n+/g, " "), 60) || `Bot ${bi + 1}`;
    extraFields(o, known(BOT_KEYS), name);
    const field = (keys: string[], k: string, n: number) => tidy(scrub(textOf(pick(o, ...keys)), `${name} › ${label(k, locale)}`, cx).text, n);

    const memRaw = pick(o, ...BOT_KEYS.memories);
    const memList = (Array.isArray(memRaw) ? memRaw : typeof memRaw === "string" ? memRaw.split(/\n+/) : [])
      .map((m) => (isObj(m) ? textOf(pick(m, "text", "fact", "value", "memory")) : textOf(m)).replace(/^\s*[-*•]\s*/, ""))
      .filter((m) => m.trim());
    if (memList.length > MAX_MEMORIES) cut = true;
    const mems = memList.slice(0, MAX_MEMORIES).map((m, i) => { const s = scrub(m, `${name} › ${label("memory", locale)} ${i + 1}`, cx); return { text: tidy(s.text, 500), flagged: s.found }; }).filter((m) => m.text);

    const skRaw = pick(o, ...BOT_KEYS.skills);
    const skList = (Array.isArray(skRaw) ? skRaw : []).filter(isObj);
    if (skList.length > MAX_SKILLS) cut = true;
    const sks: GrokImportSkill[] = [];
    for (const [i, s] of skList.slice(0, MAX_SKILLS).entries()) {
      const sName = tidy(textOf(pick(s, ...SKILL_KEYS.name)).replace(/\n+/g, " "), 80) || `${label("skill", locale)} ${i + 1}`;
      const where = `${name} › ${label("skill", locale)} “${sName}”`;
      extraFields(s, known(SKILL_KEYS), where);
      const stepsRaw = pick(s, ...SKILL_KEYS.steps);
      const steps = Array.isArray(stepsRaw) ? stepsRaw.map(textOf).filter((x) => x.trim()).map((x, n) => `${n + 1}. ${x.trim().replace(/^\d+[.)]\s*/, "")}`).join("\n") : textOf(stepsRaw);
      const when = textOf(pick(s, ...SKILL_KEYS.when));
      if (!steps.trim() && !when.trim()) continue;
      sks.push({ name: tidy(scrub(sName, where, cx).text, 80), when: tidy(scrub(when, where, cx).text, 300), steps: tidy(scrub(steps || when, where, cx).text, 20_000) });
    }

    const rtRaw = pick(o, ...BOT_KEYS.routines);
    const rtList = (Array.isArray(rtRaw) ? rtRaw : []).filter(isObj);
    if (rtList.length > MAX_ROUTINES) cut = true;
    const rts: GrokImportRoutine[] = [];
    for (const [i, r] of rtList.slice(0, MAX_ROUTINES).entries()) {
      const rName = tidy(textOf(pick(r, ...ROUTINE_KEYS.name)).replace(/\n+/g, " "), 80) || `${label("routine", locale)} ${i + 1}`;
      const where = `${name} › ${label("routine", locale)} “${rName}”`;
      extraFields(r, known(ROUTINE_KEYS), where);
      const task = tidy(scrub(textOf(pick(r, ...ROUTINE_KEYS.task)), where, cx).text, 4000);
      const schedule = tidy(scrub(textOf(pick(r, ...ROUTINE_KEYS.schedule)), where, cx).text.replace(/\n+/g, " "), 200);
      if (!task && !schedule) continue;
      const cron = validCron(textOf(pick(r, ...ROUTINE_KEYS.cron)));
      const tzRaw = textOf(pick(r, ...ROUTINE_KEYS.timezone)).trim();
      const timezone = tzRaw && isValidTimezone(tzRaw) ? tzRaw : fallbackTz;
      rts.push({ name: tidy(scrub(rName, where, cx).text, 80), schedule, cron, timezone, task: task || rName, describe: cron ? describeCron(cron, locale) : schedule });
    }

    const appRaw = pick(o, ...BOT_KEYS.apps);
    const appList = (Array.isArray(appRaw) ? appRaw : typeof appRaw === "string" ? appRaw.split(/[,\n]+/) : []).map((a) => (isObj(a) ? textOf(pick(a, "name", "nom", "app")) : textOf(a)));
    const apps: string[] = [];
    for (const a of appList) {
      // By name only: addresses, links and anything after them are dropped.
      const n = tidy(a.replace(/https?:\/\/\S+/g, "").replace(/[^\s()]+@[^\s()]+/g, "").replace(/\(\s*\)|\[\s*\]/g, "").replace(/\s+/g, " "), 60);
      if (n && !apps.some((x) => x.toLowerCase() === n.toLowerCase()) && !scrub(n, `${name} › ${label("app", locale)}`, cx).found) apps.push(n);
      if (apps.length >= MAX_APPS) break;
    }

    return {
      name, role: field(BOT_KEYS.role, "role", 500), personality: field(BOT_KEYS.personality, "personality", 2000),
      instructions: field(BOT_KEYS.instructions, "instructions", 6000), memories: mems, skills: sks, routines: rts, apps,
    };
  });
  if (cut) warnings.push({ code: "too_many_items" });
  if (unknown.size) warnings.push({ code: "unknown_fields", detail: [...unknown].slice(0, 10).map((k) => clip(k, 30)).join(", ") });
  const noCron = out.reduce((n, b) => n + b.routines.filter((r) => !r.cron).length, 0);
  if (noCron) warnings.push({ code: "routine_no_cron", n: noCron });
  return { bots: out, stripped: cx.stripped, warnings };
}

/** A 5-field cron expression the scheduler can read, or "". */
export function validCron(v: string): string {
  const expr = v.trim().replace(/\s+/g, " ");
  if (!expr || expr.split(" ").length !== 5) return "";
  try { parseCron(expr); return expr; } catch { return ""; }
}

// ── 4. Preview and commit ────────────────────────────────────────────────────────────────────────────────────────

interface Pending { userId: string; bots: Omit<GrokImportBot, "nameTaken">[]; until: number }
const pending = new Map<string, Pending>();
const sweep = () => { for (const [k, v] of pending) if (v.until < now()) pending.delete(k); };
const PREVIEW_MS = 15 * 60_000;

/** Room for `n` more bots on this installation (MAX_BOTS): the limit, when it would be passed. */
export function teamFullAt(n: number): number | null {
  try { bots.assertRoom(n); return null; } catch (e) { if (e instanceof TeamFullError) return e.max; throw e; }
}

export function previewGrokImport(user: UserRecord, text: string): GrokImportPreview {
  sweep();
  const parsed = parseGrokExport(text, { locale: user.locale, timezone: settings.profile(user.id).timezone });
  const previewId = randomBytes(18).toString("base64url");
  // At most a few previews per account wait at once (each one is a pasted reply held in memory).
  const mine = [...pending.entries()].filter(([, p]) => p.userId === user.id);
  for (const [k] of mine.slice(0, Math.max(0, mine.length - 4))) pending.delete(k);
  pending.set(previewId, { userId: user.id, bots: parsed.bots, until: now() + PREVIEW_MS });
  const room = planRoom(user.id);
  const warnings = [...parsed.warnings];
  if (room.bots !== null && parsed.bots.length > room.bots) warnings.push({ code: "bots_limit", n: room.bots });
  const full = teamFullAt(parsed.bots.length);
  if (full !== null) warnings.push({ code: "team_full", n: full });
  const routineCount = parsed.bots.reduce((n, b) => n + b.routines.length, 0);
  if (room.activeRoutines !== null && routineCount > room.activeRoutines) warnings.push({ code: "routines_limit", n: room.activeRoutines });
  const apps: string[] = [];
  for (const b of parsed.bots) for (const a of b.apps) if (!apps.some((x) => x.toLowerCase() === a.toLowerCase())) apps.push(a);
  return {
    previewId, bots: parsed.bots.map((b) => ({ ...b, skills: b.skills.map(withScan), nameTaken: !!bots.byName(user.id, b.name) })), apps,
    stripped: parsed.stripped, warnings, room: { bots: room.bots, activeRoutines: room.activeRoutines },
  };
}

/** `base`, or "base (2)", "base (3)"… — the first that `taken` does not hold. */
export function freeName(base: string, taken: (n: string) => boolean, max = 60): string {
  const b = base.trim() || "Bot";
  if (!taken(b)) return clip(b, max);
  for (let i = 2; i < 1000; i++) { const n = `${clip(b, max - String(i).length - 3)} (${i})`; if (!taken(n)) return n; }
  return clip(`${b} ${Date.now()}`, max);
}

export function commitGrokImport(user: UserRecord, previewId: string, choices: GrokImportChoice[]): GrokImportReport {
  const p = pending.get(previewId);
  if (!p || p.userId !== user.id || p.until < now()) throw new GrokImportError("expired", "This preview has expired. Paste the reply again.");
  const seen = new Set<number>();
  const picked = choices.filter((c) => c && c.include && Number.isInteger(c.index) && p.bots[c.index] && !seen.has(c.index) && (seen.add(c.index), true));
  if (!picked.length) throw new GrokImportError("nothing", "Nothing is ticked: choose at least one bot.");
  // Limits first, so a refusal creates nothing: this installation (MAX_BOTS), then the account's plan (hosted mode).
  bots.assertRoom(picked.length);
  const room = planRoom(user.id);
  if (room.bots !== null && picked.length > room.bots) throw planLimitError("bots", room.maxBots!);

  const locale = user.locale;
  const usedNames = new Set<string>();
  const report: GrokImportReport = { bots: [], skills: 0, routines: 0, memories: 0, unscheduled: [], apps: [] };
  const todo: { botId: string; apps: string[]; drafts: number; paused: number; unscheduled: string[] }[] = [];
  q.tx(() => {
    for (const c of picked) {
      const src = p.bots[c.index];
      const wanted = tidy(typeof c.name === "string" && c.name.trim() ? c.name : src.name, 60).replace(/\n+/g, " ") || src.name;
      const name = freeName(wanted, (n) => usedNames.has(n.toLowerCase()) || !!bots.byName(user.id, n));
      usedNames.add(name.toLowerCase());
      const instructions = [src.instructions, src.personality ? tr(locale, "Personality and tone: {text}", { text: src.personality }) : ""].filter(Boolean).join("\n\n");
      // Careful autonomy, the account's default model (""), the default tools and character: nothing in a pasted text
      // can hand out trust, a model or a permission.
      const bot = bots.create(user.id, { name, description: src.role, instructions, autonomy: "careful", model: "", mode: "personal" });
      report.bots.push({ id: bot.id, name: bot.name });

      const skillNames = new Set<string>();
      let drafts = 0;
      for (const sc of Array.isArray(c.skills) ? c.skills : []) {
        const s = sc?.include && Number.isInteger(sc.index) ? src.skills[sc.index] : undefined;
        if (!s) continue;
        const sName = freeName(tidy(typeof sc.name === "string" && sc.name.trim() ? sc.name : s.name, 80).replace(/\n+/g, " ") || s.name, (n) => skillNames.has(n.toLowerCase()), 80);
        skillNames.add(sName.toLowerCase());
        // A draft: listed in the bot's settings, never given to the bot until the user activates it.
        skills.create(bot.id, sName, s.when, s.steps, false, { draft: true });
        drafts++;
      }

      let paused = 0;
      const unscheduled: string[] = [];
      for (const rc of Array.isArray(c.routines) ? c.routines : []) {
        const r = rc?.include && Number.isInteger(rc.index) ? src.routines[rc.index] : undefined;
        if (!r) continue;
        const rName = tidy(typeof rc.name === "string" && rc.name.trim() ? rc.name : r.name, 80).replace(/\n+/g, " ") || r.name;
        const cron = typeof rc.cron === "string" && rc.cron.trim() ? validCron(rc.cron) : r.cron;
        if (!cron) { unscheduled.push(r.schedule ? `${rName} (${r.schedule})` : rName); continue; }
        // Paused: nothing runs before the user has looked at it and turned it on.
        routines.create(bot.id, { name: rName, prompt: r.task, trigger: "cron", schedule: cron, timezone: r.timezone, paused: true });
        paused++;
      }

      let mems = 0;
      const ticked = new Set((Array.isArray(c.memories) ? c.memories : []).filter((i) => Number.isInteger(i)));
      for (const [i, m] of src.memories.entries()) if (ticked.has(i) && m.text) { memories.add(bot.id, m.text, "import"); mems++; }

      const appPick = Array.isArray(c.apps) ? new Set(c.apps.filter((i) => Number.isInteger(i))) : null;
      const apps = src.apps.filter((_, i) => !appPick || appPick.has(i));
      report.skills += drafts; report.routines += paused; report.memories += mems;
      report.unscheduled.push(...unscheduled);
      for (const a of apps) if (!report.apps.some((x) => x.toLowerCase() === a.toLowerCase())) report.apps.push(a);
      todo.push({ botId: bot.id, apps, drafts, paused, unscheduled });
    }
  });
  pending.delete(previewId);

  // The to-do notice in each new bot's chat: apps to connect, drafts to check, routines to turn on.
  for (const t of todo) {
    const items = [
      t.apps.length ? tr(locale, "connect {apps} (Settings → Apps); no key or sign-in was imported", { apps: t.apps.join(", ") }) : "",
      t.drafts ? tr(locale, "read its {n} draft skill(s) and activate the ones you keep (its settings → Skills)", { n: t.drafts }) : "",
      t.paused ? tr(locale, "check its {n} paused routine(s), then turn them on", { n: t.paused }) : "",
      t.unscheduled.length ? tr(locale, "say when these should run, then create them: {list}", { list: t.unscheduled.join("; ") }) : "",
    ].filter(Boolean);
    const text = `${tr(locale, "Imported bot. It starts careful: it asks before acting.")}${items.length ? ` ${tr(locale, "To do:")} ${items.map((x) => `• ${x}`).join(" ")}` : ""}`;
    rows.append({ id: t.botId, userId: user.id }, { kind: "notice", tone: "info", text, ...(t.apps.length ? { action: { kind: "settings" as const, section: "connectors" } } : {}) });
  }
  emit(user.id, { type: "roster" });
  audit(user.id, "account", `Bots imported from a pasted export: ${report.bots.map((b) => b.name).join(", ")} (${report.skills} draft skills, ${report.routines} paused routines, ${report.memories} memories, ${report.apps.length} apps to connect)`);
  return report;
}

/** Tests: drop the previews kept in memory. */
export const _grokPending = pending;
