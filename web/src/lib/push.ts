/**
 * Real push notifications on this device (Web Push), even with Sklubot closed.
 * Uses the standard Push API (https://developer.mozilla.org/docs/Web/API/PushManager/subscribe):
 * the service worker (sw.js) subscribes with the server's VAPID public key, and the server sends encrypted messages
 * to the push service of this browser. iPhone and iPad only allow it for the app added to the Home Screen
 * (iOS / iPadOS 16.4 or later: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
 */
import { api } from "../api";
import type { PushDevice, PushState } from "../types";

const FLAG = "sklubot.push";

export type PushSupport = "ok" | "unsupported" | "ios-home-screen" | "denied";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (isIos() && !standalone()) return "ios-home-screen";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return Notification.permission === "denied" ? "denied" : "ok";
}

/** True when this device receives push notifications: local notifications are then left to the push. */
export function pushActiveHere(): boolean {
  try {
    return localStorage.getItem(FLAG) === "1" && "Notification" in window && Notification.permission === "granted";
  } catch {
    return false;
  }
}
function flag(on: boolean) {
  try {
    if (on) localStorage.setItem(FLAG, "1");
    else localStorage.removeItem(FLAG);
  } catch {
    /* storage unavailable */
  }
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "ok") return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** A readable name for this device, e.g. "Chrome · Android". */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : isIos() ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

/** Asks the browser's permission, subscribes, and registers this device on the server. */
export async function enablePush(state: PushState): Promise<PushDevice> {
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") throw new Error("denied");
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another server key cannot be reused.
  const want = keyBytes(state.publicKey);
  const have = sub?.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
  if (sub && (!have || have.length !== want.length || have.some((b, i) => b !== want[i]))) {
    await sub.unsubscribe().catch(() => undefined);
    sub = null;
  }
  // userVisibleOnly: every push shows a notification (required by Chrome; see the PushManager docs above).
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  const r = await api<{ device: PushDevice }>("POST", "/push/subscribe", { subscription: sub.toJSON(), label: deviceLabel() });
  flag(true);
  return r.device;
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  flag(false);
  if (!sub) return;
  await api("POST", "/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

// ── Presence: the server pushes a finished reply only when no window of the app is visible ──
let started = false;
const clientId = Math.random().toString(36).slice(2, 12);
export function startPresence(): void {
  if (started || typeof document === "undefined") return;
  started = true;
  const report = () => {
    void api("POST", "/presence", { clientId, visible: document.visibilityState === "visible" }).catch(() => undefined);
  };
  report();
  document.addEventListener("visibilitychange", report);
  window.addEventListener("pagehide", () => {
    try {
      navigator.sendBeacon?.("/api/presence", new Blob([JSON.stringify({ clientId, visible: false })], { type: "application/json" }));
    } catch {
      /* best effort */
    }
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") report();
  }, 45_000);
}
