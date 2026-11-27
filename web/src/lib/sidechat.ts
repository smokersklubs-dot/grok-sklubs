/**
 * L146 « discussions côte à côte »: other bots' chats beside the selected one (wide screens only), so bots that work at
 * the same time can be followed live — one beside it from 1 100 px, up to three (a 2×2 grid with the main chat) from
 * 1 400 px. Which bots are beside is remembered on this device (a convenience: a browser that keeps nothing simply starts
 * without them). Ideas only (Timon T29, Agent Zero): our own code.
 */
import { create } from "zustand";

const KEY = "sklubot.sideChat";
/** Narrowest window (px) that shows two chats side by side; narrower, the second chat is not offered. */
export const SIDE_MIN_WIDTH = 1100;
/** Narrowest window (px) that shows the 2×2 grid (the main chat and up to three others); narrower, only the first one. */
export const GRID_MIN_WIDTH = 1400;
/** At most this many chats beside the main one (a 2×2 grid). */
export const MAX_SIDE = 3;
const ID = /^[\w-]{1,80}$/;

/** What this device kept: a list of ids (an older version kept one id as a plain string). Anything else: none. */
export function parseSaved(v: string | null): string[] {
  if (!v) return [];
  if (ID.test(v)) return [v];
  try {
    const list = JSON.parse(v);
    return Array.isArray(list) ? [...new Set(list.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, MAX_SIDE) : [];
  } catch { return []; }
}
function saved(): string[] {
  try { return parseSaved(localStorage.getItem(KEY)); } catch { return []; }
}
function keep(ids: string[]) {
  try { if (ids.length) localStorage.setItem(KEY, JSON.stringify(ids)); else localStorage.removeItem(KEY); } catch { /* not kept */ }
}

/** `ids`: the bots beside, in grid order; `botId`: the first one (kept for the callers of the two-column version). */
interface SideState { ids: string[]; botId: string | null; open: (id: string) => void; add: (id: string) => void; remove: (id: string) => void; set: (ids: string[]) => void; close: () => void }
const next = (ids: string[]) => { const clean = [...new Set(ids.filter((x) => ID.test(x)))].slice(0, MAX_SIDE); keep(clean); return { ids: clean, botId: clean[0] ?? null }; };
export const useSideChat = create<SideState>((set, get) => {
  const first = typeof localStorage === "undefined" ? [] : saved();
  return {
    ids: first, botId: first[0] ?? null,
    open: (id) => set(next([id])),
    add: (id) => set(next([...get().ids.filter((x) => x !== id), id])),
    remove: (id) => set(next(get().ids.filter((x) => x !== id))),
    set: (ids) => set(next(ids)),
    close: () => set(next([])),
  };
});

/** The bots that can go beside `mainId`: every other bot of the list that still exists (rooms included), in list order. */
export function sideCandidates<B extends { id: string; hidden?: boolean }>(bots: B[], mainId: string | null): B[] {
  return bots.filter((b) => b.id !== mainId && !b.hidden);
}

/** The bot shown beside, or null: not set, gone, the same as the main one, or a window too narrow. */
export function sideBotId(side: string | null, mainId: string | null, exists: (id: string) => boolean, width: number): string | null {
  if (!side || side === mainId || !exists(side) || width < SIDE_MIN_WIDTH) return null;
  return side;
}

/** The bots shown beside now: still there, not the main one, one only under 1 400 px, none under 1 100 px. */
export function sideBotIds(ids: string[], mainId: string | null, exists: (id: string) => boolean, width: number): string[] {
  if (width < SIDE_MIN_WIDTH) return [];
  const list = ids.filter((id) => id !== mainId && exists(id));
  return list.slice(0, width < GRID_MIN_WIDTH ? 1 : MAX_SIDE);
}

/** The class of the window's layout: "" (one chat), "has-side" (two columns) or "has-grid has-grid-N" (N chats beside). */
export function layoutClass(shown: number): string {
  return shown <= 0 ? "" : shown === 1 ? "has-side" : `has-grid has-grid-${Math.min(shown, MAX_SIDE)}`;
}
