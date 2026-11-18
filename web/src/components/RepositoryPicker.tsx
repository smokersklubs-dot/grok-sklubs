import { useEffect, useRef, useState } from "react";
import { featuredRepositories, repositoryName } from "../../../server/src/clientshared/chatmentions";
import type { PublicRepository } from "../../../server/src/githubsearch";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { Modal, ErrorNote } from "./ui";

export function RepositoryPicker({ connected, attach, connect, close }: {
  connected: boolean; attach: (name: string) => void; connect: () => void; close: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicRepository[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const direct = repositoryName(query);
  const search = async () => {
    if (direct) { attach(direct); return; }
    if (!query.trim() || busy) return;
    const request = new AbortController();
    pending.current = request;
    setBusy(true);
    setError("");
    try {
      const r = connected
        ? await api<{ repositories: PublicRepository[] }>("POST", "/connectors/github/account-search", { query: query.trim() }, request.signal)
        : await api<{ repositories: PublicRepository[] }>("GET", "/connectors/github/public-search?q=" + encodeURIComponent(query.trim()), undefined, request.signal);
      if (!request.signal.aborted) setResults(r.repositories);
    } catch (err) { if (!request.signal.aborted) setError(errText(err)); }
    finally { if (!request.signal.aborted) setBusy(false); }
  };
  return <Modal title={t("mention.ghTitle")} onClose={close}>
    <div className="modal-body repository-picker">
      <form onSubmit={e => { e.preventDefault(); void search(); }}>
        <label className="field-label" htmlFor="github-repo-query">{t("mention.field")}</label>
        <input className="input" id="github-repo-query" data-autofocus="" autoFocus autoComplete="off" spellCheck={false} value={query} maxLength={240}
          onChange={e => { pending.current?.abort(); setQuery(e.target.value); setResults(null); setBusy(false); setError(""); }} />
        <button className="btn btn-primary" disabled={!query.trim() || busy}>{busy ? t("common.loading") : direct ? t("mention.attach") : t(connected ? "mention.accountSearch" : "mention.search")}</button>
      </form>
      <ErrorNote>{error}</ErrorNote>
      <section aria-live="polite">
        <h3>{results === null ? t("mention.sample") : t(connected ? "mention.accountSearch" : "mention.results")}</h3>
        {results?.length === 0 && <p className="muted">{t("mention.none")}</p>}
        {(results ?? featuredRepositories.map(name => ({ name, description: "" }))).map(r =>
          <button key={r.name} type="button" className="repository-option" onClick={() => attach(r.name)}>
            <strong>{r.name}</strong>{r.description && <span className="muted">{r.description}</span>}
          </button>)}
      </section>
      <div><p className="muted small">{t("mention.direct")}</p>
        <button type="button" className="btn" onClick={connect}>{t(connected ? "mention.manage" : "mention.connect")}</button>
      </div>
    </div>
  </Modal>;
}
