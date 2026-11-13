import { useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Card } from "../types";
import { Icon } from "./Icon";

type ApprovalCard = Extract<Card, { type: "approval" }>;
type QuestionCard = Extract<Card, { type: "question" }>;
type ConnectCard = Extract<Card, { type: "connect" }>;

function LogoTile({ name }: { name: string }) {
  const letter = (Array.from(name.trim())[0] ?? "?").toUpperCase();
  return <span className="logo-tile" aria-hidden="true">{letter}</span>;
}

function Approval({ card }: { card: ApprovalCard }) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: "allow" | "always" | "deny") => {
    setBusy(decision);
    setError(null);
    try {
      await api("POST", `/approvals/${encodeURIComponent(card.approvalId)}`, { decision });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const source = card.source || card.tool;
  // Saved logins: the server sends source "Vault" and tool "vault: <item name>".
  const vault = card.source === "Vault";
  return (
    <div className="card">
      <div className="card-head">
        {vault ? (
          <span className="logo-tile is-vault" role="img" aria-label={t("approval.vault")} title={t("approval.vault")}>
            <Icon name="key" size={18} />
          </span>
        ) : (
          <LogoTile name={source} />
        )}
        <div className="card-head-text">
          <p className="card-title">{card.title}</p>
          <p className="card-sub">{vault ? t("settings.section.vault") : source}{card.tool && card.tool !== source ? <> · <code>{card.tool}</code></> : null}</p>
        </div>
      </div>
      {card.detail && <pre className="card-detail">{card.detail}</pre>}
      {card.status === "pending" ? (
        <>
          <div className="card-actions">
            <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void decide("deny")}>
              {t(busy === "deny" ? "approval.denying" : "approval.deny")}
            </button>
            <span className="spacer" />
            <button type="button" className="btn" disabled={busy !== null} onClick={() => void decide("always")} title={t("approval.alwaysTitle")}>
              {t(busy === "always" ? "common.saving" : "approval.alwaysBtn")}
            </button>
            <button type="button" className="btn btn-accent" disabled={busy !== null} onClick={() => void decide("allow")}>
              {t(busy === "allow" ? "approval.allowing" : "approval.allow")}
            </button>
          </div>
          {error && <p className="card-error" role="alert">{error}</p>}
        </>
      ) : (
        <p className={`card-outcome is-${card.status}`}>
          <Icon name={card.status === "allowed" || card.status === "always" ? "check" : card.status === "denied" ? "close" : "clock"} size={14} />
          {t(`approval.${card.status}`)}
        </p>
      )}
    </div>
  );
}

function Question({ card, botId, seq }: { card: QuestionCard; botId: string; seq: number }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = card.status === "pending";
  const run = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/bots/${botId}/cards/${seq}/${path}`, body);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const hint = t(pending ? "question.hint" : card.status === "answered" ? "question.answered" : "question.skipped");
  return (
    <div className="card">
      <p className="card-title">{card.question}</p>
      <p className="card-sub">{hint}</p>
      {card.options.length > 0 && (
        <div className="card-options">
          {card.options.map((opt, i) => {
            const chosen = card.status === "answered" && card.answer === opt;
            return (
              <button key={i} type="button" className={`option ${chosen ? "is-chosen" : ""}`} disabled={!pending || busy} onClick={() => void run("answer", { answer: opt })}>
                <span className="option-letter">{chosen ? <Icon name="check" size={13} /> : String.fromCharCode(65 + (i % 26))}</span>
                <span>{opt}</span>
              </button>
            );
          })}
        </div>
      )}
      {card.status === "answered" && card.answer && !card.options.includes(card.answer) && <p className="card-outcome is-allowed">{t("question.youAnswered", { answer: card.answer })}</p>}
      {pending && (
        <button type="button" className="link card-skip" disabled={busy} onClick={() => void run("dismiss")}>
          {t("question.skip")}
        </button>
      )}
      {error && <p className="card-error" role="alert">{error}</p>}
    </div>
  );
}

function Connect({ card, botId, seq }: { card: ConnectCard; botId: string; seq: number }) {
  const openModal = useStore((s) => s.openModal);
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skip = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/bots/${botId}/cards/${seq}/dismiss`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <div className="card-head">
        <LogoTile name={card.name} />
        <div className="card-head-text">
          <p className="card-title">{t("connect.title", { name: card.name })}</p>
          {card.hint && <p className="card-sub">{card.hint}</p>}
        </div>
      </div>
      {card.reason && <p className="card-reason">{card.reason}</p>}
      {card.status === "pending" ? (
        <div className="card-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void skip()}>
            {t(busy ? "connect.skipping" : "connect.skip")}
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-accent" disabled={busy} onClick={() => openModal({ kind: "connectors", prefill: { name: card.name, botId, seq } })}>
            {t("connect.btn")}
          </button>
        </div>
      ) : (
        <p className={`card-outcome is-${card.status === "connected" ? "allowed" : "denied"}`}>
          <Icon name={card.status === "connected" ? "check" : "close"} size={14} />
          {card.status === "connected" ? t("connect.connected", { name: card.name }) : t("connect.skipped")}
        </p>
      )}
      {error && <p className="card-error" role="alert">{error}</p>}
    </div>
  );
}

export function CardView({ card, botId, seq }: { card: Card; botId: string; seq: number }) {
  switch (card.type) {
    case "approval":
      return <Approval card={card} />;
    case "question":
      return <Question card={card} botId={botId} seq={seq} />;
    case "connect":
      return <Connect card={card} botId={botId} seq={seq} />;
    default:
      return null;
  }
}
