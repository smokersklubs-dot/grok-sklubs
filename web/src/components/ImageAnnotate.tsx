import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { api, apiUpload, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Attachment, Row } from "../types";
import { fractionIn, imageRemarkMessage, REMARK_MAX, type Pin } from "../lib/remarks";
import { sendKeysFor } from "../../../mobile/shared/sendKey";
import { Icon } from "./Icon";
import { Modal } from "./ui";
import "./Remarks.css";

/**
 * L140 « Annoter une image »: from the full-window view of an image of the chat, « Annoter » opens the picture with a
 * red pen and numbered pins (each with its note). « Envoyer » draws the strokes and pins onto a copy of the picture
 * (at most 2 048 px on its longest side), adds it to the next message as a new file, with one line per pin and the
 * general remark (lib/remarks.ts). The original file is never changed. Our own code.
 */
type Stroke = { x: number; y: number }[];
const MAX_SIDE = 2048;
const PEN = "#e11d48"; // drawn into the picture itself (not a theme colour): the same red in light and dark

/** Draws the strokes and numbered pins on a 2D context of the given size (fractions → pixels). */
function drawMarks(g: CanvasRenderingContext2D, w: number, h: number, strokes: Stroke[], pins: Pin[]) {
  const lw = Math.max(3, Math.round(Math.max(w, h) / 300));
  g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = PEN; g.lineWidth = lw;
  for (const s of strokes) {
    if (s.length < 2) continue;
    g.beginPath(); g.moveTo(s[0].x * w, s[0].y * h);
    for (const p of s.slice(1)) g.lineTo(p.x * w, p.y * h);
    g.stroke();
  }
  const r = Math.max(12, Math.round(Math.max(w, h) / 70));
  pins.forEach((p, i) => {
    g.beginPath(); g.arc(p.x * w, p.y * h, r, 0, Math.PI * 2); g.fillStyle = PEN; g.fill();
    g.lineWidth = Math.max(2, r / 6); g.strokeStyle = "#ffffff"; g.stroke();
    g.fillStyle = "#ffffff"; g.font = `700 ${Math.round(r * 1.1)}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(i + 1), p.x * w, p.y * h + 1);
  });
}

export function ImageAnnotate({ botId, src, name, onClose }: { botId: string; src: string; name: string; onClose: () => void }) {
  const t = useT();
  const img = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<"pen" | "pin">("pin");
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [pins, setPins] = useState<Pin[]>([]);
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drawing = useRef<Stroke | null>(null);

  // The on-screen canvas mirrors the strokes (pins are drawn as HTML badges above it, so they stay readable).
  useEffect(() => {
    const c = canvas.current;
    const i = img.current;
    if (!c || !i) return;
    const paint = () => {
      c.width = i.clientWidth * devicePixelRatio; c.height = i.clientHeight * devicePixelRatio;
      const g = c.getContext("2d");
      if (!g) return;
      g.clearRect(0, 0, c.width, c.height);
      drawMarks(g, c.width, c.height, drawing.current ? [...strokes, drawing.current] : strokes, []);
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(i);
    return () => ro.disconnect();
  }, [strokes]);

  const at = (e: ReactPointerEvent) => (canvas.current ? fractionIn(canvas.current.getBoundingClientRect(), e.clientX, e.clientY) : null);
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = at(e);
    if (!p) return;
    if (tool === "pin") { if (pins.length < 20) setPins((list) => [...list, { ...p, note: "" }]); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = [p];
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const p = at(e);
    if (p) { drawing.current.push(p); setStrokes((s) => [...s]); }
  };
  const up = () => {
    const s = drawing.current;
    drawing.current = null;
    if (s && s.length > 1) setStrokes((list) => [...list, s]);
  };

  const size = img.current?.naturalWidth ? { w: img.current.naturalWidth, h: img.current.naturalHeight } : null;
  const message = imageRemarkMessage(t("remarks.imageHead", { name }), pins, remark, size);
  const canSend = !busy && (strokes.length > 0 || pins.length > 0) && !!message;

  const send = async () => {
    const i = img.current;
    if (!i || !i.naturalWidth) return;
    setBusy(true); setError(null);
    try {
      const k = Math.min(1, MAX_SIDE / Math.max(i.naturalWidth, i.naturalHeight));
      const out = document.createElement("canvas");
      out.width = Math.round(i.naturalWidth * k); out.height = Math.round(i.naturalHeight * k);
      const g = out.getContext("2d");
      if (!g) throw new Error(t("api.generic"));
      g.drawImage(i, 0, 0, out.width, out.height);
      drawMarks(g, out.width, out.height, strokes, pins);
      const blob = await new Promise<Blob | null>((ok) => out.toBlob(ok, "image/png"));
      if (!blob) throw new Error(t("api.generic"));
      const file = new File([blob], `${name.replace(/\.[^.]+$/, "") || "image"}-annotee.png`, { type: "image/png" });
      const { attachment } = await apiUpload<{ attachment: Attachment }>(`/bots/${encodeURIComponent(botId)}/uploads`, file);
      const keys = sendKeysFor(botId);
      const r = await api<{ row: Row }>("POST", `/bots/${encodeURIComponent(botId)}/messages`, { text: message, attachments: [attachment.path], clientKey: keys.keyFor(JSON.stringify([message, [attachment.path], false])) });
      keys.done();
      useStore.getState().addRows(botId, [r.row]);
      useStore.getState().showToast(t("passage.sent"));
      onClose();
    } catch (e) { setError(errText(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={t("remarks.imageTitle", { name })} onClose={onClose} size="xl" className="annotate">
      <div className="annotate-tools" role="toolbar" aria-label={t("remarks.imageTools")}>
        <button type="button" className={`btn btn-small ${tool === "pin" ? "btn-accent" : ""}`} aria-pressed={tool === "pin"} onClick={() => setTool("pin")}><Icon name="target" size={14} /> {t("remarks.imagePin")}</button>
        <button type="button" className={`btn btn-small ${tool === "pen" ? "btn-accent" : ""}`} aria-pressed={tool === "pen"} onClick={() => setTool("pen")}><Icon name="edit" size={14} /> {t("remarks.imagePen")}</button>
        <button type="button" className="btn btn-small btn-ghost" disabled={!strokes.length && !pins.length} onClick={() => { setStrokes([]); setPins([]); }}><Icon name="trash" size={14} /> {t("remarks.imageClear")}</button>
      </div>
      <div className="annotate-stage">
        <img ref={img} src={src} alt={name} draggable={false} onLoad={() => setStrokes((s) => [...s])} />
        <canvas ref={canvas} aria-label={t(tool === "pin" ? "remarks.imagePinHint" : "remarks.imagePenHint")} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        {pins.map((p, i) => <span key={i} className="annotate-pin" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} aria-hidden="true">{i + 1}</span>)}
      </div>
      <p className="muted small" style={{ padding: "0 16px", margin: 0 }}>{t(tool === "pin" ? "remarks.imagePinHint" : "remarks.imagePenHint")}</p>
      {pins.length > 0 && (
        <ol className="annotate-notes">
          {pins.map((p, i) => (
            <li key={i} className="annotate-note">
              <span className="annotate-pin" aria-hidden="true">{i + 1}</span>
              <input className="input" value={p.note} maxLength={600} placeholder={t("remarks.imageNote", { n: i + 1 })} aria-label={t("remarks.imageNote", { n: i + 1 })}
                onChange={(e) => setPins((list) => list.map((q, j) => (j === i ? { ...q, note: e.target.value } : q)))} />
              <button type="button" className="btn btn-small btn-ghost" aria-label={t("remarks.imageRemovePin", { n: i + 1 })} onClick={() => setPins((list) => list.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
            </li>
          ))}
        </ol>
      )}
      <div className="annotate-foot">
        <textarea className="input remark-input" rows={2} maxLength={REMARK_MAX} value={remark} placeholder={t("remarks.imageRemark")} aria-label={t("remarks.imageRemark")} onChange={(e) => setRemark(e.target.value)} />
        {error && <p className="card-error" role="alert">{error}</p>}
        <div className="remark-actions">
          <button type="button" className="btn btn-small btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
          <button type="button" className="btn btn-small btn-accent" disabled={!canSend} onClick={() => void send()}>{busy ? t("common.working") : t("remarks.imageSend")}</button>
        </div>
      </div>
    </Modal>
  );
}

/** The « Annoter » button of the image viewer; only on the owner's own bot. */
export function AnnotateButton({ botId, src, name }: { botId: string; src: string; name: string }) {
  const t = useT();
  const own = useStore((s) => !!s.bots[botId] && !s.bots[botId].access);
  const [open, setOpen] = useState(false);
  if (!own) return null;
  return (
    <>
      <button type="button" className="btn btn-small" onClick={() => setOpen(true)}><Icon name="edit" size={14} /> {t("remarks.imageOpen")}</button>
      {open && createPortal(<ImageAnnotate botId={botId} src={src} name={name} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
