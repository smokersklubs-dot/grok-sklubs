import type { Context } from "hono";
import { storeBytes } from "./computer.js";
import { MAX_UPLOAD_BODY, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "./uploadlimits.js";

let largeUploads = 0;

/** Called after the bot's owner is authenticated. Desktop clients can send the file
 * directly; older clients continue sending a multipart form with one file field. */
export async function receiveUpload(c: Context, botId: string) {
  const request = c.req.raw;
  const rawName = request.headers.get("x-sklubot-filename");
  let rawFilename: string | undefined;
  if (rawName !== null) {
    try { rawFilename = decodeURIComponent(rawName); } catch { /* invalid header */ }
    if (!rawFilename || rawFilename.length > 1024) return c.json({ error: "Invalid file name." }, 400);
  }
  const limit = rawFilename === undefined ? MAX_UPLOAD_BODY : MAX_UPLOAD_BYTES;
  const length = Number(request.headers.get("content-length"));
  const tooLarge = () => c.json({ error: `Files can be up to ${MAX_UPLOAD_MB} MB.` }, 413);
  if (length > limit) return tooLarge();
  if (!request.body) return c.json({ error: "No file was sent." }, 400);
  const large = !length || length > 25_000_000;
  if (large && largeUploads >= 2) {
    c.header("Retry-After", "2");
    return c.json({ error: "Two large files are uploading. Try again shortly." }, 429);
  }
  if (large) largeUploads++;
  try {
    let received = 0;
    const counted = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > limit) throw new RangeError();
        controller.enqueue(chunk);
      },
    }));
    const body = new Response(counted, { headers: request.headers });
    let name: string, bytes: Buffer;
    try {
      if (rawFilename !== undefined) {
        name = rawFilename;
        bytes = Buffer.from(await body.arrayBuffer());
      } else {
        const file = (await body.formData()).get("file");
        if (!(file instanceof File)) return c.json({ error: "No file was sent." }, 400);
        if (file.size > MAX_UPLOAD_BYTES) return tooLarge();
        name = file.name;
        bytes = Buffer.from(await file.arrayBuffer());
      }
    } catch {
      if (received > limit) return tooLarge();
      return c.json({ error: "Could not read the uploaded file." }, 400);
    }
    if (!bytes.length) return c.json({ error: "That file is empty." }, 400);
    return c.json({ attachment: storeBytes(botId, "uploads", name, bytes) });
  } finally {
    if (large) largeUploads--;
  }
}
