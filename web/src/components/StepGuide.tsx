import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { useStore, type AppSection } from "../store";
import type { GuideStep, StepGuideCard } from "../../../server/src/guidetypes";
import { Icon } from "./Icon";
import "./StepGuide.css";

/**
 * L153 carte « pas à pas » and L145 « ce qui reste à installer » (server stepguide.ts): one short step at a time, each
 * with its own proof — « Vérifier » asks the server to run the step's check (it turns « OK » only when the check passes;
 * else the line says what the check saw); a step nothing can see has « C'est fait ». « Ouvrir » opens the Settings page
 * that does it (keys and passwords are typed there, never in the chat). Wrong-shaped answers leave the card as it was.
 */
const SECTIONS: AppSection[] = ["models", "account", "team", "computer", "doctor", "notifications", "vault", "keys"];
const isCard = (x: unknown): x is StepGuideCard => !!x && typeof x === "object" && (x as StepGuideCard).type === "stepguide" && Array.isArray((x as StepGuideCard).steps);

export function StepGuideCardView({ card: initial, botId, seq }: { card: StepGuideCard; botId: string; seq: number }) {
  const t = useT();
  const [local, setLocal] = useState<StepGuideCard | null>(null);
  useEffect(() => setLocal(null), [initial]); // the live row (server push) is newer than our last answer
  const card = local ?? initial;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const steps = Array.isArray(card.steps) ? card.steps : [];
  const done = steps.filter((s) => s.state === "ok").length;
  const act = async (action: "check" | "self" | "dismiss", step?: string) => {
    setBusy(step ?? action); setError(null);
    try {
      const r = await api<{ card?: unknown }>("POST", `/bots/${enc(botId)}/rows/${seq}/stepguide`, { action, step });
      if (isCard(r?.card)) setLocal(r.card);
    } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  const open = (s: GuideStep) => { if (s.open && (SECTIONS as string[]).includes(s.open)) useStore.getState().openAppSettings(s.open as AppSection); };
  const closed = card.status === "dismissed";
  const current = steps.findIndex((s) => s.state !== "ok");
  return (
    <div className={`card stepguide-card ${card.status === "pending" ? "is-pending" : ""}`}>
      <div className="card-head">
        <span className="logo-tile" aria-hidden="true"><Icon name={card.guideId === "setup" ? "wrench" : "check"} size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{card.title}</p>
          <p className="card-sub">
            {card.doctorKey ? `${t(card.doctorKey as Key)} · ` : ""}
            {steps.length ? t("guide.progress", { done, n: steps.length }) : t("guide.nothing")}
            {typeof card.ready === "number" && card.ready > 0 ? ` · ${t("guide.ready", { n: card.ready })}` : ""}
          </p>
        </div>
      </div>
      <p className="card-reason">{card.intro}</p>
      {steps.length > 0 && (
        <ol className="stepguide-list">
          {steps.map((s, i) => (
            <li key={s.id} className={`stepguide-step is-${s.state} ${i === current && !closed ? "is-current" : ""}`}>
              <span className={`stepguide-mark is-${s.state}`} aria-hidden="true">{s.state === "ok" ? <Icon name="check" size={13} /> : i + 1}</span>
              <div className="stepguide-body">
                <p className="stepguide-title">{s.title}<span className="sr-only"> — {t(s.state === "ok" ? "guide.state.ok" : s.state === "notyet" ? "guide.state.notyet" : "guide.state.todo")}</span></p>
                <p className="stepguide-detail">{s.detail}</p>
                {s.command && <code className="stepguide-command">{s.command}</code>}
                {s.hint && <p className={`stepguide-hint is-${s.state}`} role={s.state === "notyet" ? "status" : undefined}>{s.hint}</p>}
                {!closed && s.state !== "ok" && (
                  <div className="stepguide-actions">
                    {s.open && <button type="button" className="btn btn-small" onClick={() => open(s)}><Icon name="settings" size={13} /> {t("guide.open")}</button>}
                    {s.check === "self"
                      ? <button type="button" className="btn btn-small btn-accent" disabled={busy !== null} onClick={() => void act("self", s.id)}><Icon name="check" size={13} /> {t("guide.done")}</button>
                      : <button type="button" className="btn btn-small btn-accent" disabled={busy !== null} onClick={() => void act("check", s.id)}><Icon name="refresh" size={13} /> {t(busy === s.id ? "guide.checking" : "guide.check")}</button>}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {card.status === "done" && <p className="card-outcome is-allowed"><Icon name="check" size={14} /> {t(steps.length ? "guide.allDone" : "guide.nothing")}</p>}
      {closed && <p className="card-outcome is-denied"><Icon name="close" size={14} /> {t("guide.closed")}</p>}
      {card.status === "pending" && (
        <div className="card-actions"><span className="spacer" /><button type="button" className="btn btn-small btn-ghost" disabled={busy !== null} onClick={() => void act("dismiss")}>{t("guide.dismiss")}</button></div>
      )}
      {error && <p className="card-error" role="alert">{error}</p>}
    </div>
  );
}

/** L145 in the main bot's empty chat: « Ce qui reste à installer » — the bot shows the setup list (POST /bots/:id/setup-guide). */
export function SetupGuideOffer({ bot }: { bot: { id: string } }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const show = async () => {
    setBusy(true); setError(null);
    try { await api("POST", `/bots/${enc(bot.id)}/setup-guide`); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <section className="setup-offer" aria-label={t("guide.setupTitle")}>
      <Icon name="wrench" size={16} />
      <span className="setup-offer-text"><strong>{t("guide.setupTitle")}</strong><span className="muted small">{t("guide.setupSub")}</span></span>
      <button type="button" className="btn btn-small btn-accent" disabled={busy} onClick={() => void show()}>{t(busy ? "common.working" : "guide.setupShow")}</button>
      {error && <p className="card-error" role="alert">{error}</p>}
    </section>
  );
}
