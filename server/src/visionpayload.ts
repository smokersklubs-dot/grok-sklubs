import sharp from "sharp";

const MiB = 1024 * 1024;
export const MAX_VISION_INPUT = 160 * MiB;
// Shared by direct model messages and the two subscription CLIs. This is a budget for
// previews of one user message; the original media always remains in the bot library.
export const PREVIEW_BATCH_BYTES = 6 * MiB;

export async function imagePreview(bytes: Buffer, targetBytes: number): Promise<Buffer> {
  const img = sharp(bytes, { limitInputPixels: 80_000_000, failOn: "error" });
  if (!["png", "jpeg", "webp", "gif"].includes((await img.metadata()).format ?? "")) throw new Error("Unsupported image");
  let best: Buffer | undefined;
  for (const edge of [1920, 1280, 800, 512]) {
    const preview = await img.clone().rotate().resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    if (!best || preview.length < best.length) best = preview;
    if (best.length <= targetBytes) break;
  }
  return best!;
}
const MAX_FORWARD = 20 * MiB;

/** Codex can send the full image history on resume, including images returned by tools. */
export async function visionPayload(body: Record<string, unknown>): Promise<string | null> {
  const parts: { image_url: string }[] = [];
  for (const item of body.input as Record<string, unknown>[]) {
    for (const field of [item.content, item.output]) {
      if (!Array.isArray(field)) continue;
      for (const p of field) {
        if (p?.type === "input_image" && typeof p.image_url === "string" && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(p.image_url)) parts.push(p);
      }
    }
  }
  const imageChars = parts.reduce((sum, p) => sum + p.image_url.length, 0);
  const imageParts = new Set(parts);
  const otherBytes = Buffer.byteLength(JSON.stringify(body, function (key, value) {
    return key === "image_url" && imageParts.has(this) ? "" : value;
  }));
  const allowance = Math.min(8 * MiB, MAX_FORWARD - otherBytes);
  if (otherBytes > MAX_FORWARD) return null;
  if (imageChars > allowance) {
    const perImage = Math.floor(allowance / parts.length);
    for (const p of parts) {
      if (p.image_url.length <= perImage) continue;
      const bytes = Buffer.from(p.image_url.slice(p.image_url.indexOf(",") + 1), "base64");
      const preview = await imagePreview(bytes, Math.max(1, Math.floor((perImage - 23) * 3 / 4)));
      const url = "data:image/jpeg;base64," + preview.toString("base64");
      if (url.length < p.image_url.length) p.image_url = url;
    }
  }
  const json = JSON.stringify(body);
  return Buffer.byteLength(json) <= MAX_FORWARD ? json : null;
}

/** Enforce the wire limit while reading, including when the CLI uses chunked transfer. */
export async function readVisionRequest(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_VISION_INPUT) throw new RangeError();
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_VISION_INPUT) { await reader.cancel(); throw new RangeError(); }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally { reader.releaseLock(); }
  chunks.push(decoder.decode());
  return JSON.parse(chunks.join(""));
}
