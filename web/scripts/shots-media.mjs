// Screenshots of Settings → Keys → « Création (images et vidéos) » (MediaKeys.tsx, gallery section=creation; audit Open
// Generative AI): Wan2GP on the owner's PC, own keys, recent runs — at 390 and 1440 px, light and dark →
// docs/screenshots/media/.
//
//   node web/scripts/shots-media.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/media");
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
      const shot = async (name, query, prepare) => {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: "fr-FR", colorScheme: theme });
        const page = await ctx.newPage();
        page.on("pageerror", (e) => problems.push(`${name} ${w} ${theme}: ${e.message}`));
        await page.goto(`${base}?dev=gallery&embed=1&section=creation&theme=${theme}${query}`, { waitUntil: "networkidle" });
        await page.waitForSelector(".media-keys", { timeout: 6000 }).catch(() => problems.push(`${name} ${w} ${theme}: no section`));
        if (prepare) await prepare(page);
        await page.waitForTimeout(300);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) problems.push(`${name} ${w} ${theme}: horizontal overflow ${overflow}px`);
        await page.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`), fullPage: true });
        await ctx.close();
      };
      await shot("media", "");
      await shot("long", "&long=1");
      await shot("empty", "&empty=1");
      await shot("url", "", async (page) => { await page.getByRole("radio", { name: /Adresse d'un serveur/ }).click(); });
    }
  }
} finally {
  await browser.close();
  await server.close();
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log(`screenshots in ${OUT}`);
