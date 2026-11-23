// Screenshots of wave 7 extensions from the dev gallery (section=extensions, fake data): « Documents partagés » (list,
// editor with history and a past version), the live vault panel, a bot's plugins and other agents — 390 and 1440 px,
// light and dark → docs/screenshots/extensions/.
//
//   node web/scripts/shots-extensions.mjs    (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.OUT || join(ROOT, "../docs/screenshots/extensions");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
const browser = await chromium.launch();
try {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    for (const theme of ["light", "dark"]) {
      const mobile = w < 800;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: "fr-FR", colorScheme: theme });
      const page = await ctx.newPage();
      const go = (q) => page.goto(`${base}?dev=gallery&embed=1&section=extensions&theme=${theme}&long=1${q}`, { waitUntil: "networkidle" });
      await go("");
      await page.waitForSelector(".livedoc-list");
      await page.screenshot({ path: join(OUT, `liste-${w}-${theme}.png`), fullPage: true });
      await go("&view=editor");
      await page.waitForSelector(".livedoc-text");
      await page.getByRole("button", { name: /Historique/ }).click();
      await page.waitForSelector(".livedoc-change");
      await page.getByRole("button", { name: "Voir" }).first().click();
      await page.waitForSelector(".livedoc-past");
      await page.screenshot({ path: join(OUT, `document-${w}-${theme}.png`), fullPage: true });
      await go("&view=settings");
      await page.waitForSelector(".ext-plugin");
      await page.screenshot({ path: join(OUT, `reglages-${w}-${theme}.png`), fullPage: true });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`screenshots in ${OUT}`);
