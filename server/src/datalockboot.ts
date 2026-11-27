/**
 * L50: imported first by index.ts (before the database opens): takes the « un seul serveur » lock on DATA_DIR
 * (datalock.ts), or stops this server with the reason. Only the real server imports this; tests and the command-line
 * tools (rotatekey.ts…) do not take the lock.
 *
 * L161 « démarrage sur disque en panne »: the lock is taken by diskboot.ts, when the database module loads, once the
 * data disk has been found writable (a lock cannot be written on a full or read-only disk; until the disk is fine the
 * server waits in safe mode instead of stopping and being restarted in a loop). Still before the database opens.
 */
import { boot } from "./bootflag.js";
import { config } from "./config.js";
import { acquireDataLock, DataLockError, type DataLock } from "./datalock.js";

let lock: DataLock | null = null;
boot.takeLock = () => {
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
};
process.on("exit", () => lock?.release());
