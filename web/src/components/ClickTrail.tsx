import { useEffect, useRef, useState, type Ref } from "react";
import { useStore } from "../store";

/** How long a mark stays on the screen view (its ripple fades out over this time). */
export const MARK_MS = 2400;

/**
 * L149 — « où le bot a cliqué »: a short-lived ring on the live screen where the bot just clicked (its live state carries
 * the point as a share of the screen, server agent/clicktrail.ts). Placed over the stream's picture (the canvas inside
 * the same frame, which keeps its proportions), at most 5 at once; nothing is kept. A point already there when the view
 * opens is not drawn (it is old news).
 */
export function ClickTrail({ botId }: { botId: string }) {
  const point = useStore((s) => s.live[botId]?.activity?.point);
  const box = useRef<HTMLDivElement>(null);
  const first = useRef(point?.at ?? 0);
  const [marks, setMarks] = useState<{ key: number; left: number; top: number }[]>([]);

  useEffect(() => {
    if (!point || point.at === first.current) return;
    const frame = box.current?.parentElement, canvas = frame?.querySelector("canvas");
    if (!frame || !canvas) return;
    const f = frame.getBoundingClientRect(), r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const key = point.at;
    setMarks((m) => [...m.filter((k) => k.key !== key).slice(-4), { key, left: r.left - f.left + point.x * r.width, top: r.top - f.top + point.y * r.height }]);
    window.setTimeout(() => setMarks((m) => m.filter((k) => k.key !== key)), MARK_MS);
  }, [point]);

  return <ClickMarks ref={box} marks={marks} />;
}

/** The marks themselves (`still`: drawn without fading, for the gallery). */
export function ClickMarks({ marks, still, ref }: { marks: { key: number; left: number | string; top: number | string }[]; still?: boolean; ref?: Ref<HTMLDivElement> }) {
  return (
    <div className="click-trail" ref={ref} aria-hidden="true">
      {marks.map((m) => <span key={m.key} className={`click-mark ${still ? "is-still" : ""}`} style={{ left: m.left, top: m.top }} />)}
    </div>
  );
}
