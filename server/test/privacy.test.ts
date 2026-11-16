import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

/** The apps' privacy policy is public (app stores link to it), in French and English, with no script. */
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-privacy-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "http://127.0.0.1";

const { site } = await import("../src/routes.js");

test("GET /confidentialite and /privacy need no session and serve a static page", async () => {
  const fr = await site.request("/confidentialite");
  assert.equal(fr.status, 200);
  assert.match(fr.headers.get("content-type") ?? "", /text\/html/);
  assert.match(fr.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  const html = await fr.text();
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /Politique de confidentialité/);
  assert.match(html, /Supprimer mon compte/);
  assert.doesNotMatch(html, /<script/i);
  // Since app 1.1.0: voice calls use the microphone, during a call only.
  assert.match(html, /Appels vocaux/);
  assert.doesNotMatch(html, /ni ton micro/);
  const en = await site.request("/privacy");
  assert.equal(en.status, 200);
  const enHtml = await en.text();
  assert.match(enHtml, /Sklubot privacy policy/);
  assert.match(enHtml, /Voice calls/);
});
