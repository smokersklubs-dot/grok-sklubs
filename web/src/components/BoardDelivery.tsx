import { useEffect, useState } from "react";
import { api } from "../api";
import { useT, type Key } from "../i18n";
import type { BoardDelivery, BoardTask } from "../../../server/src/workboardtypes";
import { Icon } from "./Icon";
import "./BoardDelivery.css";

/**
 * L175 « Livrer par demande d'intégration (pull request) » on a board task card (server workboardpr.ts, docs/TABLEAU.md):
 * the setting (repository, project folder in the bot's files, GitHub account), the owner's go-ahead before the first
 * push to a repository, the pull request's link and state (open / merged / closed), « Réessayer » after a refusal.
 */
const PR_KEY: Record<string, Key> = { open: "board.pr.state.open", merged: "board.pr.state.merged", closed: "board.pr.state.closed" };
const PR_TONE: Record<string, string> = { open: "info", merged: "ok", closed: "danger" };

export function TaskDelivery({ task, act }: { task: BoardTask; act: (fn: () => Promise<unknown>) => void }) {
  const t = useT();
  const d = task.delivery ?? null;
  const [editing, setEditing] = useState(false);
  const locked = task.state === "delivering";
  if (editing) return <DeliveryForm task={task} current={d} onClose={() => setEditing(false)} act={act} />;
  if (!d) {
    if (task.state === "done" || task.state === "running" || task.state === "review") return null;
    return <div className="wb-card-actions"><button type="button" className="btn btn-small btn-ghost" onClick={() => setEditing(true)}><Icon name="upload" size={13} />{t("board.pr.set")}</button></div>;
  }
  const prState = d.prState || (d.prNumber ? "open" : "");
  return (
    <div className="wb-pr" aria-label={t("board.pr.title")}>
      <p className="wb-line wb-pr-head">
        <Icon name="upload" size={12} /> <span>{t("board.pr.mode")}</span> <code className="wb-pr-repo">{d.repo}</code>
        {d.branch && <span className="muted wb-small">{d.branch} → {d.base || t("board.pr.defaultBase")}</span>}
      </p>
      {d.prNumber && (
        <p className="wb-line wb-pr-head">
          {d.prUrl ? <a href={d.prUrl} target="_blank" rel="noreferrer">{t("board.pr.link", { n: d.prNumber })} <Icon name="external" size={11} /></a> : <span>{t("board.pr.link", { n: d.prNumber })}</span>}
          {prState && <span className={`chip ch-tone-${PR_TONE[prState]} wb-pr-chip`}>{t(PR_KEY[prState])}</span>}
        </p>
      )}
      {d.phase === "approval" && d.pending && <Approval task={task} d={d} act={act} />}
      {d.phase === "pushing" && <p className="wb-line muted">{t("board.pr.pushing")}</p>}
      {d.note && d.note !== task.note && d.phase !== "approval" && <p className="wb-line wb-note">{d.note}</p>}
      <div className="wb-card-actions">
        {(d.phase === "refused" || d.phase === "closed") && task.state === "blocked" && <button type="button" className="btn btn-small btn-primary" onClick={() => act(() => api("POST", `/board/tasks/${task.id}/delivery/retry`))}><Icon name="refresh" size={13} />{t("board.pr.retry")}</button>}
        {!locked && task.state !== "done" && <button type="button" className="btn btn-small btn-ghost" onClick={() => setEditing(true)}><Icon name="edit" size={13} />{t("board.pr.edit")}</button>}
        {!locked && task.state !== "done" && <button type="button" className="btn btn-small btn-ghost" onClick={() => act(() => api("DELETE", `/board/tasks/${task.id}/delivery`))}>{t("board.pr.local")}</button>}
      </div>
    </div>
  );
}

function Approval({ task, d, act }: { task: BoardTask; d: BoardDelivery; act: (fn: () => Promise<unknown>) => void }) {
  const t = useT();
  const p = d.pending!;
  return (
    <div className="wb-pr-ask" role="group" aria-label={t("board.pr.askTitle")}>
      <strong>{t("board.pr.askTitle")}</strong>
      {d.note && <p className="wb-line">{d.note}</p>}
      <dl className="wb-pr-facts">
        <dt>{t("board.pr.account")}</dt><dd>{p.login}{p.expectedLogin && p.expectedLogin !== p.login ? ` (${t("board.pr.was", { login: p.expectedLogin })})` : ""}</dd>
        <dt>{t("board.pr.identity")}</dt><dd>{p.name} &lt;{p.email}&gt;</dd>
        <dt>{t("board.pr.remote")}</dt><dd><code>{p.remote}</code></dd>
        <dt>{t("board.pr.branch")}</dt><dd>{p.branch} → {p.base}</dd>
      </dl>
      <p className="wb-line muted wb-small">{t("board.pr.askRules")}</p>
      <div className="wb-card-actions">
        <button type="button" className="btn btn-small btn-primary" onClick={() => act(() => api("POST", `/board/tasks/${task.id}/delivery/approve`))}>{t("board.pr.approve")}</button>
        <button type="button" className="btn btn-small" onClick={() => act(() => api("POST", `/board/tasks/${task.id}/delivery/decline`))}>{t("board.pr.decline")}</button>
      </div>
    </div>
  );
}

function DeliveryForm({ task, current, onClose, act }: { task: BoardTask; current: BoardDelivery | null; onClose: () => void; act: (fn: () => Promise<unknown>) => void }) {
  const t = useT();
  const [accounts, setAccounts] = useState<{ id: string; name: string }[] | null>(null);
  const [f, setF] = useState({ repo: current?.repo ?? "", folder: current?.folder ?? "", connectorId: current?.connectorId ?? "", base: current?.base ?? "", branch: current?.branch ?? "", identityName: current?.identityName ?? "", identityEmail: current?.identityEmail ?? "" });
  useEffect(() => {
    let alive = true;
    api<{ accounts?: { id: string; name: string }[] }>("GET", "/board/github-accounts").then((r) => {
      if (!alive) return;
      const list = Array.isArray(r?.accounts) ? r.accounts : [];
      setAccounts(list);
      setF((x) => (x.connectorId || !list[0] ? x : { ...x, connectorId: list[0].id }));
    }).catch(() => alive && setAccounts([]));
    return () => { alive = false; };
  }, []);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const id = (k: string) => `wb-pr-${task.id}-${k}`;
  return (
    <form className="wb-form wb-pr-form" onSubmit={(e) => { e.preventDefault(); act(() => api("PUT", `/board/tasks/${task.id}/delivery`, f)); onClose(); }}>
      <strong className="wb-small">{t("board.pr.set")}</strong>
      <p className="muted wb-small">{t("board.pr.intro")}</p>
      {accounts && !accounts.length && <p className="wb-line wb-note">{t("board.pr.noAccount")}</p>}
      <div className="wb-form-grid">
        <label htmlFor={id("repo")}>{t("board.pr.repo")}<input id={id("repo")} value={f.repo} onChange={set("repo")} placeholder="owner/name" required autoComplete="off" spellCheck={false} /></label>
        <label htmlFor={id("folder")}>{t("board.pr.folder")}<input id={id("folder")} value={f.folder} onChange={set("folder")} placeholder="projets/site" required autoComplete="off" spellCheck={false} /></label>
        <label htmlFor={id("acc")}>{t("board.pr.account")}
          <select id={id("acc")} value={f.connectorId} onChange={set("connectorId")} required>
            {!accounts?.length && <option value="">—</option>}
            {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </div>
      <details className="wb-pr-more">
        <summary>{t("board.pr.more")}</summary>
        <div className="wb-form-grid">
          <label htmlFor={id("base")}>{t("board.pr.base")}<input id={id("base")} value={f.base} onChange={set("base")} placeholder={t("board.pr.defaultBase")} autoComplete="off" spellCheck={false} /></label>
          <label htmlFor={id("branch")}>{t("board.pr.branch")}<input id={id("branch")} value={f.branch} onChange={set("branch")} placeholder={t("board.pr.branchAuto")} autoComplete="off" spellCheck={false} /></label>
          <label htmlFor={id("iname")}>{t("board.pr.identityName")}<input id={id("iname")} value={f.identityName} onChange={set("identityName")} autoComplete="off" /></label>
          <label htmlFor={id("imail")}>{t("board.pr.identityEmail")}<input id={id("imail")} type="email" value={f.identityEmail} onChange={set("identityEmail")} autoComplete="off" /></label>
        </div>
      </details>
      <div className="wb-card-actions">
        <button type="submit" className="btn btn-small btn-primary" disabled={!f.repo.trim() || !f.folder.trim() || !f.connectorId}>{t("board.pr.save")}</button>
        <button type="button" className="btn btn-small" onClick={onClose}>{t("board.pr.cancel")}</button>
      </div>
    </form>
  );
}
