// Responsive check: no page of the dev gallery is wider than the screen, on a phone (360, 390 px) and a tablet (768 px).
//
//   npm run check:responsive -w web            (starts its own Vite dev server; needs Playwright's Chromium)
//   SHOTS=dir npm run check:responsive -w web  (also saves a screenshot of each page)
//
// For each page and width it asserts that the document does not scroll sideways (scrollWidth <= innerWidth) and that
// no element of the conversation or of the page sticks out past the right edge — except inside the boxes that scroll
// on their own (code blocks, tables, card details). The gallery (web/src/dev/Gallery.tsx) holds the real components
// with fake data, including the chat page that broke on an iPhone (section=chat: long replies, a long link, a code
// block, a table, a raw tool warning, several « Stopped. » notices).
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("check:responsive needs Playwright (npm i -D playwright, then npx playwright install chromium).");
  process.exit(2);
}

const WIDTHS = [[360, 740], [390, 844], [768, 1024]];
const PAGES = [
  "section=chat",
  "section=confort6&long=1", "section=confort6&nav=1&long=1", "section=confort6&view=doctor&theme=dark&lang=en", "section=confort6&view=commands&long=1", "section=confort6&slash=1&long=1", // wave 6 comfort (GalleryComfort6.tsx)
  "section=canaux&long=1",
  "section=canaux&theme=dark&lang=en",
  "section=canaux&empty=1",
  "section=chat&long=1&running=1",
  "section=chat&long=1&running=tasks",
  "section=chat&panel=thread",
  "section=chat&theme=dark&lang=en",
  "section=chat&listen=playing&long=1",
  "section=notices&long=1",
  "section=inbox&long=1",
  "section=inbox&theme=dark&lang=en",
  "section=inbox&empty=1",
  "section=cards&long=1",
  "section=today",
  "section=memoire&long=1",
  "section=memoire&long=1&theme=dark&lang=en",
  "section=relais",
  "section=routines",
  "section=routines&long=1&theme=dark&lang=en",
  "section=routines&empty=1",
  "section=createbot",
  "section=chantier",
  "section=chantier&long=1&theme=dark&lang=en",
  "section=chantier&empty=1",
  "section=createbot&theme=dark&lang=en",
  "section=relais&theme=dark&lang=en&empty=1",
  "section=command",
  "section=command&long=1&theme=dark&lang=en",
  "section=command&empty=1",
  "section=surveillance",
  "section=announcements&long=1",
  "section=basics",
  "section=skills&long=1",
  "section=pages",
  "section=skills&theme=dark&lang=en",
  "section=skillhealth&long=1",
  "section=skillhealth&theme=dark&lang=en",
  "section=skillhealth&empty=1",
  "section=skillscan&long=1",
  "section=skillscan&theme=dark&lang=en",
  "section=recruit&long=1",
  "section=equipe&long=1",
  "section=equipe&view=update&theme=dark&lang=en",
  "section=equipe&view=share",
  "section=equipe&view=choose",
  "section=grants&long=1",
  "section=securite&long=1",
  "section=securite&theme=dark&lang=en",
  "section=securite&empty=1",
  "section=grants&theme=dark&lang=en",
  "section=grants&empty=1",
  "section=confiance&long=1",
  "section=confiance&theme=dark&lang=en",
  "section=confiance&view=report",
  "section=relecture&long=1",
  "section=relecture&theme=dark&lang=en",
  "section=relecture&empty=1",
];
const SCROLLERS = "pre, .md-table, .card-detail, .segmented, .tabs, .gallery-bar, .cmd-states";

const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const failures = [];
try {
  for (const [w, h] of WIDTHS) {
    const mobile = w < 800;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: "fr-FR" });
    for (const q of PAGES) {
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${base}?dev=gallery&embed=1&${q}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      // Scroll every scrollable column through, so lazily laid out content is measured too.
      const result = await page.evaluate((scrollers) => {
        const vw = window.innerWidth;
        const out = [];
        for (const el of document.querySelectorAll("body *")) {
          if (el.closest(scrollers) && !el.matches(scrollers)) continue;
          const style = getComputedStyle(el);
          if (style.position === "fixed" || style.visibility === "hidden") continue;
          // A closed drawer is moved off screen on purpose.
          if (el.closest(".sidebar:not(.is-mobile-open)") && vw <= 720) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          if (r.right > vw + 1 || r.left < -1) out.push(`${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).join(".")} [${Math.round(r.left)}..${Math.round(r.right)}]`);
        }
        return { scrollWidth: document.documentElement.scrollWidth, vw, out: out.slice(0, 5) };
      }, SCROLLERS);
      const label = `${w}px ${q}`;
      if (errors.length) failures.push(`${label}: page error: ${errors[0]}`);
      if (result.scrollWidth > result.vw) failures.push(`${label}: the page scrolls sideways (${result.scrollWidth} > ${result.vw})`);
      if (result.out.length) failures.push(`${label}: past the edge: ${result.out.join(", ")}`);
      if (shots) await page.screenshot({ path: join(shots, `${w}-${q.replace(/[^a-z0-9]+/gi, "_")}.png`) });
      await page.close();
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`check:responsive — ${failures.length} problem(s):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`check:responsive — ${PAGES.length} pages × ${WIDTHS.length} widths: nothing wider than the screen.`);
