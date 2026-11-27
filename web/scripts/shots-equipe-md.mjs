// Screenshots of « Équipe Sklubot (.md) »: the review screen of a team file, the same file imported again (« Mettre à
// jour » / « Créer une copie »), the first step (file, text or link) and « Partager en fichier .md », from the dev
// gallery (section=equipe, fake data), at 390 and 1440 px, light and dark → docs/screenshots/equipe-md/.
//
//   node web/scripts/shots-equipe-md.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/equipe-md");
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
      for (const view of ["review", "update", "choose", "share"]) {
        const page = await ctx.newPage();
        await page.goto(`${base}?dev=gallery&embed=1&section=equipe&view=${view}&theme=${theme}`, { waitUntil: "networkidle" });
        await page.waitForSelector(".tmd-modal");
        if (view === "share") await page.waitForSelector(".tmd-file");
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(OUT, `${view}-${w}-${theme}.png`) });
        // The whole review, scrolled through: the modal's body as one tall picture.
        if (view === "review") {
          await page.evaluate(() => { for (const d of document.querySelectorAll(".tmd-modal details")) d.open = true; });
          await page.locator(".tmd-modal .modal-body").evaluate((el) => { el.style.maxHeight = "none"; el.style.overflow = "visible"; });
          await page.locator(".tmd-modal").evaluate((el) => { el.style.maxHeight = "none"; });
          await page.locator(".tmd-modal").screenshot({ path: join(OUT, `review-full-${w}-${theme}.png`) });
        }
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
