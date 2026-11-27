// Responsive check: no page of the dev gallery is wider than the screen, on a phone (360, 390 px), a tablet (768 px) and a
// computer (1440 px), and the end of every page, long chat and list can be scrolled to by hand (scroll-rule.mjs).
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
import { scrollTrap } from "./scroll-rule.mjs";
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

const WIDTHS = [[360, 740], [390, 844], [768, 1024], [1440, 900]]; // 1440: a normal computer screen (« doit marcher »: every screen scrolls)
const PAGES = [
  "section=chat",
  "section=confort6&long=1", "section=confort6&nav=1&long=1", "section=confort6&view=doctor&theme=dark&lang=en", "section=confort6&view=commands&long=1", "section=confort6&slash=1&long=1", // wave 6 comfort (GalleryComfort6.tsx)
  "section=confort7&long=1", "section=confort7&view=welcome&long=1", "section=confort7&view=convs&long=1", "section=confort7&view=trash&long=1&theme=dark&lang=en", "section=confort7&view=office&long=1", "section=confort7&view=pages&long=1", "section=confort7&view=pages&theme=dark&lang=en", "section=confort7&bell=1&long=1&nav=1", // wave 7 comfort (GalleryComfort7.tsx)
  "section=confort9&long=1", "section=confort9&view=annotate", "section=confort9&view=show", "section=confort9&view=step&long=1&theme=dark&lang=en", "section=confort9&view=selfcheck", "section=confort9&view=settings", // wave 9 web rows L140 L142 L145 L153 (GalleryComfort9.tsx)
  "section=confort10&long=1", "section=confort10&view=plan&long=1", "section=confort10&view=roles", "section=confort10&view=grid", "section=confort10&view=layouts&long=1&theme=dark&lang=en", // wave 10 L145 L146 L153 L163 (GalleryComfort10.tsx)
  "section=boucle&long=1", "section=boucle&long=1&theme=dark&lang=en", "section=boucle&empty=1", // loop and turns 23/11 (GalleryLoopPlus.tsx)
  "section=extensions&long=1", "section=extensions&view=editor&long=1", "section=extensions&view=editor&theme=dark&lang=en", "section=extensions&view=settings&long=1", "section=extensions&view=settings&empty=1&theme=dark&lang=en", "section=extensions&empty=1", // wave 7 L172 L174 L178 L179 (GalleryExtensions.tsx)
  "section=soin&long=1", "section=soin&empty=1&theme=dark&lang=en", "section=soin&view=team&long=1", "section=soin&view=team&empty=1", "section=soin&view=chat&nav=1", // L161 bot care (GalleryCare.tsx)
  "section=reunion&long=1", "section=reunion&view=review&long=1", "section=reunion&view=live&theme=dark&lang=en", "section=reunion&empty=1", // L177 bot in an online meeting (GalleryMeetingBot.tsx)
  "section=finitions&long=1", "section=finitions&empty=1&theme=dark&lang=en", "section=finitions&view=applied", // L161 themes, global recap, queue (GalleryFinish.tsx)
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
  "section=cards&type=trajectory&long=1", "section=cards&type=trajectory&theme=dark&lang=en", // L158 « Créations » (TrajectoryCard.tsx)
  "section=cards&type=batch&long=1", "section=cards&type=batch&theme=dark&lang=en", // L99 lots en parallèle (BatchCard.tsx)
  "section=routines&long=1", "section=chat&math=1&theme=dark&lang=en", "section=chat&retired=1", // L142 L143 L156 (GalleryRoutines.tsx), L136 L147 L150 (GalleryChat.tsx)
  "section=today",
  "section=memoire&long=1",
  "section=lignes23&long=1",
  "section=lignes23&long=1&theme=dark&lang=en",
  "section=memoire&long=1&theme=dark&lang=en",
  "section=relais",
  "section=routines",
  "section=routines&long=1&theme=dark&lang=en",
  "section=routines&empty=1",
  "section=createbot",
  "section=chantier",
  "section=chantier&long=1&theme=dark&lang=en",
  "section=chantier&empty=1",
  "section=tableau",
  "section=tableau&long=1&theme=dark&lang=en",
  "section=tableau&empty=1",
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
  "section=creation", "section=creation&long=1&theme=dark&lang=en", "section=creation&empty=1", // audit OGAI: Settings → Keys → Création (GalleryMedia.tsx)
  "section=acces&long=1", "section=acces&theme=dark&lang=en", "section=acces&empty=1", "section=plus&long=1", "section=plus&theme=dark&lang=en", "section=plus&empty=1", // wave 9 L159 L184 (GalleryWave9.tsx)
  "section=ecran&long=1", "section=ecran&theme=dark&lang=en", "section=salons&long=1", // L149, L155, L167 (GalleryScreen.tsx, GalleryRooms.tsx)
];
const SCROLLERS = "pre, .md-table, .card-detail, .segmented, .tabs, .gallery-bar, .cmd-states, .sheet-wrap, .traj-strip"; // .traj-strip: the renders of a creation scroll sideways on purpose (L158)

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
      for (const trap of await page.evaluate(`(${scrollTrap.toString()})()`)) failures.push(`${label}: cannot scroll to the end: ${trap}`); // scroll-rule.mjs
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
console.log(`check:responsive — ${PAGES.length} pages × ${WIDTHS.length} widths: nothing wider than the screen, every end reachable by scrolling.`);
