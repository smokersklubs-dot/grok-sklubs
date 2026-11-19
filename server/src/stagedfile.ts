import { closeSync, constants, linkSync, lstatSync, mkdirSync, openSync, realpathSync, unlinkSync } from "node:fs";
import path from "node:path";
import { checkLibraryUpload, resolveInWorkspace, storeLibraryFile } from "./computer.js";

// Publish the completed file on the same volume, atomically and exclusively. On Linux the destination
// directory is pinned by descriptor, even if a desktop changes a directory entry during publication.
export function publishStagedFile(bot: string, folder: "uploads" | "exports", source: string, name: string, size: number) {
  const original = lstatSync(source, { bigint: true });
  if (!original.isFile() || original.size !== BigInt(size)) throw new Error("The staged file size changed.");
  const dir = resolveInWorkspace(bot, folder);
  mkdirSync(dir, { recursive: true });
  const fd = process.platform === "linux" ? openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW) : null;
  try {
    const anchor = fd === null ? dir : `/proc/self/fd/${fd}`;
    if (realpathSync(anchor) !== resolveInWorkspace(bot, folder)) throw new Error("Upload directory changed.");
    return storeLibraryFile(bot, folder, name, target => {
      checkLibraryUpload(bot, size, true);
      const dest = path.join(anchor, path.basename(target));
      linkSync(source, dest);
      try { checkLibraryUpload(bot, size); } catch (err) { unlinkSync(dest); throw err; }
    }, existing => {
      const st = lstatSync(existing, { bigint: true });
      return st.isFile() && st.dev === original.dev && st.ino === original.ino;
    });
  } finally { if (fd !== null) closeSync(fd); }
}
