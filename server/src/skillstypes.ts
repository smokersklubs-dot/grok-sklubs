import type { SkillScan } from "./skillscantypes.js";

/**
 * « Bibliothèque de compétences » (skillslibrary.ts, skillsgithub.ts, docs/COMPETENCES.md): wire types shared with the
 * web app (type-only on the web side).
 */
export type LibraryOrigin = "sklubot" | "anthropic" | "opendesign" | "hermes" | "community";
/** The gallery's themes (catalog.json "category"). */
export type LibraryCategory = "method" | "writing" | "design" | "animation" | "seo" | "business" | "tools";
export const LIBRARY_CATEGORIES: readonly LibraryCategory[] = ["method", "writing", "design", "animation", "seo", "business", "tools"];
/** One skill of the bundled library, as the gallery shows it. */
export interface LibrarySkill {
  id: string; origin: LibraryOrigin; category: LibraryCategory; licence: string; source: string; title: string; summary: string;
  /** The text the bot will read (in the account's language when the skill has one). */
  body: string; language: "fr" | "en";
  /** The attribution line (NOTICE's first line). */
  notice: string;
  /** How many of the account's assistant bots already have it, out of how many. */
  addedTo: number; botCount: number;
  /** The safety check of its text (skillscan.ts). */
  scan: SkillScan;
}
/** `flagged`: the bots where the safety check kept it as a draft (a "danger" finding the owner has to accept). */
export interface LibraryAddReport { added: { botId: string; botName: string }[]; already: { botId: string; botName: string }[]; flagged?: string[] }

/** Licence found for a skill imported from GitHub. `permissive`: Apache-2.0, MIT, BSD, ISC, CC0, Unlicense, CC-BY. */
export type LicenceKind = "Apache-2.0" | "MIT" | "BSD" | "ISC" | "CC0-1.0" | "Unlicense" | "CC-BY" | "MPL-2.0" | "GPL" | "LGPL" | "AGPL" | "restrictive" | "none" | "unknown";
export interface GithubSkillFound {
  path: string; name: string; description: string; size: number;
  licence: LicenceKind; licenceFrom: "skill" | "repository" | "front matter" | "readme" | "none"; permissive: boolean;
  /** Something in its text looks like a key. */
  mentionsKey: boolean;
  /** Its text could not be read (missing from the archive or over 300 KB): cannot be imported. */
  tooLarge: boolean;
  /** L130: longer than 20 000 characters: imported as this many numbered parts (1 = in one piece). */
  parts?: number;
  /** L130: text files of its folder kept beside it (templates, styles, other pages), never run on the server. */
  companionFiles?: string[];
  /** Characters of its text (with its annexes), to say by how much it is too long. */
  chars: number;
  /** Small texts of its folder that its text cites, joined at the end as "Annex: …" sections. */
  annexes: string[];
  /** Files its text cites that are NOT imported (scripts, pictures, missing or too large): the bot cannot open them. */
  referencedFiles: string[];
  /** Other files of its folder (scripts, pictures, references) that are NOT imported. */
  ignoredFiles: number;
  /** A skill of the same name already exists on one of the account's bots. */
  exists: boolean;
  /** The safety check of its text (skillscan.ts): shown before the import. */
  scan: SkillScan;
}
export interface GithubPreview { previewId: string; repo: string; ref: string; path: string; skills: GithubSkillFound[]; truncated: boolean }
/** `flagged`: imported, with a "danger" finding of the safety check that the owner has to accept before activating. */
export interface GithubImportReport { imported: string[]; skipped: string[]; bots: number; flagged: string[] }
