// L160 — the pre-submission check (scripts/store-check.mjs): PNG transparency read from the pixels, privacy manifest
// written as a property list and its reasons read back, key patterns (a test placeholder is not a key), and the whole
// check on this app (no ÉCHEC) and on a broken copy of its config (each problem found).
//
//   cd mobile && npm run test:store
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { declaredReasons, findKeys, hasTransparency, pngInfo, runChecks, toPlist } from "./store-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A tiny RGBA PNG, every row with filter `filter`, alpha `alpha` on the last pixel. */
function png(w, h, alpha, filter = 0) {
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, "ascii"); data.copy(b, 8); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const line = Buffer.alloc(w * 4, 255);
    if (y === h - 1) line[w * 4 - 1] = alpha;
    // Filter 1 (Sub): store each byte minus the one 4 bytes to the left.
    const enc = Buffer.from(line);
    if (filter === 1) for (let x = w * 4 - 1; x >= 4; x--) enc[x] = (line[x] - line[x - 4]) & 255;
    rows.push(Buffer.from([filter]), enc);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

test("PNG: size and transparency read from the pixels, whatever the row filter", () => {
  assert.deepEqual([pngInfo(png(3, 2, 255)).width, pngInfo(png(3, 2, 255)).height], [3, 2]);
  assert.equal(hasTransparency(png(4, 3, 255)), false);
  assert.equal(hasTransparency(png(4, 3, 0)), true);
  assert.equal(hasTransparency(png(4, 3, 254, 1)), true);
  assert.equal(hasTransparency(png(4, 3, 255, 1)), false);
  assert.equal(hasTransparency(readFileSync(join(ROOT, "assets/icon.png"))), false, "the App Store icon is opaque");
  assert.equal(hasTransparency(readFileSync(join(ROOT, "assets/android-icon-foreground.png"))), true, "an adaptive icon layer is transparent");
});

test("privacy manifest: property list written, reasons read back; the committed file is current", () => {
  const m = JSON.parse(readFileSync(join(ROOT, "store/privacy-manifest.json"), "utf8"));
  const xml = toPlist(m);
  assert.match(xml, /<key>NSPrivacyTracking<\/key>\n\t<false\/>/);
  const r = declaredReasons(xml);
  assert.deepEqual([...r.get("NSPrivacyAccessedAPICategoryUserDefaults")], ["CA92.1"]);
  assert.deepEqual([...r.get("NSPrivacyAccessedAPICategoryFileTimestamp")].sort(), ["0A2A.1", "3B52.1", "C617.1"]);
  assert.equal(readFileSync(join(ROOT, "store/PrivacyInfo.xcprivacy"), "utf8"), xml);
  assert.ok(!m.NSPrivacyCollectedDataTypes.some((d) => d.NSPrivacyCollectedDataType.endsWith("AudioData")), "no audio on iOS (no voice calls there)");
});

test("keys: real-looking ones found, test placeholders not", () => {
  assert.deepEqual(findKeys(`const k = "sk-ant-api03-${"a".repeat(30)}"`), ["clé Anthropic"]);
  assert.deepEqual(findKeys(`AIza${"B".repeat(35)}`), ["clé Google"]);
  assert.deepEqual(findKeys(`ghp_${"c".repeat(36)}`), ["jeton GitHub"]);
  assert.deepEqual(findKeys("-----BEGIN PRIVATE KEY-----"), ["clé privée"]);
  assert.deepEqual(findKeys(`sk_test_${"d".repeat(24)}`), ["clé Stripe"]);
  assert.deepEqual(findKeys('apiKey: "sk-fake-for-tests"'), []);
});

test("the whole check: this app passes; a broken copy fails on each problem", () => {
  const here = runChecks(ROOT);
  assert.deepEqual(here.filter((r) => r.level === "ÉCHEC"), []);
  assert.ok(here.some((r) => r.level === "OK" && /manifeste de confidentialité/.test(r.what)));
  assert.ok(here.some((r) => r.level === "OK" && /Signaler cette réponse/.test(r.what)));

  const copy = mkdtempSync(join(tmpdir(), "store-check-"));
  for (const d of ["assets", "store", "src", "plugins", "shared"]) cpSync(join(ROOT, d), join(copy, d), { recursive: true });
  for (const f of ["app.config.ts", "App.tsx", "index.ts", "package.json", "STORE.md"]) cpSync(join(ROOT, f), join(copy, f));
  symlinkSync(join(ROOT, "node_modules"), join(copy, "node_modules"));
  const cfg = readFileSync(join(copy, "app.config.ts"), "utf8");
  writeFileSync(join(copy, "app.config.ts"), cfg.replace('const VERSION_CODE = 2;', "const VERSION_CODE = 3;").replace(/photosPermission: "[^"]*"/, 'photosPermission: "Photos"'));
  writeFileSync(join(copy, "assets/icon.png"), png(1024, 1024, 0));
  writeFileSync(join(copy, "src/leak.ts"), `export const KEY = "sk-ant-api03-${"x".repeat(32)}";`);
  const m = JSON.parse(readFileSync(join(copy, "store/privacy-manifest.json"), "utf8"));
  m.NSPrivacyAccessedAPITypes = m.NSPrivacyAccessedAPITypes.filter((t) => !t.NSPrivacyAccessedAPIType.endsWith("SystemBootTime"));
  writeFileSync(join(copy, "store/privacy-manifest.json"), JSON.stringify(m));
  writeFileSync(join(copy, "src/components/Chat.tsx"), "export const nothing = 1;\n");
  const fails = runChecks(copy).filter((r) => r.level === "ÉCHEC").map((r) => r.what).join("\n");
  assert.match(fails, /STORE\.md ne cite pas sklubot-store-1\.1\.0\.aab et versionCode 3/);
  assert.match(fails, /assets\/icon\.png a des pixels transparents/);
  assert.match(fails, /permission photos : texte absent ou sans raison/);
  assert.match(fails, /PrivacyInfo\.xcprivacy diffère/);
  assert.match(fails, /raisons d'API manquantes : SystemBootTime 35F9\.1 \(react-native\)/);
  assert.match(fails, /src\/leak\.ts \(clé Anthropic/);
  assert.match(fails, /Signaler cette réponse/);
});
