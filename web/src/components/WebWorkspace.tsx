import { useCallback, useEffect, useRef, useState } from "react";
import { api, errText } from "../api";
import { useStore } from "../store";
import { SignInSite } from "./SignInSite";
import { ErrorNote } from "./ui";

interface Page {
  title: string;
  url: string;
  text: string;
  links: { url: string; label: string }[];
}
interface Search {
  query: string;
  provider: string | null;
  results: { url: string; title: string; snippet: string }[];
}
type Entry = Page | Search;
const address = (entry: Entry) => ("url" in entry ? entry.url : entry.query);
function asUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[^\s/:?#]+\.[^\s/:?#]+(?::\d+)?(?:[/?#].*)?$/u.test(value)) return "https://" + value;
  return null;
}

export function WebWorkspace({ bot, fr, initialUrl }: { bot: string; fr: boolean; initialUrl?: string }) {
  const [input, setInput] = useState(initialUrl ?? "");
  const [history, setHistory] = useState<{ entries: Entry[]; index: number }>({ entries: [], index: -1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const { entries, index } = history;
  const current = entries[index];

  const visit = useCallback(async (raw: string) => {
    if (!raw.trim()) return;
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    setBusy(true);
    setError("");
    setInput(raw);
    try {
      const url = asUrl(raw.trim());
      const entry: Entry = url
        ? await api<Page>("POST", "/workspace/web/read", { url }, request.signal)
        : await api<Search>("POST", `/bots/${bot}/workspace/web/search`, { query: raw.trim() }, request.signal);
      if (request.signal.aborted) return;
      setHistory((h) => {
        const entries = [...h.entries.slice(0, h.index + 1), entry].slice(-20);
        return { entries, index: entries.length - 1 };
      });
      setInput(address(entry));
    } catch (e) {
      if (!request.signal.aborted) setError(errText(e));
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }, [bot]);

  useEffect(() => {
    const timer = initialUrl ? window.setTimeout(() => void visit(initialUrl), 0) : undefined;
    return () => {
      window.clearTimeout(timer);
      pending.current?.abort();
    };
  }, [initialUrl, visit]);

  function navigate(index: number) {
    setHistory({ entries, index });
    setInput(address(entries[index]));
    setError("");
  }
  return (
    <section className="dock-reader">
      <form className="studio-actions" onSubmit={(event) => { event.preventDefault(); void visit(input); }}>
        <button type="button" className="btn btn-small" aria-label={fr ? "Précédent" : "Back"} disabled={busy || index < 1} onClick={() => navigate(index - 1)}>←</button>
        <button type="button" className="btn btn-small" aria-label={fr ? "Suivant" : "Forward"} disabled={busy || index >= entries.length - 1} onClick={() => navigate(index + 1)}>→</button>
        <input className="input" aria-label={fr ? "Adresse ou recherche" : "Address or search"} placeholder={fr ? "Rechercher ou saisir une adresse" : "Search or enter an address"} value={input} onChange={(e) => setInput(e.target.value)} autoCapitalize="off" />
        <button className="btn btn-small" disabled={busy || !input.trim()}>{busy ? "…" : fr ? "Ouvrir" : "Go"}</button>
      </form>
      <div className="studio-actions">
        <SignInSite botId={bot} name={useStore.getState().bots[bot]?.name ?? ""} address={asUrl(input.trim()) ?? ""} />
        <button type="button" className="btn btn-small" onClick={() => useStore.getState().openModal({ kind: "connectors" })}>{fr ? "Applis connectées" : "Connected apps"}</button>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {current && ("url" in current ? (
        <article>
          <h3>{current.title}</h3>
          <a href={current.url} target="_blank" rel="noopener noreferrer">{fr ? "Ouvrir le site original" : "Open original site"}</a>
          <p>{current.text}</p>
          {current.links.map((link) => <button key={link.url} type="button" className="btn btn-small" disabled={busy} onClick={() => void visit(link.url)}>{link.label}</button>)}
        </article>
      ) : (
        <article>
          <h3>{current.query}</h3>
          {current.results.length ? (
            <>
              {current.provider && <p className="muted">{current.provider}</p>}
              <ol className="dock-results">{current.results.map((hit, i) => (
                <li key={hit.url + i}>
                  <button className="link" disabled={busy} onClick={() => void visit(hit.url)}>{hit.title || hit.url}</button>
                  <small>{new URL(hit.url).hostname}</small>
                  {hit.snippet && <p>{hit.snippet}</p>}
                </li>
              ))}</ol>
            </>
          ) : (
            <>
              <p>{fr ? "Aucun résultat disponible pour cette recherche." : "No results available for this search."}</p>
              <a href={"https://duckduckgo.com/?q=" + encodeURIComponent(current.query)} target="_blank" rel="noopener noreferrer">{fr ? "Rechercher sur DuckDuckGo" : "Search on DuckDuckGo"}</a>
            </>
          )}
        </article>
      ))}
    </section>
  );
}
