/*
 * Portions adapted from thomasbek3/hermes-bot-kit (https://github.com/thomasbek3/hermes-bot-kit, commit
 * ae8a590e5ac21fdbdf77dc4ddc030e59acd15a68, computer-viewer/plugin.js: BACKOFF_MS, scheduleBackoff, pasteClipboard,
 * takeScreenshot), Copyright (c) 2026 Thomas Bekkers, MIT; modified for Sklubot: pure functions without the plugin's
 * engine state, a paste that also sends Ctrl+V, the capture saved as a file named after the bot, French messages.
 */

/**
 * L149 — the live screen reconnects by itself when its stream drops after working: after 1, 2, 4, 8 then 15 seconds (5
 * tries), then it says the computer cannot be reached and offers « Reconnecter ». A stream that never opened falls back to
 * screenshots, as before.
 */
export const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000] as const;

/** The wait before try number `attempt + 1` (0-based), or null once every try was used. */
export function reconnectDelay(attempt: number): number | null {
  return attempt >= 0 && attempt < BACKOFF_MS.length ? BACKOFF_MS[attempt] : null;
}

/** What the viewer shows while the stream is down: "wait" (a try is planned in `seconds`), or "gave-up". */
export type ReconnectView = { kind: "wait"; attempt: number; of: number; seconds: number } | { kind: "gave-up" };
export function reconnectView(attempt: number, msLeft: number): ReconnectView {
  if (reconnectDelay(attempt - 1) === null) return { kind: "gave-up" };
  return { kind: "wait", attempt, of: BACKOFF_MS.length, seconds: Math.max(0, Math.ceil(msLeft / 1000)) };
}

/** The parts of the noVNC client the tools below use. */
export interface ScreenClient {
  clipboardPasteFrom(text: string): void;
  sendKey(keysym: number, code: string | null, down?: boolean): void;
  sendCtrlAltDel(): void;
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
}

// X11 keysyms (https://www.x.org/releases/current/doc/xproto/x11protocol.html#keysym_encoding): Control_L, "v".
const XK_CONTROL_L = 0xffe3;
const XK_V = 0x0076;

/**
 * « Coller » : the text becomes the bot's clipboard, then Ctrl+V pastes it where the cursor is. Returns false when there is
 * nothing to paste.
 */
export function pasteInto(client: ScreenClient, text: string): boolean {
  if (!text) return false;
  client.clipboardPasteFrom(text);
  client.sendKey(XK_CONTROL_L, "ControlLeft", true);
  client.sendKey(XK_V, "KeyV");
  client.sendKey(XK_CONTROL_L, "ControlLeft", false);
  return true;
}

/** The capture's file name: « ecran-<bot>-<date>.png », letters and digits only. */
export function captureName(botName: string, at = new Date()): string {
  const slug = botName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "bot";
  const p = (n: number) => String(n).padStart(2, "0");
  return `ecran-${slug}-${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}.png`;
}

/** The screen as a PNG (null when the stream has no picture yet). */
export const captureBlob = (client: ScreenClient): Promise<Blob | null> => new Promise((resolve) => { try { client.toBlob((b) => resolve(b), "image/png"); } catch { resolve(null); } });
