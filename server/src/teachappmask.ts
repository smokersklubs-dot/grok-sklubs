import { config } from "./config.js";
import { containerName, docker } from "./linux.js";
import type { Box } from "./teachmask.js";

/**
 * L40 (second part) — secrets in the WINDOWS OF APPS (a terminal, a text editor, a password manager…) are blacked out of
 * the « Montre-moi » screenshots too. teachmask.ts already covers what a web page in the bot's browser shows; an app's
 * window cannot be asked for its fields, so on the bot's Linux computer each visible window that is not the browser is:
 *   - hidden whole when its title says it holds secrets (a password manager, a keyring, a pass-phrase or PIN prompt);
 *   - otherwise read with the OCR already in the image (Tesseract, word boxes in TSV), and two kinds of words are hidden:
 *     words that look like a key, a token or a card number (the same formats as the page check), and what follows a
 *     label such as « password: », « mot de passe : », « token = », « code » on the same line;
 *   - hidden whole when it cannot be read (no OCR, a time-out): when unsure, hide.
 * Boxes are in screen pixels; the recording's pictures are smaller (960 px wide), so boxes are scaled to the picture
 * (scaleBoxes) — this also fixes the page boxes, which were drawn at screen size on the smaller picture.
 *
 * Tools: `wmctrl -lG` (window id, desktop, x, y, width, height, host, title — https://linux.die.net/man/1/wmctrl),
 * ImageMagick `import -window root -crop WxH+X+Y`, `tesseract <image> stdout -l fra+eng tsv` (TSV columns: level,
 * page_num, block_num, par_num, line_num, word_num, left, top, width, height, conf, text —
 * https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html#tsv-output).
 */

/** A window whose title says it is a secret store or a secret prompt: hidden whole. */
export const SECRET_WINDOW = /keepass|1password|bitwarden|lastpass|dashlane|enpass|proton ?pass|keyring|seahorse|kwallet|pinentry|passphrase|pass-?phrase|ssh-askpass|authenticat|password|mot de passe|\bpin\b|\bvault\b|coffre/i;
/** The page check's formats (teachmask.ts secretBoxesScript KEY), for one OCR word. */
const KEY_WORD = /(?:sk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{16,}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[abeprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xai-[A-Za-z0-9]{16,}|hf_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;
/** A label after which the rest of the line is a secret. */
const LABEL = /^(?:pass(?:word|wd|phrase)?|pwd|mdp|motdepasse|passe|token|secret|api[-_]?key|apikey|key|cl[ée]|code|otp|pin|cvv|cvc|iban)[:=]?$/i;

/** One visible window as wmctrl lists it. */
export interface AppWindow { x: number; y: number; w: number; h: number; title: string }

/** `wmctrl -lG` output → windows (sticky panels of desktop -1 and empty ones dropped). */
export function parseWindows(text: string): AppWindow[] {
  const out: AppWindow[] = [];
  for (const line of text.split("\n")) {
    const m = /^0x[0-9a-f]+\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+\S+\s?(.*)$/i.exec(line.trim());
    if (!m || m[1] === "-1") continue;
    // Under openbox, wmctrl's y can be below the window's real top by up to its title bar's height (and x a little):
    // the box grows by that much upward and leftward, so nothing at the top of the window is left out.
    const x = Number(m[2]), y = Number(m[3]);
    const w = { x: Math.max(0, x - 8), y: Math.max(0, y - 48), w: Number(m[4]) + Math.min(8, x), h: Number(m[5]) + Math.min(48, y), title: m[6].trim() };
    if (w.w > 4 && w.h > 4) out.push(w);
  }
  return out.slice(0, 12);
}

/** The browser's own window: its page is masked by teachmask.ts. */
export const isBrowserWindow = (w: AppWindow) => /chrom/i.test(w.title);

/** Tesseract TSV of a window → boxes (screen pixels) of the words to hide. */
export function secretWordBoxes(tsv: string, ox: number, oy: number): Box[] {
  const words: { line: string; left: number; top: number; width: number; height: number; text: string }[] = [];
  for (const row of tsv.split("\n").slice(1)) {
    const c = row.split("\t");
    if (c.length < 12 || c[0] !== "5" || !c[11]?.trim()) continue;
    words.push({ line: `${c[2]}.${c[3]}.${c[4]}`, left: Number(c[6]), top: Number(c[7]), width: Number(c[8]), height: Number(c[9]), text: c[11].trim() });
  }
  const out: Box[] = [];
  const add = (w: (typeof words)[number]) => out.push([w.left + ox - 3, w.top + oy - 3, w.width + 6, w.height + 6]);
  let hideLine = "";
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (hideLine && w.line !== hideLine) hideLine = "";
    const bare = w.text.replace(/^[«"'(]+|[»"'),.;]+$/g, "");
    // « mot de passe : » is three words: the label is its last word.
    const label = LABEL.test(bare) || (/^passe[:=]?$/i.test(bare) && /^de$/i.test(words[i - 1]?.text ?? ""));
    if (hideLine) { add(w); continue; }
    if (KEY_WORD.test(bare) || /^(?:\d[ -]?){13,19}$/.test(bare)) add(w);
    // "password:" (or "password" then ":") hides the rest of the line; "password=hunter2" hides the word itself.
    if (label) hideLine = w.line;
    else if (/^[^=:]{2,24}[=:].+/.test(bare) && LABEL.test(bare.replace(/[=:].*$/, ""))) add(w);
    else if (/^[:=]$/.test(bare) && LABEL.test(words[i - 1]?.text.replace(/[:=]$/, "") ?? "") && words[i - 1]?.line === w.line) hideLine = w.line;
  }
  return out.slice(0, 200);
}

/** Boxes in screen pixels → in a picture `factor` times the screen's size. */
export const scaleBoxes = (boxes: Box[], factor: number): Box[] =>
  factor === 1 || !Number.isFinite(factor) || factor <= 0 ? boxes : boxes.map(([x, y, w, h]) => [Math.floor(x * factor), Math.floor(y * factor), Math.ceil(w * factor) + 1, Math.ceil(h * factor) + 1] as Box);

/** The width of the bot's screen in pixels (DESKTOP_RESOLUTION "1280x800x24"). */
export const screenWidth = () => Number(config.desktopResolution.split("x")[0]) || 1280;

/** The boxes to hide in the windows of apps on the bot's Linux screen (screen pixels). Never throws. */
export async function appSecretBoxes(botId: string, run: typeof docker = docker): Promise<Box[]> {
  const name = containerName(botId);
  let windows: AppWindow[];
  try {
    const r = await run(["exec", name, "sh", "-c", "DISPLAY=:1 wmctrl -lG 2>/dev/null || true"], { timeoutMs: 6000 });
    windows = parseWindows(r.stdout.toString("utf8")).filter((w) => !isBrowserWindow(w));
  } catch { return []; }
  const out: Box[] = [];
  for (const w of windows) {
    const whole: Box = [w.x, w.y, w.w, w.h];
    if (SECRET_WINDOW.test(w.title)) { out.push(whole); continue; }
    try {
      const crop = `${w.w}x${w.h}+${w.x}+${w.y}`;
      const r = await run(["exec", name, "sh", "-c", `command -v tesseract >/dev/null || exit 40; DISPLAY=:1 import -silent -window root -crop ${crop} png:- 2>/dev/null | tesseract stdin stdout -l fra+eng tsv 2>/dev/null`], { timeoutMs: 12_000 });
      if (r.code !== 0 || !r.stdout.length) { out.push(whole); continue; }
      out.push(...secretWordBoxes(r.stdout.toString("utf8"), w.x, w.y));
    } catch { out.push(whole); }
  }
  return out.slice(0, 200);
}
