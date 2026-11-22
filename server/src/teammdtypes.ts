import type { GrokImportStripped, RoomRule, TeamFileLook } from "./shared.js";

/**
 * « Équipe Sklubot (.md) » (teammd.ts, teammdimport.ts, docs/FORMAT-EQUIPE.md): a whole team in one Markdown file whose
 * YAML header describes the bots, their skills, routines, groups and the apps to connect, followed by a playbook anyone
 * can read. Wire types, shared with the web app (web/src/types.ts).
 */

export const TEAM_MD_FORMAT = "sklubot-team/1";
/** 512 KB: a file, a pasted text or an address's answer, at most. */
export const TEAM_MD_MAX_BYTES = 512 * 1024;
export const TEAM_MD_RULES = ["lead", "everyone", "mentions", "auto"] as const satisfies readonly RoomRule[];

export interface TeamMdMeta {
  /** The team's stable id (re-importing the same id offers « Mettre à jour »). */
  id: string; name: string; description: string; version: string; language: string; author: string;
  /** The bot that leads (the main bot), by name; "" when none. */
  chief: string;
}
export interface TeamMdSkill {
  /** "library": a skill of the Bibliothèque, by id (added active); "inline": a SKILL.md carried by the file (a draft). */
  kind: "library" | "inline";
  libraryId: string; name: string; when: string; body: string;
  /** "library" only: false when this Sklubot has no skill with that id (it cannot be added). */
  known: boolean;
  /** The text looks like it holds a key (projectimport.ts mentionsKey): read it before keeping it. */
  mentionsKey: boolean;
}
export interface TeamMdRoutine { name: string; cron: string; timezone: string; task: string; describe: string }
export interface TeamMdBot {
  name: string; role: string; personality: string; instructions: string; look: TeamFileLook;
  /** A suggested brain ("provider:model"), never a key; "" when none. `modelAvailable`: this account can use it. */
  model: string; modelAvailable: boolean;
  skills: TeamMdSkill[]; routines: TeamMdRoutine[];
  /** Routines without a valid five-field cron: listed, never created. */
  unscheduled: string[];
  /** Another bot of the account has this name: `suggestedName` is a free one. */
  nameTaken: boolean; suggestedName: string;
  /** Re-import: the bot this one would update (« Mettre à jour »). */
  existingId: string | null;
  chief: boolean;
}
export interface TeamMdGroup {
  name: string; members: string[]; rule: RoomRule; lead: string;
  /** Members that are not bots of the file (left out). */
  missing: string[];
  existingId: string | null;
}
export interface TeamMdConnector {
  /** A name only (never an address, a key or a sign-in). `inCatalog`: the app is in Sklubot's catalog. */
  name: string; inCatalog: boolean; for: string[]; why: string;
}
export interface TeamMdRemoved { where: string; field: string; reason: "forbidden" | "unknown" | "secret" }
export type TeamMdWarningCode =
  | "newer_version" | "too_many_bots" | "too_many_items" | "bots_limit" | "routines_limit" | "team_full"
  | "unknown_library" | "key_like" | "group_missing" | "chief_missing" | "routine_no_cron";
export interface TeamMdWarning { code: TeamMdWarningCode; n?: number; detail?: string }
export interface TeamMdSource { kind: "file" | "text" | "url"; label: string; url?: string }
export interface TeamMdPreview {
  previewId: string; source: TeamMdSource; meta: TeamMdMeta;
  bots: TeamMdBot[]; groups: TeamMdGroup[]; connectors: TeamMdConnector[];
  /** The file's readable part (its playbook), secrets masked, cut at 6 000 characters. */
  playbook: string;
  masked: GrokImportStripped[]; removed: TeamMdRemoved[]; warnings: TeamMdWarning[];
  /** Room left on the plan (null: no limit). */
  room: { bots: number | null; activeRoutines: number | null };
  /** This team was imported before (same id): « Mettre à jour » or « Créer une copie ». */
  existing: { name: string; bots: number; updatedAt: number } | null;
  /** The account already has a main bot (the chief is not made main by default). */
  hasPrimary: boolean;
}
export interface TeamMdChoice {
  index: number; include: boolean; name?: string;
  /** Per skill / routine of the file, in order: kept or not (all kept when missing). */
  skills?: boolean[]; routines?: boolean[];
  /** Use the file's suggested brain (only when this account can use it). */
  useModel?: boolean;
}
export type TeamMdMode = "create" | "update" | "copy";
export interface TeamMdCommitInput {
  previewId: string; mode: TeamMdMode; bots: TeamMdChoice[];
  /** Per group of the file, in order: created or not (all when missing). */
  groups?: boolean[];
  /** File the bots under a section of that name ("" or missing: none). */
  section?: string;
  /** Make the file's chief the account's main bot. */
  chiefPrimary?: boolean;
}
export interface TeamMdReport {
  mode: TeamMdMode;
  created: { id: string; name: string }[]; updated: { id: string; name: string }[];
  skills: number; routines: number; groups: { id: string; name: string }[];
  section: { id: string; name: string } | null; connectors: string[]; unscheduled: string[];
}
export interface TeamMdExport { filename: string; text: string; bots: number; groups: number; connectors: number; masked: number }
