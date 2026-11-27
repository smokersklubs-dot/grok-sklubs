// Screenshots of wave 10 rows (GalleryComfort10.tsx): « pas à pas » cards and the setup list (L153, L145), engine
// warm-up lines (L145), a plan for the work board and « Proposer un bot » (L163), the 2×2 chat grid and « Dispositions »
// (L146) — at 390 and 1440 px, light and dark → docs/screenshots/confort10/.
//
//   node web/scripts/shots-confort10.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/confort10");
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
      const shot = async (name, query, prepare, full = true) => {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: "fr-FR", colorScheme: theme });
        const page = await ctx.newPage();
        page.on("pageerror", (e) => problems.push(`${name} ${w} ${theme}: ${e.message}`));
        await page.goto(`${base}?dev=gallery&embed=1&section=confort10&theme=${theme}${query}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(500);
        if (prepare) await prepare(page);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) problems.push(`${name} ${w} ${theme}: horizontal overflow ${overflow}px`);
        await page.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`), fullPage: full });
        await ctx.close();
      };
      const need = (page, sel, name, n = 1) => page.waitForSelector(sel, { timeout: 4000 }).then(async () => { const c = await page.locator(sel).count(); if (c < n) problems.push(`${name} ${w} ${theme}: ${c} × ${sel}, expected ${n}`); }).catch(() => problems.push(`${name} ${w} ${theme}: missing ${sel}`));
      await shot("guides", "&long=1", async (page) => { await need(page, ".stepguide-card", "guides", 3); await need(page, ".warmup-line", "guides", 3); await need(page, ".setup-offer", "guides"); });
      await shot("plan", "&view=plan&long=1", async (page) => {
        await need(page, ".boardplan-card", "plan", 2);
        await page.locator(".boardplan-check").nth(2).uncheck();
        const label = await page.locator(".boardplan-card .btn-accent").first().innerText();
        if (!/\(2\)/.test(label)) problems.push(`plan ${w} ${theme}: create button says "${label}"`);
      });
      await shot("roles", "&view=roles", async (page) => { await page.locator(".wb-roles summary").click(); await need(page, ".wb-propose", "roles", 4); });
      if (!mobile) await shot("grid", "&view=grid&long=1", async (page) => { await need(page, ".side-chat", "grid", 3); }, false);
      await shot("layouts", "&view=layouts&long=1", async (page) => { await need(page, ".chat-layouts-item", "layouts", 2); }, false);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(problems.length ? `Problems:\n${problems.join("\n")}` : `OK: screenshots in ${OUT}`);
process.exit(problems.length ? 1 : 0);
