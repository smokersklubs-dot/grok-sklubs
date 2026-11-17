import { create } from "zustand";
import { api, enc } from "../api";
import type { AnnouncementsState } from "../types";

/**
 * « Annonces » on the reader's side (server: server/src/announcements.ts): what is up for me, the bell's unread count,
 * the maintenance band. Kept apart from the main store: loaded at start, on every `announcements` event (events.ts),
 * when the window comes back, and every 10 minutes (a scheduled one also arrives by event when it starts).
 */
interface AnnouncementsStore {
  state: AnnouncementsState | null;
  load(): Promise<void>;
  /** The bell was opened: these are seen (an important one still counts until "J'ai lu"). */
  seen(ids: string[]): Promise<void>;
  dismiss(id: string): Promise<void>;
  setEmail(on: boolean): Promise<void>;
}

export const useAnnouncements = create<AnnouncementsStore>((set, get) => ({
  state: null,
  async load() {
    try { set({ state: await api<AnnouncementsState>("GET", "/announcements") }); } catch { /* the bell stays as it was */ }
  },
  async seen(ids) {
    const cur = get().state;
    if (!cur || !ids.length) return;
    // At once on screen; the server's answer follows.
    set({ state: { ...cur, items: cur.items.map((i) => (ids.includes(i.id) && i.kind !== "important" ? { ...i, unread: false } : i)), unread: cur.items.filter((i) => i.unread && (i.kind === "important" || !ids.includes(i.id))).length } });
    try { set({ state: await api<AnnouncementsState>("POST", "/announcements/seen", { ids }) }); } catch { /* counted again at the next load */ }
  },
  async dismiss(id) {
    const cur = get().state;
    if (cur) {
      const items = cur.items.filter((i) => i.id !== id);
      set({ state: { ...cur, items, unread: items.filter((i) => i.unread).length, site: cur.site?.id === id ? null : cur.site } });
    }
    try { set({ state: await api<AnnouncementsState>("POST", `/announcements/${enc(id)}/dismiss`) }); } catch { void get().load(); }
  },
  async setEmail(on) {
    set({ state: await api<AnnouncementsState>("PUT", "/announcements/prefs", { email: on }) });
  },
}));

let started = false;
/** Called once the app is signed in (store.ts init → events.ts connect). */
export function startAnnouncements(): void {
  if (started) return;
  started = true;
  const again = () => { if (document.visibilityState === "visible") void useAnnouncements.getState().load(); };
  void useAnnouncements.getState().load();
  document.addEventListener("visibilitychange", again);
  window.setInterval(again, 10 * 60_000);
}
