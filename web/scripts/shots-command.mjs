// Screenshots of « Centre de commandement » from the dev gallery (section=command, fake data): the whole page at 390, 768
// and 1440 px, light and dark, plus the exchange of a link open (1440) → docs/screenshots/commandement/.
//
//   node web/scripts/shots-command.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/commandement");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
const browser = await chromium.launch();
try {
  for (const [w, h] of [[390, 844], [768, 1024], [1440, 900]]) {
    for (const theme of ["light", "dark"]) {
      const mobile = w < 800;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, locale: "fr-FR", colorScheme: theme, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await page.goto(`${base}?dev=gallery&embed=1&section=command&theme=${theme}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".cmd-card");
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(OUT, `command-${w}-${theme}.png`), fullPage: true });
      if (w === 1440) {
        await page.locator(".cmd-collab-row").first().click();
        await page.waitForSelector(".cmd-exchange");
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(OUT, `exchange-${w}-${theme}.png`) });
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`screenshots in ${OUT}`);
