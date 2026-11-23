// L160 accessibility check: every page of the dev gallery (the same list as check-responsive.mjs) is opened at 390 px
// and audited with pageAudit() (a11y-rules.mjs): buttons, links and fields with no name, images with no text, clickable
// boxes that are not buttons, duplicate ids, positive tabindex. Plus the installable-app basics (pwaProblems).
//
//   npm run check:a11y -w web        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pageAudit, pwaProblems } from "./a11y-rules.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = [...new Set([...readFileSync(join(ROOT, "scripts/check-responsive.mjs"), "utf8").matchAll(/"(section=[^"]+)"/g)].map((m) => m[1]))];
const failures = pwaProblems({
  manifest: readFileSync(join(ROOT, "public/manifest.webmanifest"), "utf8"),
  html: readFileSync(join(ROOT, "index.html"), "utf8"),
  sw: readFileSync(join(ROOT, "public/sw.js"), "utf8"),
  exists: (p) => existsSync(join(ROOT, "public", p)),
}).map((p) => `PWA: ${p}`);

let chromium;
try { ({ chromium } = await import("playwright")); } catch { console.error("check:a11y needs Playwright."); process.exit(2); }
const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "fr-FR" });
  for (const q of PAGES) {
    const page = await ctx.newPage();
    await page.goto(`${base}?dev=gallery&embed=1&${q}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(250);
    const found = await page.evaluate(`(${pageAudit.toString()})()`);
    for (const f of found) failures.push(`${q}: ${f}`);
    await page.close();
  }
  await ctx.close();
} finally {
  await browser.close();
  await server.close();
}
if (failures.length) {
  console.error(`check:a11y — ${failures.length} problem(s):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`check:a11y — ${PAGES.length} pages at 390 px and the installable-app basics: nothing found.`);
