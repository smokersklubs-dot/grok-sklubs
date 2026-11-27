import { useState, type ReactElement } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import type { Card, RowBody } from "../types";
import { Icon } from "./Icon";
import { useTick } from "./ui";
import "./TurnCards.css";

/**
 * Turn-control pieces of the chat (backlog A-FAIRE L72, L79, L83, L94, L98, L139):
 * - CardCountdown: the time left on a card that lapses (or after which the bot stops waiting);
 * - DraftEditor: the subject / text of a mail or message, editable inside its approval card;
 * - RichQuestion: a question card with why, a recommended answer, an irreversible warning, several answers, pictures,
 *   2 to 4 questions, or a plan to approve (with what changed since the last version);
 * - TurnNoticeActions: « Continuer seul jusqu'au bout », « Reprendre ma note », « Annuler » under a notice.
 */
type QuestionCard = Extract<Card, { type: "question" }>;
type NoticeAction = NonNullable<Extract<RowBody, { kind: "notice" }>["action"]>;

const left = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`; };

/** "Plus que 4:12" on a card with an end. `parks`: at the end the bot stops waiting, the answer still counts. */
export function CardCountdown({ until, parks }: { until?: number; parks?: boolean }) {
  const t = useT();
  const now = useTick(1000, !!until && until > Date.now());
  if (!until) return null;
  const ms = until - now;
  if (ms <= 0) return parks ? null : <p className="card-note card-countdown is-over"><Icon name="clock" size={13} /> {t("countdown.over")}</p>;
  return (
    <p className={`card-note card-countdown ${ms < 120_000 ? "is-soon" : ""}`} aria-live={ms < 60_000 ? "polite" : "off"}>
      <Icon name="clock" size={13} /> {t(parks ? "countdown.parks" : "countdown.left", { time: left(ms) })}
    </p>
  );
}

/** The editable words of a mail or message, in its approval card (the recipients are shown, never editable here). */
export function DraftEditor({ value, onChange, disabled }: { value: Record<string, string>; onChange: (next: Record<string, string>) => void; disabled?: boolean }) {
  const t = useT();
  return (
    <div className="draft-editor">
      <p className="card-note"><Icon name="edit" size={13} /> {t("draft.hint")}</p>
      {Object.entries(value).map(([field, text]) => (
        <label key={field} className="draft-field">
          <span className="draft-label">{t(field === "subject" ? "draft.subject" : "draft.text")}</span>
          {field === "subject"
            ? <input className="input" value={text} disabled={disabled} onChange={(e) => onChange({ ...value, [field]: e.target.value })} />
            : <textarea className="input" rows={Math.min(12, Math.max(3, text.split("\n").length + 1))} value={text} disabled={disabled} onChange={(e) => onChange({ ...value, [field]: e.target.value })} />}
        </label>
      ))}
    </div>
  );
}

/** A card's argument lines without the editable fields (their values may run over several lines). */
export function detailWithout(detail: string, keys: string[]): string {
  let skip = false;
  return detail.split("\n").filter((line) => {
    const m = /^([a-zA-Z_][\w-]*): /.exec(line);
    if (m) skip = keys.includes(m[1]);
    return !skip;
  }).join("\n");
}

export const isRichQuestion = (c: QuestionCard) => !!(c.why || c.recommended || c.irreversible || c.multiple || c.images?.length || c.questions?.length || c.plan);

/** One question of a card: its options (one or several), the recommended one first and marked. */
function Choices({ q, picked, onPick, disabled }: { q: { options: string[]; recommended?: string; multiple?: boolean }; picked: string[]; onPick: (next: string[]) => void; disabled: boolean }) {
  const t = useT();
  const opts = q.recommended ? [q.recommended, ...q.options.filter((o) => o !== q.recommended)] : q.options;
  return (
    <div className="card-options" role={q.multiple ? "group" : "radiogroup"}>
      {opts.map((opt, i) => {
        const on = picked.includes(opt);
        return (
          <button key={opt} type="button" role={q.multiple ? "checkbox" : "radio"} aria-checked={on} className={`option ${on ? "is-chosen" : ""}`} disabled={disabled}
            onClick={() => onPick(q.multiple ? (on ? picked.filter((p) => p !== opt) : [...picked, opt]) : [opt])}>
            <span className="option-letter">{on ? <Icon name="check" size={13} /> : String.fromCharCode(65 + (i % 26))}</span>
            <span>{opt}</span>
            {opt === q.recommended && <span className="option-badge">{t("question.recommended")}</span>}
          </button>
        );
      })}
    </div>
  );
}

const viewUrl = (botId: string, path: string) => `/api/bots/${botId}/files/view?path=${encodeURIComponent(path)}`;

export function RichQuestion({ card, botId, seq }: { card: QuestionCard; botId: string; seq: number }) {
  const t = useT();
  const pending = card.status === "pending";
  const items = card.questions?.length ? card.questions : [{ question: card.question, options: card.options, recommended: card.recommended, multiple: card.multiple, why: undefined as string | undefined }];
  const [picked, setPicked] = useState<string[][]>(() => items.map((q) => (q.recommended ? [q.recommended] : [])));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = card.plan;
  const [review, setReview] = useState<{ verdict: "ok" | "gaps"; missing: string[]; extra: string[] } | null>(null);
  // L79 « Relire mon plan contre la demande » (server agent/planmode.ts): a separate check; its full note lands in the chat.
  const checkPlan = async () => {
    setBusy(true); setError(null);
    try { setReview((await api<{ review: { verdict: "ok" | "gaps"; missing: string[]; extra: string[] } }>("POST", `/bots/${botId}/rows/${seq}/plan-review`)).review); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const send = async (answer: string) => {
    if (!answer.trim()) return;
    setBusy(true); setError(null);
    try { await api("POST", `/bots/${botId}/cards/${seq}/answer`, { answer }); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const dismiss = async () => { setBusy(true); try { await api("POST", `/bots/${botId}/cards/${seq}/dismiss`); } catch (e) { setError(errText(e)); } finally { setBusy(false); } };
  const combined = () => (items.length > 1 ? items.map((q, i) => `${q.question} ${picked[i].join(", ") || "—"}`).join("\n") : picked[0].join(", ")) + (note.trim() ? `\n${note.trim()}` : "");
  const complete = picked.every((p) => p.length > 0);
  return (
    <div className={`card rich-question ${plan ? "is-plan" : ""}`}>
      <p className="card-title">{plan ? t("plan.title", { title: card.question, v: plan.version }) : card.question}</p>
      {card.why && <div className="approval-why"><p className="approval-reason"><Icon name="info" size={13} /> <span>{t("approval.why", { why: card.why })}</span></p></div>}
      {card.irreversible && <p className="approval-irreversible"><Icon name="alert" size={14} /><span><strong>{t("question.irreversible")}</strong></span></p>}
      {card.images?.length ? <div className="rich-question-images">{card.images.map((p) => <img key={p} src={viewUrl(botId, p)} alt="" loading="lazy" />)}</div> : null}
      {plan && (
        <ol className="plan-steps">
          {plan.steps.map((s) => <li key={s} className={plan.added?.includes(s) ? "is-added" : undefined}>{s}{plan.added?.includes(s) && <span className="option-badge">{t("plan.added")}</span>}</li>)}
          {plan.removed?.map((s) => <li key={`-${s}`} className="is-removed"><s>{s}</s> <span className="option-badge">{t("plan.removed")}</span></li>)}
        </ol>
      )}
      {plan ? (
        pending ? (
          <>
            {review && <p className={`plan-review ${review.verdict === "ok" ? "is-ok" : "is-gaps"}`} role="status">{review.verdict === "ok" ? t("plan.reviewOk") : t("plan.reviewGaps", { list: review.missing.join(" ; ") || "—" })}{review.extra.length ? ` ${t("plan.reviewExtra", { list: review.extra.join(" ; ") })}` : ""}</p>}
            <button type="button" className="btn btn-small btn-ghost plan-review-open" disabled={busy} onClick={() => void checkPlan()}><Icon name="search" size={13} /> {t("plan.review")}</button>
            <textarea className="input" rows={2} placeholder={t("plan.notePlaceholder")} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} aria-label={t("plan.notePlaceholder")} />
            <div className="card-actions">
              <button type="button" className="btn btn-ghost" disabled={busy || !note.trim()} onClick={() => void send(`${card.options[2] ?? "Change it"}: ${note.trim()}`)}>{t("plan.change")}</button>
              <span className="spacer" />
              <button type="button" className="btn" disabled={busy || !note.trim()} onClick={() => void send(`${card.options[1] ?? "Approve with a note"}: ${note.trim()}`)}>{t("plan.approveNote")}</button>
              <button type="button" className="btn btn-accent" disabled={busy} onClick={() => void send(card.options[0] ?? "Approve")}>{t("plan.approve")}</button>
            </div>
          </>
        ) : <p className="card-outcome is-allowed">{t("question.youAnswered", { answer: card.answer ?? "" })}</p>
      ) : (
        <>
          {items.map((q, i) => (
            <div key={i} className="rich-question-item">
              {items.length > 1 && <p className="rich-question-q">{q.question}</p>}
              {q.why && <p className="card-sub">{q.why}</p>}
              {(q.multiple || (items.length === 1 && card.multiple)) && <p className="card-sub">{t("question.several")}</p>}
              <Choices q={q} picked={picked[i]} disabled={!pending || busy} onPick={(next) => setPicked((all) => all.map((p, j) => (j === i ? next : p)))} />
            </div>
          ))}
          {pending ? (
            <div className="card-actions">
              <button type="button" className="link card-skip" disabled={busy} onClick={() => void dismiss()}>{t("question.skip")}</button>
              <span className="spacer" />
              <button type="button" className="btn btn-accent" disabled={busy || !complete} onClick={() => void send(combined())}>{t("question.send")}</button>
            </div>
          ) : card.answer ? <p className="card-outcome is-allowed">{t("question.youAnswered", { answer: card.answer })}</p> : null}
        </>
      )}
      {error && <p className="card-error" role="alert">{error}</p>}
    </div>
  );
}

/** The buttons of the turn-control notices (the plain « Continuer » stays in Transcript's NoticeRow). */
export function TurnNoticeActions({ action, botId, seq, readOnly }: { action: NoticeAction; botId: string; seq: number; readOnly: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const now = useTick(30_000, action.kind === "undo" && action.status === "pending");
  const run = async (method: "POST", path: string, body?: unknown) => {
    setBusy(true); setFailed(null);
    try { await api(method, path, body); } catch (e) { setFailed(errText(e)); setBusy(false); }
  };
  if (readOnly) return null;
  let button: ReactElement | null = null;
  if (action.kind === "continue" && action.auto && action.status === "pending")
    button = <button type="button" className="btn btn-small notice-action" disabled={busy} onClick={() => void run("POST", `/bots/${botId}/rows/${seq}/continue`, { auto: true })}><Icon name="play" size={13} /> {t("notice.continueAuto")}</button>;
  else if (action.kind === "note")
    button = action.status === "pending"
      ? <button type="button" className="btn btn-small notice-action" disabled={busy} onClick={() => void run("POST", `/bots/${botId}/notes/${action.noteId}/send-again`, { seq })}><Icon name="send" size={13} /> {t("notice.resumeNote")}</button>
      : <em className="notice-done">{t("notice.noteResumed")}</em>;
  else if (action.kind === "undo")
    button = action.status === "pending" && action.expiresAt > now
      ? <button type="button" className="btn btn-small notice-action" disabled={busy} onClick={() => void run("POST", `/bots/${botId}/undo/${action.undoId}`, { seq })}><Icon name="history" size={13} /> {t("notice.undo")}</button>
      : action.status === "done" ? <em className="notice-done">{t("notice.undone")}</em> : null;
  if (!button && !failed) return null;
  return <>{button}{failed && <span className="notice-error" role="alert">{failed}</span>}</>;
}
