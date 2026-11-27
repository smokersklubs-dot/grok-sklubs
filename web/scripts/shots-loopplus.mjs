// Screenshots of the loop-and-turns wave of 23/11 (GalleryLoopPlus.tsx, section=boucle): « Envoyer maintenant » (L58),
// « Relire mon plan contre ma demande » opened (L79), the model modes (L69) and « Qui peut demander à qui » (L96) — at
// 390 and 1440 px, light and dark, French and English → the folder given as first argument (default: docs/screenshots/boucle).
//
//   node web/scripts/shots-loopplus.mjs [out-dir]     (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, "../docs/screenshots/boucle");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
const browser = await chromium.launch();
const problems = [];
try {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    for (const [theme, lang, extra] of [["light", "fr", "&long=1"], ["dark", "en", ""], ["light", "fr", "&empty=1"]]) {
      const mobile = w < 800;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: "fr-FR", colorScheme: theme });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => problems.push(`${w} ${theme}: ${e.message}`));
      await page.goto(`${base}?dev=gallery&embed=1&section=boucle&theme=${theme}&lang=${lang}${extra}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      const review = page.locator(".plan-review-open");
      if (await review.count()) { await review.click(); await page.waitForSelector(".plan-review", { timeout: 4000 }).catch(() => problems.push(`${w} ${theme}: no review`)); }
      const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (sw > 1) problems.push(`${w} ${theme} ${lang}${extra}: ${sw}px sideways`);
      await page.screenshot({ path: join(OUT, `boucle-${w}-${theme}-${lang}${extra.replace(/[&=]/g, "")}.png`), fullPage: true });
      await ctx.close();
    }
  }
} finally { await browser.close(); await server.close(); }
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log("ok", OUT);
