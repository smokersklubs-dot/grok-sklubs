import { intlLocale, t as tr } from "../i18n";
import { useEffect, useState } from "react";
import { api, errText } from "../api";

/**
 * L87 « Veille », « Chercher dans mes rapports » and the private Atom feed (server researchwatch.ts). The research
 * panel keeps its words inline (fr/en pairs), so this file does too.
 */
type Every = "week" | "month" | null;

/** « Refaire ce rapport tout seul » : chaque semaine, chaque mois, ou jamais. */
export function ReportWatch({ base, report, fr }: { base: string; report: string; fr: boolean }) {
  const [w, setW] = useState<{ every: Every; nextAt: number | null } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const ctl = new AbortController();
    setW(null);
    api<{ every: Every; nextAt: number | null }>("GET", `${base}/${encodeURIComponent(report)}/watch`, undefined, ctl.signal)
      .then((v) => !ctl.signal.aborted && setW(v), (e) => !ctl.signal.aborted && setError(errText(e)));
    return () => ctl.abort();
  }, [base, report]);
  const change = async (every: Every) => {
    setError("");
    try { setW(await api("PUT", `${base}/${encodeURIComponent(report)}/watch`, { every })); } catch (e) { setError(errText(e)); }
  };
  return (
    <div className="research-watch">
      <label>
        {tr("research.watchRunReportAgain")}
        <select className="input" disabled={!w} value={w?.every ?? ""} onChange={(e) => void change((e.target.value || null) as Every)}>
          <option value="">{tr("research.never")}</option>
          <option value="week">{tr("research.everyWeek")}</option>
          <option value="month">{tr("research.everyMonth")}</option>
        </select>
      </label>
      {w?.nextAt && (
        <small className="muted">
          {tr("research.nextRunOn", { date: new Date(w.nextAt).toLocaleDateString(intlLocale()) })}
          {tr("research.reportWillSayWhat")}
        </small>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

interface Hit { id: string; botName: string; subject: string; updated: number; excerpt: string }

/** « Chercher dans mes rapports » et le flux Atom privé (lecteur de flux). */
export function ResearchArchive({ fr }: { fr: boolean }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [feed, setFeed] = useState<{ enabled: boolean; path?: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const ctl = new AbortController();
    api<{ enabled: boolean }>("GET", "/research/feed", undefined, ctl.signal).then((v) => !ctl.signal.aborted && setFeed(v), () => {});
    return () => ctl.abort();
  }, []);
  const run = async (fn: () => Promise<void>) => { setError(""); try { await fn(); } catch (e) { setError(errText(e)); } };
  const address = feed?.path ? `${window.location.origin}${feed.path}` : "";
  return (
    <details className="research-archive">
      <summary>{tr("research.myPastReportsFeed")}</summary>
      <form onSubmit={(e) => { e.preventDefault(); void run(async () => setHits((await api<{ hits: Hit[] }>("GET", `/research/search?q=${encodeURIComponent(query)}`)).hits)); }}>
        <label>
          {tr("research.searchMyReports")}
          <input className="input" value={query} maxLength={300} onChange={(e) => setQuery(e.target.value)} placeholder={tr("research.eGEBike")} />
        </label>
        <button className="btn btn-small" disabled={!query.trim()}>{tr("vaultLive.find")}</button>
      </form>
      {hits && (hits.length ? (
        <ul className="research-hits">
          {hits.map((h) => (
            <li key={h.id}>
              <strong>{h.subject}</strong>{" "}
              <small className="muted">· {h.botName} · {new Date(h.updated).toLocaleDateString(intlLocale())}</small>
              {h.excerpt && <p className="muted small">{h.excerpt}</p>}
            </li>
          ))}
        </ul>
      ) : <p className="muted small">{tr("research.noReportTalksAbout")}</p>)}
      <p className="small">
        {tr("research.privateAtomFeedFinished")}
      </p>
      {address && <input className="input" readOnly value={address} onFocus={(e) => e.currentTarget.select()} aria-label={tr("research.feedAddress")} />}
      {feed?.enabled && !address && <p className="muted small">{tr("research.feedItsAddressShown")}</p>}
      <div className="studio-actions">
        <button type="button" className="btn btn-small" onClick={() => void run(async () => setFeed(await api("POST", "/research/feed")))}>
          {feed?.enabled ? tr("account.emailNew") : tr("research.makeFeed")}
        </button>
        {feed?.enabled && (
          <button type="button" className="btn btn-small" onClick={() => void run(async () => setFeed(await api("DELETE", "/research/feed")))}>
            {tr("research.stopFeed")}
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
