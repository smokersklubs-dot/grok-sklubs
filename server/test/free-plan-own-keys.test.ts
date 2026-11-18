import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { MIGRATIONS } from "../src/migrations/index.js";
import { freePlanOwnKeys } from "../src/migrations/019-free-plan-own-keys.js";

// Migration 19: the seeded "Gratuit" plan becomes "own key or subscription" (0 €), but a plan the owner edited stays.
test("migration 19: the untouched free plan gets 0 € and the new text; an edited one is left alone", () => {
  const fresh = (): DatabaseSync => { const db = new DatabaseSync(":memory:"); for (const m of MIGRATIONS) if (m.version <= 4) m.up(db); return db; };
  const row = (db: DatabaseSync) => db.prepare("SELECT ai_budget_eur AS b, description_fr AS fr FROM plans WHERE id = 'free'").get() as { b: number; fr: string };
  const a = fresh();
  freePlanOwnKeys(a);
  assert.equal(row(a).b, 0);
  assert.match(row(a).fr, /ta propre clé d'API/);
  const b = fresh();
  b.prepare("UPDATE plans SET ai_budget_eur = 5 WHERE id = 'free'").run();
  freePlanOwnKeys(b);
  assert.equal(row(b).b, 5);
  assert.match(row(b).fr, /les clés d'IA du service/);
});
