import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { migrate } from "./migrations/index.js";

mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

// Versioned migrations (migrations/index.ts): the schema up to commit b8096fa is migration 1 (idempotent, so a database
// made by an older Sklubot is brought up to date and stamped); every later change is a numbered step that runs once, in a
// transaction, after a copy of the database file. A database newer than this code is refused (nothing is changed).
migrate(db, config.dbPath, undefined, (line) => console.log(line));

type Param = string | number | null | bigint;
export const q = {
  all<T = Record<string, unknown>>(sql: string, ...p: Param[]): T[] {
    return db.prepare(sql).all(...p) as T[];
  },
  get<T = Record<string, unknown>>(sql: string, ...p: Param[]): T | undefined {
    return db.prepare(sql).get(...p) as T | undefined;
  },
  run(sql: string, ...p: Param[]) {
    return db.prepare(sql).run(...p);
  },
  tx<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  },
};
