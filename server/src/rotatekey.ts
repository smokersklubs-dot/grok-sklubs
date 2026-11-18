/**
 * Re-seals every secret of the database under the newest data key (datakeyrotate.ts), on the server's own machine:
 *   node server/dist/rotatekey.js --dry-run     what would change, nothing written
 *   node server/dist/rotatekey.js               the rotation, in one transaction
 * With Docker: docker compose exec app node server/dist/rotatekey.js --dry-run
 * It reads the same settings as the server (DATA_DIR / DB_PATH, DATA_KEYS or DATA_KEY, SESSION_SECRET). The server may
 * keep running: SQLite serialises the writes. Exit code 0 when everything is readable, 2 when some values are not.
 */
import { checkDataKeys } from "./datakey.js";
import { db } from "./db.js";
import { reportText, rotateDataKeys } from "./datakeyrotate.js";

const dryRun = process.argv.includes("--dry-run") || process.argv.includes("-n");
const json = process.argv.includes("--json");
try {
  checkDataKeys();
} catch (err) {
  console.error(`Clé de données invalide : ${(err as Error).message}`);
  process.exit(1);
}
const report = rotateDataKeys(db, { dryRun });
console.log(json ? JSON.stringify(report, null, 2) : reportText(report));
process.exit(report.unreadable ? 2 : 0);
