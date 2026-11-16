'use strict';
/**
 * Builds the Sklubot desktop icons from our own logo (web/public/icon.svg, the Sklubot "S"), with Electron itself as
 * the SVG renderer (offscreen rendering: https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering), so no
 * other tool is needed:
 *   build/icon.png (1024), build/icons/<n>x<n>.png (Linux), build/icon.ico (Windows), build/icon.icns (macOS),
 *   assets/icon.png (512, window icon), assets/tray-{idle,active,paused,unread}[@2x].png, assets/badge.png (taskbar overlay).
 *
 * Run:  npm run icons     (on Linux without a screen: xvfb-run -a npm run icons)
 *
 * ICO: PNG-compressed entries (supported since Windows Vista: https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-icons).
 * ICNS: PNG entries ic07…ic14 (https://en.wikipedia.org/wiki/Apple_Icon_Image_format#Icon_types).
 */
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const LOGO = fs.readFileSync(path.join(ROOT, '..', 'web', 'public', 'icon.svg'), 'utf8');
const BUILD = path.join(ROOT, 'build');
const ASSETS = path.join(ROOT, 'assets');

/** The logo with an optional status dot (tray) or greyed out (paused). */
function svg({ dot = null, grey = false } = {}) {
  let body = LOGO.replace(/<\/?svg[^>]*>/g, '');
  if (grey) body = body.replace('#e2552d', '#8b8f96');
  const extra = dot ? `<circle cx="404" cy="108" r="104" fill="#fff"/><circle cx="404" cy="108" r="78" fill="${dot}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${body}${extra}</svg>`;
}
const BADGE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="7.5" fill="#fff"/><circle cx="8" cy="8" r="6" fill="#d92d20"/></svg>';

/** Renders an SVG string to a PNG buffer of `size`×`size` pixels. */
async function render(svgText, size) {
  const win = new BrowserWindow({
    width: size, height: size, show: false, frame: false, transparent: true, useContentSize: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, javascript: false },
  });
  win.webContents.setFrameRate(1);
  const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svgText}</body></html>`;
  const tmp = path.join(app.getPath('temp'), `sklubot-icon-${process.pid}-${size}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmp, html);
  try { await win.loadFile(tmp); } finally { fs.rmSync(tmp, { force: true }); }
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  win.destroy();
  const s = img.getSize();
  return (s.width === size ? img : img.resize({ width: size, height: size, quality: 'best' })).toPNG();
}

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o); dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

function icns(entries) {
  const parts = entries.map(({ type, data }) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, 'ascii'); h.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([h, data]);
  });
  const total = 8 + parts.reduce((n, p) => n + p.length, 0);
  const h = Buffer.alloc(8);
  h.write('icns', 0, 'ascii'); h.writeUInt32BE(total, 4);
  return Buffer.concat([h, ...parts]);
}

async function main() {
  fs.mkdirSync(path.join(BUILD, 'icons'), { recursive: true });
  const logo = svg();
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  const png = {};
  for (const n of sizes) png[n] = await render(logo, n);
  fs.writeFileSync(path.join(BUILD, 'icon.png'), png[1024]);
  for (const n of sizes.filter((n) => n <= 512)) fs.writeFileSync(path.join(BUILD, 'icons', `${n}x${n}.png`), png[n]);
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((n) => ({ size: n, data: png[n] }))));
  fs.writeFileSync(path.join(BUILD, 'icon.icns'), icns([
    { type: 'ic11', data: png[32] }, { type: 'ic12', data: png[64] }, { type: 'ic07', data: png[128] },
    { type: 'ic13', data: png[256] }, { type: 'ic08', data: png[256] }, { type: 'ic14', data: png[512] },
    { type: 'ic09', data: png[512] }, { type: 'ic10', data: png[1024] },
  ]));
  fs.writeFileSync(path.join(ASSETS, 'icon.png'), png[512]);
  const trays = { idle: svg(), active: svg({ dot: '#d92d20' }), paused: svg({ grey: true }), unread: svg({ dot: '#2f80ed' }) };
  for (const [name, s] of Object.entries(trays)) {
    fs.writeFileSync(path.join(ASSETS, `tray-${name}.png`), await render(s, 22));
    fs.writeFileSync(path.join(ASSETS, `tray-${name}@2x.png`), await render(s, 44));
  }
  fs.writeFileSync(path.join(ASSETS, 'badge.png'), await render(BADGE, 16));
  console.log('icons written to build/ and assets/');
}

app.disableHardwareAcceleration();
// Each icon uses its own window: do not let the default "quit when the last window closes" end the script early.
app.on('window-all-closed', () => {});
app.whenReady().then(main).then(() => app.quit(), (e) => { console.error(e); app.exit(1); });
