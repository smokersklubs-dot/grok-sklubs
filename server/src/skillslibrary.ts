import { existsSync, readFileSync } from "node:fs";
import { emit } from "./bus.js";
import type { Locale } from "./shared.js";
import { scanSkill } from "./skillscan.js";
import type { LibraryAddReport, LibraryOrigin, LibrarySkill } from "./skillstypes.js";
import { audit, bots, skills, type BotRecord } from "./store.js";

/**
 * « Bibliothèque de compétences » (docs/COMPETENCES.md): skills bundled with Sklubot, in server/skills-library/.
 *
 * Each skill is a folder with SKILL.md (English), optionally SKILL.fr.md (French), LICENSE.txt and NOTICE, listed in
 * catalog.json. Origins: Sklubot's own skills (MIT, the project's licence), skills adapted from the public repositories
 * github.com/anthropics/skills ("anthropic") and github.com/nexu-io/open-design ("opendesign"), Apache-2.0 only (their
 * LICENSE.txt is kept unchanged and their NOTICE and the first line of their text say what was changed, as Apache-2.0 §4
 * asks), and the Hermes Bot Kit ("hermes", MIT). A folder without its licence or notice is not offered. The texts are
 * read once at startup.
 *
 * Adding one to a bot creates an ordinary skill (active: the owner read the card and chose it), named after the skill's
 * title in the account's language. Adding it again changes nothing (a bot that already has a skill of that name, in
 * either language, is skipped).
 */

interface Entry {
  id: string; origin: LibraryOrigin; licence: string; source: string;
  title: Record<Locale, string>; summary: Record<Locale, string>;
  text: Partial<Record<Locale, { description: string; body: string }>>; notice: string;
}

const DIR = new URL("../skills-library/", import.meta.url);
const ID = /^[a-z0-9][a-z0-9-]{1,60}$/;
const ORIGINS = new Set<unknown>(["sklubot", "anthropic", "opendesign", "hermes"] satisfies LibraryOrigin[]);

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
    for (const [loc, name] of [["en", "SKILL.md"], ["fr", "SKILL.fr.md"]] as const) {
      if (!existsSync(file(name))) continue;
      const s = splitSkill(readFileSync(file(name), "utf8"));
      if (s.body) text[loc] = { description: s.description.slice(0, 300), body: s.body.slice(0, 20_000) };
    }
    if (!text.en) continue;
    const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    out.push({
      id: e.id, origin: e.origin, licence: str(e.licence, 40), source: str(e.source, 300),
      title: { fr: str(e.title?.fr, 80) || e.id, en: str(e.title?.en, 80) || e.id },
      summary: { fr: str(e.summary?.fr, 300), en: str(e.summary?.en, 300) },
      text, notice: readFileSync(file("NOTICE"), "utf8").split("\n")[0].trim(),
    });
  }
  return out;
}

let cache: Entry[] | null = null;
export const libraryEntries = (): Entry[] => (cache ??= load());

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
      id: e.id, origin: e.origin, licence: e.licence, source: e.source, title: e.title[locale], summary: e.summary[locale],
      body: t.body, language: t.language, notice: e.notice, scan: scanSkill({ name: e.title[locale], description: t.description || e.summary[locale], body: t.body }), addedTo: agents.filter((b) => hasIt(b.id, e)).length, botCount: agents.length,
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
    if (skills.create(b.id, e.title[locale], t.description || e.summary[locale], t.body, false).draft) (report.flagged ??= []).push(b.name);
    report.added.push({ botId: b.id, botName: b.name });
    emit(userId, { type: "memories", botId: b.id });
  }
  if (report.added.length) audit(userId, "account", `Skill added from the library: ${e.title.en} (${e.licence}) → ${report.added.map((x) => x.botName).join(", ")}`);
  return report;
}
