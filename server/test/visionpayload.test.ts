import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { MAX_VISION_INPUT, readVisionRequest, visionPayload } from "../src/visionpayload.js";

test("seven large photos survive a resumed conversation, including image tool results", async () => {
  const original = await sharp(randomBytes(1100 * 1050 * 3), { raw: { width: 1100, height: 1050, channels: 3 } }).png().toBuffer();
  const url = "data:image/png;base64," + original.toString("base64");
  const photo = () => ({ type: "input_image", image_url: url });
  const body = { input: [{ role: "user", content: [photo(), photo(), photo()] },
    { type: "function_call_output", output: [photo(), photo(), photo(), photo()] },
    { role: "user", content: [{ type: "input_text", text: "Cherche sur GitHub" }] }] };
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 21 * 1024 * 1024);
  const compact = await visionPayload(body);
  assert.ok(compact && Buffer.byteLength(compact) < 20 * 1024 * 1024);
  const [first, tool, last] = JSON.parse(compact).input;
  const images = [...first.content, ...tool.output];
  assert.equal(images.length, 7);
  for (const image of images) {
    assert.match(image.image_url, /^data:image\/jpeg;base64,/);
    assert.equal((await sharp(Buffer.from(image.image_url.split(",")[1], "base64")).metadata()).width, 1100);
  }
  assert.equal(last.content[0].text, "Cherche sur GitHub");
  assert.equal((await sharp(original).metadata()).format, "png");
});

test("small requests retain their content and the two limits also apply to requests without images", async () => {
  const small = { input: [{ role: "user", content: [{ type: "input_text", text: "Bonjour" }] }] };
  assert.equal(await visionPayload(small), JSON.stringify(small));
  assert.equal(await visionPayload({ input: [], instructions: "x".repeat(21 * 1024 * 1024) }), null);
  const req = new Request("http://local/", { method: "POST", body: "{}", headers: { "content-length": String(MAX_VISION_INPUT + 1) } });
  await assert.rejects(readVisionRequest(req), RangeError);
  assert.deepEqual(await readVisionRequest(new Request("http://local/", { method: "POST", body: '{"ok":true}' })), { ok: true });
});
