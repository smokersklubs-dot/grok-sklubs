// L160: the installable-app basics of web/ (manifest, index.html, service worker) and the in-page audit rules.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pageAudit, pwaProblems } from "./a11y-rules.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const real = () => ({
  manifest: readFileSync(join(ROOT, "public/manifest.webmanifest"), "utf8"),
  html: readFileSync(join(ROOT, "index.html"), "utf8"),
  sw: readFileSync(join(ROOT, "public/sw.js"), "utf8"),
  exists: (p) => existsSync(join(ROOT, "public", p)),
});

test("L160 web/ passes the installable-app basics", () => {
  assert.deepEqual(pwaProblems(real()), []);
});

test("L160 each missing basic is reported", () => {
  const f = real();
  const bad = pwaProblems({
    manifest: JSON.stringify({ name: "S", short_name: "A very long app name", display: "browser", icons: [{ src: "/nope.png", sizes: "192x192" }] }),
    html: '<html><head><meta name="viewport" content="width=device-width, maximum-scale=1, user-scalable=no"></head></html>',
    sw: "self.addEventListener('install', () => {})",
    exists: f.exists,
  });
  for (const want of ['missing "id"', "short_name longer", "display must be", "no 512x512 icon", "maskable", "/nope.png is missing", "no language", "blocks zooming", "rel=\"manifest\"", "theme-color", "apple-touch-icon", "<title>", "<noscript>", "no fetch handler", "/api/ is not excluded"]) {
    assert.ok(bad.some((p) => p.includes(want)), `expected a problem about ${want}: ${bad.join(" | ")}`);
  }
  assert.deepEqual(pwaProblems({ ...f, manifest: "{" }), ["manifest.webmanifest is not valid JSON"]);
});

test("L160 the in-page audit is self-contained (it runs serialised inside the browser)", () => {
  const src = pageAudit.toString();
  assert.match(src, /no name:/);
  assert.match(src, /duplicate id/);
  assert.doesNotMatch(src, /\bimport\b|\brequire\(/);
});
