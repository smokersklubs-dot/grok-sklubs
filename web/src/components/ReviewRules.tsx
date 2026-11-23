import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { ErrorNote } from "./ui";

/** L77 « Règles de relecture » of a project (server reviewplus.ts): rules every reviewer checks, approvals needed. */
export function ReviewRulesField({ sectionId }: { sectionId: string }) {
  const t = useT();
  const [r, setR] = useState<{ text: string; minReviewers: number } | null>(null);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    api<{ text: string; minReviewers: number }>("GET", `/sections/${enc(sectionId)}/review-rules`).then((v) => { if (!dead) { setR(v); setSaved(JSON.stringify(v)); } }, (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [sectionId]);
  const save = async (next: { text: string; minReviewers: number }) => {
    setR(next);
    if (JSON.stringify(next) === saved) return;
    setError(null);
    try { const v = await api<{ text: string; minReviewers: number }>("PUT", `/sections/${enc(sectionId)}/review-rules`, next); setR(v); setSaved(JSON.stringify(v)); } catch (e) { setError(errText(e)); }
  };
  return (
    <div className="field review-rules">
      <label className="field"><span>{t("reviewRules.title")}</span>
        <textarea className="input" rows={3} maxLength={2000} disabled={!r} value={r?.text ?? ""} placeholder={t("reviewRules.placeholder")}
          onChange={(e) => r && setR({ ...r, text: e.target.value })} onBlur={() => r && void save(r)} />
      </label>
      <label className="field"><span>{t("reviewRules.min")}</span>
        <select className="input" disabled={!r} value={r?.minReviewers ?? 1} onChange={(e) => r && void save({ ...r, minReviewers: Number(e.target.value) })}>
          {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <p className="muted">{t("reviewRules.help")}</p>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
