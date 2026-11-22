import type { ResearchExtra, ResearchWindow, SourceState } from "../types";

/** L87: the period and the free sources of a new report, and what each source did for a question. */
const WINDOWS: [ResearchWindow | "auto", string, string][] = [
  ["auto", "Selon la demande (« ce mois-ci »…)", "From the request (\"this month\"…)"],
  ["week", "7 derniers jours", "Last 7 days"],
  ["month", "30 derniers jours", "Last 30 days"],
  ["year", "12 derniers mois", "Last 12 months"],
  ["any", "Toutes dates", "Any date"],
];
const EXTRAS: [ResearchExtra, string, string][] = [
  ["hn", "Hacker News (discussions tech, gratuit)", "Hacker News (tech discussions, free)"],
  ["polymarket", "Polymarket (paris en cours : des attentes, pas des faits)", "Polymarket (open bets: expectations, not facts)"],
  ["reddit", "Reddit (via l’ordinateur du bot, lecture seule)", "Reddit (through the bot’s computer, read-only)"],
  ["youtube", "YouTube (via l’ordinateur du bot, lecture seule)", "YouTube (through the bot’s computer, read-only)"],
];
const NAMES: Record<SourceState["source"], string> = { web: "Web", x: "X", hn: "Hacker News", polymarket: "Polymarket", reddit: "Reddit", youtube: "YouTube" };
const STATES: Record<SourceState["state"], [string, string]> = {
  ok: ["a répondu", "answered"], empty: ["rien trouvé", "nothing found"], failed: ["en panne", "failed"], rate_limited: ["limite de débit", "rate limited"],
  timeout: ["trop lent", "timed out"], login: ["connexion à faire", "needs a login"], unavailable: ["indisponible", "unavailable"],
};

export function ResearchOptions({ fr, window, setWindow, extras, setExtras }: {
  fr: boolean; window: ResearchWindow | "auto"; setWindow: (w: ResearchWindow | "auto") => void; extras: ResearchExtra[]; setExtras: (e: ResearchExtra[]) => void;
}) {
  return (
    <>
      <label>
        {fr ? "Période des sources" : "Source period"}
        <select className="input" value={window} onChange={(e) => setWindow(e.target.value as ResearchWindow | "auto")}>
          {WINDOWS.map(([v, f, e]) => <option key={v} value={v}>{fr ? f : e}</option>)}
        </select>
      </label>
      <fieldset className="research-extras">
        <legend>{fr ? "Sources gratuites en plus du web" : "Free sources besides the web"}</legend>
        {EXTRAS.map(([v, f, e]) => (
          <label className="research-check" key={v}>
            <input type="checkbox" checked={extras.includes(v)} onChange={(ev) => setExtras(ev.target.checked ? [...extras, v] : extras.filter((x) => x !== v))} />
            {fr ? f : e}
          </label>
        ))}
      </fieldset>
    </>
  );
}

export function SourceStates({ states, fr }: { states?: SourceState[]; fr: boolean }) {
  if (!states?.length) return null;
  return (
    <ul className="research-states" aria-label={fr ? "État des sources" : "Source status"}>
      {states.map((s) => (
        <li key={s.source} data-state={s.state}>
          {NAMES[s.source]}{fr ? " : " : ": "}{STATES[s.state][fr ? 0 : 1]}{s.count ? ` (${s.count})` : ""}
        </li>
      ))}
    </ul>
  );
}

export function FindingMeta({ published, engagement, fr }: { published?: string; engagement?: string; fr: boolean }) {
  if (!published && !engagement) return null;
  return (
    <small className="research-meta">
      {published ? (fr ? `Publié le ${new Date(published).toLocaleDateString("fr-FR")}` : `Published ${new Date(published).toLocaleDateString("en")}`) : ""}
      {published && engagement ? " · " : ""}
      {engagement}
    </small>
  );
}
