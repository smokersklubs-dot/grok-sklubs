import { useStore } from "./store";
import type { ServerEvent } from "./types";
import { startAnnouncements, useAnnouncements } from "./lib/announcements";

/**
 * One server-sent event stream for the whole app.
 * Reconnects with a backoff of 1 s doubling up to 15 s, and re-syncs state after every reconnect.
 */
let source: EventSource | null = null;
let retryTimer: number | undefined;
let delay = 1000;
let connectedBefore = false;
let listening = false;

function open(): void {
  window.clearTimeout(retryTimer);
  source?.close();
  const es = new EventSource("/api/events");
  source = es;

  es.onopen = () => {
    if (source !== es) return;
    useStore.setState({ online: true });
    if (connectedBefore) { useStore.getState().resync(); void useAnnouncements.getState().load(); }
    connectedBefore = true;
  };

  es.onmessage = (msg: MessageEvent<string>) => {
    if (source !== es) return;
    let ev: ServerEvent;
    try {
      ev = JSON.parse(msg.data) as ServerEvent;
    } catch {
      return;
    }
    if (!ev || typeof ev !== "object") return;
    if (ev.type === "hello") delay = 1000;
    if (ev.type === "hello" || ev.type === "ping") return;
    // « Annonces »: their own small store (lib/announcements.ts).
    if (ev.type === "announcements") { void useAnnouncements.getState().load(); return; }
    useStore.getState().applyEvent(ev);
  };

  es.onerror = () => {
    if (source !== es) return;
    es.close();
    source = null;
    useStore.setState({ online: false });
    if (useStore.getState().boot !== "ready") return;
    retryTimer = window.setTimeout(open, delay);
    delay = Math.min(delay * 2, 15_000);
  };
}

export function connectEvents(): void {
  if (source) return;
  delay = 1000;
  open();
  startAnnouncements();
  if (!listening) {
    listening = true;
    // A click on a push notification while the app is open: the service worker says which bot to show.
    navigator.serviceWorker?.addEventListener("message", (e: MessageEvent) => {
      const data = e.data as { type?: string; botId?: string; view?: string } | null;
      if (data?.type === "sklubot-open-bot" && data.botId) useStore.getState().selectBot(data.botId);
      // The daily digest ("Aujourd'hui") opens the Today page.
      if (data?.type === "sklubot-open-view" && data.view === "today") useStore.getState().setView("today");
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      const s = useStore.getState();
      const id = s.selectedId;
      if (s.boot === "ready" && s.view === "chat" && id && (s.bots[id]?.unread ?? 0) > 0) void s.markRead(id);
    });
  }
}
