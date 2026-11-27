// Screenshots of wave 7 comfort (GalleryComfort7.tsx): chat with the bell, a pinned and a deleted message, the model
// chip and the context gauge; a new bot's welcome; « Conversations »; the danger zone and the trash; the Office
// viewers; page exports and « Comparer » — at 390 and 1440 px, light and dark → docs/screenshots/confort7/.
//
//   node web/scripts/shots-confort7.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/confort7");
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
        await page.goto(`${base}?dev=gallery&embed=1&section=confort7&theme=${theme}${query}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(500);
        if (prepare) await prepare(page);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) problems.push(`${name} ${w} ${theme}: horizontal overflow ${overflow}px`);
        await page.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`) });
        await ctx.close();
      };
      const need = (page, sel, name) => page.waitForSelector(sel, { timeout: 4000 }).catch(() => problems.push(`${name} ${w} ${theme}: missing ${sel}`));
      await shot("chat", "&long=1", async (page) => { await need(page, ".composer-meta", "chat"); await need(page, ".pinned-strip", "chat"); });
      await shot("bell", `&long=1${mobile ? "&nav=1" : ""}&bell=1`, async (page) => { await page.waitForTimeout(500); await need(page, ".bell-pop", "bell"); });
      await shot("welcome", "&view=welcome", async (page) => { await need(page, ".welcome-choice", "welcome"); });
      await shot("convs", "&view=convs&long=1", async (page) => { await need(page, ".conv", "convs"); });
      await shot("trash", "&view=trash&long=1", async (page) => { await page.getByText(/Voir ce qui sera supprimé/).click().catch(() => {}); await need(page, ".trash-preview", "trash"); });
      await shot("office", "&view=office&long=1", async (page) => { await need(page, ".slide-card", "office"); });
      await shot("pages", "&view=pages&long=1", async (page) => { await page.getByText("Comparer").click(); await need(page, ".diff-body", "pages"); });
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(problems.length ? `Problems:\n${problems.join("\n")}` : `OK: screenshots in ${OUT}`);
process.exit(problems.length ? 1 : 0);
