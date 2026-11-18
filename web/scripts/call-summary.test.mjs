// A voice call's summary under "Voice call ended" (web/src/lib/callSummary.ts): a sentence is shown, internal JSON never.
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { isHumanSummary } from "../src/lib/callSummary.ts";

test("a plain sentence is shown", () => {
  assert.equal(isHumanSummary("Léa a demandé un point sur le devis et ils ont convenu de l'envoyer demain."), true);
});

test("the memory pass's JSON and other structured answers are hidden", () => {
  for (const s of ['{"facts": []}', ' {"facts":[{"text":"x","quote":"y"}]} ', "[]", "[1, 2]", "```json\n{}\n```", '"facts": []', "", "   ", "{}", "42", null, undefined, 3])
    assert.equal(isHumanSummary(s), false, String(s));
});
