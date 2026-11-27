/**
 * Data key rotation: every sealed value of the database is opened with whatever key of the keyring sealed it and sealed
 * again under the newest key (datakey.ts), in one transaction — all or nothing. Afterwards the older keys (and
 * SESSION_SECRET, for the derived key "s0") are no longer needed to read anything.
 *
 *   node server/dist/rotatekey.js --dry-run     counts only, changes nothing
 *   node server/dist/rotatekey.js               rotates
 *   npm run rotate-data-key -w server -- --dry-run
 * Or, signed in as the server's owner: GET /api/admin/data-key, POST /api/admin/data-key/rotate { dryRun }.
 *
 * Where sealed values live (every column whose name ends in _enc is found by itself, so a new one is never forgotten;
 * the JSON fields are listed in JSON_FIELDS):
 */
import type { DatabaseSync } from "node:sqlite";
import type { Context, Hono } from "hono";
import { db } from "./db.js";
import { isCurrent, keyIdOf, keyring, openValue, sealWith, type Keyring } from "./datakey.js";
import { ownerAccountId } from "./hosted.js";
import type { UserRecord } from "./store.js";

/** The sealed columns known when this was written (documentation and report; the scan below finds every *_enc). */
export const KNOWN_SEALED: Record<string, string> = {
  "bots.telegram_token_enc": "Telegram bot token",
  "bot_channels.secret_enc": "bot channel secrets: Slack bot and app tokens, Discord bot token, IMAP mailbox password (L162)",
  "connectors.token_enc": "connector (MCP) access token",
  "connectors.oauth_enc": "connector OAuth tokens and client",
  "oauth_pending.verifier_enc": "PKCE verifier of a connector sign-in in progress (10 min)",
  "native_clients.secret_enc": "built-in app OAuth client secret",
  "native_clients.app_token_enc": "Slack app-level token",
  "native_accounts.tokens_enc": "built-in app account tokens (Gmail, Calendar, Slack…)",
  "native_pending.verifier_enc": "PKCE verifier of a built-in app sign-in in progress (10 min)",
  "vault.password_enc": "vault: passwords, API secrets, two-factor seeds, payment cards",
  "server_keys.private_enc": "Web Push (VAPID) private key",
  "push_subscriptions.auth_enc": "Web Push subscription secret",
  "mail_relays.pass_enc": "bots' outgoing SMTP password",
  "mail_relays.dkim_key_enc": "DKIM private key",
  "instance_smtp.pass_enc": "server e-mail (SMTP) password",
  "user_providers.key_enc": "model provider API key",
  "instance_backup.access_key_enc": "backup bucket access key",
  "instance_backup.secret_key_enc": "backup bucket secret key",
  "google_login.secret_enc": "\"Continuer avec Google\" client secret",
  "two_factor.secret_enc": "two-factor sign-in seed",
  "two_factor.pending_enc": "two-factor seed being set up (30 min)",
  "routine_hooks.secret_enc": "webhook signing secret (L20)",
  "routine_hooks.prev_secret_enc": "previous webhook signing secret, valid 24 h after a change",
};
/** Sealed values inside JSON columns: table, column, keys of the object that hold sealed strings. */
export const JSON_FIELDS: { table: string; column: string; keys: string[]; label: string }[] = [
  { table: "settings", column: "voice", keys: ["sttKeyEnc", "ttsKeyEnc", "fishKeyEnc"], label: "voice provider API keys (speech-to-text, text-to-speech, Fish Audio)" },
];

export interface LocationReport { where: string; label: string; total: number; current: number; resealed: number; unreadable: number; byKey: Record<string, number> }
export interface RotationReport { dryRun: boolean; newKey: string; keys: string[]; total: number; current: number; resealed: number; unreadable: number; locations: LocationReport[]; problems: string[] }

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

function sealedColumns(db: DatabaseSync): { table: string; column: string }[] {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
  const out: { table: string; column: string }[] = [];
  for (const t of tables) for (const c of db.prepare(`PRAGMA table_info(${quote(t)})`).all() as { name: string }[]) if (c.name.endsWith("_enc")) out.push({ table: t, column: c.name });
  return out;
}

/**
 * Re-seals every sealed value under the newest key. `dryRun`: counts what would change, writes nothing. A value no key
 * opens is left exactly as it was and reported (it was already unreadable; rotating cannot make it worse).
 */
export function rotateDataKeys(db: DatabaseSync, opts: { dryRun?: boolean; ring?: Keyring } = {}): RotationReport {
  const ring = opts.ring ?? keyring();
  const dryRun = !!opts.dryRun;
  const report: RotationReport = { dryRun, newKey: ring.current.id, keys: ring.keys.map((k) => k.id), total: 0, current: 0, resealed: 0, unreadable: 0, locations: [], problems: [] };
  const step = (loc: LocationReport, value: string): string | null => {
    loc.total++;
    const id = keyIdOf(value) ?? "?";
    loc.byKey[id] = (loc.byKey[id] ?? 0) + 1;
    if (isCurrent(value, ring)) { loc.current++; return null; }
    const o = openValue(value, ring);
    if (!o.ok) { loc.unreadable++; if (report.problems.length < 50) report.problems.push(`${loc.where}: a value sealed with key "${o.keyId ?? "?"}" cannot be opened (${o.reason})`); return null; }
    loc.resealed++;
    return sealWith(ring.current, o.value);
  };
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { table, column } of sealedColumns(db)) {
      const where = `${table}.${column}`;
      const loc: LocationReport = { where, label: KNOWN_SEALED[where] ?? "sealed column", total: 0, current: 0, resealed: 0, unreadable: 0, byKey: {} };
      const update = db.prepare(`UPDATE ${quote(table)} SET ${quote(column)} = ? WHERE rowid = ?`);
      for (const r of db.prepare(`SELECT rowid AS rid, ${quote(column)} AS v FROM ${quote(table)} WHERE ${quote(column)} IS NOT NULL AND ${quote(column)} <> ''`).all() as { rid: number; v: string }[]) {
        const next = step(loc, r.v);
        if (next && !dryRun) update.run(next, r.rid);
      }
      report.locations.push(loc);
    }
    for (const f of JSON_FIELDS) {
      const exists = (db.prepare(`PRAGMA table_info(${quote(f.table)})`).all() as { name: string }[]).some((c) => c.name === f.column);
      if (!exists) continue;
      const loc: LocationReport = { where: `${f.table}.${f.column} (${f.keys.join(", ")})`, label: f.label, total: 0, current: 0, resealed: 0, unreadable: 0, byKey: {} };
      const update = db.prepare(`UPDATE ${quote(f.table)} SET ${quote(f.column)} = ? WHERE rowid = ?`);
      for (const r of db.prepare(`SELECT rowid AS rid, ${quote(f.column)} AS v FROM ${quote(f.table)} WHERE ${quote(f.column)} IS NOT NULL`).all() as { rid: number; v: string }[]) {
        let obj: Record<string, unknown>;
        try { obj = JSON.parse(r.v); } catch { continue; }
        if (!obj || typeof obj !== "object") continue;
        let changed = false;
        for (const k of f.keys) {
          if (typeof obj[k] !== "string" || !obj[k]) continue;
          const next = step(loc, obj[k] as string);
          if (next) { obj[k] = next; changed = true; }
        }
        if (changed && !dryRun) update.run(JSON.stringify(obj), r.rid);
      }
      report.locations.push(loc);
    }
    db.exec(dryRun ? "ROLLBACK" : "COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  for (const l of report.locations) { report.total += l.total; report.current += l.current; report.resealed += l.resealed; report.unreadable += l.unreadable; }
  return report;
}

/** The report in words (French: the command line and the docs are French). */
export function reportText(r: RotationReport): string {
  const lines = [
    r.dryRun ? "Essai à blanc : rien n'a été modifié." : "Rotation terminée (une seule transaction).",
    `Clé la plus récente : ${r.newKey} — trousseau : ${r.keys.join(", ")}`,
    `Valeurs scellées : ${r.total} — déjà sous ${r.newKey} : ${r.current} — ${r.dryRun ? "à rechiffrer" : "rechiffrées"} : ${r.resealed} — illisibles (laissées telles quelles) : ${r.unreadable}`,
    "",
    "Emplacements :",
    ...r.locations.map((l) => `  ${l.where.padEnd(44)} ${String(l.total).padStart(5)}  ${l.resealed ? `${r.dryRun ? "à rechiffrer" : "rechiffrées"} ${l.resealed}` : "—"}${l.unreadable ? `  illisibles ${l.unreadable}` : ""}  (${l.label})`),
  ];
  if (r.problems.length) lines.push("", "Problèmes :", ...r.problems.map((p) => `  - ${p}`));
  if (!r.dryRun && !r.unreadable) lines.push("", `Les anciennes clés ne servent plus : tu peux ne garder que ${r.newKey} dans DATA_KEYS (garde une copie des anciennes avec tes sauvegardes, qui en ont encore besoin).`);
  return lines.join("\n");
}

/** Owner-only routes (the earliest account; anyone else gets the 404 of an unknown address). */
export function registerDataKeyRoutes(api: Hono<any>) {
  const owner = (c: Context) => (c.get("user") as UserRecord | undefined)?.id === ownerAccountId();
  api.get("/admin/data-key", (c) => {
    if (!owner(c)) return c.json({ error: "No such endpoint." }, 404);
    return c.json({ report: rotateDataKeys(db, { dryRun: true }) });
  });
  api.post("/admin/data-key/rotate", async (c) => {
    if (!owner(c)) return c.json({ error: "No such endpoint." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { dryRun?: unknown };
    return c.json({ report: rotateDataKeys(db, { dryRun: b?.dryRun !== false }) });
  });
}
