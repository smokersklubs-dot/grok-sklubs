// Screenshots of « Téléphones Android (USB) » (GalleryAndroidUsb.tsx, L177): a phone used by a bot with « Arrêter »,
// a phone not allowed yet, and the adb guide — at 390 and 1440 px, light and dark, French and English (long names)
// → docs/screenshots/android-usb/.
//
//   node web/scripts/shots-android-usb.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/android-usb");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
const browser = await chromium.launch();
const problems = [];
try {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    for (const theme of ["light", "dark"]) {
      for (const [lang, long] of [["fr", ""], ["en", "&long=1"]]) {
        const mobile = w < 800;
        const name = `android-usb-${lang}-${w}-${theme}`;
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: lang === "fr" ? "fr-FR" : "en-US", colorScheme: theme });
        const page = await ctx.newPage();
        page.on("pageerror", (e) => problems.push(`${name}: ${e.message}`));
        await page.goto(`${base}?dev=gallery&embed=1&section=relais&lang=${lang}&theme=${theme}${long}`, { waitUntil: "networkidle" });
        const sec = page.locator("#g-android-usb");
        await sec.waitFor({ timeout: 6000 }).catch(() => problems.push(`${name}: section missing`));
        for (const sel of [".android-usb-row", ".android-usb-guide", ".btn-danger"]) if (!(await sec.locator(sel).count())) problems.push(`${name}: missing ${sel}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) problems.push(`${name}: horizontal overflow ${overflow}px`);
        await sec.scrollIntoViewIfNeeded();
        await sec.screenshot({ path: join(OUT, `${name}.png`) });
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(problems.length ? `Problems:\n${problems.join("\n")}` : `OK: screenshots in ${OUT}`);
process.exit(problems.length ? 1 : 0);
