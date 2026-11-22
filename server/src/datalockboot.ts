/**
 * L50: imported first by index.ts (before the database opens): takes the « un seul serveur » lock on DATA_DIR
 * (datalock.ts), or stops this server with the reason. Only the real server imports this; tests and the command-line
 * tools (rotatekey.ts…) do not take the lock.
 */
import { config } from "./config.js";
import { acquireDataLock, DataLockError, type DataLock } from "./datalock.js";

let lock: DataLock | null = null;
try {
  lock = acquireDataLock(config.dataDir, {
    heartbeat: true,
    onLost: (by) => {
      console.error(`\nArrêt : un autre serveur Sklubot (processus ${by?.pid ?? "?"} sur « ${by?.host ?? "?"} ») a repris le dossier de données ${config.dataDir}. Deux serveurs ne doivent jamais tourner ensemble sur les mêmes données.\n(Stopping: another server took over this data folder.)\n`);
      process.exit(1);
    },
  });
} catch (err) {
  console.error(`\nCannot start: ${err instanceof DataLockError ? err.message : `le verrou du dossier de données n'a pas pu être pris (${(err as Error).message}).`}\n`);
  process.exit(1);
}
process.on("exit", () => lock?.release());
