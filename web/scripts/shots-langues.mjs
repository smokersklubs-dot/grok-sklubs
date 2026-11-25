// Screenshots of the interface in another language (default Spanish) at 390 and 1440 px, light: the sign-in page,
// the chat with its sidebar, Today, the landing page and the bot creation form → docs/screenshots/langues/.
// For each new language (docs/LANGUES.md): `UI=de node web/scripts/shots-langues.mjs`, then look for cut texts.
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UI = process.env.UI ?? "es";
const OUT = process.env.SHOTS ?? join(ROOT, "../docs/screenshots/langues");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
const browser = await chromium.launch();
const PAGES = [
  ["signin", "", ".signin, form"],
  ["chat", `?dev=gallery&embed=1&section=chat&lang=en&ui=${UI}`, ".shell"],
  ["today", `?dev=gallery&embed=1&section=today&lang=en&ui=${UI}`, ".gallery-page"],
  ["landing", `?dev=gallery&embed=1&section=landing&lang=en&ui=${UI}`, "main, .lp"],
  ["createbot", `?dev=gallery&embed=1&section=createbot&lang=en&ui=${UI}`, "form, .modal, dialog"],
];
try {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    for (const [name, query, sel] of PAGES) {
      const mobile = w < 800;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: `${UI}-ES`, colorScheme: "light", reducedMotion: "reduce" });
      await ctx.addInitScript((l) => { try { localStorage.setItem("sklubot.locale", l); } catch { /* none */ } }, UI);
      const page = await ctx.newPage();
      await page.goto(`${base}${query}`, { waitUntil: "networkidle" });
      await page.waitForSelector(sel, { timeout: 15000 }).catch(() => undefined);
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(OUT, `${name}-${UI}-${w}.png`), fullPage: name !== "chat" });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
