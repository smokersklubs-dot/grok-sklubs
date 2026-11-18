import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { MIGRATIONS } from "../src/migrations/index.js";
import { serverMailFromRelay } from "../src/migrations/020-server-mail-from-relay.js";

// Migration 20: the owner's bot relay fills the server's own SMTP when there is none; never overwrites, never others'.
const fresh = (): DatabaseSync => { const db = new DatabaseSync(":memory:"); for (const m of MIGRATIONS) if (m.version <= 19) m.up(db); return db; };
const user = (db: DatabaseSync, id: string, at: number) => db.prepare("INSERT INTO users (id, email, name, pass_hash, created_at) VALUES (?, ?, ?, '', ?)").run(id, `${id}@example.com`, id, at);
const relay = (db: DatabaseSync, uid: string, username: string, pass: string | null) =>
  db.prepare("INSERT INTO mail_relays (user_id, host, port, secure, username, pass_enc, updated_at) VALUES (?, 'smtp.gmail.com', 465, 1, ?, ?, 1)").run(uid, username, pass);
const smtp = (db: DatabaseSync) => db.prepare("SELECT * FROM instance_smtp WHERE id = 1").get() as any;

test("migration 20: the owner's relay becomes the server's mail, sealed password copied as is", () => {
  const db = fresh(); user(db, "owner", 1); user(db, "other", 2); relay(db, "owner", "Me@Gmail.com", "v2:s0:sealed");
  serverMailFromRelay(db);
  const s = smtp(db);
  assert.equal(s.host, "smtp.gmail.com"); assert.equal(s.port, 465); assert.equal(s.tls_mode, "tls");
  assert.equal(s.pass_enc, "v2:s0:sealed"); assert.equal(s.from_addr, "me@gmail.com"); assert.equal(s.updated_by, "owner");
});
test("migration 20: nothing when the server already has mail, the relay has no password or no e-mail, or it is someone else's", () => {
  const a = fresh(); user(a, "owner", 1); relay(a, "owner", "me@gmail.com", "x");
  a.prepare("INSERT INTO instance_smtp (id, host, port, tls_mode, username, pass_enc, from_addr, updated_at) VALUES (1, 'mail.example.com', 587, 'starttls', 'u', 'p', 'a@example.com', 1)").run();
  serverMailFromRelay(a); assert.equal(smtp(a).host, "mail.example.com");
  const b = fresh(); user(b, "owner", 1); relay(b, "owner", "me@gmail.com", null); serverMailFromRelay(b); assert.equal(smtp(b), undefined);
  const c = fresh(); user(c, "owner", 1); relay(c, "owner", "not-an-email", "x"); serverMailFromRelay(c); assert.equal(smtp(c), undefined);
  const d = fresh(); user(d, "owner", 1); user(d, "other", 2); relay(d, "other", "o@gmail.com", "x"); serverMailFromRelay(d); assert.equal(smtp(d), undefined);
});
