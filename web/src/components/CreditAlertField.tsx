import { useEffect, useId, useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { ErrorNote } from "./ui";
import "./VoicePlus.css";

/**
 * L150 « alerte de crédit OpenRouter » (server providercredit.ts): below this amount, your main bot warns you once a day
 * so you can top up before your bots stop. OpenRouter tells what is left when your key has a limit (or with a management
 * key); otherwise « non communiqué », never 0.
 */
interface View { thresholdUsd: number; lastLeftUsd: number | null; checkedAt: number | null; hasOpenRouter: boolean }

export function CreditAlertField({ initial }: { initial?: View }) {
  const t = useT();
  const hintId = useId();
  const [v, setV] = useState<View | null>(initial ?? null);
  const [draft, setDraft] = useState(initial ? String(initial.thresholdUsd) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (initial) return;
    let dead = false;
    api<View>("GET", "/openrouter/credit-alert").then((r) => { if (!dead) { setV(r); setDraft(String(r.thresholdUsd)); } }, (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [initial]);
  if (!v) return <ErrorNote>{error}</ErrorNote>;
  const save = async () => {
    setError(null);
    try { const r = await api<View>("PUT", "/openrouter/credit-alert", { thresholdUsd: Number(draft.replace(",", ".")) }); setV(r); setDraft(String(r.thresholdUsd)); } catch (e) { setError(errText(e)); }
  };
  const check = async () => {
    setBusy(true); setError(null);
    try { setV(await api<View>("POST", "/openrouter/credit-alert/check")); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="credit-alert">
      <label className="field">
        <span className="field-label">{t("credit.alert")}</span>
        <span className="credit-alert-row">
          <input className="input" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (draft !== String(v.thresholdUsd)) void save(); }} aria-describedby={hintId} />
          <span aria-hidden="true">$</span>
          <button type="button" className="btn btn-small" disabled={busy} onClick={() => void check()}>{busy ? t("common.loading") : t("credit.check")}</button>
        </span>
        <span className="field-hint" id={hintId}>{v.thresholdUsd > 0 ? t("credit.hint") : t("credit.off")}</span>
      </label>
      {v.checkedAt !== null && <p className="muted small" role="status">{v.lastLeftUsd === null ? t("credit.unknown") : t("credit.left", { usd: v.lastLeftUsd.toFixed(2) })}</p>}
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </div>
  );
}
