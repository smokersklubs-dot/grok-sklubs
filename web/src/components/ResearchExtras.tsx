import type { ResearchExtra, ResearchWindow, SourceState } from "../types";
import { intlLocale, t as tr, type Key } from "../i18n";

/** L87: the period and the free sources of a new report, and what each source did for a question. */
const WINDOWS: [ResearchWindow | "auto", Key][] = [
  ["auto", "research.window.auto"],
  ["week", "research.window.week"],
  ["month", "research.window.month"],
  ["year", "research.window.year"],
  ["any", "research.window.any"],
];
const EXTRAS: [ResearchExtra, Key][] = [
  ["hn", "research.extra.hn"],
  ["polymarket", "research.extra.polymarket"],
  ["reddit", "research.extra.reddit"],
  ["youtube", "research.extra.youtube"],
  ["openalex", "research.extra.openalex"],
  ["pubmed", "research.extra.pubmed"],
];
const NAMES: Record<SourceState["source"], string> = { web: "Web", x: "X", hn: "Hacker News", polymarket: "Polymarket", reddit: "Reddit", youtube: "YouTube", openalex: "OpenAlex", pubmed: "PubMed" };
const STATES: Record<SourceState["state"], Key> = {
  ok: "research.state.ok", empty: "research.state.empty", failed: "research.state.failed", rate_limited: "research.state.rate_limited",
  timeout: "research.state.timeout", login: "research.state.login", unavailable: "research.state.unavailable",
};

export function ResearchOptions({ fr, window, setWindow, extras, setExtras }: {
  fr: boolean; window: ResearchWindow | "auto"; setWindow: (w: ResearchWindow | "auto") => void; extras: ResearchExtra[]; setExtras: (e: ResearchExtra[]) => void;
}) {
  return (
    <>
      <label>
        {tr("research.sourcePeriod")}
        <select className="input" value={window} onChange={(e) => setWindow(e.target.value as ResearchWindow | "auto")}>
          {WINDOWS.map(([v, k]) => <option key={v} value={v}>{tr(k)}</option>)}
        </select>
      </label>
      <fieldset className="research-extras">
        <legend>{tr("research.freeSourcesBesidesWeb")}</legend>
        {EXTRAS.map(([v, k]) => (
          <label className="research-check" key={v}>
            <input type="checkbox" checked={extras.includes(v)} onChange={(ev) => setExtras(ev.target.checked ? [...extras, v] : extras.filter((x) => x !== v))} />
            {tr(k)}
          </label>
        ))}
      </fieldset>
    </>
  );
}

export function SourceStates({ states, fr }: { states?: SourceState[]; fr: boolean }) {
  if (!states?.length) return null;
  return (
    <ul className="research-states" aria-label={tr("research.sourceStatus")}>
      {states.map((s) => (
        <li key={s.source} data-state={s.state}>
          {tr("research.stateLine", { source: NAMES[s.source], state: tr(STATES[s.state]) })}{s.count ? ` (${s.count})` : ""}
        </li>
      ))}
    </ul>
  );
}

export function FindingMeta({ published, engagement, fr }: { published?: string; engagement?: string; fr: boolean }) {
  if (!published && !engagement) return null;
  return (
    <small className="research-meta">
      {published ? tr("research.publishedOn", { date: new Date(published).toLocaleDateString(intlLocale()) }) : ""}
      {published && engagement ? " · " : ""}
      {engagement}
    </small>
  );
}
