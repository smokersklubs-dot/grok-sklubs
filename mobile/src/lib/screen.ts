/**
 * The bot's screen in the app: pure helpers for the screenshot viewer (screens/Computer.tsx). The server sends JPEG
 * screenshots (GET /api/bots/:id/screen) and takes clicks in screenshot pixels (POST /api/bots/:id/screen/input), like
 * the web viewer's screenshot mode (web/src/components/ComputerViewer.tsx). Unit-tested.
 */

/** Width and height of a JPEG from its SOFn header (ITU T.81, B.2.2), or null if it is not a readable JPEG. */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }
    // Markers without a length: RSTn, SOI, EOI, TEM.
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Standard base64 (RFC 4648 §4) of bytes, for a data: URI. */
export function toBase64(b: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = b.length - i;
  if (rest === 1) { const n = b[i] << 16; out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + "=="; }
  else if (rest === 2) { const n = (b[i] << 16) | (b[i + 1] << 8); out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + "="; }
  return out;
}

/** Bytes of standard base64 (padding optional; other characters ignored). */
export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1] ?? "A") << 12) | ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0) << 6) | (i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length && i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (o < out.length && i + 3 < clean.length) out[o++] = n & 255;
  }
  return out;
}

/** Where an image of imgW×imgH sits inside a box of viewW×viewH with "contain" (centered, aspect kept). */
export function fitRect(viewW: number, viewH: number, imgW: number, imgH: number): { x: number; y: number; w: number; h: number } {
  if (viewW <= 0 || viewH <= 0 || imgW <= 0 || imgH <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.min(viewW / imgW, viewH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { x: (viewW - w) / 2, y: (viewH - h) / 2, w, h };
}

/** A tap in the box, in the screenshot's own pixels; null when the tap is outside the picture. */
export function toScreenPoint(tapX: number, tapY: number, viewW: number, viewH: number, imgW: number, imgH: number): { x: number; y: number } | null {
  const r = fitRect(viewW, viewH, imgW, imgH);
  if (r.w === 0) return null;
  const x = Math.round(((tapX - r.x) * imgW) / r.w);
  const y = Math.round(((tapY - r.y) * imgH) / r.h);
  if (x < 0 || y < 0 || x > imgW || y > imgH) return null;
  return { x, y };
}

/** "example.com" → "https://example.com"; an address with a scheme is kept (same rule as the web viewer). */
export function normalizeAddress(s: string): string | null {
  const v = s.trim();
  if (!v) return null;
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
}
