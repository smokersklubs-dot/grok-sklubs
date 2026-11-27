// Screenshots of « Chantier » from the dev gallery (section=chantier, fake data: the article → cards example): the whole
// gallery section at 390 and 1440 px, light and dark → docs/screenshots/chantier/.
//
//   node web/scripts/shots-chantier.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.SHOTS ?? join(ROOT, "../docs/screenshots/chantier");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
const browser = await chromium.launch();
try {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    for (const theme of ["light", "dark"]) {
      const mobile = w < 800;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: "fr-FR", colorScheme: theme, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await page.goto(`${base}?dev=gallery&embed=1&section=chantier&theme=${theme}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".chantier-page");
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(OUT, `chantier-${w}-${theme}.png`), fullPage: true });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
