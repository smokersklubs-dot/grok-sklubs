'use strict';
/* End-to-end helpers: launch the relay (dev or packaged) and the target app under Xvfb, take screenshots,
   and click UI elements by color (the test plays the human sitting at the computer). */
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = process.env.RELAIS_SHOTS_DIR || path.join(ROOT, 'test', '.tmp', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const robot = require('@jitsi/robotjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function electronBin() {
  return require('electron'); // path to the Electron binary when required from Node
}

function packagedBin() {
  const dir = path.join(ROOT, 'dist', 'linux-unpacked');
  return path.join(dir, 'sklubot-relais');
}

/**
 * @param {{ packaged?: boolean, dataDir: string, server: string, autoconfirm?: boolean }} o
 */
function launchRelay(o) {
  const env = {
    ...process.env,
    SKLUBOT_RELAIS_DATA_DIR: o.dataDir,
    SKLUBOT_RELAIS_SERVER: o.server,
    SKLUBOT_RELAIS_DEBUG: '1',
    LANG: 'fr_FR.UTF-8',
  };
  if (o.autoconfirm) env.SKLUBOT_RELAIS_TEST_AUTOCONFIRM = '1';
  else delete env.SKLUBOT_RELAIS_TEST_AUTOCONFIRM;
  // --no-sandbox only because the test container runs as root (Chromium refuses otherwise).
  const [cmd, args] = o.packaged ? [packagedBin(), ['--no-sandbox', '--lang=fr']] : [electronBin(), [ROOT, '--no-sandbox', '--lang=fr']];
  const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.output = '';
  child.stdout.on('data', (d) => { child.output += d; });
  child.stderr.on('data', (d) => { child.output += d; });
  return child;
}

function launchTarget(logFile) {
  fs.writeFileSync(logFile, '');
  const child = spawn(electronBin(), [path.join(ROOT, 'test', 'target-app'), '--no-sandbox'], {
    env: { ...process.env, TARGET_LOG: logFile }, stdio: 'ignore',
  });
  return child;
}

function readTarget(logFile) {
  return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  for (let i = 0; i < 50 && child.exitCode === null; i++) await sleep(100);
  if (child.exitCode === null) child.kill('SIGKILL');
}

/** Full-screen screenshot (ImageMagick `import`), optional crop "WxH+X+Y". */
function screenshot(name, crop) {
  const file = path.join(SHOTS, name);
  execFileSync('import', ['-display', process.env.DISPLAY, '-window', 'root', file]);
  if (crop) execFileSync('convert', [file, '-crop', crop, '+repage', file]);
  return file;
}

function hex(c) { return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]; }
function near(a, b, tol = 24) { return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol; }

/** Bounding box of pixels close to `color` inside a screen region. */
function findColor(region, color, step = 2) {
  const bmp = robot.screen.capture(region.x, region.y, region.w, region.h);
  const target = hex(color.replace('#', ''));
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, n = 0;
  for (let y = 0; y < region.h; y += step) {
    for (let x = 0; x < region.w; x += step) {
      if (near(hex(bmp.colorAt(x, y)), target)) { n++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }
  }
  if (n < 20) return null;
  return { x: region.x + minX, y: region.y + minY, w: maxX - minX, h: maxY - minY, cx: region.x + Math.round((minX + maxX) / 2), cy: region.y + Math.round((minY + maxY) / 2) };
}

/** Wait until a colored element appears. */
async function waitColor(region, color, timeoutMs = 10000) {
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    const box = findColor(region, color);
    if (box) return box;
    await sleep(200);
  }
  throw new Error(`color ${color} not found in region`);
}

/** The test's "human" clicks somewhere. */
function humanClick(x, y) {
  robot.moveMouse(x, y);
  robot.mouseClick();
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

module.exports = { ROOT, SHOTS, robot, sleep, launchRelay, launchTarget, readTarget, stop, screenshot, findColor, waitColor, humanClick, tmpDir, packagedBin };
