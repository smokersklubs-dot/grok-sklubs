// Screenshots of L44 « Clés d'accès » and « Nouvel appareil »: Settings → Permissions → Sécurité (passkeys, new-device
// sign-ins), the floor approval card with « Utiliser ma clé d'accès » (dev gallery, section=securite, fake data) and the
// sign-in page with « Se connecter avec une clé d'accès » (the real page, its few API answers faked), at 390 and 1440 px,
// light and dark → docs/screenshots/passkeys/.
//
//   node web/scripts/shots-passkeys.mjs        (starts its own Vite dev server; needs Playwright's Chromium)
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "../docs/screenshots/passkeys");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
const browser = await chromium.launch();
const SHOTS = [
  ["security-passkeys", "section=securite&long=1", ".security-block"],
  ["security-empty", "section=securite&empty=1", ".security-block"],
  ["floor-card", "section=securite", ".gallery-cards"],
];
const ME = { user: null, signupOpen: false, setupCodeRequired: false, imageGeneration: false, video: { provider: null, higgsfield: false }, firstBot: { name: "Juno", label: "Chef de cabinet" }, publicSignup: { open: false, turnstileSiteKey: null } };
try {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    for (const theme of ["light", "dark"]) {
      const mobile = w < 800;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: "fr-FR", colorScheme: theme });
      for (const [name, q, sel] of SHOTS) {
        const page = await ctx.newPage();
        await page.goto(`${base}?dev=gallery&embed=1&${q}&theme=${theme}`, { waitUntil: "networkidle" });
        await page.waitForSelector(sel);
        await page.waitForTimeout(500);
        await page.locator(sel).first().screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`) });
        await page.close();
      }
      const page = await ctx.newPage();
      await page.route("**/api/**", (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/api/me") return route.fulfill({ json: ME });
        if (url.pathname === "/api/auth/password/status") return route.fulfill({ json: { mail: true } });
        if (url.pathname === "/api/auth/google/status") return route.fulfill({ json: { enabled: false } });
        return route.fulfill({ status: 401, json: { error: "Please sign in." } });
      });
      await page.goto(base, { waitUntil: "networkidle" });
      await page.waitForSelector(".pk-signin");
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, `signin-${w}-${theme}.png`), fullPage: true });
      await page.close();
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`screenshots in ${OUT}`);
