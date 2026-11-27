import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// The demo model answers in the account's language: it reads the prompt's language line (agent/nodguidance.ts
// languageLine). The Android end-to-end test (mobile/e2e/flows/03-discussion.yaml) waits for the French reply.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-demolang-"));
process.env.SESSION_SECRET = "demo-language-secret-demo-language-01";
process.env.NO_SCHEDULER = "1";

const { DemoProvider } = await import("../src/llm/demo.js");
const { languageLine } = await import("../src/agent/nodguidance.js");

async function replyTo(system: string): Promise<string> {
  const demo = new DemoProvider();
  const req = { system, messages: [{ role: "user", content: [{ type: "text", text: "Bonjour, test automatique" }] }], tools: [{ name: "remember", description: "", inputSchema: { type: "object" } }] } as never;
  const out = await demo.runTurn(req);
  return out.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ");
}

test("demo model: a French account gets the French demo reply; another language gets English", async () => {
  const bot = { id: "bot_none", generation: 0 };
  assert.match(await replyTo(languageLine(bot, "fr")), /modèle de démonstration/);
  assert.match(await replyTo(languageLine(bot, "en")), /demo model/);
});
