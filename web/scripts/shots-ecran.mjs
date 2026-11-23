// Screenshots of the bot's screen view (L149) and the real-time voice option (L167): from the dev gallery (section=ecran,
// fake data), at 390 and 1440 px, light and dark → docs/screenshots/ecran/.
//
//   node web/scripts/shots-ecran.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/ecran");
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
      await page.goto(`${base}?dev=gallery&embed=1&section=ecran&long=1&theme=${theme}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".gallery-screens");
      await page.waitForTimeout(400);
      await page.locator(".gallery-screens").screenshot({ path: join(OUT, `ecran-etats-${w}-${theme}.png`) });
      await page.locator(".gallery-realtime").screenshot({ path: join(OUT, `voix-temps-reel-${w}-${theme}.png`) });
      await page.close();
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
