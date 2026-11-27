import { useEffect, useState } from "react";
import { t as tr, type Key } from "../i18n";
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
const labels: Record<string, Key> = {
  prepare: "ghIssues.phase.prepare",
  review: "ghIssues.phase.review",
  connect: "ghIssues.phase.connect",
  approval: "ghIssues.phase.approval",
  commit: "ghIssues.phase.commit",
  publish: "ghIssues.phase.publish",
  ci: "ghIssues.phase.ci",
  done: "ghIssues.phase.done",
  error: "ghIssues.phase.error",
  declined: "ghIssues.phase.declined",
  changes: "ghIssues.phase.changes",
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
      <summary hidden={launched}>GitHub · {tr("ghIssues.tasks")}</summary>
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
                {tr("ghIssues.reportOpenThread")}
              </span>
            </label>
          )}
          <label>
            {tr("ghIssues.issueUrl")}
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
              {tr("board.pr.account")}
              <select className="input" value={connector || "public"} onChange={(e) => setAccount(e.target.value)}>
                <option value="public">{tr("ghIssues.publicReadAccess")}</option>
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
                {tr("ghIssues.publicIssuesCanPrepared")}
              </small>
              <button className="btn btn-small" type="button" onClick={connect}>
                {tr("ghIssues.connectGithubCode")}
              </button>
            </>
          )}
          {cfg.reviewers.length > 0 ? (
            <label>
              {tr("ghIssues.reviewingBot")}
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
              {tr("ghIssues.addSecondBotReview")}
            </small>
          )}
          <button className="btn btn-small" disabled={busy || !peer || !url.trim()}>
            {tr("ghIssues.assignIssue")}
          </button>
        </form>
      )}
      {cfg?.jobs.map((j) => (
        <section key={j.id}>
          <strong>
            {j.repo}#{j.issue}
          </strong>
          <small>{labels[j.phase] ? tr(labels[j.phase]) : j.phase}</small>
          {j.note && <p>{j.note}</p>}
          <div className="studio-actions">
            <button className="btn btn-small" onClick={() => thread(j.thread)}>
              {tr("ghIssues.conversation")}
            </button>
            {j.phase !== "prepare" && (
              <button className="btn btn-small" disabled={busy} onClick={() => void inspect(j)}>
                {tr("ghIssues.inspectFiles")}
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
                {tr("ghIssues.retry")}
              </button>
            )}
          </div>
          {detail?.job === j.id && (
            <div>
              <p>{detail.data.review}</p>
              {detail.data.changes.map((f) => (
                <details key={f.path}>
                  <summary>{f.path}</summary>
                  <strong>{tr("ghIssues.before")}</strong>
                  <pre>{f.before ?? (tr("ghIssues.newFile"))}</pre>
                  <strong>{tr("ghIssues.after")}</strong>
                  <pre>{f.after}</pre>
                </details>
              ))}
              {j.phase === "connect" &&
                (cfg.accounts.length ? (
                  <div>
                    <label>
                      {tr("ghIssues.publishingAccount")}
                      <select
                        className="input"
                        value={publishAccount}
                        onChange={(e) => setPublishAccount(e.target.value)}
                      >
                        <option value="">{tr("ghIssues.chooseAccount")}</option>
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
                      {tr("ghIssues.linkAccountPatch")}
                    </button>
                  </div>
                ) : (
                  <button className="btn btn-small" onClick={connect}>
                    {tr("ghIssues.connectGithubCode")}
                  </button>
                ))}
              {j.phase === "approval" && (
                <div className="studio-actions">
                  <button
                    className="btn btn-small"
                    disabled={busy}
                    onClick={() => void post({ job: j.id, decision: "approve", revision: detail.data.revision })}
                  >
                    {tr("ghIssues.approveDraftPr")}
                  </button>
                  <button
                    className="btn btn-ghost btn-small"
                    disabled={busy}
                    onClick={() => void post({ job: j.id, decision: "decline", revision: detail.data.revision })}
                  >
                    {tr("goal.decline")}
                  </button>
                </div>
              )}
              {["connect", "approval"].includes(j.phase) && detail.data.publicRepository !== false && (
                <details>
                  <summary>{tr("ghIssues.followExistingDraftPr")}</summary>
                  <small>{tr("ghIssues.expectedPublicRepositoryBranch")} · <code>{j.branch}</code></small>
                  {detail.data.baseSha && <p>{tr("ghIssues.reviewedBase")} · {detail.data.base} · <code>{detail.data.baseSha}</code></p>}
                  <form onSubmit={e => {
                    e.preventDefault();
                    void post({ job: j.id, decision: "follow-published", revision: detail.data.revision, pr: publishedPr });
                  }}>
                    <label>{tr("ghIssues.prNumberUrl")}
                      <input className="input" maxLength={250} required value={publishedPr}
                        onChange={e => setPublishedPr(e.target.value)} /></label>
                    <button type="submit" className="btn btn-small" disabled={busy || !publishedPr.trim()}>
                      {tr("ghIssues.verifyFollowConversation")}
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
