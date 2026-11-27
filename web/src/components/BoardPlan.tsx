import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { openBoard } from "../lib/workboard";
import type { BoardPlanCard } from "../../../server/src/boardplantypes";
import { Icon } from "./Icon";
import "./StepGuide.css";

/**
 * L163 « plan créé depuis la discussion » (server boardplan.ts; clean room 10-timon.md T9/T12): the bot's plan for the
 * work board on a card — each task with its kind, its bot (or « selon le rôle »), its priority and what it waits on. The
 * owner unticks what they do not want, chooses « lancer tout de suite » or not, and presses « Mettre sur le tableau »
 * (nothing exists on the board before). A role nobody holds is named: a proposal card for a bot appears in the main bot's
 * chat once the plan is on the board (never created silently). Wrong-shaped answers leave the card as it was.
 */
const ROLE_KEY: Record<string, Key> = { code: "board.role.code", review: "board.role.review", research: "board.role.research", docs: "board.role.docs", chore: "board.role.chore" };
const isCard = (x: unknown): x is BoardPlanCard => !!x && typeof x === "object" && (x as BoardPlanCard).type === "boardplan" && Array.isArray((x as BoardPlanCard).tasks);

export function BoardPlanCardView({ card: initial, botId, seq }: { card: BoardPlanCard; botId: string; seq: number }) {
  const t = useT();
  const [local, setLocal] = useState<BoardPlanCard | null>(null);
  useEffect(() => setLocal(null), [initial]);
  const card = local ?? initial;
  const tasks = Array.isArray(card.tasks) ? card.tasks : [];
  const [keep, setKeep] = useState<boolean[]>(() => tasks.map(() => true));
  const [launch, setLaunch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = card.status === "pending";
  const kept = keep.map((k, i) => (k ? i : -1)).filter((i) => i >= 0);
  const missing = (card.missingRoles ?? []).filter((r) => tasks.some((x, i) => keep[i] && x.kind === r && !x.botId));
  const act = async (action: "create" | "dismiss") => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ card?: unknown }>("POST", `/bots/${enc(botId)}/rows/${seq}/boardplan`, action === "create" ? { action, keep: kept, launch } : { action });
      if (isCard(r?.card)) setLocal(r.card);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const created = card.status === "created";
  return (
    <div className={`card boardplan-card ${pending ? "is-pending" : ""}`}>
      <div className="card-head">
        <span className="logo-tile" aria-hidden="true"><Icon name="tasks" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{card.title}</p>
          <p className="card-sub">{t("plan.sub", { n: tasks.length })}</p>
        </div>
      </div>
      {card.why && <p className="card-reason">{card.why}</p>}
      <ol className="stepguide-list boardplan-list">
        {tasks.map((x, i) => (
          <li key={i} className={`stepguide-step ${!keep[i] && pending ? "is-off" : ""} ${created && !card.taskIds?.[i] ? "is-off" : ""}`}>
            {pending
              ? <input type="checkbox" className="boardplan-check" checked={keep[i] ?? true} aria-label={t("plan.keep", { title: x.title })} onChange={(e) => setKeep((k) => k.map((v, j) => (j === i ? e.target.checked : v)))} />
              : <span className={`stepguide-mark ${created && card.taskIds?.[i] ? "is-ok" : ""}`} aria-hidden="true">{created && card.taskIds?.[i] ? <Icon name="check" size={13} /> : i + 1}</span>}
            <div className="stepguide-body">
              <p className="stepguide-title">{i + 1}. {x.title}</p>
              {x.description && <p className="stepguide-detail">{x.description}</p>}
              <p className="boardplan-meta muted small">
                {x.kind ? <span className="chip">{t(ROLE_KEY[x.kind] ?? "board.role.chore")}</span> : null}
                <span>{x.botName ? t("plan.by", { name: x.botName }) : t("plan.byRole")}</span>
                <span>{t("plan.priority", { n: x.priority })}</span>
                {x.after?.length ? <span>{t("plan.after", { list: x.after.map((j) => j + 1).join(", ") })}</span> : null}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {pending ? (
        <>
          {missing.length > 0 && <p className="stepguide-hint is-notyet"><Icon name="users" size={13} /> {t("plan.missing", { list: missing.map((r) => t(ROLE_KEY[r] ?? "board.role.chore")).join(", ") })}</p>}
          <label className="wb-check boardplan-launch"><input type="checkbox" checked={launch} onChange={(e) => setLaunch(e.target.checked)} /> {t("plan.launch")}</label>
          <div className="card-actions">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void act("dismiss")}>{t("plan.no")}</button>
            <span className="spacer" />
            <button type="button" className="btn btn-accent" disabled={busy || !kept.length} onClick={() => void act("create")}><Icon name="tasks" size={15} /> {t(busy ? "common.working" : "plan.create", { n: kept.length })}</button>
          </div>
        </>
      ) : created ? (
        <>
          <p className="card-outcome is-allowed"><Icon name="check" size={14} /> {t(card.launched ? "plan.launched" : "plan.created", { n: (card.taskIds ?? []).filter(Boolean).length })}</p>
          {card.proposedRoles?.length ? <p className="muted small">{t("plan.proposed", { list: card.proposedRoles.map((r) => t(ROLE_KEY[r] ?? "board.role.chore")).join(", ") })}</p> : null}
          <div className="card-actions"><button type="button" className="btn btn-small" onClick={() => openBoard("board")}><Icon name="tasks" size={13} /> {t("plan.openBoard")}</button></div>
        </>
      ) : <p className="card-outcome is-denied"><Icon name="close" size={14} /> {t("plan.dismissed")}</p>}
      {error && <p className="card-error" role="alert">{error}</p>}
    </div>
  );
}
