/**
 * L146 « dispositions enregistrées »: a named arrangement of chats — the main bot and the ones beside it — saved on THIS
 * device (browser storage; it does not follow the owner to another device, and the menu says so) and brought back in one
 * click. A bot deleted since is skipped, and how many were skipped is said. Ideas only (Timon T29): our own code.
 */
/** As lib/sidechat.ts MAX_SIDE (not imported: this file is also loaded by the node tests, which need no bundler). */
const MAX_SIDE = 3;

export interface ChatLayout { id: string; name: string; main: string; side: string[]; savedAt: number }
export const LAYOUTS_KEY = "sklubot.chatLayouts";
export const MAX_LAYOUTS = 8;
const ID = /^[\w-]{1,80}$/;

/** The layouts kept on this device; anything malformed is dropped. */
export function parseLayouts(raw: string | null): ChatLayout[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((l): l is ChatLayout => !!l && typeof l === "object" && typeof l.id === "string" && typeof l.name === "string" && l.name.trim() !== "" && typeof l.main === "string" && ID.test(l.main) && Array.isArray(l.side))
      .map((l) => ({ id: l.id, name: l.name.slice(0, 40), main: l.main, side: l.side.filter((x: unknown): x is string => typeof x === "string" && ID.test(x)).slice(0, MAX_SIDE), savedAt: Number(l.savedAt) || 0 }))
      .slice(0, MAX_LAYOUTS);
  } catch { return []; }
}

/**
 * Adds (or replaces, same name ignoring case) a layout. Refused (null) without a name, a main bot or anything beside it,
 * or when MAX_LAYOUTS are kept and the name is new.
 */
export function addLayout(list: ChatLayout[], name: string, main: string | null, side: string[], now = Date.now()): ChatLayout[] | null {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 40);
  const beside = side.filter((x) => x !== main && ID.test(x)).slice(0, MAX_SIDE);
  if (!n || !main || !ID.test(main) || !beside.length) return null;
  const same = list.find((l) => l.name.toLowerCase() === n.toLowerCase());
  if (!same && list.length >= MAX_LAYOUTS) return null;
  const layout: ChatLayout = { id: same?.id ?? `lay_${now.toString(36)}`, name: n, main, side: beside, savedAt: now };
  return same ? list.map((l) => (l.id === same.id ? layout : l)) : [...list, layout];
}

export const removeLayout = (list: ChatLayout[], id: string) => list.filter((l) => l.id !== id);

/** What applying a layout shows now: the bots that still exist (the main one falls back to the first one left). */
export function applyLayout(l: ChatLayout, exists: (id: string) => boolean): { main: string | null; side: string[]; skipped: number } {
  const all = [l.main, ...l.side];
  const left = all.filter(exists);
  return { main: left[0] ?? null, side: left.slice(1), skipped: all.length - left.length };
}

export function loadLayouts(): ChatLayout[] {
  try { return parseLayouts(localStorage.getItem(LAYOUTS_KEY)); } catch { return []; }
}
export function storeLayouts(list: ChatLayout[]): boolean {
  try { localStorage.setItem(LAYOUTS_KEY, JSON.stringify(list)); return true; } catch { return false; }
}
