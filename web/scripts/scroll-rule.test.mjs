// « Doit marcher »: the scroll rule of check:responsive (scroll-rule.mjs) on small pages built for it, in Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { scrollTrap } from "./scroll-rule.mjs";

let chromium = null;
try { ({ chromium } = await import("playwright")); } catch { /* not installed */ }
const LONG = Array.from({ length: 80 }, (_, i) => `<p>Message ${i + 1}</p>`).join("");

test("scroll rule: a page or a column that scrolls passes; content trapped behind overflow hidden fails", { skip: !chromium && "Playwright is not installed" }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
    const run = async (html) => { await page.setContent(html); return page.evaluate(`(${scrollTrap.toString()})()`); };
    assert.deepEqual(await run(`<body>${LONG}</body>`), [], "a long page");
    assert.deepEqual(await run(`<body style="margin:0;height:100vh;overflow:hidden"><div id="chat" style="height:100%;overflow-y:auto">${LONG}</div></body>`), [], "a chat column that scrolls");
    assert.match((await run(`<body style="margin:0"><div id="list" style="height:300px;overflow:hidden">${LONG}</div></body>`))[0], /inside div#list \(overflow-y: hidden\)/);
    assert.deepEqual(await run(`<body>${LONG}<details><summary>Plus</summary><p>Caché</p></details></body>`), [], "a folded <details> is not out of reach");
    assert.match((await run(`<html style="overflow:hidden"><body>${LONG}</body></html>`))[0], /the page itself does not scroll/);
  } finally { await browser.close(); }
});
