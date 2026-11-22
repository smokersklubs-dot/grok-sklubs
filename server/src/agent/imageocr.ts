import { computerKind, workspaceOf } from "../computer.js";
import { q } from "../db.js";
import { setCurrentBot, setImageOcr, setReadingStore, setReadingUsage, CACHE_MAX } from "../llm/imagetext.js";
import { linuxExec } from "../linux.js";
import { now, rowScope } from "../store.js";
import { record } from "../usage.js";

/**
 * The server side of llm/imagetext.ts (pictures read for text-only models): where readings are kept (one table, per
 * account: one account never reuses another's reading of the same bytes), which bot's turn is running (its usage line),
 * and the Tesseract fallback on that bot's own computer when no model of the account reads images. Tables are created
 * here, at load (the house pattern).
 */
q.run("CREATE TABLE IF NOT EXISTS image_readings (user_id TEXT NOT NULL, digest TEXT NOT NULL, text TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, digest))");

setReadingStore({
  get(userId, digest) {
    const r = q.get<{ text: string; by: string }>("SELECT text, by FROM image_readings WHERE user_id = ? AND digest = ?", userId, digest);
    return r ? { text: r.text, by: r.by } : null;
  },
  put(userId, digest, r) {
    q.run("INSERT OR REPLACE INTO image_readings (user_id, digest, text, by, at) VALUES (?, ?, ?, ?, ?)", userId, digest, r.text, r.by, now());
    q.run("DELETE FROM image_readings WHERE user_id = ? AND digest NOT IN (SELECT digest FROM image_readings WHERE user_id = ? ORDER BY at DESC LIMIT ?)", userId, userId, CACHE_MAX);
  },
});
setCurrentBot(() => rowScope.getStore()?.botId ?? null);
setReadingUsage((userId, botId, model, usage) => record(userId, botId, model, usage));

/** The picture goes in on standard input (base64), never on a command line; Tesseract reads French and English. */
const OCR_STDIN = `set -u
command -v tesseract >/dev/null 2>&1 || exit 40
tmp=$(mktemp -d /tmp/sklubot-read.XXXXXX); trap 'rm -rf "$tmp"' EXIT
base64 -d > "$tmp/in" || exit 41
convert "$tmp/in[0]" -colorspace Gray -resize 200% "png:$tmp/a.png" 2>/dev/null || exit 42
tesseract "$tmp/a.png" stdout -l fra+eng 2>/dev/null || exit 44`;

setImageOcr(async (botId, userId, img, signal) => {
  if (computerKind() !== "linux") return null;
  const r = await linuxExec(botId, userId, workspaceOf(botId), ["bash", "-c", OCR_STDIN], 90, { signal, input: img.data, maxBytes: 400_000 });
  return r.code === 0 ? r.stdout : null;
});
