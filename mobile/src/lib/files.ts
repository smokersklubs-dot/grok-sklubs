/**
 * Library files: downloaded with the session header into the app's cache, then handed to the system share sheet
 * (save to Files, open in another app, send…). https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/
 * (File.downloadFileAsync with `headers`, `idempotent`) and https://docs.expo.dev/versions/v58.0.0/sdk/sharing/
 */
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { ApiClient } from "../api/client";

const safeName = (name: string) => name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";

export async function downloadToCache(client: ApiClient, botId: string, filePath: string, name: string): Promise<File> {
  const dir = new Directory(Paths.cache, "downloads", safeName(botId));
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, safeName(name));
  return File.downloadFileAsync(client.fileUrl(botId, filePath, "download"), dest, { headers: client.authHeaders(), idempotent: true });
}

export async function shareLibraryFile(client: ApiClient, botId: string, filePath: string, name: string, mime?: string) {
  const file = await downloadToCache(client, botId, filePath, name);
  if (!(await Sharing.isAvailableAsync())) throw new Error("sharing unavailable");
  await Sharing.shareAsync(file.uri, { mimeType: mime || undefined, dialogTitle: name });
}
