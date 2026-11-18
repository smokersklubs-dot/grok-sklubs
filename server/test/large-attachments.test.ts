import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
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
const { beginUpload, receivePart, cancelUpload, sweepUploads } = await import("../src/uploadparts.js");
const { q } = await import("../src/db.js");
const { listFiles } = await import("../src/computer.js");

test("1 GB sessions expose only finished files, survive retried parts and keep bots isolated", async () => {
  const app = new Hono();
  app.post("/:bot/start", async c => beginUpload(c, c.req.param("bot"), "owner", await c.req.json()));
  app.post("/:bot/:id", c => receivePart(c, c.req.param("bot"), c.req.param("id")));
  app.delete("/:bot/:id", c => cancelUpload(c, c.req.param("bot"), c.req.param("id")));
  const bot = "parts-test";
  const start = (size: number) => app.request("/" + bot + "/start", { method: "POST", body: JSON.stringify({ name: "clip.mp4", size }) });
  const part = (id: string, offset: number, data: Uint8Array, who = bot) => app.request("/" + who + "/" + id + "?offset=" + offset, { method: "POST", body: Buffer.from(data) });
  assert.equal((await start(MAX_UPLOAD_BYTES + 1)).status, 413);
  const full = await (await start(1_000_000_000)).json();
  assert.ok(full.id);
  assert.equal((await app.request("/" + bot + "/" + full.id, { method: "DELETE" })).status, 204);
  const n = full.partBytes;
  const { id } = await (await start(n + 3)).json();
  const first = Buffer.alloc(n, 37);
  const last = Buffer.from("end");
  assert.equal((await part(id, n, last)).status, 409);
  assert.equal((await part(id, 0, last)).status, 400);
  assert.equal((await part(id, 0, first, "other-bot")).status, 404);
  assert.deepEqual(await (await part(id, 0, first)).json(), { received: n });
  assert.deepEqual(await (await part(id, 0, first)).json(), { received: n });
  assert.equal(listFiles(bot, "uploads").length, 0);
  storeBytes(bot, "uploads", "clip.mp4", Buffer.from("previous"));
  const { attachment } = await (await part(id, n, last)).json();
  assert.equal(attachment.path, "uploads/clip-2.mp4");
  assert.deepEqual(readLibraryFile(bot, attachment.path), Buffer.concat([first, last]));
  assert.deepEqual(await (await part(id, n, last)).json(), { attachment });
  assert.deepEqual(readLibraryFile(bot, "uploads/clip.mp4").toString(), "previous");
  assert.equal(existsSync(path.join(process.env.DATA_DIR!, "incoming-uploads", id)), false);
  const abandoned = await (await start(n + 1)).json();
  await part(abandoned.id, 0, first);
  q.run("UPDATE upload_sessions SET touched = 0 WHERE id = ?", abandoned.id);
  sweepUploads();
  assert.equal((await part(abandoned.id, n, last)).status, 404);
  assert.equal(existsSync(path.join(process.env.DATA_DIR!, "incoming-uploads", abandoned.id)), false);
});

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
