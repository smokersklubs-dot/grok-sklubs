import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import type { BotJob, Card } from "../types";
import { Icon } from "./Icon";

/* ---------- Goal mode: the goal card (agent/goals.ts) ---------- */

type GoalCard = Extract<Card, { type: "goal" }>;

export function GoalCardView({ card, botId }: { card: GoalCard; botId: string }) {
  const t = useT();
  const own = useStore((s) => !s.bots[botId]?.access);
  const live = useStore((s) => s.live[botId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const act = async (action: "pause" | "resume" | "stop" | "accept" | "decline") => {
    setBusy(action);
    setError(null);
    try { await api("POST", `/bots/${enc(botId)}/goals/${enc(card.goalId)}`, { action }); }
    catch (e) { setError(errText(e)); }
    finally { setBusy(null); }
  };
  const active = card.status === "active";
  const working = active && !!live?.running && !card.waiting;
  const pct = Math.min(100, Math.round((card.rounds / Math.max(1, card.maxRounds)) * 100));
  const resumable = card.status === "paused" || card.status === "limit" || card.status === "blocked";
  const long = (card.objective.length > 220);
  return (
    <div className={`card goal-card is-${card.status}`}>
      <div className="card-head">
        <span className={`logo-tile is-goal is-${card.status}`} aria-hidden="true"><Icon name="target" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{t(card.status === "proposed" ? "goal.proposedTitle" : "goal.title")}</p>
          <p className="card-sub">
            <span className={`chip goal-state is-${card.status}`}>{t(working ? "goal.working" : (`goal.status.${card.status}` as Key))}</span>
            {card.status !== "proposed" && card.status !== "declined" && <> <span className="goal-rounds">{t("goal.rounds", { n: card.rounds, max: card.maxRounds })}</span></>}
          </p>
        </div>
      </div>
      <p className={`goal-objective ${long && !open ? "is-clamped" : ""}`}>{card.objective}</p>
      {long && <button type="button" className="link goal-more" onClick={() => setOpen((v) => !v)}>{t(open ? "task.less" : "task.more")}</button>}
      {card.status !== "proposed" && card.status !== "declined" && (
        <div className="goal-bar" role="progressbar" aria-valuemin={0} aria-valuemax={card.maxRounds} aria-valuenow={card.rounds} aria-label={t("goal.rounds", { n: card.rounds, max: card.maxRounds })}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      {active && card.waiting && <p className="goal-line is-waiting"><Icon name="hand" size={13} /> {t(`goal.waiting.${card.waiting}` as Key)}</p>}
      {card.summary && card.status !== "complete" && <p className="goal-line"><span className="muted">{t("goal.last")}</span> {card.summary}</p>}
      {card.status === "complete" && (
        <div className="goal-done">
          {card.summary && <p>{card.summary}</p>}
          {card.evidence && <p className="goal-evidence"><span className="muted">{t("goal.evidence")}</span> {card.evidence}</p>}
        </div>
      )}
      {card.reason && card.status !== "complete" && card.status !== "active" && <p className="goal-line is-reason"><Icon name="info" size={13} /> {card.reason}</p>}
      {own && (
        <div className="card-actions">
          {card.status === "proposed" && (
            <>
              <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void act("decline")}>{t("goal.decline")}</button>
              <span className="spacer" />
              <button type="button" className="btn btn-accent" disabled={busy !== null} onClick={() => void act("accept")}><Icon name="play" size={13} /> {t(busy === "accept" ? "common.working" : "goal.accept")}</button>
            </>
          )}
          {(active || resumable) && (
            <>
              <button type="button" className="btn btn-small btn-ghost-danger" disabled={busy !== null} onClick={() => void act("stop")}><Icon name="stop" size={12} /> {t("goal.stop")}</button>
              <span className="spacer" />
              {active && <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void act("pause")}><Icon name="pause" size={13} /> {t("goal.pause")}</button>}
              {resumable && <button type="button" className="btn btn-small btn-accent" disabled={busy !== null} onClick={() => void act("resume")}><Icon name="play" size={12} /> {t(card.status === "limit" ? "goal.resumeMore" : "goal.resume")}</button>}
            </>
          )}
        </div>
      )}
      {error && <p className="card-error" role="alert">{error}</p>}
    </div>
  );
}

/* ---------- Background jobs on the bot's computer (jobs.ts), in the computer panel ---------- */

const minutes = (from: number, to: number | null) => Math.max(0, Math.round(((to ?? Date.now()) - from) / 60_000));

export function JobsList({ botId }: { botId: string }) {
  const t = useT();
  const [list, setList] = useState<BotJob[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    const load = () => api<{ jobs: BotJob[] }>("GET", `/bots/${enc(botId)}/jobs`).then((r) => !dead && setList(r.jobs), () => undefined);
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 5000);
    return () => { dead = true; window.clearInterval(timer); };
  }, [botId]);
  const stop = async (id: string) => {
    setBusy(id);
    setError(null);
    try { setList((await api<{ jobs: BotJob[] }>("POST", `/bots/${enc(botId)}/jobs/${enc(id)}/stop`)).jobs); }
    catch (e) { setError(errText(e)); }
    finally { setBusy(null); }
  };
  // Running jobs, then the last few that ended in the past day.
  const shown = (list ?? []).filter((j) => j.status === "running" || (j.endedAt ?? 0) > Date.now() - 86_400_000).slice(0, 6);
  if (!shown.length) return null;
  return (
    <div className="jobs" aria-label={t("jobs.title")}>
      <p className="jobs-head"><Icon name="terminal" size={13} /> {t("jobs.title")}</p>
      <ul className="jobs-list">
        {shown.map((j) => (
          <li key={j.id} className={`job is-${j.status}`}>
            <span className={`dot-inline ${j.status === "running" ? "dot-step-running" : ""}`} aria-hidden="true" />
            <span className="job-text">
              <code className="job-cmd truncate" title={j.command}>{j.command}</code>
              <span className="job-sub">
                {t(`jobs.status.${j.status}` as Key, { code: j.exitCode ?? "?" })} · {t("jobs.minutes", { n: minutes(j.startedAt, j.endedAt) })}{j.note ? ` · ${j.note}` : ""}
              </span>
            </span>
            {j.status === "running" && (
              <button type="button" className="btn btn-small btn-ghost-danger" disabled={busy !== null} onClick={() => void stop(j.id)} aria-label={t("jobs.stopLabel", { id: j.id })}>
                <Icon name="stop" size={11} /> {t(busy === j.id ? "common.working" : "jobs.stop")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="card-error" role="alert">{error}</p>}
    </div>
  );
}
