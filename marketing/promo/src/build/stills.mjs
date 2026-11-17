// Renders a few stills to check the layout: node stills.mjs <outDir> <mode h|v> <t1> <t2> ...
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
const [outDir, mode, ...times] = process.argv.slice(2);
const page_ = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html")).href;
const W = mode === "v" ? 1080 : 1920, H = mode === "v" ? 1920 : 1080;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${page_}?mode=${mode}&render=1`);
await page.evaluate(() => document.fonts.ready);
for (const t of times) {
  await page.evaluate((t) => window.renderAt(t), +t);
  await page.screenshot({ path: join(outDir, `${mode}-${t}.png`), clip: { x: 0, y: 0, width: W, height: H } });
}
if (errors.length) console.log("ERRORS", errors);
await browser.close();
