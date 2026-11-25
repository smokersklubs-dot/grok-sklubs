// « Doit marcher » (24/11): in « Connecter des applis », choosing an app first shows a short connect screen (how you
// connect, what is kept, one button) — nothing is added, and nothing says « Connectée » / « Ajouté », until the owner
// confirms there. Runs the real ConnectorsModal in the dev gallery (GalleryComfort7.tsx, view=connect) in Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let chromium = null;
try { ({ chromium } = await import("playwright")); } catch { /* not installed */ }

test("Connecter des applis: a connect screen comes before anything is added", { skip: !chromium && "Playwright is not installed", timeout: 120_000 }, async () => {
  const { createServer } = await import("vite");
  const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
  await server.listen();
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, locale: "fr-FR" });
      await page.goto(`${server.resolvedUrls.local[0]}?dev=gallery&embed=1&section=confort7&view=connect`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Ajouter Notion" }).waitFor();
      // Count what is sent from here on (the gallery's fake API sits on window.fetch).
      await page.evaluate(() => { const f = window.fetch; window.__sent = []; window.fetch = (i, init) => { if ((init?.method ?? "GET") !== "GET") window.__sent.push(String(i)); return f(i, init); }; });
      const says = async () => (await page.locator("body").innerText());
      assert.doesNotMatch(await says(), /Connectée|Ajouté/);
      for (const [app, screen, button] of [
        ["Notion", /Tu te connectes sur la page de Notion/, "Se connecter avec Notion"],
        ["Linear", /Jeton d’accès[\s\S]*Conservé sur ton serveur/, "Connecter"],
        ["Docs publiques", /Pas besoin de jeton d’accès : un clic suffit\./, "Connecter"],
      ]) {
        await page.getByRole("button", { name: `Ajouter ${app}` }).click();
        const form = page.locator("form.catalog-form");
        await form.waitFor();
        assert.match(await form.innerText(), screen, `${app}: the connect screen says how`);
        assert.equal(await form.getByRole("button", { name: button }).count(), 1, `${app}: one button to connect`);
        assert.doesNotMatch(await says(), /Connectée|Ajouté/, `${app}: nothing says added yet`);
        assert.deepEqual(await page.evaluate(() => window.__sent), [], `${app}: nothing was sent`);
        await page.getByRole("button", { name: `Ajouter ${app}` }).click(); // the same button, now « Annuler »
        await form.waitFor({ state: "detached" });
      }
      await page.close();
    }
  } finally { await browser.close(); await server.close(); }
});
