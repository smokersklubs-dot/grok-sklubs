import { useState } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import type { Card } from "../types";
import { Icon } from "./Icon";
import "./RecruitCard.css";

/**
 * « Bot recruteur »: the main bot proposes ONE new specialist (server agent/recruit.ts). The card is the approval:
 * « Créer {name} » creates it (careful, in the main bot's section, with its Bibliothèque skills and its routines paused)
 * and hands it the request; « Modifier » edits the name, role and instructions in place; « Non merci » leaves nothing.
 * A limit (hosted plan, bots created today, full team) shows its remedy instead of creating.
 */
type RecruitCard = Extract<Card, { type: "recruit" }>;

export function RecruitCardView({ card, botId, seq }: { card: RecruitCard; botId: string; seq: number }) {
  const t = useT();
  const openAppSettings = useStore((s) => s.openAppSettings);
  const selectBot = useStore((s) => s.selectBot);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(card.name);
  const [role, setRole] = useState(card.role);
  const [instructions, setInstructions] = useState(card.instructions);
  const [busy, setBusy] = useState<"create" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = card.status === "pending";
  const shown = pending ? name.trim() || card.name : card.botName || card.name;
  const act = async (action: "create" | "decline") => {
    setBusy(action);
    setError(null);
    try {
      await api("POST", `/bots/${enc(botId)}/cards/${seq}/recruit`, action === "create" ? { action, name, role, instructions } : { action });
    } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  const id = `rc-${seq}`;
  return (
    <div className={`card recruit-card is-${card.status}`}>
      <div className="card-head">
        <span className="logo-tile is-recruit" aria-hidden="true"><Icon name="users" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{t("recruit.title", { name: shown })}</p>
          <p className="card-sub">{pending ? role || card.role : card.role}</p>
        </div>
      </div>
      <p className="card-reason recruit-why"><Icon name="bulb" size={14} /> <span>{card.why}</span></p>

      {pending && editing ? (
        <div className="recruit-edit">
          <label className="field-label" htmlFor={`${id}-n`}>{t("recruit.name")}</label>
          <input id={`${id}-n`} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <label className="field-label" htmlFor={`${id}-r`}>{t("recruit.role")}</label>
          <input id={`${id}-r`} className="input" value={role} onChange={(e) => setRole(e.target.value)} maxLength={60} />
          <label className="field-label" htmlFor={`${id}-i`}>{t("recruit.instructions")}</label>
          <textarea id={`${id}-i`} className="input recruit-instructions-input" rows={5} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={8000} />
        </div>
      ) : pending ? (
        <dl className="recruit-setup">
          <div className="recruit-line">
            <dt>{t("recruit.instructions")}</dt>
            <dd className="recruit-instructions">{instructions}</dd>
          </div>
          {card.skills.length > 0 && (
            <div className="recruit-line">
              <dt>{t("recruit.skills")}</dt>
              <dd className="recruit-chips">{card.skills.map((s) => <span key={s.id} className="chip"><Icon name="book" size={12} /> {s.title}</span>)}</dd>
            </div>
          )}
          {card.routines.length > 0 && (
            <div className="recruit-line">
              <dt>{t("recruit.routines")}</dt>
              <dd>
                <ul className="recruit-routines">
                  {card.routines.map((r) => (
                    <li key={r.name}><Icon name="clock" size={13} /><span className="recruit-routine-name">{r.name}</span><span className="chip"><Icon name="pause" size={11} /> {t("recruit.paused")}</span><span className="recruit-routine-when muted">{r.when}</span></li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          <div className="recruit-line">
            <dt>{t("recruit.brain")}</dt>
            <dd className="recruit-brain"><Icon name="brain" size={13} /><span><span className="recruit-brain-name">{card.brainLabel}</span> <span className="muted">· {t(`recruit.brain.${card.brain}` as Key)}</span></span></dd>
          </div>
          <div className="recruit-line">
            <dt>{t("recruit.task")}</dt>
            <dd className="recruit-task">{card.task}</dd>
          </div>
        </dl>
      ) : null}

      {pending && (
        <>
          <p className="card-sub note-line"><Icon name="shield" size={13} /> <span>{t("recruit.careful")}</span></p>
          {card.limit && (
            <div className="recruit-limit" role="status">
              <p className="note-line"><Icon name="alert" size={14} /> <span>{t(`recruit.limit.${card.limit}` as Key, { n: card.limitN ?? 0 })}</span></p>
              {card.limit === "plan" && <button type="button" className="btn btn-small" onClick={() => openAppSettings("subscription")}><Icon name="chart" size={13} /> {t("recruit.limit.planAction")}</button>}
            </div>
          )}
          <div className="card-actions recruit-actions">
            <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void act("decline")}>{t("recruit.decline")}</button>
            <span className="spacer" />
            <button type="button" className="btn" disabled={busy !== null} aria-pressed={editing} onClick={() => setEditing((v) => !v)}><Icon name={editing ? "check" : "edit"} size={14} /> {t(editing ? "recruit.doneEditing" : "recruit.edit")}</button>
            <button type="button" className="btn btn-accent" disabled={busy !== null || !name.trim() || !role.trim() || !instructions.trim()} onClick={() => void act("create")}>
              {busy === "create" ? t("common.working") : t(card.limit ? "recruit.retry" : "recruit.create", { name: name.trim() || card.name })}
            </button>
          </div>
          {error && <p className="card-error" role="alert">{error}</p>}
        </>
      )}

      {card.status === "created" && (
        <div className="recruit-done">
          <p className="card-outcome is-allowed"><Icon name="check" size={14} /> {t("recruit.created", { name: shown })}</p>
          {card.botId && <button type="button" className="btn btn-small" onClick={() => selectBot(card.botId!)}><Icon name="chat" size={13} /> {t("recruit.open", { name: shown })}</button>}
        </div>
      )}
      {card.status === "declined" && <p className="card-outcome is-denied"><Icon name="close" size={14} /> {t("recruit.declined")}</p>}
    </div>
  );
}
