import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { baseline } from "./001-baseline.js";
import { usageAndPrices } from "./002-usage-prices.js";
import { accountMail } from "./003-account-mail.js";
import { hosted } from "./004-hosted.js";
import { autoBackup } from "./005-auto-backup.js";
import { botPauses } from "./006-bot-pauses.js";
import { botVoices } from "./007-bot-voices.js";
import { usageCaps } from "./008-usage-caps.js";
import { skillDrafts } from "./009-skill-drafts.js";
import { today } from "./010-today.js";
import { botApiKeys } from "./011-bot-api-keys.js";
import { sentinel } from "./012-sentinel.js";
import { publicSignup } from "./013-public-signup.js";
import { emailGate } from "./014-email-gate.js";
import { subscriptionLimits } from "./015-subscription-limits.js";
import { announcements } from "./016-announcements.js";
import { pageVersions } from "./017-page-versions.js";
import { twoFactor } from "./018-two-factor.js";
import { freePlanOwnKeys } from "./019-free-plan-own-keys.js";
import { serverMailFromRelay } from "./020-server-mail-from-relay.js";
import { prepaidCredits } from "./021-prepaid-credits.js";
import { botFailures } from "./022-bot-failures.js";
import { githubIssueJobs } from "./025-github-issue-jobs.js";
import { studioAndGithub } from "./024-studio-and-github.js";
import { research } from "./026-research.js";
import { teamMcp } from "./027-team-mcp.js";
import { sectionInstructions } from "./028-section-instructions.js";
import { uploadSessions } from "./023-upload-sessions.js";

/**
 * Versioned migrations (SK-P0-05). The database's version is SQLite's own `PRAGMA user_version` (0 on a database made
 * before this existed, or on a new file). Each step runs once, in its own transaction, and stamps its number in that same
 * transaction: a failing step leaves the database exactly as it was, at the previous version.
 *
 * Rules for a new step: append it here with the next number; never edit or reorder a step that shipped; keep it additive
 * where possible (the production database already holds data); a step that rewrites data must be safe to read by
 * the previous version of the code too, or say so in its comment.
 */
export interface Migration { version: number; name: string; up(db: DatabaseSync): void }

export const MIGRATIONS: Migration[] = [
  { version: 1, name: "baseline", up: baseline },
  { version: 2, name: "usage-prices", up: usageAndPrices },
  { version: 3, name: "account-mail", up: accountMail },
  { version: 4, name: "hosted", up: hosted },
  { version: 5, name: "auto-backup", up: autoBackup },
  { version: 6, name: "bot-pauses", up: botPauses },
  { version: 7, name: "bot-voices", up: botVoices },
  { version: 8, name: "usage-caps", up: usageCaps },
  { version: 9, name: "skill-drafts", up: skillDrafts },
  { version: 10, name: "today", up: today },
  { version: 11, name: "bot-api-keys", up: botApiKeys },
  { version: 12, name: "sentinel", up: sentinel },
  { version: 13, name: "public-signup", up: publicSignup },
  { version: 14, name: "email-gate", up: emailGate },
  { version: 15, name: "subscription-limits", up: subscriptionLimits },
  { version: 16, name: "announcements", up: announcements },
  { version: 17, name: "page-versions", up: pageVersions },
  { version: 18, name: "two-factor", up: twoFactor },
  { version: 19, name: "free-plan-own-keys", up: freePlanOwnKeys },
  { version: 20, name: "server-mail-from-relay", up: serverMailFromRelay },
  { version: 21, name: "prepaid-credits", up: prepaidCredits },
  { version: 22, name: "bot-failures", up: botFailures },
  { version: 23, name: "upload-sessions", up: uploadSessions },
  { version: 24, name: "studio-and-github", up: studioAndGithub },
  { version: 25, name: "github-issue-jobs", up: githubIssueJobs },
  { version: 26, name: "research", up: research },
  { version: 27, name: "team-mcp", up: teamMcp },
  { version: 28, name: "section-instructions", up: sectionInstructions },
];
export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export class NewerDatabaseError extends Error {
  constructor(public found: number, public supported: number) {
    super(`The database is at version ${found}, newer than this Sklubot understands (${supported}). It was opened by a more recent version: update Sklubot again, or restore the backup taken before that update (deploy/restore.sh). Nothing was changed.`);
  }
}

export interface MigrateResult { from: number; to: number; applied: string[]; backup: string | null }

const version = (db: DatabaseSync) => Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
const hasTables = (db: DatabaseSync) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get();

/** Pre-migration copies kept next to the database (the newest ones); older copies are removed. */
const KEEP_COPIES = 3;

/**
 * A consistent copy of the database before it is changed: `VACUUM INTO` writes a complete, standalone database file from
 * the live one (WAL included) — https://www.sqlite.org/lang_vacuum.html#vacuuminto . Only for a database that already
 * has tables; a new, empty file has nothing to lose.
 */
function copyBefore(db: DatabaseSync, dbPath: string, from: number, to: number): string | null {
  if (!dbPath || dbPath === ":memory:" || !hasTables(db)) return null;
  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  const out = path.join(dir, `${base}.pre-v${from}-to-v${to}-${stamp}.bak`);
  if (existsSync(out)) rmSync(out);
  try {
    db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  } catch {
    // VACUUM INTO needs SQLite 3.27; a plain file copy is the fallback (the server is starting: nothing else writes yet).
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    copyFileSync(dbPath, out);
  }
  const prefix = `${base}.pre-v`;
  const old = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".bak"))
    .map((f) => ({ f, t: statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t || b.f.localeCompare(a.f));
  for (const { f } of old.slice(KEEP_COPIES)) rmSync(path.join(dir, f), { force: true });
  return out;
}

/** Brings the database up to the latest version. Throws NewerDatabaseError (and changes nothing) for a newer database. */
export function migrate(db: DatabaseSync, dbPath: string, steps: Migration[] = MIGRATIONS, log: (line: string) => void = () => {}): MigrateResult {
  const latest = steps[steps.length - 1].version;
  const from = version(db);
  if (from > latest) throw new NewerDatabaseError(from, latest);
  const pending = steps.filter((s) => s.version > from);
  if (!pending.length) return { from, to: from, applied: [], backup: null };
  const existing = hasTables(db);
  const backup = copyBefore(db, dbPath, from, latest);
  if (backup) log(`Database copied before migration to ${backup}`);
  for (const step of pending) {
    db.exec("BEGIN IMMEDIATE");
    try {
      step.up(db);
      db.exec(`PRAGMA user_version = ${step.version}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`Database migration ${step.version} (${step.name}) failed and was rolled back; the database stays at version ${version(db)}. ${(err as Error).message}`);
    }
    if (existing) log(`Database migration ${step.version} (${step.name}) applied.`);
  }
  return { from, to: latest, applied: pending.map((s) => `${s.version}-${s.name}`), backup };
}
