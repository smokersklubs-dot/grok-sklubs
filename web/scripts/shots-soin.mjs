// Screenshots of L161 bot care (GalleryCare.tsx): a bot's settings (photo, shared role, identity, set aside, what it can
// read and write), Settings → Team (instructions for every bot, shared roles, shortcuts to revisit, missing
// capabilities), the app with photos and the « capacité manquante » card — at 390 and 1440 px, light and dark →
// docs/screenshots/soin/.
//
//   node web/scripts/shots-soin.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/soin");
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
        await page.goto(`${base}?dev=gallery&embed=1&section=soin&theme=${theme}${query}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(500);
        if (prepare) await prepare(page);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) problems.push(`${name} ${w} ${theme}: horizontal overflow ${overflow}px`);
        await page.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`), fullPage: true });
        await ctx.close();
      };
      const need = (page, sel, name) => page.waitForSelector(sel, { timeout: 4000 }).catch(() => problems.push(`${name} ${w} ${theme}: missing ${sel}`));
      await shot("bot", "&long=1", async (page) => { await need(page, ".care-photo-img", "bot"); await need(page, ".care-doc", "bot"); await need(page, ".care-fam", "bot"); });
      await shot("bot-empty", "&empty=1", async (page) => { await need(page, ".care-photo-empty", "bot-empty"); });
      await shot("team", "&view=team&long=1", async (page) => { await need(page, ".care-doc.is-due", "team"); });
      await shot("team-empty", "&view=team&empty=1", async (page) => { await need(page, ".care-empty", "team-empty"); });
      await shot("chat", `&view=chat${mobile ? "&nav=1" : ""}`, async (page) => { await need(page, ".bot-photo img", "chat"); });
      if (!mobile) await shot("chat-card", "&view=chat", async (page) => { await page.getByText(/Ouvrir Réglages › Équipe/).first().waitFor({ timeout: 4000 }).catch(() => problems.push(`chat-card ${w} ${theme}: no team button`)); });
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(problems.length ? `Problems:\n${problems.join("\n")}` : `OK: screenshots in ${OUT}`);
process.exit(problems.length ? 1 : 0);
