/**
 * « Contrôle de sécurité des compétences » (skillscan.ts, skillscanroutes.ts, docs/COMPETENCES.md): wire types shared
 * with the web app (type-only on the web side).
 */
export type ScanSeverity = "danger" | "warning" | "info";

/** Stable codes: one per kind of thing the check looks for. The web app has a sentence for each (scan.code.*). */
export const SCAN_CODES = [
  "override-rules", "skip-approval", "hide-from-owner", "cover-tracks", "exfiltration", "send-data", "embedded-secret",
  "pipe-to-shell", "decode-and-run", "encoded-blob", "destructive-command", "disable-security", "payment-unasked",
  "payment-details", "bidi-text", "invisible-text", "html-comment", "short-link", "ip-link", "self-modify", "offensive-tool",
] as const;
export type ScanCode = (typeof SCAN_CODES)[number];

export interface ScanFinding {
  code: ScanCode; severity: ScanSeverity;
  /** Line of the skill's text, from 1. 0: in its name, its "when" line or another short field. */
  line: number;
  /** A short quote of that line (secrets masked, invisible characters written as U+XXXX). */
  excerpt: string;
  /** The same line says NOT to do it ("never run…"): kept as information only. */
  negated: boolean;
}

/** `worst`: the highest severity found ("ok": nothing at all). `truncated`: more findings than the list keeps. */
export interface SkillScan { worst: ScanSeverity | "ok"; findings: ScanFinding[]; truncated: boolean }

/** One skill of the account in « Vérifier mes compétences ». `accepted`: the owner accepted this exact text. */
export interface SkillScanEntry {
  skillId: string; botId: string; botName: string; name: string; draft: boolean; accepted: boolean; scan: SkillScan;
}
/** `entries`: only the skills with something found, the most serious first. */
export interface SkillScanReport { scannedAt: number; skills: number; clean: number; entries: SkillScanEntry[] }
