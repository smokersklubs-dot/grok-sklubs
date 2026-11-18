// Screenshots of « Coordinateur d'échecs »: the failure cards (every status), the « Incidents » section of the Activité
// tab and the summary on « Aujourd'hui », from the dev gallery (section=incidents / section=today, fake data), at 390 and
// 1440 px, light and dark → docs/screenshots/incidents/.
//
//   node web/scripts/shots-incidents.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/incidents");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
const browser = await chromium.launch();
// [file name, gallery query, element to capture]
const SHOTS = [
  ["incidents-section", "section=incidents", ".incidents"],
  ["failure-cards", "section=incidents", ".gallery-cards"],
  ["today-summary", "section=today", ".failure-summary"],
];
try {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    for (const theme of ["light", "dark"]) {
      const mobile = w < 800;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: "fr-FR", colorScheme: theme });
      for (const [name, q, sel] of SHOTS) {
        const page = await ctx.newPage();
        await page.goto(`${base}?dev=gallery&embed=1&${q}&theme=${theme}`, { waitUntil: "networkidle" });
        await page.waitForSelector(sel);
        await page.waitForTimeout(400);
        // Aujourd'hui scrolls inside its own panel: the summary is brought into view and the screen is taken as seen.
        if (name === "today-summary") { await page.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(200); await page.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`) }); }
        else await page.locator(sel).first().screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`) });
        await page.close();
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`screenshots in ${OUT}`);
