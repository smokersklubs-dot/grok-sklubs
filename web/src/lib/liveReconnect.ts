import { useCallback, useEffect, useRef, useState } from "react";
import { reconnectDelay } from "./reconnect";

/**
 * L149 — the live screen's reconnection, shared by the large view and the small panel. A stream that worked and dropped is
 * tried again after 1, 2, 4, 8 and 15 s (reconnect.ts); a stream that never opened since the view (or `resetKey`) changed
 * falls back to screenshots (`onNeverOpened`). `key` goes on <LiveScreen key=…> so each try opens a fresh stream.
 */
export function useLiveReconnect(resetKey: string, onNeverOpened: () => void) {
  const [key, setKey] = useState(0);
  const [waiting, setWaiting] = useState<{ attempt: number; dueAt: number } | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const tries = useRef(0);
  const everUp = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const neverOpened = useRef(onNeverOpened);
  neverOpened.current = onNeverOpened;
  const clear = () => { window.clearTimeout(timer.current); timer.current = undefined; };
  useEffect(() => { clear(); tries.current = 0; everUp.current = false; setWaiting(null); setGaveUp(false); }, [resetKey]);
  useEffect(() => clear, []);

  const connected = useCallback(() => { clear(); tries.current = 0; everUp.current = true; setWaiting(null); setGaveUp(false); }, []);
  const dropped = useCallback(() => {
    if (!everUp.current) { neverOpened.current(); return; }
    const delay = reconnectDelay(tries.current);
    clear();
    if (delay === null) { setWaiting(null); setGaveUp(true); return; }
    tries.current++;
    setWaiting({ attempt: tries.current, dueAt: Date.now() + delay });
    timer.current = window.setTimeout(() => { timer.current = undefined; setKey((k) => k + 1); }, delay);
  }, []);
  const retryNow = useCallback(() => { clear(); tries.current = 0; setWaiting(null); setGaveUp(false); setKey((k) => k + 1); }, []);
  return { key, waiting, gaveUp, connected, dropped, retryNow };
}
