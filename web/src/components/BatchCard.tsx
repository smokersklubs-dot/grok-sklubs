import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import { money } from "../lib/format";
import { durationText, spendText } from "../lib/stepview";
import type { BatchCard, BatchCost, BatchItemState } from "../types";
import { Icon } from "./Icon";
import "./BatchCard.css";

/**
 * L99 « lots en parallèle »: one card for a batch of tasks the bot launched (agent/batches.ts). A progress bar, each
 * task with its state (waiting its turn, at work, needs you, done, failed, stopped), its report when done, an action
 * it waits on answered right here, what the batch has cost so far, and « Arrêter » (cancels what has not started).
 */
const ICON: Record<BatchItemState, "clock" | "refresh" | "hand" | "check" | "alert" | "stop"> = { queued: "clock", running: "refresh", waiting: "hand", done: "check", failed: "alert", stopped: "stop" };

function useBatchCost(botId: string, batchId: string, running: boolean, tick: string): BatchCost | null {
  const own = useStore((s) => !!s.bots[botId] && !s.bots[botId].access);
  const [cost, setCost] = useState<BatchCost | null>(null);
  useEffect(() => {
    if (!own) return;
    let dead = false;
    const load = () => api<BatchCost>("GET", `/bots/${enc(botId)}/batches/${enc(batchId)}`).then((r) => !dead && setCost(r), () => undefined);
    void load();
    const timer = running ? window.setInterval(load, 15_000) : undefined;
    return () => { dead = true; if (timer) window.clearInterval(timer); };
  }, [own, botId, batchId, running, tick]);
  return cost;
}

export function BatchCardView({ card, botId }: { card: BatchCard; botId: string }) {
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = card.state === "running";
  const total = card.items.length;
  // Finished = done or failed (a stopped task did not finish): "1 of 4" after a stop.
  const finished = card.items.filter((i) => i.state === "done" || i.state === "failed").length;
  const working = card.items.filter((i) => i.state === "running").length;
  const ended = card.items.filter((i) => i.state === "done" || i.state === "failed" || i.state === "stopped").length;
  const cost = useBatchCost(botId, card.batchId, running, `${card.state}-${ended}`);
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  const spend = cost ? spendText(cost.costUsd, cost.estimatedUsd, money) : null;
  return (
    <div className={`card batch-card is-${card.state}`}>
      <div className="card-head">
        <span className={`logo-tile is-task is-${running ? "running" : card.state === "done" ? "done" : "stopped"}`} aria-hidden="true"><Icon name="tasks" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{card.title}</p>
          <p className="card-sub">
            <span className={`chip task-state is-${running ? "running" : card.state === "done" ? "done" : "stopped"}`}>{t(`batch.state.${card.state}` as Key)}</span>
            {" "}<span className="task-steps">{t("batch.progress", { done: finished, total })}</span>
          </p>
        </div>
        <span className="spacer" />
        {running && (
          <button type="button" className="btn btn-small btn-ghost-danger" disabled={busy !== null} onClick={() => void act("stop", () => api("POST", `/bots/${enc(botId)}/batches/${enc(card.batchId)}/stop`))}>
            <Icon name="stop" size={13} /> {t(busy === "stop" ? "common.working" : "batch.stop")}
          </button>
        )}
      </div>
      <div className="batch-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={finished} aria-label={t("batch.progressLabel", { done: finished, total })}>
        <span style={{ width: `${total ? Math.round((finished / total) * 100) : 0}%` }} />
      </div>
      <p className="batch-meta muted small">
        {running && <>{t("batch.parallel", { n: working, max: card.parallel })}<span aria-hidden="true"> · </span></>}
        {cost && spend && <><Icon name="clock" size={12} /> {durationText(cost.durationMs)}<span aria-hidden="true"> · </span>{spend.cost}{spend.estimate && <span title={t("task.costEstimate")}> {spend.estimate}</span>}</>}
      </p>
      <ol className="batch-items">
        {card.items.map((it, i) => (
          <li key={i} className={`batch-item is-${it.state}`}>
            <div className="batch-item-head">
              <span className={`batch-dot is-${it.state}`} aria-hidden="true"><Icon name={ICON[it.state]} size={12} /></span>
              <span className="batch-item-title">{it.title}</span>
              <span className="batch-item-state">{t(`batch.item.${it.state}` as Key)}</span>
              {it.result && (
                <button type="button" className="link batch-item-more" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                  {t(open === i ? "task.less" : "batch.report")}
                </button>
              )}
            </div>
            {it.result && open === i && <p className="batch-item-result">{it.result}</p>}
            {it.question && <p className="card-reason task-question"><Icon name="hand" size={13} /> {it.question}</p>}
            {it.approval && (
              <div className="task-approval">
                <p className="card-title small">{it.approval.title}</p>
                {it.approval.detail && <pre className="card-detail">{it.approval.detail}</pre>}
                {it.approval.irreversible && <p className="approval-irreversible"><Icon name="alert" size={14} /><span><strong>{t("approval.irreversible")}</strong> {it.approval.irreversible}</span></p>}
                <div className="card-actions">
                  <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void act(`deny${i}`, () => api("POST", `/approvals/${enc(it.approval!.approvalId)}`, { decision: "deny" }))}>{t("approval.deny")}</button>
                  <button type="button" className="btn btn-accent" disabled={busy !== null} onClick={() => void act(`allow${i}`, () => api("POST", `/approvals/${enc(it.approval!.approvalId)}`, { decision: "allow" }))}>{t("approval.allow")}</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      {card.state === "done" && <p className="muted small">{t("batch.summaryNote")}</p>}
      {error && <p className="card-error" role="alert">{error}</p>}
    </div>
  );
}
