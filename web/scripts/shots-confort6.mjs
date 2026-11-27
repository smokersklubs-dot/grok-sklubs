// Screenshots of wave 6 UI comfort (GalleryComfort6.tsx): the chat with the « qui travaille » bar, stop-cause chips,
// the « NOUVEAU » line and the passage bar (words selected in a reply); Settings → « Docteur »; « Mes commandes / » and
// the `/` picker — at 390 and 1440 px, light and dark → docs/screenshots/confort6/.
//
//   node web/scripts/shots-confort6.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/confort6");
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
        await page.goto(`${base}?dev=gallery&embed=1&section=confort6&theme=${theme}${query}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);
        if (prepare) await prepare(page);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) problems.push(`${name} ${w} ${theme}: horizontal overflow ${overflow}px`);
        await page.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`) });
        await ctx.close();
      };
      // The passage bar: select a few words of the first long reply of the bot.
      await shot("chat-passage", "", async (page) => {
        await page.evaluate(() => {
          const md = [...document.querySelectorAll(".main.chat .group.is-theirs .bubble .md p")].find((p) => (p.textContent ?? "").length > 40);
          if (!md) return;
          md.scrollIntoView({ block: "center" });
          const node = [...md.childNodes].find((n) => n.nodeType === 3 && (n.textContent ?? "").length > 20) ?? md.firstChild;
          const r = document.createRange();
          r.setStart(node, 0); r.setEnd(node, Math.min(28, (node.textContent ?? "").length));
          const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        });
        await page.waitForTimeout(300);
        if (!(await page.locator(".passage-bar").count())) problems.push(`chat-passage ${w} ${theme}: no passage bar`);
      });
      await shot("chat-new", "", async (page) => {
        await page.evaluate(() => document.querySelector(".divider.is-new")?.scrollIntoView({ block: "center" }));
        if (!(await page.locator(".divider.is-new").count())) problems.push(`chat-new ${w} ${theme}: no NOUVEAU line`);
      });
      if (mobile) await shot("sidebar", "&nav=1", async (page) => { if (!(await page.locator(".stop-chip").count())) problems.push(`sidebar ${w} ${theme}: no stop chip`); });
      await shot("doctor", "&view=doctor", async (page) => { await page.waitForSelector(".doctor-row"); });
      await shot("commands", "&view=commands", async (page) => { await page.waitForSelector(".pc-row"); });
      await shot("slash", "&slash=1", async (page) => { await page.locator(".composer textarea").focus(); await page.waitForTimeout(300); if (!(await page.locator(".slash-picker").count())) problems.push(`slash ${w} ${theme}: no picker`); });
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(problems.length ? `problems:\n${problems.join("\n")}` : "no problem found");
console.log(`screenshots in ${OUT}`);
