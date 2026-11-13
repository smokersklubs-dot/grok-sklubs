import { useStore } from "./store";
import type { ServerEvent } from "./types";

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
    if (connectedBefore) useStore.getState().resync();
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
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      const s = useStore.getState();
      const id = s.selectedId;
      if (s.boot === "ready" && s.view === "chat" && id && (s.bots[id]?.unread ?? 0) > 0) void s.markRead(id);
    });
  }
}
