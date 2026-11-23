import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { ErrorNote } from "./ui";
import "./Comfort7.css";

/**
 * L161 « Garder l'historique » (Settings → Memory): earlier conversations not pinned and untouched for N days are
 * deleted once a day (server convs.ts). The open conversation of a bot and pinned ones are always kept. Default: keep all.
 */
export function HistoryRetention() {
  const t = useT();
  const [days, setDays] = useState<number | null>(null);
  const [choices, setChoices] = useState<number[]>([0, 30, 90, 365]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<{ days: number; choices: number[] }>("GET", "/history-retention").then((r) => { setDays(r.days); setChoices(r.choices); }, (e) => setError(errText(e))); }, []);
  const save = async (d: number) => {
    const before = days;
    setDays(d); setError(null);
    try { await api("PUT", "/history-retention", { days: d }); } catch (e) { setDays(before); setError(errText(e)); }
  };
  return (
    <section className="retention" aria-labelledby="retention-h">
      <h3 className="pane-heading" id="retention-h">{t("c7.ret.title")}</h3>
      <p className="muted small">{t("c7.ret.hint")}</p>
      <div className="seg" role="radiogroup" aria-labelledby="retention-h">
        {choices.map((d) => (
          <button key={d} type="button" role="radio" aria-checked={days === d} disabled={days === null} className={`seg-btn${days === d ? " is-on" : ""}`} onClick={() => void save(d)}>
            {d === 0 ? t("c7.ret.forever") : t("c7.ret.days", { n: d })}
          </button>
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}
