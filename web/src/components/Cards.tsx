import { useState } from "react";
import { useTick } from "./ui";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Card } from "../types";
import { Icon } from "./Icon";
import { NudgeCardView, TaskCardView, Uncertain } from "./Wave5";
import { ApiConnectorCardView, MemoryCardView, SkillCardView, SpendCardView } from "./Wave5b";

type ApprovalCard = Extract<Card, { type: "approval" }>;
type QuestionCard = Extract<Card, { type: "question" }>;
type ConnectCard = Extract<Card, { type: "connect" }>;
type TakeoverCard = Extract<Card, { type: "takeover" }>;
type SecretCard = Extract<Card, { type: "secret" }>;

function LogoTile({ name }: { name: string }) {
  const letter = (Array.from(name.trim())[0] ?? "?").toUpperCase();
  return <span className="logo-tile" aria-hidden="true">{letter}</span>;
}

function Approval({ card, botId }: { card: ApprovalCard; botId: string }) {
  const t = useT();
  // Wave 6: on a bot someone shares with you, only its owner (and admins, when the owner allows it) answer.
  const access = useStore((s) => s.bots[botId]?.access);
  const canDecide = !access || access.canApprove;
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
  // The user's own computer (Sklubot Relais): tool "mycomputer: control|command|url: <bot>".
  const relay = card.tool.startsWith("mycomputer:");
  return (
    <div className="card">
      <div className="card-head">
        {relay ? (
          <span className="logo-tile is-relay" aria-hidden="true">
            <Icon name="monitor" size={18} />
          </span>
        ) : vault ? (
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
      {(card.why || card.quote) && (
        <div className="approval-why">
          {card.quote && <p className="approval-quote"><Icon name="chat" size={13} /> <span>{t("approval.quote", { quote: card.quote })}</span></p>}
          {card.why && <p className="approval-reason"><Icon name="info" size={13} /> <span>{t("approval.why", { why: card.why })}</span></p>}
        </div>
      )}
      {card.once && card.status === "pending" && <p className="card-note">{t("approval.onceOnly")}</p>}
      {card.status === "pending" && !canDecide ? (
        <p className="card-note"><Icon name="users" size={13} /> {t("ws.approvalOwner", { name: access?.ownerName ?? "" })}</p>
      ) : card.status === "pending" ? (
        <>
          <div className="card-actions">
            <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void decide("deny")}>
              {t(busy === "deny" ? "approval.denying" : "approval.deny")}
            </button>
            <span className="spacer" />
            {!card.once && !access && (
              <button type="button" className="btn" disabled={busy !== null} onClick={() => void decide("always")} title={t("approval.alwaysTitle")}>
                {t(busy === "always" ? "common.saving" : "approval.alwaysBtn")}
              </button>
            )}
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
          {card.outcome && (card.status === "allowed" || card.status === "always") && <span className={`approval-outcome is-${card.outcome}`}> · {t(`approval.outcome.${card.outcome}`)}</span>}
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

const minutesLeft = (until: number, now: number) => Math.max(0, Math.ceil((until - now) / 60_000));

/** The bot needs the user on its screen (CAPTCHA, 2FA, login, payment): open it in control mode, then hand it back. */
function Takeover({ card, botId }: { card: TakeoverCard; botId: string }) {
  const t = useT();
  const bot = useStore((s) => s.bots[botId]);
  const viewing = useStore((s) => s.viewerBotId === botId);
  const now = useTick(15_000, card.status === "pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/bots/${botId}/takeover/${encodeURIComponent(card.takeoverId)}/done`);
      if (useStore.getState().viewerBotId === botId) useStore.getState().closeViewer();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const pending = card.status === "pending";
  return (
    <div className={`card takeover-card ${pending ? "is-pending" : ""}`}>
      <div className="card-head">
        <span className="logo-tile is-takeover" aria-hidden="true"><Icon name="hand" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{t("takeover.title", { name: bot?.name ?? "" })}</p>
          <p className="card-sub">
            <span className="chip">{t(`takeover.reason.${card.reason}`)}</span>
            {pending && <> · {t("takeover.left", { n: minutesLeft(card.expiresAt, now) })}</>}
          </p>
        </div>
      </div>
      {card.detail && <p className="card-reason">{card.detail}</p>}
      {pending ? (
        <>
          <p className="card-sub">{t("takeover.hint")}</p>
          <div className="card-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => useStore.getState().openViewer(botId, { control: true })}>
              <Icon name="monitor" size={15} /> {t(viewing ? "takeover.opened" : "takeover.open")}
            </button>
            <span className="spacer" />
            <button type="button" className="btn btn-accent" disabled={busy} onClick={() => void done()}>
              <Icon name="check" size={15} /> {t(busy ? "common.working" : "takeover.done")}
            </button>
          </div>
          {error && <p className="card-error" role="alert">{error}</p>}
        </>
      ) : (
        <p className={`card-outcome is-${card.status === "done" ? "allowed" : card.status === "timeout" ? "expired" : "denied"}`}>
          <Icon name={card.status === "done" ? "check" : card.status === "timeout" ? "clock" : "close"} size={14} />
          {t(`takeover.status.${card.status}`)}
        </p>
      )}
    </div>
  );
}

/** A secret the bot asked for by name. What is typed here goes straight to the server's vault; the bot never sees it. */
function Secret({ card, botId, seq }: { card: SecretCard; botId: string; seq: number }) {
  const t = useT();
  const bot = useStore((s) => s.bots[botId]);
  const [value, setValue] = useState("");
  const [host, setHost] = useState(card.host);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState<"save" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (kind: "save" | "skip") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "save") await api("POST", `/bots/${botId}/cards/${seq}/secret`, { value, host });
      else await api("POST", `/bots/${botId}/cards/${seq}/dismiss`);
      setValue("");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="card secret-card">
      <div className="card-head">
        <span className="logo-tile is-vault" aria-hidden="true"><Icon name="lock" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{t("secret.title", { bot: bot?.name ?? "", name: card.name })}</p>
          <p className="card-sub">{t("secret.sub", { host: card.host })}</p>
        </div>
      </div>
      {card.reason && <p className="card-reason">{card.reason}</p>}
      {card.status === "pending" ? (
        <form
          className="secret-form"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) void run("save");
          }}
        >
          <label className="sr-only" htmlFor={`secret-${seq}`}>{t("secret.label", { name: card.name })}</label>
          <div className="input-affix">
            <input id={`secret-${seq}`} className="input" type={reveal ? "text" : "password"} value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("secret.placeholder")} autoComplete="off" autoCapitalize="off" spellCheck={false} data-1p-ignore="" data-lpignore="true" maxLength={8000} />
            <button type="button" className="icon-btn" aria-label={t(reveal ? "vault.hide" : "vault.show")} onClick={() => setReveal((v) => !v)}><Icon name={reveal ? "eyeOff" : "eye"} size={16} /></button>
          </div>
          <label className="secret-host">
            <span>{t("secret.host")}</span>
            <input className="input input-small" value={host} onChange={(e) => setHost(e.target.value)} spellCheck={false} autoCapitalize="off" />
          </label>
          <p className="card-sub secret-note"><Icon name="shield" size={14} /> <span>{t("secret.never", { bot: bot?.name ?? "" })}</span></p>
          <div className="card-actions">
            <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void run("skip")}>{t("secret.skip")}</button>
            <span className="spacer" />
            <button type="submit" className="btn btn-accent" disabled={busy !== null || !value.trim()}>{t(busy === "save" ? "common.saving" : "secret.save")}</button>
          </div>
          {error && <p className="card-error" role="alert">{error}</p>}
        </form>
      ) : (
        <p className={`card-outcome is-${card.status === "saved" ? "allowed" : "denied"}`}>
          <Icon name={card.status === "saved" ? "check" : "close"} size={14} />
          {card.status === "saved" ? t("secret.saved", { host: card.host }) : t("secret.skipped")}
        </p>
      )}
    </div>
  );
}

export function CardView({ card, botId, seq }: { card: Card; botId: string; seq: number }) {
  switch (card.type) {
    case "approval":
      return <Approval card={card} botId={botId} />;
    case "question":
      return <Question card={card} botId={botId} seq={seq} />;
    case "connect":
      return <Connect card={card} botId={botId} seq={seq} />;
    case "takeover":
      return <Takeover card={card} botId={botId} />;
    case "secret":
      return <Secret card={card} botId={botId} seq={seq} />;
    case "uncertain":
      return <Uncertain card={card} />;
    case "task":
      return <TaskCardView card={card} botId={botId} />;
    case "nudge":
      return <NudgeCardView card={card} botId={botId} />;
    case "spend":
      return <SpendCardView card={card} />;
    case "skill":
      return <SkillCardView card={card} botId={botId} seq={seq} />;
    case "apiconnector":
      return <ApiConnectorCardView card={card} botId={botId} seq={seq} />;
    case "memory":
      return <MemoryCardView card={card} botId={botId} seq={seq} />;
    case "mail":
      return <MailCardView card={card} botId={botId} />;
    default:
      return null;
  }
}

/* ---------- Wave 6: an email received at the bot's own address ---------- */

type MailCard = Extract<Card, { type: "mail" }>;
const AUTH_KEYS = ["spf", "dkim", "dmarc"] as const;

function MailCardView({ card, botId }: { card: MailCard; botId: string }) {
  const t = useT();
  const own = useStore((s) => !s.bots[botId]?.access);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const release = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/bots/${botId}/mail/${encodeURIComponent(card.mailId)}/release`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`card mail-card is-${card.status}`}>
      <div className="card-head">
        <span className="logo-tile is-mail" aria-hidden="true"><Icon name="mail" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{card.subject}</p>
          <p className="card-sub">{t("mail.from", { from: card.from })}</p>
        </div>
        <span className={`mail-status is-${card.status}`}>{t(`mail.status.${card.status}`)}</span>
      </div>
      {card.snippet && <p className="mail-snippet">{card.snippet}</p>}
      <div className="mail-auth" aria-label={t("mail.authAria")}>
        {AUTH_KEYS.map((k) => (
          <span key={k} className={`auth-badge is-${card.auth[k] === "pass" ? "pass" : card.auth[k] === "fail" ? "fail" : "none"}`} title={t("mail.authTitle", { check: k.toUpperCase(), result: card.auth[k] })}>
            {k.toUpperCase()} {card.auth[k]}
          </span>
        ))}
        {card.spam > 0 && <span className={`auth-badge is-${card.spam >= 5 ? "fail" : "none"}`}>{t("mail.spam", { n: card.spam })}</span>}
      </div>
      <p className="card-note"><Icon name="shield" size={13} /> {card.status === "held" ? t("mail.heldNote") : t("mail.outsideNote")}</p>
      {card.status === "held" && own && (
        <div className="card-actions">
          <span className="spacer" />
          <button type="button" className="btn" disabled={busy} onClick={() => void release()}>{t(busy ? "common.saving" : "mail.release")}</button>
        </div>
      )}
      {error && <p className="card-error" role="alert">{error}</p>}
    </div>
  );
}
