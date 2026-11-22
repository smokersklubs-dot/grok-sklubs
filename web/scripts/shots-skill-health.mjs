// Screenshots of « Santé des compétences » (SkillHealth.tsx: L131-L135, Hermes curator): a bot's skill row with its
// health line, « Santé et réglages » open and the with / without bench result, then the team catalogue and the owner's
// view with the curator's card, from the dev gallery (section=skillhealth, fake data), at 390 and 1440 px, light and
// dark → docs/screenshots/skill-health/.
//
//   node web/scripts/shots-skill-health.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/skill-health");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
const browser = await chromium.launch();
try {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    for (const [theme, lang, extra] of [["light", "fr", "&long=1"], ["dark", "en", ""], ["light", "fr", "&empty=1"]]) {
      const mobile = w < 800;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: "fr-FR", colorScheme: theme });
      const page = await ctx.newPage();
      await page.goto(`${base}?dev=gallery&embed=1&section=skillhealth&theme=${theme}&lang=${lang}${extra}`, { waitUntil: "networkidle" });
      await page.waitForSelector("#g-skillhealth");
      if (!extra.includes("empty")) {
        await page.fill(".skh-panel textarea", lang === "fr" ? "Fais le résumé des ventes de la semaine." : "Summarise this week's sales.");
        await page.click(".skh-panel .skh-bench .btn-primary");
        await page.waitForSelector(".skh-bench-grid");
      }
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) console.log(`horizontal overflow ${overflow}px at ${w} ${theme}${extra}`);
      const name = `skill-health-${w}-${theme}${extra.includes("empty") ? "-empty" : extra.includes("long") ? "-long" : ""}.png`;
      await page.locator("#g-skillhealth").screenshot({ path: join(OUT, name) });
      console.log(name);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
