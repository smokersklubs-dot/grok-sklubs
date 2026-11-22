/*
 * Portions adapted from openclaw/openclaw (https://github.com/openclaw/openclaw, commit 3c8c7bf781fbf3e2c614a446eee0ad3a87b400fd),
 * Copyright (c) 2026 OpenClaw Foundation, MIT License; modified for Sklubot: the finding shape and severity scale of
 * src/security/audit.types.ts (SecurityAuditFinding: checkId, severity info/warn/critical, title, detail, remediation)
 * and the filesystem permission classification of src/security/audit.ts collectFilesystemFindings (state dir:
 * world-writable → critical, group-writable → warn, readable by others → warn; config file: writable by others or
 * world-readable → critical, group-readable → warn; a symlink is an extra trust boundary) kept, applied to Sklubot's data
 * folder, database file and .env, with mode bits read by our caller (no icacls on Windows); the titles are French/English
 * keys of Sklubot's dictionaries; OpenClaw's gateway, channel and plugin checks are left out (Sklubot has none of those).
 *
 * L153 « Docteur »: a read-only check of this installation and of the caller's account, each line « OK » or « À corriger »
 * with what to do, plus a summary to paste in a help request that carries no path, address, e-mail or secret. Nothing is
 * changed by running it. Pure: doctorroutes.ts gathers the facts.
 */
import { findSecrets } from "./shared.js";

export type DoctorSeverity = "ok" | "info" | "warn" | "critical";
export interface DoctorFinding { checkId: string; severity: DoctorSeverity; title: string; detail: string; remediation?: string; scope: "install" | "account" }

/** What a path's mode says (POSIX bits). `exists: false`: the path is not there (no finding). */
export interface PathPerms { exists: boolean; isSymlink: boolean; mode: number }
const perms = (p: PathPerms) => ({ worldWritable: (p.mode & 0o002) !== 0, groupWritable: (p.mode & 0o020) !== 0, worldReadable: (p.mode & 0o004) !== 0, groupReadable: (p.mode & 0o040) !== 0 });

export interface DoctorFacts {
  /** Installation facts: only gathered for the instance owner or an operator (null otherwise). */
  install: null | {
    nodeVersion: string;
    sessionSecretLength: number;
    publicUrl: string;
    trustProxy: boolean;
    openSignup: boolean;
    allowedEmails: number;
    setupCode: boolean;
    users: number;
    dataKey: "DATA_KEYS" | "DATA_KEY" | "SESSION_SECRET";
    hostShell: boolean;
    freeBytes: number | null;
    dataDir: PathPerms;
    database: PathPerms;
    envFile: PathPerms;
    backup: { configured: boolean; enabled: boolean; lastOkAt: number | null; failures: number };
  };
  /** `models`: how many models the account can use (null: not counted here — the web app adds that line from GET /models). */
  account: { twoFactor: boolean; models: number | null; vaultProblems: number; bots: number; pausedAll: boolean };
  now: number;
}

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const DAY = 86_400_000;

/** The permission findings (adapted from OpenClaw collectFilesystemFindings). */
export function permissionFindings(dataDir: PathPerms, database: PathPerms, envFile: PathPerms): DoctorFinding[] {
  const out: DoctorFinding[] = [];
  const add = (f: Omit<DoctorFinding, "scope">) => out.push({ ...f, scope: "install" });
  if (dataDir.exists) {
    const p = perms(dataDir);
    if (dataDir.isSymlink) add({ checkId: "fs.data_dir.symlink", severity: "warn", title: "doctor.fs.dataSymlink", detail: "doctor.fs.dataSymlink.detail" });
    if (p.worldWritable) add({ checkId: "fs.data_dir.perms_world_writable", severity: "critical", title: "doctor.fs.dataWorldWritable", detail: "doctor.fs.dataWorldWritable.detail", remediation: "chmod 700 <data>" });
    else if (p.groupWritable) add({ checkId: "fs.data_dir.perms_group_writable", severity: "warn", title: "doctor.fs.dataGroupWritable", detail: "doctor.fs.dataGroupWritable.detail", remediation: "chmod 700 <data>" });
    else if (p.groupReadable || p.worldReadable) add({ checkId: "fs.data_dir.perms_readable", severity: "warn", title: "doctor.fs.dataReadable", detail: "doctor.fs.dataReadable.detail", remediation: "chmod 700 <data>" });
  }
  for (const [file, id, name] of [[database, "database", "sklubot.db"], [envFile, "env", ".env"]] as const) {
    if (!file.exists) continue;
    const p = perms(file);
    if (file.isSymlink) add({ checkId: `fs.${id}.symlink`, severity: "warn", title: `doctor.fs.${id}Symlink`, detail: "doctor.fs.symlink.detail" });
    if (p.worldWritable || p.groupWritable) add({ checkId: `fs.${id}.perms_writable`, severity: "critical", title: `doctor.fs.${id}Writable`, detail: "doctor.fs.fileWritable.detail", remediation: `chmod 600 ${name}` });
    else if (!file.isSymlink && p.worldReadable) add({ checkId: `fs.${id}.perms_world_readable`, severity: "critical", title: `doctor.fs.${id}WorldReadable`, detail: "doctor.fs.fileReadable.detail", remediation: `chmod 600 ${name}` });
    else if (!file.isSymlink && p.groupReadable) add({ checkId: `fs.${id}.perms_group_readable`, severity: "warn", title: `doctor.fs.${id}GroupReadable`, detail: "doctor.fs.fileReadable.detail", remediation: `chmod 600 ${name}` });
  }
  return out;
}

/** Every line of the report: problems first (critical, warn, info), then what is fine. */
export function doctorFindings(f: DoctorFacts): DoctorFinding[] {
  const out: DoctorFinding[] = [];
  const line = (scope: DoctorFinding["scope"], checkId: string, bad: DoctorSeverity | false, title: string, detail = "", remediation?: string) =>
    out.push({ scope, checkId, severity: bad || "ok", title: bad ? title : `${title}.ok`, detail: bad ? detail : "", ...(bad && remediation ? { remediation } : {}) });
  const i = f.install;
  if (i) {
    const [major, minor] = i.nodeVersion.replace(/^v/, "").split(".").map(Number);
    line("install", "runtime.node", major < 22 || (major === 22 && minor < 13) ? "warn" : false, "doctor.node", "doctor.node.detail");
    line("install", "auth.session_secret", i.sessionSecretLength < 32 ? "critical" : false, "doctor.secret", "doctor.secret.detail", "openssl rand -hex 32");
    const remote = !LOCAL.test(i.publicUrl);
    line("install", "net.https", remote && !/^https:\/\//i.test(i.publicUrl) ? "critical" : false, "doctor.https", "doctor.https.detail");
    line("install", "auth.setup_code", i.users === 0 && remote && !i.setupCode ? "critical" : false, "doctor.setup", "doctor.setup.detail");
    line("install", "auth.open_signup", i.openSignup && remote && i.allowedEmails === 0 ? "warn" : false, "doctor.signup", "doctor.signup.detail");
    line("install", "data.encryption_key", i.dataKey === "SESSION_SECRET" ? "info" : false, "doctor.dataKey", "doctor.dataKey.detail");
    line("install", "exec.host_shell", i.hostShell ? "warn" : false, "doctor.hostShell", "doctor.hostShell.detail");
    line("install", "disk.free", i.freeBytes !== null && i.freeBytes < 2 * 1024 ** 3 ? (i.freeBytes < 512 * 1024 ** 2 ? "critical" : "warn") : false, "doctor.disk", "doctor.disk.detail");
    const b = i.backup;
    const stale = !b.configured || !b.enabled ? "warn" : b.failures > 0 || !b.lastOkAt || f.now - b.lastOkAt > 3 * DAY ? "warn" : false;
    line("install", "backup.recent", stale, !b.configured || !b.enabled ? "doctor.backupOff" : "doctor.backupStale", !b.configured || !b.enabled ? "doctor.backupOff.detail" : "doctor.backupStale.detail");
    const fs = permissionFindings(i.dataDir, i.database, i.envFile);
    out.push(...fs);
    if (!fs.length) line("install", "fs.permissions", false, "doctor.fs");
  }
  const a = f.account;
  line("account", "account.two_factor", a.twoFactor ? false : "warn", "doctor.twoFactor", "doctor.twoFactor.detail");
  if (a.models !== null) line("account", "models.available", a.models === 0 ? "critical" : false, "doctor.models", "doctor.models.detail");
  line("account", "vault.health", a.vaultProblems > 0 ? "warn" : false, "doctor.vault", "doctor.vault.detail");
  line("account", "bots.paused_all", a.pausedAll ? "info" : false, "doctor.pausedAll", "doctor.pausedAll.detail");
  const rank: Record<DoctorSeverity, number> = { critical: 0, warn: 1, info: 2, ok: 3 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity]);
}

/** The counts shown at the top (OpenClaw's summary, plus the lines that are fine). */
export function doctorSummary(findings: DoctorFinding[]): Record<DoctorSeverity, number> {
  const s: Record<DoctorSeverity, number> = { critical: 0, warn: 0, info: 0, ok: 0 };
  for (const f of findings) s[f.severity]++;
  return s;
}

/**
 * The text to paste in a help request: no path, no address, no e-mail, no secret — only check ids, their state and the
 * versions. Anything that slips into it anyway is cut out a second time here (paths, URLs, e-mails, secrets).
 */
export function pasteText(findings: DoctorFinding[], o: { app: string; node?: string; words: (key: string) => string }): string {
  const s = doctorSummary(findings);
  const lines = [`${o.app} — ${o.words("doctor.paste.head")}`, `critical=${s.critical} warn=${s.warn} info=${s.info} ok=${s.ok}${o.node ? ` node=${o.node}` : ""}`];
  for (const f of findings) lines.push(`- [${f.severity === "ok" ? "OK" : f.severity.toUpperCase()}] ${f.checkId}: ${o.words(f.title)}`);
  return scrub(lines.join("\n"));
}

/** Removes paths, web addresses, e-mail addresses and secrets from a text. */
export function scrub(text: string): string {
  let out = text.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<e-mail>").replace(/\bhttps?:\/\/\S+/gi, "<url>").replace(/(^|[\s"'(=])(~|[A-Za-z]:)?([\\/][\w.@-]+){2,}[\\/]?/g, "$1<chemin>");
  const found = findSecrets(out).sort((a, b) => b.start - a.start);
  for (const f of found) out = out.slice(0, f.start) + "<secret>" + out.slice(f.end);
  return out;
}
