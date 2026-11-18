import type { Block } from "./llm/types.js";
import { createHash } from "node:crypto";
import { botPathOf, imageForModel, isInlineImage } from "./computer.js";
import type { Attachment } from "./shared.js";
import { PREVIEW_BATCH_BYTES } from "./visionpayload.js";

export function previewBudget(files: Attachment[]) {
  const count = files.filter((file) => isInlineImage(file.mime)).length;
  return Math.min(5_000_000, Math.floor(PREVIEW_BATCH_BYTES / Math.max(1, count)));
}

/** Both subscription tools read files on the desktop. Give them a small version
 * for inspection and keep the original available for editing and rendering. */
export async function desktopAttachmentNotes(botId: string, files: Attachment[], writePreview: (path: string, data: string) => Promise<void>) {
  const notes: string[] = [];
  const budget = previewBudget(files);
  for (const file of files) {
    const original = botPathOf(file.path);
    let note = `- ${original} (${file.mime})`;
    if (isInlineImage(file.mime) && file.size > budget) {
      const image = await imageForModel(botId, file, budget);
      if (image) {
        const hash = createHash("sha256").update(image.data).digest("hex");
        const preview = `/root/.sklubot/vision/${hash}.jpg`;
        await writePreview(preview, image.data);
        note += ` — inspect ${preview} for the image content; use the original for edits`;
      }
    }
    notes.push(note);
  }
  return notes.length ? "\n\n[Files the user attached, in your library:]\n" + notes.join("\n") : "";
}

/** What the model sees for a user message: the words, any pictures, and where attached files were put. */
export async function userBlocks(botId: string, words: string, attachments: Attachment[] = []): Promise<Block[]> {
  const budget = previewBudget(attachments);
  const blocks: Block[] = [];
  for (const a of attachments) {
    const img = await imageForModel(botId, a, budget);
    if (img) blocks.push({ type: "image", mediaType: img.mediaType, data: img.data });
  }
  const notes = attachments.map((a) => `- ${botPathOf(a.path)} (${a.mime}, ${a.size} bytes)`);
  const full = [words, notes.length ? `[The user attached ${notes.length === 1 ? "a file" : "files"}, saved in your library:]\n${notes.join("\n")}` : ""].filter(Boolean).join("\n\n");
  if (full) blocks.push({ type: "text", text: full });
  return blocks;
}
