import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { LATEST_VERSION, MIGRATIONS, migrate, NewerDatabaseError, type Migration } from "../src/migrations/index.js";

// SK-P0-05: versioned migrations. The fixture is a database written by the schema code of commit b8096fa (before
// versions existed: user_version 0), with one account, one bot, three chat rows and two usage lines.
const here = path.dirname(new URL(import.meta.url).pathname);
const dir = mkdtempSync(path.join(tmpdir(), "sklubot-mig-"));
const open = (file: string) => { const db = new DatabaseSync(file); db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;"); return db; };
const userVersion = (db: DatabaseSync) => (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
const n = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;
function schemaOf(db: DatabaseSync): string[] {
  const out: string[] = [];
  for (const t of db.prepare("SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string; type: string }[]) {
    out.push(`${t.type}:${t.name}`);
    if (t.type === "table") for (const c of db.prepare(`PRAGMA table_info(${t.name})`).all() as { name: string; type: string; notnull: number; dflt_value: string | null }[]) out.push(`  ${t.name}.${c.name} ${c.type} ${c.notnull} ${c.dflt_value}`);
  }
  return out.sort();
}
function fixtureCopy(name: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, gunzipSync(readFileSync(path.join(here, "fixtures", "db-v0-b8096fa.sqlite.gz"))));
  return file;
}
const backups = (file: string) => readdirSync(path.dirname(file)).filter((f) => f.startsWith(`${path.basename(file)}.pre-v`));

test("a new database is created at the latest version, without a pre-migration copy", () => {
  const file = path.join(dir, "fresh.db");
  const db = open(file);
  const r = migrate(db, file);
  assert.equal(r.from, 0);
  assert.equal(r.to, LATEST_VERSION);
  assert.deepEqual(r.applied, MIGRATIONS.map((m) => `${m.version}-${m.name}`));
  assert.equal(r.backup, null);
  assert.equal(userVersion(db), LATEST_VERSION);
  for (const t of ["users", "bots", "rows", "usage", "bot_jobs", "model_prices", "subscription_usage", "instance_smtp", "password_resets", "email_changes"]) assert.equal(n(db, `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '${t}'`), 1, t);
  assert.deepEqual(backups(file), []);
  db.close();
});

test("a database made before versions (b8096fa) is copied, migrated, stamped, and keeps all its data", () => {
  const file = fixtureCopy("old.db");
  const db = open(file);
  assert.equal(userVersion(db), 0);
  const r = migrate(db, file);
  assert.equal(r.from, 0);
  assert.equal(r.to, LATEST_VERSION);
  assert.ok(r.backup && backups(file).length === 1, "a copy is made before changing it");
  assert.equal(userVersion(db), LATEST_VERSION);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM users"), 1);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM bots"), 1);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM rows"), 3);
  assert.equal((db.prepare("SELECT body FROM rows WHERE seq = 2").get() as { body: string }).body.includes("hello 2"), true);
  // Old usage lines: the subscription tool's is labelled, the API model's stays '' (its price status was not recorded then).
  assert.deepEqual(db.prepare("SELECT model, price_status, est_cost_usd FROM usage ORDER BY model").all().map((r) => ({ ...r })),
    [{ model: "claude-code:sonnet", price_status: "subscription", est_cost_usd: 0 }, { model: "grok-4.7", price_status: "", est_cost_usd: 0 }]);
  assert.equal((db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  // The same schema as a database created new by this code.
  const fresh = open(path.join(dir, "fresh.db"));
  assert.deepEqual(schemaOf(db), schemaOf(fresh));
  fresh.close();
  // The copy is the database as it was: version 0, same data.
  const copy = new DatabaseSync(r.backup!, { readOnly: true });
  assert.equal(userVersion(copy), 0);
  assert.equal(n(copy, "SELECT COUNT(*) AS n FROM rows"), 3);
  assert.equal(n(copy, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'model_prices'"), 0);
  copy.close();
  db.close();
});

test("running the migrations again changes nothing and makes no copy", () => {
  const file = path.join(dir, "old.db");
  const db = open(file);
  const before = schemaOf(db);
  const r = migrate(db, file);
  assert.deepEqual(r, { from: LATEST_VERSION, to: LATEST_VERSION, applied: [], backup: null });
  assert.deepEqual(schemaOf(db), before);
  assert.equal(backups(file).length, 1);
  db.close();
});

test("a database newer than the code is refused and left untouched", () => {
  const file = path.join(dir, "newer.db");
  const db = open(file);
  migrate(db, file);
  db.exec(`PRAGMA user_version = ${LATEST_VERSION + 1}`);
  assert.throws(() => migrate(db, file), (err) => err instanceof NewerDatabaseError && /newer than this Sklubot/.test(err.message));
  assert.equal(userVersion(db), LATEST_VERSION + 1);
  db.close();
});

test("a failing step is rolled back: the database stays at the previous version, without its partial changes", () => {
  const file = path.join(dir, "failing.db");
  const db = open(file);
  migrate(db, file);
  const steps: Migration[] = [...MIGRATIONS, { version: LATEST_VERSION + 1, name: "broken", up: (d) => { d.exec("CREATE TABLE half_done (x)"); throw new Error("boom"); } }];
  assert.throws(() => migrate(db, file, steps), new RegExp(`broken\\) failed and was rolled back.*version ${LATEST_VERSION}.*boom`, "s"));
  assert.equal(userVersion(db), LATEST_VERSION);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'half_done'"), 0);
  // A working next step then applies once, after a copy.
  const ok: Migration[] = [...MIGRATIONS, { version: LATEST_VERSION + 1, name: "ok", up: (d) => d.exec("CREATE TABLE later (x)") }];
  const r = migrate(db, file, ok);
  assert.deepEqual(r.applied, [`${LATEST_VERSION + 1}-ok`]);
  assert.ok(r.backup);
  assert.equal(migrate(db, file, ok).applied.length, 0);
  db.close();
});

test("only the newest pre-migration copies are kept", () => {
  const file = path.join(dir, "rotate.db");
  const db = open(file);
  migrate(db, file);
  let steps = [...MIGRATIONS];
  for (let i = 1; i <= 5; i++) {
    steps = [...steps, { version: LATEST_VERSION + i, name: `s${i}`, up: (d) => d.exec(`CREATE TABLE t${i} (x)`) }];
    migrate(db, file, steps);
  }
  assert.equal(backups(file).length, 3);
  db.close();
});
