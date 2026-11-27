// Screenshots of Bot settings → « Canaux » (BotChannels.tsx, L162) from the dev gallery (section=canaux, fake data), at
// 390 and 1440 px, light and dark, filled and empty → docs/screenshots/canaux/.
//
//   node web/scripts/shots-canaux.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/canaux");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
const browser = await chromium.launch();
try {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    for (const theme of ["light", "dark"]) {
      for (const variant of ["", "&empty=1"]) {
        const mobile = w < 800;
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: "fr-FR", colorScheme: theme });
        const page = await ctx.newPage();
        await page.goto(`${base}?dev=gallery&embed=1&section=canaux&theme=${theme}${variant}`, { waitUntil: "networkidle" });
        await page.waitForSelector(".bot-channels .channels-card");
        await page.locator(".channels-details").evaluateAll((els) => els.forEach((e) => { e.open = true; }));
        await page.locator(".bot-channels").first().screenshot({ path: join(OUT, `canaux-${w}-${theme}${variant ? "-vide" : ""}.png`) });
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`screenshots in ${OUT}`);
