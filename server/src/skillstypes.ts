/**
 * « Bibliothèque de compétences » (skillslibrary.ts, skillsgithub.ts, docs/COMPETENCES.md): wire types shared with the
 * web app (type-only on the web side).
 */
export type LibraryOrigin = "sklubot" | "anthropic";
/** One skill of the bundled library, as the gallery shows it. */
export interface LibrarySkill {
  id: string; origin: LibraryOrigin; licence: string; source: string; title: string; summary: string;
  /** The text the bot will read (in the account's language when the skill has one). */
  body: string; language: "fr" | "en";
  /** The attribution line (NOTICE's first line). */
  notice: string;
  /** How many of the account's assistant bots already have it, out of how many. */
  addedTo: number; botCount: number;
}
export interface LibraryAddReport { added: { botId: string; botName: string }[]; already: { botId: string; botName: string }[] }

/** Licence found for a skill imported from GitHub. `permissive`: Apache-2.0, MIT, BSD, ISC, CC0, Unlicense, CC-BY. */
export type LicenceKind = "Apache-2.0" | "MIT" | "BSD" | "ISC" | "CC0-1.0" | "Unlicense" | "CC-BY" | "MPL-2.0" | "GPL" | "LGPL" | "AGPL" | "restrictive" | "none" | "unknown";
export interface GithubSkillFound {
  path: string; name: string; description: string; size: number;
  licence: LicenceKind; licenceFrom: "skill" | "repository" | "front matter" | "readme" | "none"; permissive: boolean;
  /** Something in its text looks like a key. */
  mentionsKey: boolean;
  /** Longer than 20 000 characters: cannot be imported as is. */
  tooLarge: boolean;
  /** Other files of its folder (scripts, pictures, references) that are NOT imported. */
  ignoredFiles: number;
  /** A skill of the same name already exists on one of the account's bots. */
  exists: boolean;
}
export interface GithubPreview { previewId: string; repo: string; ref: string; path: string; skills: GithubSkillFound[]; truncated: boolean }
export interface GithubImportReport { imported: string[]; skipped: string[]; bots: number }
