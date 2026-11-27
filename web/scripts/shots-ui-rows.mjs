// Screenshots of the « Interface web » rows built on 23/11 (L142 run durations and the 30-day chart, L156 report export,
// …) from the dev gallery, at 390 and 1440 px, light and dark → docs/screenshots/interface/<name>-<width>-<theme>.png.
// Fails on a page error, a missing element or a horizontal overflow.
//
//   node web/scripts/shots-ui-rows.mjs [name…]   (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/interface");
const SHOTS = [
  // name, gallery query, element that must be there, element to frame (optional), element to click first (optional)
  ["routine-runs", "section=routines", ".usage-chart", "[aria-label=L142]"],
  ["routine-runs-empty", "section=routines&empty=1", ".usage-chart", "[aria-label=L142]"],
  ["routine-runs-long", "section=routines&long=1", ".usage-chart", "[aria-label=L142]"],
  ["routine-params-ical", "section=routines", "[aria-label=L143] input", "[aria-label=L143]"],
  ["routine-params-ical-empty", "section=routines&empty=1", "[aria-label=L143] input", "[aria-label=L143]"],
  ["bot-activity", "section=confort6&nav=1", ".bot-activity", ".sidebar"],
  ["bot-activity-working", "section=confort6&nav=1", ".bot-activity", ".sidebar", ".bot-activity-chip >> nth=2"],
  ["model-menu", "section=chat&retired=1", ".composer-model", null, ".composer-model"],
  ["chat-math-fold", "section=chat&math=1", ".md-math", null],
  ["report-export", "section=routines", ".report-export", "[aria-label=L156]"],
  ["report-export-long", "section=routines&long=1", ".report-export", "[aria-label=L156]"],
];
const only = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
const browser = await chromium.launch();
const problems = [];
try {
  for (const [name, query, need, frame, click] of SHOTS.filter(([n]) => !only.length || only.includes(n))) {
    for (const [w, h] of [[390, 844], [1440, 900]]) {
      for (const theme of ["light", "dark"]) {
        const mobile = w < 800;
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: "fr-FR", colorScheme: theme });
        const page = await ctx.newPage();
        page.on("pageerror", (e) => problems.push(`${name} ${w} ${theme}: ${e.message}`));
        await page.goto(`${base}?dev=gallery&embed=1&lang=fr&theme=${theme}&${query}`, { waitUntil: "networkidle" });
        await page.waitForSelector(need, { timeout: 8000 }).catch(() => problems.push(`${name} ${w} ${theme}: no ${need}`));
        if (click) await page.locator(click).click();
        if (!frame && !click) await page.locator(need).first().evaluate((el) => el.scrollIntoView({ block: "start" })).catch(() => undefined);
        await page.waitForTimeout(300);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) problems.push(`${name} ${w} ${theme}: horizontal overflow ${overflow}px`);
        const target = frame ? page.locator(frame).first() : null;
        if (target && (await target.count())) await target.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`) });
        else await page.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`), fullPage: true });
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log(`screenshots → ${OUT}`);
