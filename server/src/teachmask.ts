import sharp from "sharp";
import { maskSecrets } from "./shared.js";

/**
 * L40 — secrets are blacked out of the « Montre-moi » screenshots (CopilotKit audit, cleanroom T74: "passwords, one-time
 * codes and card data are never recorded").
 *
 * Keystrokes were already never kept (teach.ts: counts only). But a screenshot can still show a secret: a password the
 * page displays ("show password"), an API key on a dashboard, a card number, a one-time code. Before each picture is
 * written, the page in front is asked (in the page itself, like the click checks) for the boxes of:
 *   - fields that hold a secret: password fields, and fields whose autocomplete / name / id / label say password,
 *     one-time code, card number, expiry or security code, token, API key, secret, IBAN;
 *   - visible text that looks like a key or a token (the same formats as the pasted-secret check, shared.ts);
 * and those boxes are painted black (sharp). Page addresses kept in the recording (`opened the address …`, the page of
 * each frame) lose the values of their sensitive query parameters (token, key, code, password, secret, signature…).
 *
 * Limits, said in the docs: only what a web page in the bot's browser shows can be found (a desktop app's window cannot
 * be read this way); when the page cannot be asked, the picture is kept as it is (as before).
 */
export type Box = [number, number, number, number];

/** Boxes of secret fields and secret-looking text in the page in front. `fromScreen`: in screen coordinates (Linux desktop grab). */
export function secretBoxesScript(fromScreen: boolean): string {
  return `(() => {
const side = ${fromScreen ? "Math.max(0, (window.outerWidth - window.innerWidth) / 2)" : "0"};
const ox = ${fromScreen ? "window.screenX + side" : "0"}, oy = ${fromScreen ? "window.screenY + Math.max(0, window.outerHeight - window.innerHeight - side)" : "0"};
const out = []; const add = (r) => { if (r && r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth) out.push([Math.round(r.left + ox - 2), Math.round(r.top + oy - 2), Math.round(r.width + 4), Math.round(r.height + 4)]); };
const SECRET = /pass|pwd|otp|one-time|2fa|mfa|totp|cc-|card|cvc|cvv|csc|expir|token|secret|api.?key|iban|pin\\b|security.?code|mot.?de.?passe|code.?de.?s/i;
for (const el of document.querySelectorAll('input, textarea')) {
  const t = (el.getAttribute('type') || '').toLowerCase();
  const hints = [el.getAttribute('autocomplete'), el.name, el.id, el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.labels && el.labels[0] ? el.labels[0].innerText : ''].join(' ');
  if (t === 'password' || ((t === '' || t === 'text' || t === 'tel' || t === 'number' || el.tagName === 'TEXTAREA') && SECRET.test(hints))) add(el.getBoundingClientRect());
}
const KEY = /(?:sk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{16,}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[abeprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xai-[A-Za-z0-9]{16,}|hf_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}|\\b(?:\\d[ -]?){13,19}\\b)/;
const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
let n = 0; while (walker.nextNode() && n < 4000) { n++; const node = walker.currentNode; if (!node.nodeValue || node.nodeValue.length < 12 || !KEY.test(node.nodeValue)) continue; const range = document.createRange(); range.selectNodeContents(node); for (const r of range.getClientRects()) add(r); }
return { boxes: out.slice(0, 200) };
})()`;
}

/** The picture with every box painted black (JPEG, same size). Unchanged when there is nothing to hide or it cannot be read. */
export async function blackOut(jpeg: Buffer, boxes: Box[]): Promise<Buffer> {
  if (!boxes.length) return jpeg;
  try {
    const meta = await sharp(jpeg).metadata();
    const w = meta.width ?? 0, h = meta.height ?? 0;
    if (!w || !h) return jpeg;
    const rects = boxes.map(([x, y, bw, bh]) => {
      const x0 = Math.max(0, Math.min(w, x)), y0 = Math.max(0, Math.min(h, y));
      const x1 = Math.max(0, Math.min(w, x + bw)), y1 = Math.max(0, Math.min(h, y + bh));
      return x1 > x0 && y1 > y0 ? `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#000"/>` : "";
    }).join("");
    if (!rects) return jpeg;
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${rects}</svg>`);
    return await sharp(jpeg).composite([{ input: svg, top: 0, left: 0 }]).jpeg({ quality: 55 }).toBuffer();
  } catch { return jpeg; }
}

/** The boxes a page answered ({ boxes: [...] }: the page helper only passes objects back), checked. */
export const asBoxes = (raw: unknown): Box[] => { const v = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { boxes?: unknown }).boxes : raw; return Array.isArray(v) ? v.filter((b): b is Box => Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === "number" && Number.isFinite(n))).slice(0, 200) : []; };

const SENSITIVE_PARAM = /^(?:token|access_token|id_token|refresh_token|code|key|api_key|apikey|password|pass|pwd|secret|client_secret|sig|signature|auth|session|otp|state)$/i;
/** A page address as a recording keeps it: sensitive query values and secret-looking parts replaced. */
export function maskUrl(url: string): string {
  let out = url;
  try {
    const u = new URL(url);
    let changed = false;
    for (const k of [...u.searchParams.keys()]) if (SENSITIVE_PARAM.test(k)) { u.searchParams.set(k, "•••"); changed = true; }
    if (u.password) { u.password = "•••"; changed = true; }
    if (changed) out = u.toString();
  } catch { /* not a full address: only the formats below */ }
  return maskSecrets(out, "•••").text;
}
