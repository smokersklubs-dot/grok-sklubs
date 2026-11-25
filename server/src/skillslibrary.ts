import { existsSync, readdirSync, readFileSync } from "node:fs"; import { byLocale, type LocaleTexts } from "./lang/index.js";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { emit } from "./bus.js";
import type { Locale } from "./shared.js";
import { scanSkill } from "./skillscan.js";
import { LIBRARY_CATEGORIES, type LibraryAddReport, type LibraryCategory, type LibraryOrigin, type LibrarySkill } from "./skillstypes.js";
import { skillMeta } from "./skillhealth.js"; import { keepCompanions, skillFiles, type CompanionFile } from "./skillfiles.js";
import { audit, bots, sha256, skills, type BotRecord } from "./store.js";

/**
 * « Bibliothèque de compétences » (docs/COMPETENCES.md): skills bundled with Sklubot, in server/skills-library/.
 *
 * Each skill is a folder with SKILL.md (English), optionally SKILL.fr.md (French), LICENSE.txt and NOTICE, listed in
 * catalog.json. Origins: Sklubot's own skills (MIT, the project's licence), skills adapted from the public repositories
 * github.com/anthropics/skills ("anthropic") and github.com/nexu-io/open-design ("opendesign"), Apache-2.0 only (their
 * LICENSE.txt is kept unchanged and their NOTICE and the first line of their text say what was changed, as Apache-2.0 §4
 * asks), the Hermes Bot Kit ("hermes", MIT), and skills adapted from other open-source repositories ("community"): MIT,
 * Apache-2.0 or CC BY 4.0 texts only, each with the upstream licence text in LICENSE.txt, a NOTICE naming the copyright
 * holder, the source pinned to one commit and the changes made (licenceOk below). A folder without its licence or notice
 * is not offered. Each skill has a theme ("category") the gallery groups by. The texts are read once at startup.
 *
 * Adding one to a bot creates an ordinary skill (active: the owner read the card and chose it), named after the skill's
 * title in the account's language. Adding it again changes nothing (a bot that already has a skill of that name, in
 * either language, is skipped).
 */

interface Entry {
  id: string; origin: LibraryOrigin; category: LibraryCategory; licence: string; source: string;
  title: LocaleTexts<string>; summary: LocaleTexts<string>;
  text: Partial<Record<Locale, { description: string; body: string }>>; notice: string;
  /** L130: text files of its `files/` folder (templates, styles), copied with the skill, never run. */
  files: CompanionFile[];
}

/** The text files under a library skill's `files/` folder (L130), within the companion limits. */
function libraryFiles(dir: URL): CompanionFile[] {
  const root = new URL("files/", dir);
  if (!existsSync(root)) return [];
  const base = fileURLToPath(root);
  const names = readdirSync(base, { recursive: true, withFileTypes: true }).filter((d) => d.isFile())
    .map((d) => relative(base, join(d.parentPath, d.name)).split(sep).join("/")).sort();
  return keepCompanions(names.map((n) => ({ path: n, content: readFileSync(new URL(n, root), "utf8") }))).kept;
}

const DIR = new URL("../skills-library/", import.meta.url);
const ID = /^[a-z0-9][a-z0-9-]{1,60}$/;
const ORIGINS = new Set<unknown>(["sklubot", "anthropic", "opendesign", "hermes", "community"] satisfies LibraryOrigin[]);

/** What each licence of a "community" skill must show in its LICENSE.txt (the upstream text, unchanged). */
const LICENCE_TEXT: Record<string, RegExp> = {
  "MIT": /Permission is hereby granted, free of charge/,
  "Apache-2.0": /Apache License\s+Version 2\.0/,
  "CC-BY-4.0": /Creative Commons Attribution 4\.0|CC BY 4\.0/,
};
/**
 * A "community" skill: its licence is one of MIT, Apache-2.0, CC-BY-4.0, or several joined by " AND " (a skill made from
 * several sources), each found in LICENSE.txt; its NOTICE states the changes ("Modified for Sklubot") and its source is
 * pinned to a 40-character commit.
 */
export function licenceOk(licence: string, licenceText: string, notice: string, source: string): boolean {
  const parts = licence.split(" AND ").map((x) => x.trim());
  return parts.length > 0 && parts.every((x) => LICENCE_TEXT[x]?.test(licenceText)) && /Modified for Sklubot \(\d{4}-\d{2}-\d{2}\)/.test(notice)
    && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/tree\/[0-9a-f]{40}(\/|$)/.test(source) && /[0-9a-f]{40}/.test(notice);
}

/** Front matter `name:` / `description:` and the text after it. */
export function splitSkill(md: string): { name: string; description: string; body: string } {
  const text = md.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const meta = (k: string) => (fm ? (new RegExp(`^${k}:\\s*(.+)$`, "m").exec(fm[1])?.[1] ?? "").trim().replace(/^["']|["']$/g, "") : "");
  return { name: meta("name"), description: meta("description"), body: (fm ? text.slice(fm[0].length) : text).trim() };
}

function load(): Entry[] {
  let catalog: { skills?: unknown[] };
  try { catalog = JSON.parse(readFileSync(new URL("catalog.json", DIR), "utf8")); } catch (err) { console.warn(`[skills-library] catalog.json: ${(err as Error).message}`); return []; }
  const out: Entry[] = [];
  for (const raw of Array.isArray(catalog.skills) ? catalog.skills : []) {
    const e = raw as Record<string, any>;
    if (typeof e?.id !== "string" || !ID.test(e.id) || !ORIGINS.has(e.origin)) continue;
    const dir = new URL(`${e.id}/`, DIR);
    const file = (n: string) => new URL(n, dir);
    // The licence and its notice travel with the text, or the skill is not offered.
    if (!existsSync(file("SKILL.md")) || !existsSync(file("LICENSE.txt")) || !existsSync(file("NOTICE"))) { console.warn(`[skills-library] ${e.id}: SKILL.md, LICENSE.txt and NOTICE are required`); continue; }
    if ((e.origin === "anthropic" || e.origin === "opendesign") && (e.licence !== "Apache-2.0" || !/Apache License\s+Version 2\.0/.test(readFileSync(file("LICENSE.txt"), "utf8")))) { console.warn(`[skills-library] ${e.id}: only Apache-2.0 skills are bundled`); continue; }
    const text: Entry["text"] = {};
    if (e.origin === "hermes" && (e.licence !== "MIT" || !readFileSync(file("LICENSE.txt"), "utf8").includes("Copyright (c) 2026 Thomas Bekkers"))) {
      console.warn(`[skills-library] ${e.id}: expected the Hermes Bot Kit MIT licence`);
      continue;
    }
    if (e.origin === "community" && !licenceOk(String(e.licence ?? ""), readFileSync(file("LICENSE.txt"), "utf8"), readFileSync(file("NOTICE"), "utf8"), String(e.source ?? ""))) {
      console.warn(`[skills-library] ${e.id}: a community skill needs an MIT, Apache-2.0 or CC-BY-4.0 licence text, its changes and a pinned source`);
      continue;
    }
    for (const [loc, name] of [["en", "SKILL.md"], ["fr", "SKILL.fr.md"]] as const) {
      if (!existsSync(file(name))) continue;
      const s = splitSkill(readFileSync(file(name), "utf8"));
      if (s.body) text[loc] = { description: s.description.slice(0, 300), body: s.body.slice(0, 20_000) };
    }
    if (!text.en) continue;
    const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    out.push({
      id: e.id, origin: e.origin, category: (LIBRARY_CATEGORIES as readonly unknown[]).includes(e.category) ? e.category : "method", licence: str(e.licence, 60), source: str(e.source, 300),
      title: { fr: str(e.title?.fr, 80) || e.id, en: str(e.title?.en, 80) || e.id },
      summary: { fr: str(e.summary?.fr, 300), en: str(e.summary?.en, 300) },
      text, notice: readFileSync(file("NOTICE"), "utf8").split("\n")[0].trim(), files: libraryFiles(dir),
    });
  }
  return out;
}

let cache: Entry[] | null = null;
export const libraryEntries = (): Entry[] => (cache ??= load());
/** A library skill's version: a short hash of all its texts (any language), so a change of language is not an update (skillcatalog.ts). */
export const libraryVersion = (id: string): string | null => {
  const e = libraryEntries().find((x) => x.id === id);
  return e ? sha256(JSON.stringify(e.files.length ? { text: e.text, files: e.files } : e.text)).slice(0, 16) : null;
};

const textFor = (e: Entry, loc: Locale) => (e.text[loc] ? { ...e.text[loc]!, language: loc } : { ...e.text.en!, language: "en" as const });
const agentsOf = (userId: string) => bots.list(userId).filter((b) => b.kind === "agent");
const hasIt = (botId: string, e: Entry) => {
  const names = new Set([e.title.fr, e.title.en].map((n) => n.toLowerCase()));
  return skills.list(botId).some((k) => names.has(k.name.toLowerCase()));
};

/** The gallery: every bundled skill, in the account's language, with how many of its bots already have it. */
export function libraryFor(userId: string, locale: Locale): LibrarySkill[] {
  const agents = agentsOf(userId);
  return libraryEntries().map((e) => {
    const t = textFor(e, locale);
    return {
      id: e.id, origin: e.origin, category: e.category, licence: e.licence, source: e.source, title: byLocale(locale, e.title), summary: byLocale(locale, e.summary),
      body: t.body, language: t.language, notice: e.notice, scan: scanSkill({ name: byLocale(locale, e.title), description: t.description || byLocale(locale, e.summary), body: t.body }), addedTo: agents.filter((b) => hasIt(b.id, e)).length, botCount: agents.length,
    };
  });
}

export class LibraryError extends Error { constructor(public status: 400 | 404, message: string) { super(message); } }

/** Adds a bundled skill to every assistant bot of the account ("all") or to one of them. Idempotent. */
export function addFromLibrary(userId: string, id: string, target: string, locale: Locale): LibraryAddReport {
  const e = libraryEntries().find((x) => x.id === id);
  if (!e) throw new LibraryError(404, "That skill is not in the library.");
  let targets: BotRecord[];
  if (target === "all") targets = agentsOf(userId);
  else {
    const b = bots.owned(userId, target);
    if (!b || b.kind !== "agent" || b.hidden) throw new LibraryError(404, "That bot does not exist.");
    targets = [b];
  }
  if (!targets.length) throw new LibraryError(400, "Create a bot first.");
  const t = textFor(e, locale);
  const report: LibraryAddReport = { added: [], already: [] };
  for (const b of targets) {
    if (hasIt(b.id, e)) { report.already.push({ botId: b.id, botName: b.name }); continue; }
    // A text the safety check flags as "danger" comes back as a draft (store.ts → skillscan.ts): said in the report.
    const made = skills.create(b.id, (e.title[locale] ?? e.title.en), t.description || (e.summary[locale] ?? e.summary.en), t.body, false);
    if (made.draft) (report.flagged ??= []).push(b.name);
    if (e.files.length) skillFiles.save(made.id, e.files); // L130: its templates travel with it
    skillMeta.setMadeBy(made.id, "library"); skillMeta.setOrigin(made.id, "library", e.id, libraryVersion(e.id)!); // versioned copy (skillcatalog.ts)
    report.added.push({ botId: b.id, botName: b.name });
    emit(userId, { type: "memories", botId: b.id });
  }
  if (report.added.length) audit(userId, "account", `Skill added from the library: ${e.title.en} (${e.licence}) → ${report.added.map((x) => x.botName).join(", ")}`);
  return report;
}
