import "./GithubActivity.css";
import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useStore } from "../store";
import { ErrorNote } from "./ui";
interface GitEvent {
  repo: string;
  id: number;
  name: string;
  branch: string;
  sha: string;
  pr?: number;
  at: string;
  url: string;
}
interface Group {
  repo: string;
  events: GitEvent[];
  error?: string;
}
interface Config {
  watches: { repo: string; connector: string | null }[];
  accounts: { id: string; name: string }[];
}

export function GithubActivity({ bot }: { bot: string }) {
  const fr = useStore((s) => s.locale === "fr");
  const base = "/bots/" + encodeURIComponent(bot) + "/github-activity";
  const [open, setOpen] = useState(false),
    [repo, setRepo] = useState(""),
    [account, setAccount] = useState("");
  const [settings, setSettings] = useState<Config | null>(null),
    [groups, setGroups] = useState<Group[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [revision, refresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const config = await api<Config>("GET", base, undefined, abort.signal);
        const feed = config.watches.length
          ? await api<{ results: Group[] }>("GET", base + "/events", undefined, abort.signal)
          : { results: [] };
        if (!abort.signal.aborted) {
          setSettings(config);
          setGroups(feed.results);
          setError("");
        }
      } catch (e) {
        if (!abort.signal.aborted) setError(errText(e));
      }
      if (!abort.signal.aborted) timer = setTimeout(load, 120000);
    };
    void load();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [base, open, revision]);
  async function change(name: string, remove: boolean) {
    setBusy(true);
    setError("");
    try {
      await api("POST", base, { repo: name, remove, connector: account || null });
      setRepo("");
      refresh((n) => n + 1);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }
  async function explain(event: GitEvent) {
    setError("");
    setBusy(true);
    try {
      const r = await api<{ seq: number }>("POST", base + "/explain", { repo: event.repo, run: event.id });
      const store = useStore.getState();
      store.selectBot(bot);
      store.openThreadPanel(bot, r.seq);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="github-activity" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>GitHub Actions</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void change(repo, false);
        }}
      >
        <label>
          {fr ? "Dépôt à suivre" : "Repository to watch"}
          <input
            className="input"
            placeholder="organisation/dépôt"
            required
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
        </label>
        {!!settings?.accounts.length && (
          <select
            className="input"
            aria-label="GitHub"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="">{fr ? "Accès public" : "Public access"}</option>
            {settings.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-small" disabled={busy || !repo.trim()}>
          {fr ? "Suivre le dépôt" : "Watch repository"}
        </button>
      </form>
      {groups.map((g) => (
        <section key={g.repo}>
          <div className="studio-actions">
            <strong>{g.repo}</strong>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              disabled={busy}
              onClick={() => void change(g.repo, true)}
            >
              {fr ? "Retirer" : "Remove"}
            </button>
          </div>
          {g.error ? (
            <ErrorNote>{g.error}</ErrorNote>
          ) : !g.events.length ? (
            <small>{fr ? "Aucun échec récent." : "No recent failures."}</small>
          ) : (
            <ul>
              {g.events.map((ev) => (
                <li key={ev.id}>
                  <a href={ev.url} target="_blank" rel="noreferrer">
                    {ev.name} · {ev.sha.slice(0, 7)}
                  </a>
                  <small>
                    {ev.pr ? "PR #" + ev.pr : ev.branch} ·{" "}
                    {new Date(ev.at).toLocaleDateString(fr ? "fr-FR" : "en")}
                  </small>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busy}
                    onClick={() => void explain(ev)}
                  >
                    {fr ? "Expliquer cet échec" : "Explain failure"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <ErrorNote>{error}</ErrorNote>
    </details>
  );
}
