// Screenshots of model health (ModelHealth.tsx: nod items 3 and 4, L59, L60): the banners above the composer (key to
// reconnect, no credit, not answering) and the result lines of a check (testing, ok, refused), from the dev gallery
// (section=banners, fake data; long=1 for long names), at 390 and 1440 px, light and dark → docs/screenshots/model-health/.
//
//   node web/scripts/shots-model-health.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/model-health");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
const browser = await chromium.launch();
try {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    for (const theme of ["light", "dark"]) {
      for (const long of [0, 1]) {
        const mobile = w < 800;
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: "fr-FR", colorScheme: theme });
        const page = await ctx.newPage();
        await page.goto(`${base}?dev=gallery&embed=1&section=banners&theme=${theme}${long ? "&long=1" : ""}`, { waitUntil: "networkidle" });
        await page.waitForSelector(".model-health-banner");
        await page.waitForTimeout(300);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) console.log(`horizontal overflow ${overflow}px at ${w} ${theme} long=${long}`);
        await page.locator(".model-health-banner").first().evaluate((el) => el.parentElement.scrollIntoView({ block: "start" }));
        const box = page.locator("#g-banners");
        await box.screenshot({ path: join(OUT, `model-health-${w}-${theme}${long ? "-long" : ""}.png`) });
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`screenshots in ${OUT}`);
