// Screenshots of the Relais « Règles de sécurité » (RelayGuardPanel.tsx) from the dev gallery (section=relais, fake
// data), at 390 and 1440 px, light and dark, with the built-in lists opened (commands on by default: their warning shown)
// → docs/screenshots/relais/.
//
//   node web/scripts/shots-relais.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/relais");
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
      await page.goto(`${base}?dev=gallery&embed=1&section=relais&theme=${theme}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".relay-guard");
      await page.locator(".relay-guard-list").evaluateAll((els) => els.forEach((e) => { e.open = true; }));
      await page.locator(".relay-guard").first().screenshot({ path: join(OUT, `regles-${w}-${theme}.png`) });
      // Commands are on by default (owner decision): the warning is shown as is.
      await page.waitForSelector(".relay-guard-terminal.is-on");
      await page.locator(".relay-guard-terminal").first().screenshot({ path: join(OUT, `terminal-on-${w}-${theme}.png`) });
      // A command and its output in the chat (folded, then opened).
      await page.locator(".relay-output").first().evaluate((e) => { e.open = true; });
      await page.locator(".event.is-relay").first().screenshot({ path: join(OUT, `sortie-${w}-${theme}.png`) });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`screenshots in ${OUT}`);
