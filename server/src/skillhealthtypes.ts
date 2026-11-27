/**
 * « Santé des compétences » (skillhealth.ts, docs/COMPETENCES.md): wire types shared with the web app (type-only there).
 */
export type SkillState = "active" | "stale" | "archived";
/** Who made a skill: the bot itself (skill_save, skill_propose), the owner, the bundled library, the team catalogue or an import. */
export type SkillMaker = "bot" | "owner" | "library" | "catalog" | "import" | "";
/** Where a shared skill applies: every bot (all empty), some sections, some bots; `exclude` wins. Bot and section ids. */
export interface SkillScope { sections: string[]; bots: string[]; exclude: string[] }

export interface SkillHealth {
  skillId: string; botId: string; botName: string; name: string;
  uses: number; failures: number; lastUsedAt: number | null; lastFailure: string;
  state: SkillState; archivedBy: "curator" | "owner" | null;
  pinned: boolean; locked: boolean; madeBy: SkillMaker;
  onlyOnRequest: boolean; alwaysFull: boolean; scope: SkillScope;
  /** Characters of the text the bot reads; long ones are read by their index then one section (L132). */
  chars: number; sections: number;
  /** Older versions kept (the newest first is the one just before the current text). */
  versions: number;
  /** A newer text exists where it came from (bundled library or team catalogue): the "Update" chip. */
  update: { kind: "library" | "catalog"; title: string } | null;
  /** Other skills of the account that say almost the same thing (names). */
  similar: { skillId: string; name: string; botName: string; score: number }[];
  /** Given in full in the bot's prompt (few short skills): reads cannot be counted, so the curator never retires it. */
  inline: boolean;
}

export type CuratorKind = "never_used" | "stale" | "failing" | "duplicate" | "archived";
/** One suggestion of the curator card: what it saw and the one action it proposes (the owner decides). */
export interface CuratorSuggestion { kind: CuratorKind; skillId: string; name: string; botName: string; detail: string; otherId?: string; otherName?: string }

export interface SkillHealthReport {
  skills: SkillHealth[]; suggestions: CuratorSuggestion[];
  /** What the automatic pass (Hermes curator port) changed this time. */
  pass: { checked: number; markedStale: number; archived: number; reactivated: number };
  staleAfterDays: number; archiveAfterDays: number;
}

export interface SkillVersion { id: string; name: string; description: string; body: string; savedAt: number; reason: string }

/** L135 — the account's own catalogue of vetted skills, versioned, added to any of its bots. */
export interface CatalogSkill { id: string; name: string; description: string; body: string; version: number; fromBot: string; updatedAt: number; addedTo: number; botCount: number }

export interface BenchAnswer { text: string; chars: number }
/** L134 — the same request answered with and without a skill, side by side. */
export interface BenchResult { prompt: string; skillName: string; withSkill: BenchAnswer; without: BenchAnswer }
