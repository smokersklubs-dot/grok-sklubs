import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { animationSources, animationSourceUrl, createAnimationGuideReader, describeAnimationSource } from "../src/animationreferences.js";
import { studioTechniques } from "../src/studiotechniques.js";

test("each Studio technique points to one immutable guide and an upstream license", () => {
  assert.deepEqual(animationSources.map(source => source.id).sort(), [...studioTechniques].sort());
  for (const source of animationSources) {
    assert.match(source.rev, /^[a-f\d]{40}$/);
    assert.match(source.blob, /^[a-f\d]{40}$/);
    const details = describeAnimationSource(source);
    assert.ok(details.includes(animationSourceUrl(source)));
    assert.ok(details.includes(animationSourceUrl(source, "LICENSE")));
    assert.ok(details.includes(`technique to "${source.id}"`));
  }
  assert.ok(describeAnimationSource(animationSources[8]).includes("/NOTICE"));
});

test("root and nested guides are fetched only from the pinned tree, paginated without splitting Unicode and reused", async () => {
  const text = "x".repeat(3999) + "🎬" + " fin du guide";
  const bytes = Buffer.from(text);
  const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  const fixtures = [animationSources[1], animationSources[4]].map(s => ({ ...s, blob }));
  const urls: string[] = [];
  const read = createAnimationGuideReader(fixtures, async (input, init) => {
    urls.push(String(input));
    assert.equal(init?.redirect, "error");
    return new Response(bytes);
  });
  for (const source of fixtures) {
    const [first, last] = await Promise.all([read(source.id, 1), read(source.id, 2)]);
    assert.match(first, /1\/2 · next source_page: 2/);
    assert.ok(first.endsWith("🎬"));
    assert.ok(last.endsWith(" fin du guide"));
    await assert.rejects(() => read(source.id, 3), /between 1 and 2/);
  }
  assert.deepEqual(urls, fixtures.map(s => `https://raw.githubusercontent.com/${s.repo}/${s.rev}/${s.entry}`));
});

test("invalid ids and pages are rejected before network access, failed verification can be retried", async () => {
  const source = animationSources[0];
  const text = "pinned text";
  const bytes = Buffer.from(text);
  const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  let calls = 0;
  const read = createAnimationGuideReader([{ ...source, blob }], async () => {
    calls++;
    if (calls === 1) return new Response("Unavailable", { status: 503 });
    if (calls === 2) return new Response("unexpected bytes");
    if (calls === 3) return new Response(new Uint8Array(1024 * 1024 + 1));
    return new Response(bytes);
  });
  await assert.rejects(() => read("https://example.test", 1));
  await assert.rejects(() => read(source.id, 0));
  await assert.rejects(() => read(source.id, 1.5));
  assert.equal(calls, 0);
  await assert.rejects(() => read(source.id, 1), /GitHub/);
  await assert.rejects(() => read(source.id, 1), /differs from/);
  await assert.rejects(() => read(source.id, 1), /size limit/);
  assert.ok((await read(source.id, 1)).endsWith(text));
  assert.equal(calls, 4);
});
