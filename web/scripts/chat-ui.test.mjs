// L176 — browser tests of the chat (the real ChatView, Transcript, Composer and cards of web/src, in Chromium, on the
// dev gallery's chat page with its fake API: ?dev=gallery&section=chat&test=1, GalleryChat.tsx). Server events are
// played into the real store (window.__galleryStore, gallery only) exactly as the live channel delivers them.
//
//   npm test -w web        (skipped, with a note, when Playwright or its Chromium is not installed)
//
// What is checked: the chat opens at the bottom and follows new rows; scrolled up, new rows never move the view and the
// « Aller au dernier message » button brings it back; a streaming reply grows in place (same DOM node, never twice) while
// the view follows; sending carries an idempotency key, the SAME key when a lost send is retried and a new one for the
// next message, and Enter sends while Shift+Enter makes a new line; cards render from events and their buttons call the
// right route (approval → /approvals/:id with the decision, a trajectory card's compare).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let chromium = null;
try { ({ chromium } = await import("playwright")); } catch { /* not installed */ }
let browser = null, server = null, base = "", why = chromium ? "" : "Playwright is not installed";
if (chromium) {
  try { browser = await chromium.launch(); } catch (e) { why = `Chromium did not start (${String(e.message).split("\n")[0]})`; }
}
const skip = browser ? false : why;
const BOT = "bot_gallery";

before(async () => {
  if (skip) return;
  const { createServer } = await import("vite");
  server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0, strictPort: false } });
  await server.listen();
  base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
});
after(async () => { await browser?.close(); await server?.close(); });

/** The chat page at 390 × 844 (a phone), the store ready, the transcript drawn. */
async function openChat(query = "") {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "fr-FR" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}?dev=gallery&embed=1&section=chat&test=1&lang=fr${query}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__galleryStore && !!document.querySelector(".transcript [data-seq]"), null, { timeout: 15000 });
  await page.waitForTimeout(200);
  return { page, ctx, errors };
}
/** Plays a "rows" event (as the server sends it) into the store. */
const play = (page, rows) => page.evaluate(([bot, rows]) => {
  const s = window.__galleryStore.getState();
  s.applyEvent({ type: "rows", botId: bot, generation: s.threads[bot].generation, rows: rows.map((r) => ({ botId: bot, generation: s.threads[bot].generation, createdAt: Date.now(), ...r })) });
}, [BOT, rows]);
const lastSeq = (page) => page.evaluate((bot) => Math.max(...window.__galleryStore.getState().threads[bot].rows.map((r) => r.seq)), BOT);
const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const gap = (page) => page.evaluate(() => { const el = document.querySelector(".transcript"); return el.scrollHeight - el.scrollTop - el.clientHeight; });
const long = (n) => Array.from({ length: n }, (_, i) => `Ligne ${i + 1} de la réponse, avec assez de mots pour remplir l'écran d'un téléphone.`).join("\n\n");

test("opens at the bottom and follows new rows", { skip }, async () => {
  const { page, ctx, errors } = await openChat();
  assert.ok((await gap(page)) <= 2, "opened at the bottom");
  const seq = (await lastSeq(page)) + 1;
  await play(page, [{ seq, rev: 1, body: { kind: "message", role: "user", text: "Une question de plus" } }, { seq: seq + 1, rev: 1, body: { kind: "message", role: "assistant", text: long(12) } }]);
  await frame(page);
  await page.waitForSelector(`[data-seq="${seq + 1}"]`);
  assert.ok((await gap(page)) <= 2, "still at the bottom after a long reply");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("scrolled up: new rows never move the view; the jump button brings it back", { skip }, async () => {
  const { page, ctx } = await openChat("&long=1");
  await page.evaluate(() => { const el = document.querySelector(".transcript"); el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
  await frame(page);
  const top = await page.evaluate(() => document.querySelector(".transcript").scrollTop);
  const seq = (await lastSeq(page)) + 1;
  await play(page, [{ seq, rev: 1, body: { kind: "message", role: "assistant", text: long(8) } }]);
  await frame(page);
  assert.equal(await page.evaluate(() => document.querySelector(".transcript").scrollTop), top, "the reader's place is kept");
  const jump = page.getByRole("button", { name: "Aller au dernier message" });
  await jump.waitFor({ state: "visible" });
  await jump.click();
  await frame(page);
  assert.ok((await gap(page)) <= 2, "back at the bottom");
  assert.equal(await jump.count(), 0, "the button goes once at the bottom");
  await play(page, [{ seq: seq + 1, rev: 1, body: { kind: "message", role: "assistant", text: long(4) } }]);
  await frame(page);
  assert.ok((await gap(page)) <= 2, "follows again");
  await ctx.close();
});

test("streaming: the reply grows in place, once, and the view follows", { skip }, async () => {
  const { page, ctx, errors } = await openChat();
  const seq = (await lastSeq(page)) + 1;
  await play(page, [{ seq, rev: 1, body: { kind: "message", role: "assistant", text: "Bonjour", streaming: true } }]);
  await page.waitForSelector(`[data-seq="${seq}"]`);
  await page.evaluate((s) => { document.querySelector(`[data-seq="${s}"]`).__mark = "same-node"; }, seq);
  let text = "Bonjour";
  for (let i = 1; i <= 25; i++) {
    text += ` mot${i}${i % 5 === 0 ? "\n\n" : ""}`;
    await play(page, [{ seq, rev: 1 + i, body: { kind: "message", role: "assistant", text, streaming: true } }]);
    if (i % 5 === 0) await frame(page);
  }
  await play(page, [{ seq, rev: 99, body: { kind: "message", role: "assistant", text: `${text}\n\nFin.`, streaming: false } }]);
  await frame(page);
  assert.equal(await page.locator(`[data-seq="${seq}"]`).count(), 1, "never two copies of the reply");
  assert.equal(await page.evaluate((s) => document.querySelector(`[data-seq="${s}"]`).__mark, seq), "same-node", "the same element all along (no remount)");
  assert.match(await page.locator(`[data-seq="${seq}"]`).innerText(), /mot25[\s\S]*Fin\./);
  // An older revision arriving late never rolls the text back.
  await play(page, [{ seq, rev: 3, body: { kind: "message", role: "assistant", text: "Bonjour mot1", streaming: true } }]);
  await frame(page);
  assert.match(await page.locator(`[data-seq="${seq}"]`).innerText(), /Fin\./);
  assert.ok((await gap(page)) <= 2, "followed the reply to its end");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("sending: an idempotency key per message, the same key when a lost send is retried; Enter sends, Shift+Enter does not", { skip }, async () => {
  const { page, ctx } = await openChat();
  // Record every send, and lose the first one on the way (the network fails before any answer).
  await page.evaluate(() => {
    const inner = window.fetch;
    window.__sends = [];
    let lose = 1;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (/\/api\/bots\/[^/]+\/messages$/.test(url) && (init?.method ?? "GET") === "POST") {
        window.__sends.push(JSON.parse(String(init.body)));
        if (lose-- > 0) return Promise.reject(new TypeError("network lost"));
      }
      return inner(input, init);
    };
  });
  const box = page.locator("textarea.composer-input");
  await box.fill("Prépare le devis");
  await box.press("Shift+Enter");
  assert.equal(await page.evaluate(() => window.__sends.length), 0, "Shift+Enter makes a new line, it does not send");
  assert.equal(await box.inputValue(), "Prépare le devis\n");
  await box.fill("Prépare le devis");
  await box.press("Enter");
  await page.waitForFunction(() => window.__sends.length === 1);
  await page.getByText(/joindre le serveur|injoignable|unreachable/i).first().waitFor({ timeout: 5000 }).catch(() => undefined);
  assert.equal(await box.inputValue(), "Prépare le devis", "the words stay in the box after a failed send");
  await page.getByRole("button", { name: "Envoyer le message" }).click();
  await page.waitForFunction(() => window.__sends.length === 2);
  await page.waitForFunction(() => document.querySelector("textarea.composer-input").value === "");
  await box.fill("Prépare le devis"); // the same words again, once the first went through: a NEW message
  await box.press("Enter");
  await page.waitForFunction(() => window.__sends.length === 3);
  const sends = await page.evaluate(() => window.__sends);
  assert.match(sends[0].clientKey, /^[A-Za-z0-9_-]{8,100}$/);
  assert.equal(sends[1].clientKey, sends[0].clientKey, "the retry of the lost send carries the same key: never two messages");
  assert.equal(sends[1].text, "Prépare le devis");
  assert.notEqual(sends[2].clientKey, sends[0].clientKey, "the next message has its own key, even with the same words");
  await page.waitForFunction(() => [...document.querySelectorAll(".transcript .msg")].filter((m) => m.textContent.includes("Prépare le devis")).length >= 2);
  await ctx.close();
});

test("cards: drawn from events; an approval's buttons call its route with the decision; a trajectory compares", { skip }, async () => {
  const { page, ctx, errors } = await openChat();
  await page.evaluate(() => {
    const inner = window.fetch;
    window.__posts = [];
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if ((init?.method ?? "GET") !== "GET") window.__posts.push({ url: new URL(url, location.href).pathname, body: init.body ? JSON.parse(String(init.body)) : null });
      return inner(input, init);
    };
  });
  const seq = (await lastSeq(page)) + 1;
  await play(page, [{ seq, rev: 1, body: { kind: "card", card: { type: "approval", approvalId: "ap_test_1", title: "Envoyer l'e-mail à Paul", detail: "À : paul@example.com", tool: "mail_send", source: "Gmail", status: "pending" } } }]);
  // Cards carry no row number in the page: found by their words.
  const card = page.locator(".transcript .card", { hasText: "Envoyer l'e-mail à Paul" });
  await card.waitFor();
  await card.getByRole("button", { name: "Autoriser", exact: true }).click();
  await page.waitForFunction(() => window.__posts.some((p) => p.url === "/api/approvals/ap_test_1"));
  assert.deepEqual((await page.evaluate(() => window.__posts)).find((p) => p.url === "/api/approvals/ap_test_1").body, { decision: "allow" });
  // The server then rewrites the card: the buttons go.
  await play(page, [{ seq, rev: 2, body: { kind: "card", card: { type: "approval", approvalId: "ap_test_1", title: "Envoyer l'e-mail à Paul", detail: "À : paul@example.com", tool: "mail_send", source: "Gmail", status: "allowed" } } }]);
  await card.getByText("Autoriser", { exact: true }).waitFor({ state: "detached" });

  const renders = [1, 2, 3].map((n) => ({ id: 500 + n, n, stage: n === 1 ? "study" : "build", kind: "image", name: `affiche-${n}.png`, note: "", at: Date.now(), bytes: 1000, unchanged: n === 3, preview: true }));
  await play(page, [{ seq: seq + 1, rev: 1, body: { kind: "card", card: { type: "trajectory", creationId: "cre_t", title: "Affiche du concert", stage: "build", renders, total: 3, stalled: false } } }]);
  const traj = page.locator(".transcript .traj-card", { hasText: "Affiche du concert" });
  await traj.waitFor();
  assert.equal(await traj.locator(".traj-thumb").count(), 3);
  assert.equal(await traj.locator(".traj-same").count(), 1, "the unchanged render is marked");
  assert.equal(await traj.locator('[aria-current="step"]').innerText(), "2\nConstruire");
  await traj.getByRole("button", { name: "Comparer côte à côte" }).click();
  assert.equal(await traj.locator(".traj-side").count(), 2);
  assert.match(await traj.locator(".traj-same-note").innerText(), /Les rendus 2 et 3 sont identiques/);
  // The gallery draws its own sample pictures (trajectoryFixtures.ts setRenderSource): both sides really load.
  await page.waitForFunction(() => [...document.querySelectorAll(".traj-side img")].every((i) => i.complete && i.naturalWidth > 0));
  assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), []);
  await ctx.close();
});
