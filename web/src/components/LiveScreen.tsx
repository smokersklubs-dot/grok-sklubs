import { useEffect, useRef } from "react";
import RFBExport from "@novnc/novnc/lib/rfb.js";
import type { ScreenClient } from "../lib/reconnect";

// The client is published as CommonJS; depending on the bundler its class arrives wrapped once more.
const RFB: typeof RFBExport = (RFBExport as unknown as { default?: typeof RFBExport }).default ?? RFBExport;

/**
 * A bot's Linux screen, streamed live (remote-screen protocol over a WebSocket). In watch mode the
 * server only opens a view-only stream, so nothing typed or clicked here can reach the computer.
 */
export function LiveScreen({ botId, control, label, onConnect, onClose, onClient }: {
  botId: string;
  control: boolean;
  label: string;
  onConnect?: () => void;
  onClose?: () => void;
  /** L149: the connected client (paste, Ctrl+Alt+Del, capture), or null once the stream is closed. */
  onClient?: (client: ScreenClient | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onConnect, onClose, onClient });
  handlers.current = { onConnect, onClose, onClient };

  useEffect(() => {
    if (!box.current) return;
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const url = `${scheme}://${location.host}/api/bots/${encodeURIComponent(botId)}/vnc?mode=${control ? "control" : "watch"}`;
    let rfb: RFBExport;
    try {
      rfb = new RFB(box.current, url, { wsProtocols: ["binary"], shared: true });
    } catch (err) {
      console.error("live screen", err);
      handlers.current.onClose?.();
      return;
    }
    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    rfb.viewOnly = !control;
    rfb.focusOnClick = control;
    rfb.background = "transparent";
    rfb.addEventListener("connect", () => { handlers.current.onClient?.(rfb); handlers.current.onConnect?.(); if (control) rfb.focus(); });
    rfb.addEventListener("disconnect", () => { handlers.current.onClient?.(null); handlers.current.onClose?.(); });
    return () => { handlers.current.onClient?.(null); try { rfb.disconnect(); } catch { /* already closed */ } };
  }, [botId, control]);

  return <div className={`live-screen ${control ? "is-control" : ""}`} ref={box} role="img" aria-label={label} />;
}
