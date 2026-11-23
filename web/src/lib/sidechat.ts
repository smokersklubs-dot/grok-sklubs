/**
 * L146 « discussions côte à côte »: a second bot's chat beside the selected one (wide screens only), so two bots that
 * work at the same time can be followed live. Which bot is beside is remembered on this device (a convenience: a
 * browser that keeps nothing simply starts without one). Ideas only (Timon T29, Agent Zero): our own code.
 */
import { create } from "zustand";

const KEY = "sklubot.sideChat";
/** Narrowest window (px) that shows two chats side by side; narrower, the second chat is not offered. */
export const SIDE_MIN_WIDTH = 1100;

function saved(): string | null {
  try { const v = localStorage.getItem(KEY); return v && /^[\w-]{1,80}$/.test(v) ? v : null; } catch { return null; }
}

export const useSideChat = create<{ botId: string | null; open: (id: string) => void; close: () => void }>((set) => ({
  botId: typeof localStorage === "undefined" ? null : saved(),
  open: (id) => { try { localStorage.setItem(KEY, id); } catch { /* not kept */ } set({ botId: id }); },
  close: () => { try { localStorage.removeItem(KEY); } catch { /* nothing kept */ } set({ botId: null }); },
}));

/** The bots that can go beside `mainId`: every other bot of the list that still exists (rooms included), in list order. */
export function sideCandidates<B extends { id: string; hidden?: boolean }>(bots: B[], mainId: string | null): B[] {
  return bots.filter((b) => b.id !== mainId && !b.hidden);
}

/** The bot shown beside, or null: not set, gone, the same as the main one, or a window too narrow. */
export function sideBotId(side: string | null, mainId: string | null, exists: (id: string) => boolean, width: number): string | null {
  if (!side || side === mainId || !exists(side) || width < SIDE_MIN_WIDTH) return null;
  return side;
}
