// Screenshots of L150 / L154 (GalleryModelVoice.tsx in the « écran et appels » section, and the reasoning chip above the
// composer in the wave-7 chat) — at 390 and 1440 px, light and dark → docs/screenshots/voix-modeles/.
//
//   node web/scripts/shots-voix-modeles.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.SHOTS_OUT || join(ROOT, "../docs/screenshots/voix-modeles");
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
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: "fr-FR", colorScheme: theme });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => problems.push(`${w} ${theme}: ${e.message}`));
      await page.goto(`${base}?dev=gallery&embed=1&section=ecran&theme=${theme}&long=1`, { waitUntil: "networkidle" });
      await page.waitForSelector(".gallery-modelvoice", { timeout: 5000 }).catch(() => problems.push(`${w} ${theme}: missing .gallery-modelvoice`));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) problems.push(`settings ${w} ${theme}: horizontal overflow ${overflow}px`);
      await page.locator(".gallery-modelvoice").screenshot({ path: join(OUT, `reglages-${w}-${theme}.png`) });
      await page.goto(`${base}?dev=gallery&embed=1&section=confort7&theme=${theme}&long=1`, { waitUntil: "networkidle" });
      await page.waitForSelector(".composer-reason", { timeout: 5000 }).catch(() => problems.push(`${w} ${theme}: missing .composer-reason`));
      const o2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (o2 > 1) problems.push(`chat ${w} ${theme}: horizontal overflow ${o2}px`);
      await page.locator(".composer-reason").click().catch(() => problems.push(`${w} ${theme}: cannot open the reasoning menu`));
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, `reflexion-${w}-${theme}.png`) });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(problems.length ? `Problems:\n${problems.join("\n")}` : `OK: screenshots in ${OUT}`);
process.exit(problems.length ? 1 : 0);
