import { useId, useState, type FormEvent } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Card } from "../types";
import { Icon } from "./Icon";
import { useTick } from "./ui";

type CodeCard = Extract<Card, { type: "code" }>;

/**
 * L91 — « case masquée »: the bot needs a one-time code (SMS, authenticator) in a field of the page in front of its
 * browser. The user types it here, hidden; the server types it into that field (server agent/codebox.ts). The code is
 * never shown to the bot nor kept: once sent, the box is emptied and the card only says « saisi ».
 */
export function CodeBoxCard({ card, botId }: { card: CodeCard; botId: string }) {
  const t = useT();
  const id = useId();
  const bot = useStore((s) => s.bots[botId]);
  const now = useTick(15_000, card.status === "pending");
  const [code, setCode] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (body: { code?: string; dismiss?: true }) => {
    setBusy(true); setError(null);
    try { await api("POST", `/bots/${botId}/code/${encodeURIComponent(card.codeId)}`, body); setCode(""); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (code.trim()) void send({ code: code.trim() }); };
  const pending = card.status === "pending";
  const left = Math.max(0, Math.ceil((card.expiresAt - now) / 60_000));
  return (
    <div className={`card takeover-card code-card ${pending ? "is-pending" : ""}`}>
      <div className="card-head">
        <span className="logo-tile is-takeover" aria-hidden="true"><Icon name="key" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{t("codebox.title", { name: bot?.name ?? "" })}</p>
          <p className="card-sub"><span className="chip">{card.host || "?"}</span> · {t("codebox.field", { field: card.label })}{pending && <> · {t("takeover.left", { n: left })}</>}</p>
        </div>
      </div>
      {card.detail && <p className="card-reason">{card.detail}</p>}
      {pending ? (
        <form className="code-form" onSubmit={submit}>
          <label className="field-hint" htmlFor={`${id}c`}>{t("codebox.hint")}</label>
          <div className="code-row">
            <input id={`${id}c`} className="input code-input" type={show ? "text" : "password"} inputMode="numeric" autoComplete="one-time-code" maxLength={16} spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} />
            <button type="button" className="btn btn-small btn-ghost" aria-pressed={show} aria-label={t(show ? "codebox.hide" : "codebox.show")} onClick={() => setShow((v) => !v)}><Icon name={show ? "eyeOff" : "eye"} size={15} /></button>
          </div>
          <div className="card-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => void send({ dismiss: true })}>{t("codebox.dismiss")}</button>
            <span className="spacer" />
            <button type="submit" className="btn btn-accent" disabled={busy || !code.trim()}><Icon name="send" size={15} /> {t(busy ? "common.working" : "codebox.send")}</button>
          </div>
          {error && <p className="card-error" role="alert">{error}</p>}
        </form>
      ) : (
        <p className={`card-outcome is-${card.status === "typed" ? "allowed" : card.status === "timeout" ? "expired" : "denied"}`}>
          <Icon name={card.status === "typed" ? "check" : card.status === "timeout" ? "clock" : "close"} size={14} />
          {t(`codebox.status.${card.status}`)}
        </p>
      )}
    </div>
  );
}
