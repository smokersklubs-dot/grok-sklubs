import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { t as tt, useT, type Key } from "../i18n";
import type { DoctorFinding, DoctorSeverity } from "../../../server/src/doctor";
import { pasteText } from "../../../server/src/doctor";
import { Icon } from "./Icon";
import "./DoctorSection.css";

/**
 * L153 Settings → « Docteur »: a read-only check (server doctor.ts / doctorroutes.ts, GET /doctor) — each line « OK » or
 * « À corriger » with what to do, the installation lines for the instance owner only. The models line comes from
 * GET /models (what the composer can use). « Copier le résumé » copies a text without any path, address, e-mail or secret.
 */
interface Report { findings: DoctorFinding[]; install: boolean; node: string | null }

const label = (k: string) => tt(k as Key);

export function DoctorSection() {
  const t = useT();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const run = async () => {
    setBusy(true); setError(null);
    try {
      const [r, m] = await Promise.all([api<Report>("GET", "/doctor"), api<{ models: unknown[] }>("GET", "/models").catch(() => null)]);
      const findings = [...r.findings];
      if (m) findings.push(m.models.length ? { checkId: "models.available", severity: "ok", title: "doctor.models.ok", detail: "", scope: "account" } : { checkId: "models.available", severity: "critical", title: "doctor.models", detail: "doctor.models.detail", scope: "account" });
      const rank: Record<DoctorSeverity, number> = { critical: 0, warn: 1, info: 2, ok: 3 };
      setReport({ ...r, findings: findings.sort((a, b) => rank[a.severity] - rank[b.severity]) });
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  useEffect(() => { void run(); }, []);
  const problems = report?.findings.filter((f) => f.severity !== "ok").length ?? 0;
  const copy = async () => {
    if (!report) return;
    try { await navigator.clipboard.writeText(pasteText(report.findings, { app: "Sklubot", node: report.node ?? undefined, words: label })); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { setError(t("msg.copyFailed")); }
  };
  return (
    <div className="doctor">
      <h2>{t("settings.section.doctor")}</h2>
      <p className="muted">{t(report?.install ? "doctor.introOwner" : "doctor.intro")}</p>
      <div className="doctor-actions">
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => void run()}><Icon name="refresh" size={14} /> {t(busy ? "doctor.running" : "doctor.again")}</button>
        <button type="button" className="btn btn-small" disabled={!report} onClick={() => void copy()}><Icon name={copied ? "check" : "copy"} size={14} /> {t(copied ? "msg.copied" : "doctor.copy")}</button>
      </div>
      {error && <p className="card-error" role="alert">{error}</p>}
      {report && (
        <>
          <p className={`doctor-verdict ${problems ? "is-bad" : "is-good"}`} role="status">
            <Icon name={problems ? "alert" : "check"} size={16} /> {problems ? t("doctor.toFix", { n: problems }) : t("doctor.allGood")}
          </p>
          <ul className="doctor-list">
            {report.findings.map((f) => (
              <li key={f.checkId} className={`doctor-row is-${f.severity}`}>
                <span className={`doctor-state is-${f.severity}`}>{t(f.severity === "ok" ? "doctor.state.ok" : f.severity === "info" ? "doctor.state.info" : "doctor.state.fix")}</span>
                <span className="doctor-text">
                  <span className="doctor-title">{label(f.title)}</span>
                  {f.detail && <span className="doctor-detail">{label(f.detail)}</span>}
                  {f.remediation && <code className="doctor-fix">{f.remediation}</code>}
                </span>
                <span className="doctor-scope muted">{t(f.scope === "install" ? "doctor.scope.install" : "doctor.scope.account")}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">{t("doctor.readOnly")}</p>
        </>
      )}
    </div>
  );
}
