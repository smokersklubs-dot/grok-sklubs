/**
 * The Sklubot desktop app (companion/) shows this web app in its own window and adds `window.sklubotDesktop`
 * (companion/src/preload/web-preload.js). Everything here is optional: in a browser the bridge is absent and
 * these calls do nothing.
 */
import { useEffect } from "react";
import { useStore } from "../store";

interface SklubotDesktop {
  isDesktop: true;
  platform: string;
  setBadge(n: number): void;
  focus(): void;
}

declare global {
  interface Window {
    sklubotDesktop?: SklubotDesktop;
  }
}

export const desktopApp = (): SklubotDesktop | undefined => (typeof window === "undefined" ? undefined : window.sklubotDesktop);

/** Total unread messages, sent to the desktop app's tray / Dock / taskbar badge whenever it changes. */
export function useDesktopBadge(): void {
  const unread = useStore((s) => Object.values(s.bots).reduce((n, b) => n + (b.unread > 0 ? b.unread : 0), 0));
  const signedIn = useStore((s) => s.boot === "ready");
  useEffect(() => {
    desktopApp()?.setBadge(signedIn ? unread : 0);
  }, [unread, signedIn]);
}

/** Brings the desktop app's window back (it may be hidden in the tray). */
export function focusDesktopWindow(): void {
  desktopApp()?.focus();
}
