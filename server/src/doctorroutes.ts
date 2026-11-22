import { lstatSync, statfsSync } from "node:fs";
import path from "node:path";
import type { Hono } from "hono";
import { config, ROOT } from "./config.js";
import { q } from "./db.js";
import { keyring } from "./datakey.js";
import { healthList } from "./health.js";
import { isOperator } from "./hosted.js";
import { pauses } from "./pauses.js";
import { twoFactorOn } from "./twofactor.js";
import { backupView } from "./autobackup.js";
import { bots, type UserRecord } from "./store.js";
import { doctorFindings, doctorSummary, type DoctorFacts, type PathPerms } from "./doctor.js";

/**
 * L153 « Docteur », registered after the session check (routes.ts):
 *   GET /doctor   { findings, summary, install: boolean, node } — read-only. The installation lines (secret, https,
 *   permissions, disk, backups) are only for the instance owner or an operator; everyone gets their own account's lines.
 * Nothing is written, fixed or sent anywhere.
 */
function perms(p: string): PathPerms {
  try { const s = lstatSync(p); return { exists: true, isSymlink: s.isSymbolicLink(), mode: s.mode & 0o777 }; } catch { return { exists: false, isSymlink: false, mode: 0 }; }
}
function freeBytes(dir: string): number | null {
  try { const s = statfsSync(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

export function doctorFacts(user: UserRecord, now = Date.now()): DoctorFacts {
  const owner = isOperator(user.id);
  const health = healthList(user.id);
  const backup = owner ? backupView() : null;
  return {
    now,
    install: owner && backup ? {
      nodeVersion: process.version,
      sessionSecretLength: config.sessionSecret.length,
      publicUrl: config.publicUrl,
      trustProxy: config.trustProxy,
      openSignup: config.openSignup,
      allowedEmails: config.allowedEmails.length,
      setupCode: !!config.setupCode,
      users: q.get<{ n: number }>("SELECT COUNT(*) AS n FROM users")?.n ?? 0,
      dataKey: keyring().current.source,
      hostShell: config.hostShell,
      freeBytes: freeBytes(config.dataDir),
      dataDir: perms(config.dataDir),
      database: perms(config.dbPath),
      envFile: perms(path.join(ROOT, ".env")),
      backup: { configured: backup.configured, enabled: backup.enabled, lastOkAt: backup.lastOk?.startedAt ?? null, failures: backup.failures },
    } : null,
    account: {
      twoFactor: twoFactorOn(user.id),
      models: null,
      vaultProblems: health.filter((h) => h.state === "broken" || h.state === "reconnect").length,
      bots: bots.list(user.id).filter((b) => b.kind === "agent").length,
      pausedAll: !!pauses.state(user.id).all,
    },
  };
}

export function registerDoctorRoutes(api: Hono<any>) {
  api.get("/doctor", (c) => {
    const user = c.get("user") as UserRecord;
    const facts = doctorFacts(user);
    const findings = doctorFindings(facts);
    return c.json({ findings, summary: doctorSummary(findings), install: !!facts.install, node: facts.install ? process.version : null });
  });
}
