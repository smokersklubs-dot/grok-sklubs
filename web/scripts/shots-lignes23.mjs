// Screenshots of the 23/11 rows (GalleryRows23.tsx, gallery section=lignes23): « Retiens surtout », documents and site
// notes, « Réponses courtes », « Pourquoi ? », project review rules, several reviewers, « Faire corriger par l'auteur »,
// « Veille » and the Atom feed — at 390 and 1440 px, light and dark, normal / long / empty → docs/screenshots/lignes23/.
//
//   node web/scripts/shots-lignes23.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/lignes23");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
const browser = await chromium.launch();
const problems = [];
try {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    for (const theme of ["light", "dark"]) {
      const mobile = w < 800;
      for (const [name, query] of [["normal", ""], ["long", "&long=1"], ["vide", "&empty=1"]]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: "fr-FR", colorScheme: theme });
        const page = await ctx.newPage();
        page.on("pageerror", (e) => problems.push(`${name} ${w} ${theme}: ${e.message}`));
        await page.goto(`${base}?dev=gallery&embed=1&section=lignes23&theme=${theme}${query}`, { waitUntil: "networkidle" });
        await page.waitForSelector(".mem-places", { timeout: 6000 }).catch(() => problems.push(`${name} ${w} ${theme}: nothing rendered`));
        for (const d of await page.locator("details").all()) await d.evaluate((el) => { el.open = true; });
        await page.waitForTimeout(400);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) problems.push(`${name} ${w} ${theme}: horizontal overflow ${overflow}px`);
        await page.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`), fullPage: true });
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log(`ok: screenshots in ${OUT}`);
