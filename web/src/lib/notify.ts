/**
 * Browser notifications for "a bot needs you" and "a bot finished a reply".
 * The on/off choice lives on this device (localStorage); the browser's own permission still decides.
 */
const KEY = "sklubot.notify";
const GAP_MS = 20_000;
const lastAt = new Map<string, number>();

export type NotifySupport = "ok" | "unsupported" | "denied";

export function notifySupport(): NotifySupport {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission === "denied" ? "denied" : "ok";
}

/** True when the user switched notifications on here and the browser still allows them. */
export function notifyEnabled(): boolean {
  if (notifySupport() !== "ok" || Notification.permission !== "granted") return false;
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function store(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}

/** Switch notifications on (asking the browser when needed) or off. Resolves to the resulting state. */
export async function setNotifyEnabled(on: boolean): Promise<boolean> {
  if (!on) {
    store(false);
    return false;
  }
  if (notifySupport() !== "ok") return false;
  let permission = Notification.permission;
  if (permission !== "granted") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = Notification.permission;
    }
  }
  const granted = permission === "granted";
  store(granted);
  return granted;
}

/** Show one notification for a bot; at most one per bot every 20 s. Clicking it focuses the window. */
export function notifyBot(botId: string, title: string, body: string, onClick: () => void): void {
  if (!notifyEnabled()) return;
  const now = Date.now();
  if (now - (lastAt.get(botId) ?? 0) < GAP_MS) return;
  lastAt.set(botId, now);
  try {
    const n = new Notification(title, { body, tag: `sklubot-${botId}`, icon: "/icon-192.png" });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker; nothing to show then */
  }
}
