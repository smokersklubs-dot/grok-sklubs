// Screenshots of « Bot recruteur »: the main bot's proposal card for a new specialist (pending, its limits, created,
// declined), from the dev gallery (section=recruit, fake data), at 390 and 1440 px, light and dark →
// docs/screenshots/recruteur/. One shot of every state together, and one of the pending card alone, also with
// « Modifier » open.
//
//   node web/scripts/shots-recruteur.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/recruteur");
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
      await page.goto(`${base}?dev=gallery&embed=1&section=recruit&theme=${theme}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".recruit-card");
      await page.waitForTimeout(400);
      await page.locator(".recruit-gallery").first().screenshot({ path: join(OUT, `recruit-states-${w}-${theme}.png`) });
      const first = page.locator(".recruit-card").first();
      await first.screenshot({ path: join(OUT, `recruit-card-${w}-${theme}.png`) });
      await first.getByRole("button", { name: "Modifier" }).click();
      await page.waitForTimeout(150);
      await first.screenshot({ path: join(OUT, `recruit-edit-${w}-${theme}.png`) });
      await page.close();
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`screenshots in ${OUT}`);
