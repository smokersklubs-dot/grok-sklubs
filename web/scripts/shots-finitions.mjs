// Screenshots of L161 (second half) — GalleryFinish.tsx: themes proposed by the bots, the recap of the whole team, the
// queue line of a shared computer, the app with an applied theme; and the server's safe-mode card (diskboot.ts) — at
// 390 and 1440 px, light and dark → docs/screenshots/finitions/. Fails on a page error or a horizontal overflow.
//
//   SAFE_MODE_HTML=/path/to/safe.html node web/scripts/shots-finitions.mjs   (the card's HTML, written by the server's safeModePage)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/finitions");
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
      const shot = async (name, url, full = true) => {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: "fr-FR", colorScheme: theme });
        const page = await ctx.newPage();
        page.on("pageerror", (e) => problems.push(`${name} ${w} ${theme}: ${e.message}`));
        await page.goto(url, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) problems.push(`${name} ${w} ${theme}: horizontal overflow ${overflow}px`);
        await page.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`), fullPage: full });
        await ctx.close();
      };
      const g = (q) => `${base}?dev=gallery&embed=1&section=finitions&theme=${theme}${q}`;
      await shot("finitions", g(""));
      await shot("finitions-long", g("&long=1"));
      await shot("finitions-vide", g("&empty=1"));
      await shot("finitions-applique", g("&view=applied"));
      if (process.env.SAFE_MODE_HTML) await shot("mode-sur", pathToFileURL(process.env.SAFE_MODE_HTML).href, false);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log(`Screenshots in ${OUT}`);
