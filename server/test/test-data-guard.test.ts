import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { REPO_DB, refuseRepoDbInTests } from "../src/testdataguard.js";

// « Doit marcher » (24/11): tests use their own data and never touch data/sklubot.db. This file imports no module
// that opens a database.
const HERE = path.dirname(fileURLToPath(import.meta.url));

test("must work: under the test runner, opening data/sklubot.db is refused before anything is opened", () => {
  assert.equal(REPO_DB, path.resolve(HERE, "..", "..", "data", "sklubot.db"));
  assert.throws(() => refuseRepoDbInTests(REPO_DB, { NODE_TEST_CONTEXT: "child-v8" }), /Set process\.env\.DATA_DIR to a temporary folder/);
  assert.throws(() => refuseRepoDbInTests(path.join(HERE, "..", "..", "data", ".", "sklubot.db"), { NODE_TEST_CONTEXT: "child" }));
  assert.doesNotThrow(() => refuseRepoDbInTests("/tmp/sklubot-x/sklubot.db", { NODE_TEST_CONTEXT: "child-v8" }), "a test's own folder");
  assert.doesNotThrow(() => refuseRepoDbInTests(REPO_DB, {}), "the real server");
  const db = readFileSync(path.join(HERE, "..", "src", "db.ts"), "utf8");
  assert.ok(db.indexOf("refuseRepoDbInTests(config.dbPath)") >= 0 && db.indexOf("refuseRepoDbInTests(config.dbPath)") < db.indexOf("new DatabaseSync("), "checked before the file is opened");
});

test("must work: every test file that loads server code sets DATA_DIR before loading it", () => {
  const bad: string[] = [];
  for (const f of readdirSync(HERE).filter((n) => n.endsWith(".test.ts"))) {
    const src = readFileSync(path.join(HERE, f), "utf8");
    const dyn = src.search(/await import\(["'`]\.\.\/src\//);
    if (dyn < 0) continue;
    const set = src.search(/process\.env\.DATA_DIR\s*=/);
    // data-lock.test.ts loads only datalock.ts (node:fs, no database) and gives its child servers their own DATA_DIR.
    if ((set < 0 || set > dyn) && f !== "data-lock.test.ts") bad.push(f);
  }
  assert.deepEqual(bad, []);
});
