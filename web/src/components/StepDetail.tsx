import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import { money } from "../lib/format";
import { argLines, durationText, spendText } from "../lib/stepview";
import { Icon } from "./Icon";
import { Loading, Modal } from "./ui";
import "./StepDetail.css";

/**
 * L142 « détail complet d'une étape » and « coût sur la carte d'une tâche » (server/src/stepdetail.ts).
 *  - StepDetailButton: a small « Détail » on each step of the owner's chat opens the step in full: tool, every argument,
 *    the whole result the bot read back, when and how long, and what allowed it with what the model spent before it.
 *  - TaskCostLine: on a background task's card, its running time and what it has cost so far (refreshed while it runs).
 */
interface Detail {
  seq: number; tool: string; label: string; status: string; args: Record<string, unknown>; summary: string;
  startedAt: number; endedAt: number | null; durationMs: number | null;
  result: { text: string; truncated: boolean; isError: boolean; images: number } | null;
  journal: { decision: string; reason: string; quote: string; costUsd: number; status: string } | null;
}

const DECISIONS = ["words", "reviewer", "approval", "retry", "conversation", "policy", "free", "denied"];

function StepDetailModal({ botId, seq, generation, onClose }: { botId: string; seq: number; generation: number; onClose: () => void }) {
  const t = useT();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    api<Detail>("GET", `/bots/${enc(botId)}/steps/${seq}?generation=${generation}`).then((r) => !dead && setD(r), (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [botId, seq, generation]);
  return (
    <Modal title={d ? d.label || d.tool : t("stepDetail.title")} onClose={onClose} size="lg" className="step-detail">
      <div className="step-detail-body">
        {error && <p className="card-error" role="alert">{error}</p>}
        {!d && !error && <Loading />}
        {d && (
          <>
            <dl className="step-detail-facts">
              <dt>{t("stepDetail.tool")}</dt><dd><code>{d.tool}</code></dd>
              <dt>{t("stepDetail.status")}</dt><dd>{t(`stepDetail.st.${d.status}` as Key)}</dd>
              <dt>{t("stepDetail.started")}</dt><dd>{new Date(d.startedAt).toLocaleString()}</dd>
              <dt>{t("stepDetail.duration")}</dt><dd>{d.durationMs === null ? t("stepDetail.stillRunning") : durationText(d.durationMs)}</dd>
              {d.journal && <><dt>{t("stepDetail.allowed")}</dt><dd>{DECISIONS.includes(d.journal.decision) ? t(`stepDetail.dec.${d.journal.decision}` as Key) : d.journal.decision}{d.journal.reason ? ` — ${d.journal.reason}` : ""}</dd></>}
              {d.journal && <><dt>{t("stepDetail.cost")}</dt><dd>{money(d.journal.costUsd)}</dd></>}
            </dl>
            {d.journal?.quote && <blockquote className="step-detail-quote">{d.journal.quote}</blockquote>}
            <h3 className="step-detail-h">{t("stepDetail.args")}</h3>
            {argLines(d.args).length === 0 ? <p className="muted small">{t("stepDetail.noArgs")}</p> : (
              <dl className="step-detail-args">{argLines(d.args).map(([k, v]) => <div key={k}><dt>{k}</dt><dd><pre>{v}</pre></dd></div>)}</dl>
            )}
            {d.summary && <><h3 className="step-detail-h">{t("stepDetail.summary")}</h3><p className="step-detail-summary">{d.summary}</p></>}
            <h3 className="step-detail-h">{t("stepDetail.result")}</h3>
            {d.result ? (
              <>
                {d.result.isError && <p className="card-error">{t("stepDetail.resultError")}</p>}
                <pre className="step-detail-result">{d.result.text || t("stepDetail.empty")}</pre>
                {d.result.images > 0 && <p className="muted small">{t("stepDetail.images", { n: d.result.images })}</p>}
                {d.result.truncated && <p className="muted small">{t("stepDetail.truncated")}</p>}
              </>
            ) : <p className="muted small">{t("stepDetail.noResult")}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}

export function StepDetailButton({ botId, seq, generation }: { botId?: string; seq: number; generation?: number }) {
  const t = useT();
  const own = useStore((s) => !!botId && !!s.bots[botId] && !s.bots[botId].access);
  const [open, setOpen] = useState(false);
  if (!own || !botId || !generation) return null;
  return (
    <>
      <button type="button" className="step-detail-btn" onClick={() => setOpen(true)} aria-label={t("stepDetail.open")} title={t("stepDetail.open")}><Icon name="info" size={13} /></button>
      {open && createPortal(<StepDetailModal botId={botId} seq={seq} generation={generation} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

interface Cost { costUsd: number; estimatedUsd: number; turns: number; durationMs: number; endedAt: number | null }

export function TaskCostLine({ botId, taskId, state }: { botId: string; taskId: string; state: string }) {
  const t = useT();
  const own = useStore((s) => !!s.bots[botId] && !s.bots[botId].access);
  const [c, setC] = useState<Cost | null>(null);
  const running = state === "running" || state === "waiting";
  useEffect(() => {
    if (!own) return;
    let dead = false;
    const load = () => api<Cost>("GET", `/bots/${enc(botId)}/bgtasks/${enc(taskId)}/cost`).then((r) => !dead && setC(r), () => undefined);
    void load();
    const timer = running ? setInterval(load, 15_000) : undefined;
    return () => { dead = true; if (timer) clearInterval(timer); };
  }, [own, botId, taskId, running, state]);
  if (!c) return null;
  const s = spendText(c.costUsd, c.estimatedUsd, money);
  return (
    <p className="task-cost muted small" aria-label={t("task.costLabel")}>
      <Icon name="clock" size={12} /> {durationText(c.durationMs)}
      <span aria-hidden="true"> · </span>{s.cost}{s.estimate && <span title={t("task.costEstimate")}> {s.estimate}</span>}
    </p>
  );
}
