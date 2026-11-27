import { useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import type { TrajectoryCard } from "../types";
import { Icon } from "./Icon";

/**
 * L158 « Créations », the rest (server agent/creationplus.ts): under the trajectory, the budget the owner sets for this
 * creation with what the bot spent since it started (warned at 80 %, « budget atteint » at 100 %), and the open questions
 * the bot could not settle alone, each with a button to tick it off. The server answers with the whole card again.
 */
const usd = (n: number) => `${n.toFixed(2)} $`;

export function CreationExtras({ card, botId, onCard }: { card: TrajectoryCard; botId: string; onCard: (c: TrajectoryCard) => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(card.budgetUsd != null ? String(card.budgetUsd) : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/bots/${enc(botId)}/creations/${enc(card.creationId)}`;
  const send = async (fn: () => Promise<TrajectoryCard>) => {
    setBusy(true); setError("");
    try { onCard(await fn()); setEditing(false); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const saveBudget = (value: string) => send(() => api<TrajectoryCard>("PUT", `${base}/budget`, { usd: value.trim() ? Number(value.replace(",", ".")) : null }));
  const questions = card.questions ?? [];
  const spent = card.spentUsd ?? 0;
  const state = card.budget ?? "none";
  return (
    <div className="traj-extras">
      <div className={`traj-budget is-${state}`}>
        <Icon name={state === "over" || state === "warn" ? "alert" : "chart"} size={14} />
        {editing ? (
          <form className="traj-budget-form" onSubmit={(e) => { e.preventDefault(); void saveBudget(amount); }}>
            <input aria-label={t("creation.budgetLabel")} className="input traj-budget-input" inputMode="decimal" value={amount} placeholder="5" onChange={(e) => setAmount(e.target.value)} autoFocus />
            <span>$</span>
            <button type="submit" className="btn btn-small btn-primary" disabled={busy}>{t("common.save")}</button>
            {card.budgetUsd != null && <button type="button" className="btn btn-small" disabled={busy} onClick={() => void saveBudget("")}>{t("creation.budgetRemove")}</button>}
            <button type="button" className="btn btn-small btn-ghost" onClick={() => setEditing(false)}>{t("common.cancel")}</button>
          </form>
        ) : (
          <>
            <span className="traj-budget-text">
              {card.budgetUsd != null ? t(state === "over" ? "creation.budgetOver" : "creation.budgetSpent", { spent: usd(spent), budget: usd(card.budgetUsd) }) : t("creation.budgetNone", { spent: usd(spent) })}
            </span>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => setEditing(true)}>{card.budgetUsd != null ? t("creation.budgetChange") : t("creation.budgetSet")}</button>
          </>
        )}
      </div>
      {card.budgetUsd != null && <p className="traj-budget-note muted">{t("creation.budgetNote")}</p>}
      {questions.length > 0 && (
        <div className="traj-questions">
          <div className="traj-questions-title">{t("creation.questions", { n: questions.length })}</div>
          <ul>
            {questions.map((q) => (
              <li key={q.id}>
                <span className="traj-q-text">{q.text}</span>
                <button type="button" className="btn btn-small" disabled={busy} aria-label={t("creation.resolveAria", { text: q.text })} onClick={() => void send(() => api<TrajectoryCard>("POST", `${base}/questions/${q.id}/resolve`))}>
                  <Icon name="check" size={13} /> {t("creation.resolve")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="card-error" role="alert">{error}</p>}
    </div>
  );
}
