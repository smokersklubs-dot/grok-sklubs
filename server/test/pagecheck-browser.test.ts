import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L56 in browser mode (no Linux computer: the server's own Chromium through Playwright, when installed): page_publish
// renders the saved page from memory at 390 and 1280 px, with its console errors and the in-page rules.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-pcb-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.DEFAULT_MODEL = "demo:demo";

const { initComputer, browserAvailable, closeAllDesktops } = await import("../src/computer.js");
const { builtinTools } = await import("../src/agent/tools.js");
const { users, bots } = await import("../src/store.js");

test("L56: page_publish checks the page in the server's browser (browser mode)", async (t) => {
  await initComputer();
  if (!browserAvailable()) { t.skip("no browser engine installed"); return; }
  try {
    const user = users.create("pcb@example.com", "PCB", "x", "fr");
    const bot = bots.create(user.id, { name: "Paule" });
    const ctx = { bot, user, tainted: false, depth: 0, signal: new AbortController().signal } as never;
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>P</title><link rel="stylesheet" href="s.css"></head><body><h1>Titre</h1><div class="w">Large</div><script>undefinedFunction()</script></body></html>`;
    const out = await builtinTools().find((x) => x.spec.name === "page_publish")!.run({ name: "p", title: "P", html, visibility: "private", files: [{ path: "s.css", content: ".w { width: 900px; background: #eee }" }] }, ctx);
    const blocks = out.content as { type: string; text?: string }[];
    assert.ok(Array.isArray(blocks) && blocks.length === 2 && blocks[1].type === "image", JSON.stringify(out).slice(0, 400));
    assert.match(blocks[0].text!, /rendered at 390 and 1280 px/);
    assert.match(blocks[0].text!, /Console: 1 error — “Uncaught undefinedFunction is not defined”/);
    assert.match(blocks[0].text!, /At 390 px: the page is \d+ px wide at 390 px: it scrolls sideways \(div\.w goes past the edge\)/, "the page's own CSS file was served");
  } finally { await closeAllDesktops(); }
});
