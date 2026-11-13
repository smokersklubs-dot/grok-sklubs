import { useState } from "react";
import { api, errText } from "../api";
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

const APPROVAL_OUTCOME: Record<Exclude<ApprovalCard["status"], "pending">, string> = {
  allowed: "Allowed once",
  always: "Always allowed",
  denied: "Not allowed",
  expired: "Expired — no answer in time",
};

function Approval({ card }: { card: ApprovalCard }) {
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
  return (
    <div className="card">
      <div className="card-head">
        <LogoTile name={source} />
        <div className="card-head-text">
          <p className="card-title">{card.title}</p>
          <p className="card-sub">{source}{card.tool && card.tool !== source ? <> · <code>{card.tool}</code></> : null}</p>
        </div>
      </div>
      {card.detail && <pre className="card-detail">{card.detail}</pre>}
      {card.status === "pending" ? (
        <>
          <div className="card-actions">
            <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void decide("deny")}>
              {busy === "deny" ? "Denying…" : "Deny"}
            </button>
            <span className="spacer" />
            <button type="button" className="btn" disabled={busy !== null} onClick={() => void decide("always")} title="Stop asking for this action">
              {busy === "always" ? "Saving…" : "Always allow"}
            </button>
            <button type="button" className="btn btn-accent" disabled={busy !== null} onClick={() => void decide("allow")}>
              {busy === "allow" ? "Allowing…" : "Allow"}
            </button>
          </div>
          {error && <p className="card-error" role="alert">{error}</p>}
        </>
      ) : (
        <p className={`card-outcome is-${card.status}`}>
          <Icon name={card.status === "allowed" || card.status === "always" ? "check" : card.status === "denied" ? "close" : "clock"} size={14} />
          {APPROVAL_OUTCOME[card.status]}
        </p>
      )}
    </div>
  );
}

function Question({ card, botId, seq }: { card: QuestionCard; botId: string; seq: number }) {
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
  const hint = pending ? "Pick an option, or just reply in your own words." : card.status === "answered" ? "Answered" : "Skipped";
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
      {card.status === "answered" && card.answer && !card.options.includes(card.answer) && <p className="card-outcome is-allowed">You answered: {card.answer}</p>}
      {pending && (
        <button type="button" className="link card-skip" disabled={busy} onClick={() => void run("dismiss")}>
          Skip this question
        </button>
      )}
      {error && <p className="card-error" role="alert">{error}</p>}
    </div>
  );
}

function Connect({ card, botId, seq }: { card: ConnectCard; botId: string; seq: number }) {
  const openModal = useStore((s) => s.openModal);
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
          <p className="card-title">Connect {card.name}</p>
          {card.hint && <p className="card-sub">{card.hint}</p>}
        </div>
      </div>
      {card.reason && <p className="card-reason">{card.reason}</p>}
      {card.status === "pending" ? (
        <div className="card-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void skip()}>
            {busy ? "Skipping…" : "Skip"}
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-accent" disabled={busy} onClick={() => openModal({ kind: "connectors", prefill: { name: card.name, botId, seq } })}>
            Connect
          </button>
        </div>
      ) : (
        <p className={`card-outcome is-${card.status === "connected" ? "allowed" : "denied"}`}>
          <Icon name={card.status === "connected" ? "check" : "close"} size={14} />
          {card.status === "connected" ? `${card.name} connected` : "Skipped"}
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
