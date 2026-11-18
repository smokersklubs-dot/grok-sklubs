import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 20 — the server's own e-mails (sign-up confirmation, forgotten password) reuse the owner's bot relay when the
 * server has none yet. Owners often fill the bots' relay (Settings → E-mail) with their Gmail app password, thinking it
 * is the server's mail. Only when: no server SMTP is saved, the owner (the earliest account) has a relay with a saved
 * password, and its user name is an e-mail address (used as the sender). The sealed password is copied as it is: it never
 * leaves the database and is never decrypted here. Settings from the environment (SMTP_HOST…) still win. Nothing else
 * changes; the previous version of the code reads the row as before.
 */
export function serverMailFromRelay(db: DatabaseSync): void {
  const has = db.prepare("SELECT 1 AS x FROM instance_smtp WHERE id = 1").get();
  if (has) return;
  const owner = db.prepare("SELECT id FROM users ORDER BY created_at ASC, rowid ASC LIMIT 1").get() as { id: string } | undefined;
  if (!owner) return;
  const r = db.prepare("SELECT host, port, secure, username, pass_enc FROM mail_relays WHERE user_id = ?").get(owner.id) as
    { host: string; port: number; secure: number; username: string; pass_enc: string | null } | undefined;
  if (!r || !r.pass_enc || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.username.trim())) return;
  const t = Date.now();
  db.prepare(`INSERT INTO instance_smtp (id, host, port, tls_mode, username, pass_enc, from_addr, updated_at, updated_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(r.host, r.port, r.secure ? "tls" : "starttls", r.username.trim(), r.pass_enc, r.username.trim().toLowerCase(), t, owner.id);
  db.prepare("INSERT INTO audit (user_id, at, kind, text) VALUES (?, ?, 'account', ?)")
    .run(owner.id, t, `Server e-mail (SMTP) set from the bots' relay: ${r.host}:${r.port}`);
}
