import { useCallback, useEffect, useRef, useState } from "react";

export type ScreenStatus = "loading" | "none" | "ok" | "error";

/**
 * Poll a bot's desktop screenshot (JPEG; 204 means no desktop is open yet).
 * Only polls while `active` and while the tab is visible.
 */
export function useScreen(botId: string | null, intervalMs: number, active: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ScreenStatus>("loading");
  const loader = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!botId || !active) return;
    let dead = false;
    let busy = false;
    let current: string | null = null;
    const swap = (next: string | null) => {
      const old = current;
      current = next;
      setUrl(next);
      if (old) window.setTimeout(() => URL.revokeObjectURL(old), 1500);
    };
    const load = async () => {
      if (dead || busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const res = await fetch(`/api/bots/${botId}/screen`, { credentials: "same-origin", cache: "no-store" });
        if (dead) return;
        if (res.status === 204) {
          swap(null);
          setStatus("none");
        } else if (res.ok) {
          const blob = await res.blob();
          if (dead) return;
          swap(URL.createObjectURL(blob));
          setStatus("ok");
        } else {
          setStatus("error");
        }
      } catch {
        if (!dead) setStatus("error");
      } finally {
        busy = false;
      }
    };
    loader.current = () => void load();
    void load();
    const timer = window.setInterval(() => void load(), intervalMs);
    const onVisible = () => void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      dead = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      loader.current = () => undefined;
      if (current) URL.revokeObjectURL(current);
      setUrl(null);
      setStatus("loading");
    };
  }, [botId, intervalMs, active]);

  const refresh = useCallback(() => loader.current(), []);
  return { url, status, refresh };
}
