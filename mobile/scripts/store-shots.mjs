#!/usr/bin/env node
/**
 * L160 — the store screenshots, made automatically:  cd mobile && npm run store:shots
 *
 * How: each real capture of the app (store/01-bots.png …, taken on the Android emulator, 1080 × 2160, no status bar) is
 * framed on a plain background with its caption in the listing's language (store/listing.json), then rendered with
 * Playwright + Chromium at the exact sizes the stores take:
 *   - iPhone 6.9" 1320 × 2868 (Apple: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications ;
 *     smaller iPhones are scaled from it by App Store Connect; no iPad set since ios.supportsTablet is false);
 *   - Android phone 1080 × 1920, 9:16 (Play: 2 to 8 screenshots, each side 320–3840 px,
 *     https://support.google.com/googleplay/android-developer/answer/9866151).
 * Output: store/shots/<language>/<iphone-6.9|android-phone>/01.png … (checked by `npm run store:check`).
 *
 * Not an Expo web export: the app has no react-native-web build, so the screens are the real Android captures (French
 * interface). Limits, said in docs/BOUTIQUES.md: the app's own words in the captures stay French (only the captions are
 * translated), and the iPhone set shows the Android build; retake the captures on an iPhone (TestFlight) when possible.
 *
 * Playwright comes from the repository root (node_modules/playwright, already used by web/); needs a Chromium
 * (`npx playwright install chromium` once).
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEVICES, LANGUAGES } from "./store-listing.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The page for one screenshot: caption on top, the capture in a rounded frame below. Pure, so it can be tested. */
export function shotHtml({ width, height, caption, imageDataUri, dark = false }) {
  const capH = Math.round(height * 0.17), margin = Math.round(height * 0.035);
  const imgH = height - capH - margin, imgW = Math.min(Math.round(imgH / 2), Math.round(width * 0.82));
  const font = Math.round(width * 0.068);
  const bg = dark ? "#131416" : "#f4f2ee", ink = dark ? "#f4f2ee" : "#1e2024";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0}
body{width:${width}px;height:${height}px;background:linear-gradient(180deg,${bg} 0%,${bg} 55%,${dark ? "#2a1a14" : "#f6dccf"} 100%);overflow:hidden;font-family:"Inter","Helvetica Neue",Arial,"WenQuanYi Zen Hei","Noto Sans CJK SC",sans-serif}
.cap{height:${capH}px;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 ${Math.round(width * 0.08)}px;box-sizing:border-box;color:${ink};font-weight:800;font-size:${font}px;line-height:1.15;letter-spacing:-0.01em}
.bar{display:block;width:${Math.round(width * 0.09)}px;height:${Math.max(6, Math.round(width * 0.008))}px;border-radius:9px;background:#e2552d;margin:0 auto ${Math.round(height * 0.012)}px}
.phone{width:${imgW}px;height:${Math.round(imgW * 2)}px;margin:0 auto;border-radius:${Math.round(imgW * 0.07)}px;overflow:hidden;box-shadow:0 ${Math.round(width * 0.02)}px ${Math.round(width * 0.06)}px rgba(30,32,36,.28);border:${Math.max(4, Math.round(imgW * 0.012))}px solid ${dark ? "#4a4e55" : "#1e2024"};background:#1e2024}
.phone img{display:block;width:100%;height:100%;object-fit:cover}
</style></head><body><div class="cap"><div><span class="bar"></span>${esc(caption)}</div></div><div class="phone"><img src="${imageDataUri}"></div></body></html>`;
}

export async function makeShots({ root = ROOT, languages = LANGUAGES, log = console.log } = {}) {
  const require = createRequire(join(root, "..", "package.json"));
  const { chromium } = require("playwright");
  const listing = JSON.parse(readFileSync(join(root, "store/listing.json"), "utf8"));
  const browser = await chromium.launch();
  let n = 0;
  try {
    for (const lang of languages) {
      const e = listing.locales[lang];
      for (const [device, size] of Object.entries(DEVICES)) {
        const out = join(root, "store/shots", lang, device);
        mkdirSync(out, { recursive: true });
        const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
        for (let i = 0; i < listing.screens.length; i++) {
          const file = listing.screens[i];
          const uri = `data:image/png;base64,${readFileSync(join(root, "store", file)).toString("base64")}`;
          await page.setContent(shotHtml({ ...size, caption: e.captions[i] ?? "", imageDataUri: uri, dark: /dark/.test(file) }), { waitUntil: "load" });
          const path = join(out, `${String(i + 1).padStart(2, "0")}.png`);
          // Chromium sometimes refuses one very large capture: one more try before giving up.
          await page.screenshot({ path, clip: { x: 0, y: 0, ...size } }).catch(() => page.waitForTimeout(500).then(() => page.screenshot({ path, clip: { x: 0, y: 0, ...size } })));
          n++;
        }
        await page.close();
      }
      log(`${lang} : ${listing.screens.length * Object.keys(DEVICES).length} captures`);
    }
  } finally {
    await browser.close();
  }
  return n;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const only = process.argv.slice(2).filter((a) => LANGUAGES.includes(a));
  makeShots({ languages: only.length ? only : LANGUAGES }).then((n) => console.log(`${n} captures dans store/shots/ (contrôle : npm run store:check)`), (e) => { console.error(`Échec : ${e.message}`); process.exit(1); });
}
