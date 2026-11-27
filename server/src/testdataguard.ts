import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * « Doit marcher » (24/11): a test never opens or migrates the owner's own database (data/sklubot.db of this checkout).
 * Under Node's test runner (it sets NODE_TEST_CONTEXT in each test file's process: https://nodejs.org/api/test.html) a
 * process that would open that file stops at once with the fix to make: set DATA_DIR to a temporary folder before
 * importing server code. A real server (no NODE_TEST_CONTEXT) is not affected.
 */
export const REPO_DB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "sklubot.db");

export function refuseRepoDbInTests(dbPath: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!env.NODE_TEST_CONTEXT) return;
  if (path.resolve(dbPath) !== REPO_DB) return;
  throw new Error(`A test was about to open ${REPO_DB}, the owner's own data. Set process.env.DATA_DIR to a temporary folder (mkdtempSync) before importing server code.`);
}
