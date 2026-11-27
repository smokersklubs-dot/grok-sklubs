import { useState, type RefObject } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";
import { fractionIn, REMARK_MAX, screenPointMessage } from "../lib/remarks";
import { quickSend } from "../lib/quicksend";
import "./Remarks.css";

/**
 * L140 « Montrer »: while watching the bot's screen (not driving it), « Montrer » lays a transparent layer over the
 * picture. One click (or tap) places a pin; a box asks what to do there; « Envoyer » tells the bot the spot — in the
 * screen's own pixels when its size is known (the live canvas or the screenshot) — and the request (lib/remarks.ts).
 * Nothing is clicked on the bot's computer: it is only a message. Our own code (idea: Timon T75, Agent Zero).
 */
function screenOf(stage: HTMLElement | null): { el: HTMLElement; size: { w: number; h: number } | null } | null {
  const el = stage?.querySelector<HTMLCanvasElement>(".live-screen canvas") ?? stage?.querySelector<HTMLImageElement>(":scope > img") ?? null;
  if (!el) return null;
  const w = el instanceof HTMLCanvasElement ? el.width : el.naturalWidth;
  const h = el instanceof HTMLCanvasElement ? el.height : el.naturalHeight;
  return { el, size: w > 0 && h > 0 ? { w, h } : null };
}

export function ShowOnScreen({ botId, botName, stage, onClose }: { botId: string; botName: string; stage: RefObject<HTMLElement | null>; onClose: () => void }) {
  const t = useT();
  const [spot, setSpot] = useState<{ x: number; y: number; left: number; top: number; size: { w: number; h: number } | null } | null>(null);
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const pick = (clientX: number, clientY: number) => {
    const screen = screenOf(stage.current);
    const layer = stage.current?.getBoundingClientRect();
    if (!screen || !layer) return;
    const f = fractionIn(screen.el.getBoundingClientRect(), clientX, clientY);
    if (!f) return;
    setSpot({ ...f, left: clientX - layer.left, top: clientY - layer.top, size: screen.size });
  };
  const send = async () => {
    if (!spot) return;
    const text = screenPointMessage(t("remarks.screenHead", { name: botName }), spot.x, spot.y, spot.size, remark);
    if (!text) return;
    setBusy(true);
    const ok = await quickSend(botId, text);
    setBusy(false);
    if (ok) { useStore.getState().showToast(t("passage.sent")); onClose(); }
  };
  return (
    <div className="show-layer" role="application" aria-label={t("remarks.screenLayer")}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { if (e.target === e.currentTarget) pick(e.clientX, e.clientY); }}>
      {!spot && <p className="show-tip" role="status">{t("remarks.screenTip")}</p>}
      {spot && <span className="annotate-pin" style={{ left: spot.left, top: spot.top }} aria-hidden="true">1</span>}
      {spot && (
        <form className="show-box remark-form" onSubmit={(e) => { e.preventDefault(); void send(); }} onClick={(e) => e.stopPropagation()}>
          <textarea className="input remark-input" autoFocus rows={2} maxLength={REMARK_MAX} value={remark} placeholder={t("remarks.screenPlaceholder", { name: botName })} aria-label={t("remarks.screenPlaceholder", { name: botName })} onChange={(e) => setRemark(e.target.value)} />
          <div className="remark-actions">
            <button type="button" className="btn btn-small btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
            <button type="button" className="btn btn-small" onClick={() => setSpot(null)}>{t("remarks.screenAgain")}</button>
            <button type="submit" className="btn btn-small btn-accent" disabled={busy || !remark.trim()}>{t("passage.send")}</button>
          </div>
        </form>
      )}
    </div>
  );
}
