import { useCallback, useEffect, useId, useState } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { dateTime } from "../lib/format";
import { Icon } from "./Icon";
import { ErrorNote } from "./ui";
import "./ReportMessage.css";

/**
 * L31 — « Réponses signalées » on the Surveillance page (owner and hosted operators; server: reports.ts). Each report:
 * the reason, the person's note, the masked reply and the masked messages before it; « Marquer comme traité » / « Rouvrir ».
 */
export interface ReportView {
  id: string; botName: string; account: string; reason: string; note: string; text: string;
  context: { who: "user" | "bot"; name: string; text: string }[]; status: "open" | "done"; createdAt: number; handledAt: number | null;
}
interface ReportList { reports: ReportView[]; open: number }

export function ReportsSection({ initial }: { initial?: ReportList }) {
  const t = useT();
  const hid = useId();
  const [data, setData] = useState<ReportList | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await api<ReportList>("GET", "/reports")); } catch (e) { setError(errText(e)); }
  }, []);
  useEffect(() => { if (!initial) void load(); }, [load, initial]);
  const mark = async (id: string, done: boolean) => {
    setBusy(true);
    try { setData(await api<ReportList>("POST", `/reports/${enc(id)}/done`, { done })); setError(null); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const list = data?.reports ?? [];
  return (
    <section className="today-block reports-block" aria-labelledby={hid}>
      <header className="today-block-head">
        <Icon name="alert" size={17} />
        <h2 id={hid}>{t("reports.title")}</h2>
        {!!data?.open && <span className="count-badge">{data.open}</span>}
      </header>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {data && list.length === 0 && <p className="today-note">{t("reports.empty")}</p>}
      {list.length > 0 && (
        <>
          <p className="today-note">{t("reports.masked")}</p>
          <ul className="surv-list">
            {list.map((r) => (
              <li key={r.id} className={`surv-card is-warn ${r.status === "done" ? "is-acked" : ""}`}>
                <div className="surv-card-main">
                  <div className="surv-card-chips">
                    <span className="chip surv-sev is-warn">{t(`report.reason.${r.reason}` as Key)}</span>
                    {r.status === "done" && <span className="chip">{t("reports.handled")}</span>}
                  </div>
                  <p className="surv-card-meta">{t("reports.meta", { bot: r.botName, account: r.account, when: dateTime(r.createdAt) })}</p>
                  {r.note && <p className="surv-card-text">{t("reports.note", { note: r.note })}</p>}
                  <blockquote className="report-quote">{r.text}</blockquote>
                  {r.context.length > 0 && (
                    <details className="surv-detectors">
                      <summary>{t("reports.context", { n: r.context.length })}</summary>
                      <ul className="report-context">
                        {r.context.map((c, i) => <li key={i}><b>{c.name || t(c.who === "bot" ? "reports.who.bot" : "reports.who.user")}</b> {c.text}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
                <div className="row-end">
                  <button type="button" className="btn btn-small" disabled={busy} onClick={() => void mark(r.id, r.status !== "done")}>
                    <Icon name={r.status === "done" ? "refresh" : "check"} size={13} /> {t(r.status === "done" ? "reports.reopen" : "reports.done")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
