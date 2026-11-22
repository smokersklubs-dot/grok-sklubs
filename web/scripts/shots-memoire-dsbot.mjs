// Screenshots of the memory marks (pin, end date) and the group notes (audit DS-Bot #58 #81 #82): from the dev gallery
// (sections memoire and salons, fake data), at 390 and 1440 px, light and dark → docs/screenshots/memoire-dsbot/.
//
//   node web/scripts/shots-memoire-dsbot.mjs   (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/memoire-dsbot");
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
      await page.goto(`${base}?dev=gallery&embed=1&section=memoire&theme=${theme}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".memory-edit-marks");
      await page.waitForTimeout(300);
      await page.locator(".memory-edit").first().screenshot({ path: join(OUT, `note-marques-${w}-${theme}.png`) });
      await page.goto(`${base}?dev=gallery&embed=1&section=salons&theme=${theme}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".room-notes");
      await page.waitForTimeout(300);
      await page.locator(".room-notes").screenshot({ path: join(OUT, `notes-groupe-${w}-${theme}.png`) });
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (wide) console.log(`WIDER THAN SCREEN at ${w} ${theme}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`screenshots in ${OUT}`);
