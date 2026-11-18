import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { Hono } from "hono";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-large-files-"));
process.env.NO_SCHEDULER = "1";
const { storeBytes, readLibraryFile } = await import("../src/computer.js");
const { userBlocks, desktopAttachmentNotes } = await import("../src/attachmentpreviews.js");
const { receiveUpload } = await import("../src/uploads.js");
const { MAX_UPLOAD_BYTES } = await import("../src/uploadlimits.js");

test("raw and multipart uploads preserve bytes and enforce the file limit", async () => {
  const app = new Hono();
  app.post("/upload", c => receiveUpload(c, "upload-test"));
  const file = new File(["café"], "démo.txt", { type: "text/plain" });
  const name = { "X-Sklubot-Filename": encodeURIComponent(file.name) };
  const form = new FormData();
  form.append("file", file);
  for (const init of [{ body: file, headers: name }, { body: form }]) {
    const res = await app.request("/upload", { method: "POST", ...init });
    assert.equal(res.status, 200);
    const { attachment } = await res.json();
    assert.equal(attachment.size, file.size);
    assert.equal(readLibraryFile("upload-test", attachment.path).toString(), "café");
  }
  assert.equal((await app.request("/upload", { method: "POST", body: file, headers: { ...name, "content-length": String(MAX_UPLOAD_BYTES + 1) } })).status, 413);
});

test("large chat photos remain visible to API models and subscription desktops with the original intact", async () => {
  const bytes = await sharp(randomBytes(1700 * 1200 * 3), { raw: { width: 1700, height: 1200, channels: 3 } }).png().toBuffer();
  assert.ok(bytes.length > 5_000_000);
  const bot = "test-photo";
  const file = storeBytes(bot, "uploads", "original.png", bytes);
  const blocks = await userBlocks(bot, "Lis cette photo", [file]);
  assert.equal(blocks[0].type, "image");
  if (blocks[0].type !== "image") return;
  const preview = Buffer.from(blocks[0].data, "base64");
  assert.ok(preview.length < bytes.length);
  assert.equal((await sharp(preview).metadata()).width, 1700);
  let destination = "";
  const notes = await desktopAttachmentNotes(bot, [file], async (path, data) => {
    destination = path;
    assert.deepEqual(Buffer.from(data, "base64"), preview);
  });
  assert.match(destination, /\/vision\/[0-9a-f]{64}\.jpg$/);
  assert.ok(notes.includes(file.path) && notes.includes(destination));
  assert.deepEqual(readLibraryFile(bot, file.path), bytes);
});
