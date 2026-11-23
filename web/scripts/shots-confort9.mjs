// Screenshots of wave 9 web rows (GalleryComfort9.tsx): comment a page, a remark per file, a task's time and cost,
// annotate an image, « Montrer », a step in full, « Vérifier ce bot », two chats side by side — at 390 and 1440 px,
// light and dark → docs/screenshots/confort9/. Also checks that a click in the sandboxed page reaches the remark box.
//
//   node web/scripts/shots-confort9.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/confort9");
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
        await page.goto(`${base}?dev=gallery&embed=1&section=confort9&theme=${theme}${query}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(500);
        if (prepare) await prepare(page);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) problems.push(`${name} ${w} ${theme}: horizontal overflow ${overflow}px`);
        await page.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`) });
        await ctx.close();
      };
      const need = (page, sel, name) => page.waitForSelector(sel, { timeout: 4000 }).catch(() => problems.push(`${name} ${w} ${theme}: missing ${sel}`));
      await shot("page", "&long=1", async (page) => {
        await need(page, ".task-cost", "page");
        await page.getByRole("button", { name: "Commenter la page" }).click();
        const frame = page.frameLocator(".page-preview-frame iframe");
        await frame.locator("h1, h2, p").first().click({ timeout: 4000 }).catch((e) => problems.push(`page ${w} ${theme}: click in page ${e.message}`));
        await need(page, ".remark-path", "page");
        await page.locator(".remark-input").first().fill("Mets le titre en plus gros.");
        await page.getByText("Remarque sur ce fichier").first().click();
        await page.locator(".page-comment").scrollIntoViewIfNeeded();
      });
      await shot("annotate", "&view=annotate", async (page) => {
        await need(page, ".annotate-stage canvas", "annotate");
        const box = await page.locator(".annotate-stage canvas").boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
          await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.82);
          await page.getByRole("button", { name: "Stylo" }).click();
          await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.3); await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.3, { steps: 8 }); await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.45, { steps: 8 }); await page.mouse.up();
        }
        await page.locator(".annotate-note .input").first().fill("Logo trop petit");
        const pins = await page.locator(".annotate-stage .annotate-pin").count();
        if (pins !== 2) problems.push(`annotate ${w} ${theme}: ${pins} pins, expected 2`);
      });
      await shot("show", "&view=show", async (page) => {
        await need(page, ".show-layer", "show");
        const b = await page.locator(".viewer-stage img").boundingBox();
        if (b) await page.mouse.click(b.x + b.width * 0.4, b.y + b.height * 0.4);
        await need(page, ".show-box", "show"); await page.waitForTimeout(400);
      });
      await shot("step", "&view=step&long=1", async (page) => { await page.locator(".step-detail-btn").click(); await need(page, ".step-detail-result", "step"); await page.waitForTimeout(600); });
      await shot("selfcheck", "&view=selfcheck", async (page) => { await page.getByText("Lancer la vérification").click(); await page.waitForTimeout(1200); await need(page, ".selfcheck-verdict", "selfcheck"); });
      await shot("settings", "&view=settings", async (page) => { await page.locator(".settings-simple input").check(); await page.waitForTimeout(200); if (!mobile && await page.locator(".settings-nav-item", { hasText: "Coffre" }).count()) problems.push(`settings ${w} ${theme}: vault still listed in Simple mode`); });
      if (!mobile) await shot("side", "&view=side&long=1", async (page) => { await need(page, ".side-chat .transcript", "side"); });
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(problems.length ? `Problems:\n${problems.join("\n")}` : `OK: screenshots in ${OUT}`);
process.exit(problems.length ? 1 : 0);
