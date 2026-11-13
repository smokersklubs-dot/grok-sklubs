/**
 * Renders the app icons (PNG) from the SVG sources in web/public.
 * Run from the repository root: `node web/scripts/make-icons.mjs`
 * Needs the `playwright` module (with its Chromium) to be installed globally or in the project.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const TARGETS = [
  { svg: "icon.svg", out: "icon-192.png", size: 192, transparent: true },
  { svg: "icon.svg", out: "icon-512.png", size: 512, transparent: true },
  { svg: "icon-maskable.svg", out: "icon-maskable-512.png", size: 512, transparent: false },
  { svg: "icon-maskable.svg", out: "apple-touch-icon.png", size: 180, transparent: false },
];

const browser = await chromium.launch();
try {
  for (const target of TARGETS) {
    const svg = await readFile(join(publicDir, target.svg), "utf8");
    const page = await browser.newPage({ viewport: { width: target.size, height: target.size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${target.size}px;height:${target.size}px}</style>${svg}`,
    );
    const png = await page.screenshot({ type: "png", omitBackground: target.transparent, clip: { x: 0, y: 0, width: target.size, height: target.size } });
    await writeFile(join(publicDir, target.out), png);
    await page.close();
    console.log(`wrote ${target.out} (${target.size}×${target.size})`);
  }
} finally {
  await browser.close();
}
