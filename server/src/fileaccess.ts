import { q } from "./db.js";

/**
 * nod audit item 9 (row 15) — local file access switchable from the chat.
 *
 * Per linked computer, a switch « Accès à mes fichiers » on top of the folders the owner shared in the Sklubot Relais
 * app (those stay chosen on the computer, never by the server). ON when no row exists: sharing a folder on the computer
 * is already an explicit opt-in, and turning it off by default would break the file access owners already use.
 *
 * Off → every file tool stops on a card in the chat (« Rallumer l'accès à tes fichiers ? »); Allow turns it back on and
 * the same request continues; Refuse leaves it off. The card is never "Always". Turning it off is free (the owner says
 * « coupe l'accès à mes fichiers » in the chat, or flips it in Settings → Computers). Only work the owner started in the
 * chat can use files at all (mycomputer.ts filesTarget), so a routine or another bot can never turn it on.
 */
q.run(`CREATE TABLE IF NOT EXISTS relay_file_access (
  device_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, files_on INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
)`);

export const fileAccess = {
  on(userId: string, deviceId: string): boolean {
    const r = q.get<{ files_on: number }>("SELECT files_on FROM relay_file_access WHERE device_id = ? AND user_id = ?", deviceId, userId);
    return r ? r.files_on === 1 : true;
  },
  set(userId: string, deviceId: string, on: boolean) {
    q.run("INSERT INTO relay_file_access (device_id, user_id, files_on, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET user_id = excluded.user_id, files_on = excluded.files_on, updated_at = excluded.updated_at", deviceId, userId, on ? 1 : 0, Date.now());
  },
};

export const fileAccessKey = (botName: string) => `myfiles: turn on: ${botName}`;
/** The card shown when a file tool meets the switch off (English template, translated by the card itself). */
export const FILE_ACCESS_CARD = {
  title: "Access to your files on {device} is off. Turn it back on so {bot} can use the folders you shared there?",
  reason: "turn your file access back on for {device}",
  note: "Only the folders you shared in the Sklubot Relais app. You can turn it off again in the chat (\"turn off my files\") or in Settings → Computers.",
};
/** Extra line on the write / trash card when the same click also turns the access back on. */
export const FILE_ACCESS_ALSO = " Access to your files on {device} is off: allowing also turns it back on.";
