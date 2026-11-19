import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useStore } from "../store";
import { ErrorNote } from "./ui";

type Choice = { id: string; name: string };
type Job = {
  id: string;
  repo: string;
  issue: number;
  thread: number;
  phase: string;
  pr: number | null;
  note: string;
  branch: string;
};
type Config = { accounts: Choice[]; reviewers: Choice[]; jobs: Job[] };
type Detail = {
  changes: { path: string; before: string | null; after: string }[];
  review: string;
  revision: string;
  base?: string;
  baseSha?: string;
  publicRepository?: boolean;
};
const labels: Record<string, [string, string]> = {
  prepare: ["Préparation du correctif", "Preparing patch"],
  review: ["Relecture du correctif", "Reviewing patch"],
  connect: ["Compte requis pour publier", "Connect an account to publish"],
  approval: ["Ta validation est attendue", "Awaiting your approval"],
  commit: ["Création du commit", "Creating commit"],
  publish: ["Publication du brouillon", "Publishing draft"],
  ci: ["Tests en cours de suivi", "Watching checks"],
  done: ["Suivi terminé", "Checks reported"],
  error: ["Mission interrompue", "Interrupted"],
  declined: ["Publication refusée", "Declined"],
  changes: ["Corrections demandées", "Changes requested"],
};
export function GithubIssues({
  bot,
  launched,
  initialUrl = "",
  close,
}: {
  bot: string;
  launched?: boolean;
  initialUrl?: string;
  close?: () => void;
}) {
  const fr = useStore((s) => s.locale === "fr");
  const base = "/bots/" + encodeURIComponent(bot) + "/github-issues";
  const origin = useStore((s) => s.openThread);
  const [inThread, setInThread] = useState(false);
  const [open, setOpen] = useState(!!launched),
    [cfg, setCfg] = useState<Config | null>(null),
    [error, setError] = useState(""),
    [url, setUrl] = useState(initialUrl),
    [account, setAccount] = useState(""),
    [publishAccount, setPublishAccount] = useState(""),
    [publishedPr, setPublishedPr] = useState(""),
    [reviewer, setReviewer] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, tick] = useState(0),
    [detail, setDetail] = useState<{ job: string; data: Detail } | null>(null);
  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const cfg = await api<Config>("GET", base, undefined, ac.signal);
        if (!ac.signal.aborted) {
          setCfg(cfg);
          setError("");
        }
      } catch (e) {
        if (!ac.signal.aborted) setError(errText(e));
      }
      if (!ac.signal.aborted) timer = setTimeout(load, 10000);
    };
    void load();
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [base, open, refresh]);
  const thread = (seq: number) => {
    close?.();
    const s = useStore.getState();
    s.selectBot(bot);
    s.openThreadPanel(bot, seq);
  };
  async function post(data: object, show = false) {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ thread: number }>("POST", base, data);
      setDetail(null);
      tick((n) => n + 1);
      if (show) {
        setUrl("");
        thread(r.thread);
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }
  async function inspect(job: Job) {
    setPublishedPr("");
    if (detail?.job === job.id) {
      setDetail(null);
      return;
    }
    setBusy(true);
    try {
      setDetail({ job: job.id, data: await api<Detail>("GET", base + "?job=" + encodeURIComponent(job.id)) });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }
  const connector = account === "public" ? "" : account || cfg?.accounts[0]?.id || "",
    peer = reviewer || cfg?.reviewers[0]?.id || "";
  const connect = () => {
    close?.();
    useStore.getState().openModal({ kind: "connectors", catalogId: "github-code" });
  };
  return (
    <details
      className="github-activity"
      open={launched ? true : undefined}
      onToggle={(e) => {
        if (e.target === e.currentTarget) setOpen(e.currentTarget.open);
      }}
    >
      <summary hidden={launched}>GitHub · {fr ? "Missions" : "Tasks"}</summary>
      {cfg && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void post(
              { url, reviewer: peer, connector, thread: inThread && origin?.botId === bot ? origin.seq : 0 },
              true,
            );
          }}
        >
          {origin?.botId === bot && (
            <label>
              <span>
                <input type="checkbox" checked={inThread} onChange={(e) => setInThread(e.target.checked)} />{" "}
                {fr ? "Suivre dans le fil ouvert" : "Report to the open thread"}
              </span>
            </label>
          )}
          <label>
            {fr ? "Lien du ticket" : "Issue URL"}
            <input
              className="input"
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/…/issues/123"
            />
          </label>
          {cfg.accounts.length > 0 ? (
            <label>
              {fr ? "Compte GitHub" : "GitHub account"}
              <select className="input" value={connector || "public"} onChange={(e) => setAccount(e.target.value)}>
                <option value="public">{fr ? "Lecture publique" : "Public read access"}</option>
                {cfg.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <small>
                {fr
                  ? "Un ticket public peut être préparé et relu dès maintenant."
                  : "Public issues can be prepared and reviewed now."}
              </small>
              <button className="btn btn-small" type="button" onClick={connect}>
                {fr ? "Connecter GitHub Code" : "Connect GitHub Code"}
              </button>
            </>
          )}
          {cfg.reviewers.length > 0 ? (
            <label>
              {fr ? "Bot relecteur" : "Reviewing bot"}
              <select className="input" value={peer} onChange={(e) => setReviewer(e.target.value)}>
                {cfg.reviewers.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <small>
              {fr ? "Ajoute un deuxième bot pour la relecture." : "Add a second bot to review changes."}
            </small>
          )}
          <button className="btn btn-small" disabled={busy || !peer || !url.trim()}>
            {fr ? "Confier le ticket" : "Assign issue"}
          </button>
        </form>
      )}
      {cfg?.jobs.map((j) => (
        <section key={j.id}>
          <strong>
            {j.repo}#{j.issue}
          </strong>
          <small>{labels[j.phase]?.[fr ? 0 : 1] ?? j.phase}</small>
          {j.note && <p>{j.note}</p>}
          <div className="studio-actions">
            <button className="btn btn-small" onClick={() => thread(j.thread)}>
              {fr ? "Discussion" : "Conversation"}
            </button>
            {j.phase !== "prepare" && (
              <button className="btn btn-small" disabled={busy} onClick={() => void inspect(j)}>
                {fr ? "Examiner les fichiers" : "Inspect files"}
              </button>
            )}
            {j.pr && (
              <a href={"https://github.com/" + j.repo + "/pull/" + j.pr} target="_blank" rel="noreferrer">
                PR #{j.pr}
              </a>
            )}
            {["error", "changes"].includes(j.phase) && (
              <button
                className="btn btn-small"
                disabled={busy}
                onClick={() => void post({ job: j.id, decision: "retry" })}
              >
                {fr ? "Reprendre" : "Retry"}
              </button>
            )}
          </div>
          {detail?.job === j.id && (
            <div>
              <p>{detail.data.review}</p>
              {detail.data.changes.map((f) => (
                <details key={f.path}>
                  <summary>{f.path}</summary>
                  <strong>{fr ? "Avant" : "Before"}</strong>
                  <pre>{f.before ?? (fr ? "Nouveau fichier" : "New file")}</pre>
                  <strong>{fr ? "Après" : "After"}</strong>
                  <pre>{f.after}</pre>
                </details>
              ))}
              {j.phase === "connect" &&
                (cfg.accounts.length ? (
                  <div>
                    <label>
                      {fr ? "Compte de publication" : "Publishing account"}
                      <select
                        className="input"
                        value={publishAccount}
                        onChange={(e) => setPublishAccount(e.target.value)}
                      >
                        <option value="">{fr ? "Choisir un compte" : "Choose an account"}</option>
                        {cfg.accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="btn btn-small"
                      disabled={busy || !publishAccount}
                      onClick={() =>
                        void post({
                          job: j.id,
                          decision: "connect",
                          revision: detail.data.revision,
                          connector: publishAccount,
                        })
                      }
                    >
                      {fr ? "Associer ce compte au correctif" : "Link account to this patch"}
                    </button>
                  </div>
                ) : (
                  <button className="btn btn-small" onClick={connect}>
                    {fr ? "Connecter GitHub Code" : "Connect GitHub Code"}
                  </button>
                ))}
              {j.phase === "approval" && (
                <div className="studio-actions">
                  <button
                    className="btn btn-small"
                    disabled={busy}
                    onClick={() => void post({ job: j.id, decision: "approve", revision: detail.data.revision })}
                  >
                    {fr ? "Autoriser la PR en brouillon" : "Approve draft PR"}
                  </button>
                  <button
                    className="btn btn-ghost btn-small"
                    disabled={busy}
                    onClick={() => void post({ job: j.id, decision: "decline", revision: detail.data.revision })}
                  >
                    {fr ? "Refuser" : "Decline"}
                  </button>
                </div>
              )}
              {["connect", "approval"].includes(j.phase) && detail.data.publicRepository !== false && (
                <details>
                  <summary>{fr ? "Suivre une PR brouillon déjà publiée" : "Follow an existing draft PR"}</summary>
                  <small>{fr ? "Branche attendue dans le dépôt public" : "Expected public repository branch"} · <code>{j.branch}</code></small>
                  {detail.data.baseSha && <p>{fr ? "Base du correctif" : "Reviewed base"} · {detail.data.base} · <code>{detail.data.baseSha}</code></p>}
                  <form onSubmit={e => {
                    e.preventDefault();
                    void post({ job: j.id, decision: "follow-published", revision: detail.data.revision, pr: publishedPr });
                  }}>
                    <label>{fr ? "Numéro ou URL de la PR" : "PR number or URL"}
                      <input className="input" maxLength={250} required value={publishedPr}
                        onChange={e => setPublishedPr(e.target.value)} /></label>
                    <button type="submit" className="btn btn-small" disabled={busy || !publishedPr.trim()}>
                      {fr ? "Vérifier et suivre dans la discussion" : "Verify and follow in this conversation"}
                    </button>
                  </form>
                </details>
              )}
            </div>
          )}
        </section>
      ))}
      <ErrorNote>{error}</ErrorNote>
    </details>
  );
}
