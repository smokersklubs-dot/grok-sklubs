import assert from "node:assert/strict";
import { test } from "node:test";
import { studioTechniques } from "../../server/src/studiotechniques.ts";
import { studioCanvasSource } from "../../server/src/studiocanvassource.ts";
import { techniqueLabels } from "../src/lib/studioTechniques.ts";
import { validStory } from "../src/lib/studioStory.ts";

test("editor and offline player accept the nine saved shot techniques and legacy stories", async () => {
  const js = studioCanvasSource();
  const native = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
  const shot = { text: "Été", seconds: 3, style: "editorial", media: "" };
  const project = { title: "Essai", aspect: "square", audio: "", offset: 0, muted: false, scenes: [shot] };
  assert.deepEqual(Object.keys(techniqueLabels).sort(), [...studioTechniques].sort());
  assert.equal(typeof native.drawFrame, "function");
  for (const validate of [validStory, native.validStory]) {
    assert.ok(validate(project));
    for (const technique of studioTechniques) assert.ok(validate({ ...project, scenes: [{ ...shot, technique }] }));
    assert.equal(validate({ ...project, scenes: [{ ...shot, technique: "unknown" }] }), false);
  }
});
