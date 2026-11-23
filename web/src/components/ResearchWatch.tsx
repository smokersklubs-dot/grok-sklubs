import { useEffect, useState } from "react";
import { api, errText } from "../api";

/**
 * L87 « Veille », « Chercher dans mes rapports » and the private Atom feed (server researchwatch.ts). The research
 * panel keeps its words inline (fr/en pairs), so this file does too.
 */
type Every = "week" | "month" | null;

/** « Refaire ce rapport tout seul » : chaque semaine, chaque mois, ou jamais. */
export function ReportWatch({ base, report, fr }: { base: string; report: string; fr: boolean }) {
  const loc = (f: string, e: string) => (fr ? f : e);
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
        {loc("Veille : refaire ce rapport tout seul", "Watch: run this report again by itself")}
        <select className="input" disabled={!w} value={w?.every ?? ""} onChange={(e) => void change((e.target.value || null) as Every)}>
          <option value="">{loc("Jamais", "Never")}</option>
          <option value="week">{loc("Chaque semaine", "Every week")}</option>
          <option value="month">{loc("Chaque mois", "Every month")}</option>
        </select>
      </label>
      {w?.nextAt && (
        <small className="muted">
          {loc("Prochain passage le ", "Next run on ")}
          {new Date(w.nextAt).toLocaleDateString(fr ? "fr-FR" : "en")}
          {loc(" ; le rapport dira ce qui a changé.", "; the report will say what changed.")}
        </small>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

interface Hit { id: string; botName: string; subject: string; updated: number; excerpt: string }

/** « Chercher dans mes rapports » et le flux Atom privé (lecteur de flux). */
export function ResearchArchive({ fr }: { fr: boolean }) {
  const loc = (f: string, e: string) => (fr ? f : e);
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
      <summary>{loc("Mes rapports passés et flux", "My past reports and feed")}</summary>
      <form onSubmit={(e) => { e.preventDefault(); void run(async () => setHits((await api<{ hits: Hit[] }>("GET", `/research/search?q=${encodeURIComponent(query)}`)).hits)); }}>
        <label>
          {loc("Chercher dans mes rapports", "Search my reports")}
          <input className="input" value={query} maxLength={300} onChange={(e) => setQuery(e.target.value)} placeholder={loc("Ex. : prix du vélo électrique", "E.g. e-bike prices")} />
        </label>
        <button className="btn btn-small" disabled={!query.trim()}>{loc("Chercher", "Search")}</button>
      </form>
      {hits && (hits.length ? (
        <ul className="research-hits">
          {hits.map((h) => (
            <li key={h.id}>
              <strong>{h.subject}</strong>{" "}
              <small className="muted">· {h.botName} · {new Date(h.updated).toLocaleDateString(fr ? "fr-FR" : "en")}</small>
              {h.excerpt && <p className="muted small">{h.excerpt}</p>}
            </li>
          ))}
        </ul>
      ) : <p className="muted small">{loc("Aucun rapport ne parle de ça.", "No report talks about that.")}</p>)}
      <p className="small">
        {loc("Flux Atom privé : tes rapports terminés dans un lecteur de flux. L'adresse est secrète ; en créer une nouvelle coupe l'ancienne.",
          "Private Atom feed: your finished reports in a feed reader. The address is secret; making a new one stops the old one.")}
      </p>
      {address && <input className="input" readOnly value={address} onFocus={(e) => e.currentTarget.select()} aria-label={loc("Adresse du flux", "Feed address")} />}
      {feed?.enabled && !address && <p className="muted small">{loc("Un flux est actif. Son adresse n'est montrée qu'à sa création.", "A feed is on. Its address is shown only when it is made.")}</p>}
      <div className="studio-actions">
        <button type="button" className="btn btn-small" onClick={() => void run(async () => setFeed(await api("POST", "/research/feed")))}>
          {feed?.enabled ? loc("Nouvelle adresse", "New address") : loc("Créer le flux", "Make the feed")}
        </button>
        {feed?.enabled && (
          <button type="button" className="btn btn-small" onClick={() => void run(async () => setFeed(await api("DELETE", "/research/feed")))}>
            {loc("Arrêter le flux", "Stop the feed")}
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
