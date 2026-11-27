import { useEffect, useId, useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import { ErrorNote } from "./ui";

/** Server computerhours.ts hoursView. */
export interface ComputerHoursView { month: string; usedHours: number; capHours: number | null; ownCapHours: number | null; operatorCapHours: number | null; reached: boolean }

/**
 * L95 — Settings → Usage: the computer hours of this month (the bots' Linux computers awake), and the account's own cap
 * on them, separate from money and tokens. Shown only when bots have Linux computers. `initial`: the gallery's state.
 */
export function ComputerHoursBlock({ initial }: { initial?: ComputerHoursView }) {
  const t = useT();
  const id = useId();
  const kind = useStore((s) => s.computer?.kind);
  const tick = useStore((s) => s.usageTick);
  const [view, setView] = useState<ComputerHoursView | null>(initial ?? null);
  const [value, setValue] = useState(initial?.ownCapHours != null ? String(initial.ownCapHours) : "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (initial || kind !== "linux") return;
    let dead = false;
    api<ComputerHoursView>("GET", "/usage/computer-hours").then((v) => { if (!dead) { setView(v); setValue(v.ownCapHours != null ? String(v.ownCapHours) : ""); } }, (e: unknown) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [tick, kind, initial]);
  if (!initial && kind !== "linux") return null;
  if (error && !view) return <ErrorNote>{error}</ErrorNote>;
  if (!view) return null;
  const pct = view.capHours ? Math.min(100, Math.round((view.usedHours / view.capHours) * 100)) : 0;
  const tone = view.reached ? "is-over" : pct >= 80 ? "is-warn" : "";
  const dirty = value !== (view.ownCapHours != null ? String(view.ownCapHours) : "");
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const v = await api<ComputerHoursView>("PUT", "/usage/computer-hours", { hours: value === "" ? null : Number(value) });
      setView(v); setValue(v.ownCapHours != null ? String(v.ownCapHours) : "");
      setSaved(true); window.setTimeout(() => setSaved(false), 1800);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const hours = (n: number) => t("chours.hours", { n: String(n).replace(".", t("chours.decimal")) });
  return (
    <section className="chours" aria-labelledby={`${id}h`}>
      <h4 className="caps-subheading" id={`${id}h`}>{t("chours.heading")}</h4>
      <div className="cap-meter">
        <div className="meter-head">
          <span>{t("chours.thisMonth")}</span>
          <span className={`cap-figure ${tone}`}>{view.capHours ? `${hours(view.usedHours)} / ${hours(view.capHours)}` : hours(view.usedHours)}</span>
        </div>
        {view.capHours !== null && <div className={`meter ${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("chours.heading")}><span style={{ width: `${pct}%` }} /></div>}
        <p className="field-hint">{view.reached ? t("chours.reached") : t("chours.hint")}{view.operatorCapHours !== null ? ` ${t("chours.operator", { n: hours(view.operatorCapHours) })}` : ""}</p>
      </div>
      <div className="chours-line">
        <label className="caps-line-label" htmlFor={`${id}v`}>{t("chours.cap")}</label>
        <div className="caps-line-limit">
          <input id={`${id}v`} className="input input-small" type="number" min={0} max={744} step={1} inputMode="decimal" placeholder={t("caps.none")} value={value} onChange={(e) => setValue(e.target.value)} />
          <span className="muted small">{t("chours.perMonth")}</span>
        </div>
        <div className="caps-line-save">
          <button type="button" className="btn btn-small" disabled={busy || !dirty} onClick={() => void save()}>{t(busy ? "common.saving" : "common.save")}</button>
          {saved && <span className="chip state-ready" role="status">{t("common.saved")}</span>}
        </div>
      </div>
      {error && <p className="card-error" role="alert">{error}</p>}
    </section>
  );
}
