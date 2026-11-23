// Screenshots of L91 (« fais-le toi-même » card, hidden code box), L95 (computer hours), L83 (mail signature) and L149
// (click marks), from the dev gallery, at 390 and 1440 px, light and dark → docs/screenshots/browser-infra/.
//
//   node web/scripts/shots-browser-infra.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.SHOTS_OUT || join(ROOT, "../docs/screenshots/browser-infra");
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
      const shot = async (name, query, selector) => {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: "fr-FR", colorScheme: theme });
        const page = await ctx.newPage();
        page.on("pageerror", (e) => problems.push(`${name} ${w} ${theme}: ${e.message}`));
        await page.goto(`${base}?dev=gallery&embed=1&theme=${theme}${query}`, { waitUntil: "networkidle" });
        await page.waitForSelector(selector, { timeout: 8000 }).catch(() => problems.push(`${name} ${w} ${theme}: no ${selector}`));
        await page.waitForTimeout(300);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) problems.push(`${name} ${w} ${theme}: horizontal overflow ${overflow}px`);
        const el = page.locator(selector).first();
        await el.scrollIntoViewIfNeeded().catch(() => undefined);
        await page.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`), fullPage: name.startsWith("cards") });
        await ctx.close();
      };
      await shot("cards-code", "&section=cards&type=code", ".code-card");
      await shot("cards-code-long", "&section=cards&type=code&long=1", ".code-card");
      await shot("cards-takeover", "&section=cards&type=takeover", ".takeover-card");
      await shot("hours", "&section=routines", ".chours");
      await shot("screen", "&section=ecran", ".mail-signature");
      await shot("clicks", "&section=ecran", ".click-trail");
      await shot("screen-long", "&section=ecran&long=1", ".mail-signature");
    }
  }
} finally {
  await browser.close();
  await server.close();
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log(`screenshots → ${OUT}`);
