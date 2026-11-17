// Renders the promo frame by frame with Playwright (Chromium) and pipes the PNGs straight into ffmpeg:
// no frame is written to disk. Usage: node render.mjs h|v out.mp4 [audio.wav] [--from s --to s]
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const TL = require("../timeline.js");

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? +args[i + 1] : d; };
const [mode, out, audio] = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const from = flag("--from", 0), to = flag("--to", TL.duration);
const W = mode === "v" ? 1080 : 1920, H = mode === "v" ? 1920 : 1080;
const url = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html")).href + `?mode=${mode}&render=1`;

const ff = spawn("ffmpeg", [
  "-y", "-loglevel", "error",
  "-f", "image2pipe", "-c:v", "png", "-framerate", String(TL.fps), "-i", "-",
  ...(audio ? ["-ss", String(from), "-t", String(to - from), "-i", audio] : []),
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high",
  ...(audio ? ["-c:a", "aac", "-b:a", "192k", "-shortest"] : []),
  "-movflags", "+faststart", out,
], { stdio: ["pipe", "inherit", "inherit"] });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on("pageerror", (e) => { console.error("page error:", e); process.exitCode = 1; });
await page.goto(url);
await page.evaluate(() => document.fonts.ready);
const f0 = Math.round(from * TL.fps), f1 = Math.round(to * TL.fps);
const started = Date.now();
for (let f = f0; f < f1; f++) {
  await page.evaluate((t) => window.renderAt(t), f / TL.fps);
  const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: W, height: H } });
  if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
  if ((f - f0) % 150 === 0) console.log(`${mode} frame ${f}/${f1} · ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
ff.stdin.end();
await browser.close();
await new Promise((r) => ff.on("close", r));
console.log("done", out, ((Date.now() - started) / 1000).toFixed(0) + " s");
