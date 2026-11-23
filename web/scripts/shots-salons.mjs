// Screenshots of « Qui répond » in group chats (agent/roomrouting.ts): from the dev gallery (section=salons, fake
// data), at 390 and 1440 px, light and dark → docs/screenshots/salons/. The conversation with its routed lines, the same
// with « Réassigner » open (L155: owner, Archiver, Restaurer, time limits), and the group's settings (Qui répond, Discret, Proposer avant de commencer).
//
//   node web/scripts/shots-salons.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/salons");
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
      const page = await ctx.newPage();
      await page.goto(`${base}?dev=gallery&embed=1&section=salons&theme=${theme}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".room-who-switches");
      await page.waitForTimeout(400);
      await page.locator(".rooms-chat").screenshot({ path: join(OUT, `salon-conversation-${w}-${theme}.png`) });
      await page.locator(".rooms-settings").screenshot({ path: join(OUT, `salon-reglages-${w}-${theme}.png`) });
      await page.getByRole("button", { name: "Réassigner" }).first().click();
      await page.waitForTimeout(200);
      const notice = page.locator(".notice:has(.route-actions)").first();
      await notice.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.screenshot({ path: join(OUT, `salon-redemander-${w}-${theme}.png`), clip: await (async () => { const b = await notice.boundingBox(); return { x: 0, y: Math.max(0, b.y - 20), width: w, height: Math.min(h - Math.max(0, b.y - 20), 320) }; })() });
      await page.close();
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`screenshots in ${OUT}`);
