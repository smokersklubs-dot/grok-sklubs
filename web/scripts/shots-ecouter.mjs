// Screenshots of « Écouter les réponses » (the 🔊 action, the player, the header's mute button) from the dev gallery's
// chat (section=chat&listen=…, web/src/dev/GalleryChat.tsx), at 390 and 1440 px, light and dark → docs/screenshots/ecouter/.
//
//   node web/scripts/shots-ecouter.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/ecouter");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
const browser = await chromium.launch();
const SHOTS = [
  ["player-playing", "listen=playing"],
  ["player-paused", "listen=paused"],
  ["player-browser-voice", "listen=browser"],
  ["player-error", "listen=error"],
  ["action", ""],
];
try {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    for (const theme of ["light", "dark"]) {
      const mobile = w < 800;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: "fr-FR", colorScheme: theme });
      for (const [name, q] of SHOTS) {
        if (name !== "player-playing" && name !== "action" && theme === "dark" && w === 1440) continue;
        const page = await ctx.newPage();
        await page.goto(`${base}?dev=gallery&embed=1&section=chat&theme=${theme}${q ? `&${q}` : ""}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(300);
        // The last reply in view; on a desktop, the pointer over it (its actions show on hover).
        const target = q ? page.locator(".listen-player").first() : page.locator(".msg-listen").last();
        await target.scrollIntoViewIfNeeded();
        if (!mobile) await page.locator(".msg-listen").last().hover({ force: true }).catch(() => undefined);
        await page.waitForTimeout(200);
        await page.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`) });
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
