/**
 * The guided first run of a new public account (server publicsignup.ts, POST /api/onboarding/commit). Steps:
 *  - hosted mode, customers: "Choisis comment tes bots travaillent" — their own OpenRouter, ChatGPT or Claude account,
 *    connected right there (AiAccounts.tsx), "another API key" as a small link; prepaid credits (server credits.ts) only
 *    when the owner sells them. A credits or key choice comes back as the last step's main button.
 *  - "Active les notifications": the Web Push subscription of Settings → Notifications (lib/push.ts), with what to do
 *    when it cannot (blocked, iPhone without the Home Screen icon, unsupported). Asked once: the answer is kept on the
 *    server (PUT /account/push-prompt); "Plus tard" leaves one gentle banner on Today (PushPromptBanner).
 *  - a team template from the real gallery, or "un seul assistant"; its name (and role); a first suggested task,
 *    written into the composer for the person to send. Skippable at every step. Careful bots, draft skills, paused routines.
 */
import { useEffect, useId, useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { CreditsView, PushState, TaskIdea, TemplateSummary } from "../types";
import { enablePush, pushActiveHere, pushSupport } from "../lib/push";
import { AiAccountCards } from "./AiAccounts";
import { Character } from "./Character";
import { Icon, type IconName } from "./Icon";
import { ModelHealthLine } from "./ModelHealth";
import { ErrorNote, Modal } from "./ui";
import "../styles/firstrun.css";

type Way = "subscription" | "key" | "credits";
type StepId = "how" | "notify" | "team" | "name" | "ideas";

/** Records the answer to "Active les notifications" (asked once). */
export const answerPushPrompt = (status: "later" | "enabled" | "dismissed") => api("PUT", "/account/push-prompt", { status }).catch(() => undefined);

/** The Web Push step's body (also used by Today's banner): enable, or say why it cannot and how to fix it. */
export function PushEnable({ onEnabled }: { onEnabled: () => void }) {
  const t = useT();
  const [support] = useState(pushSupport);
  const [on, setOn] = useState(() => support === "ok" && pushActiveHere());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enable = async () => {
    setBusy(true); setError(null);
    try {
      const state = await api<PushState>("GET", "/push");
      await enablePush(state);
      setOn(true);
      void answerPushPrompt("enabled");
      onEnabled();
    } catch (e) {
      setError(e instanceof Error && e.message === "denied" ? t("onb.notifyDenied") : t("onb.notifyFailed", { detail: errText(e) }));
    }
    setBusy(false);
  };
  if (on) return <p className="onb-push-ok" role="status"><Icon name="check" size={16} /> {t("onb.notifyDone")}</p>;
  if (support === "ios-home-screen") {
    return (
      <div className="onb-push-ios">
        <p>{t("onb.notifyIos")}</p>
        <ol>{(["onb.notifyIos1", "onb.notifyIos2", "onb.notifyIos3"] as const).map((k) => <li key={k}>{t(k)}</li>)}</ol>
      </div>
    );
  }
  if (support === "denied") return <p className="callout is-warn"><Icon name="alert" size={16} /><span>{t("onb.notifyDenied")}</span></p>;
  if (support === "unsupported") return <p className="muted">{t("onb.notifyUnsupported")}</p>;
  return (
    <>
      <button type="button" className="btn btn-primary onb-push-btn" onClick={() => void enable()} disabled={busy}><Icon name="bell" size={16} /> {t(busy ? "onb.notifyBusy" : "onb.notifyOn")}</button>
      <ErrorNote>{error}</ErrorNote>
    </>
  );
}

export function Onboarding() {
  const user = useStore((s) => s.user);
  const hosted = useStore((s) => s.hosted);
  const primary = useStore((s) => Object.values(s.bots).find((b) => b.kind === "agent" && b.primary) ?? null);
  const t = useT();
  const nameId = useId();
  const roleId = useId();
  const customer = !!hosted && !hosted.operator;
  const steps: StepId[] = [...(customer ? (["how"] as const) : []), "notify", "team", "name", "ideas"];
  const [at, setAt] = useState(0);
  const step = steps[at];
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [credits, setCredits] = useState<CreditsView | null>(null);
  const [way, setWay] = useState<Way | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ botId: string; ideas: TaskIdea[] } | null>(null);
  const [closed, setClosed] = useState(false);
  const [pushAnswered, setPushAnswered] = useState(false);
  const pending = !!user?.onboarding;
  useEffect(() => {
    if (!pending) return;
    api<{ templates: TemplateSummary[] }>("GET", "/templates").then((r) => setTemplates(r.templates), () => setTemplates([]));
    if (customer) api<CreditsView>("GET", "/billing/credits").then(setCredits, () => setCredits(null));
  }, [pending, customer]);
  if (!user?.onboarding || closed) return null;

  const chosen = pick ? templates?.find((x) => x.id === pick) ?? null : null;
  const placeholder = chosen?.bots[0]?.name ?? primary?.name ?? "";
  const finish = () => { setClosed(true); useStore.setState((s) => ({ user: s.user ? { ...s.user, onboarding: undefined } : s.user })); };
  const leavePush = () => { if (!pushAnswered) { setPushAnswered(true); void answerPushPrompt("later"); useStore.setState((s) => ({ user: s.user ? { ...s.user, pushPrompt: "later" } : s.user })); } };
  const skip = () => { if (steps.indexOf("notify") >= at) leavePush(); void api("POST", "/onboarding/skip").catch(() => undefined); finish(); };
  const next = () => { if (step === "notify") leavePush(); setError(null); setAt((n) => Math.min(n + 1, steps.length - 1)); };
  const create = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ botId: string; ideas: TaskIdea[] }>("POST", "/onboarding/commit", { template: pick ?? undefined, name: name.trim() || undefined, label: role.trim() || undefined });
      await useStore.getState().loadBots();
      useStore.getState().selectBot(r.botId);
      setDone(r);
      setAt(steps.indexOf("ideas"));
    } catch (e) { setError(errText(e)); }
    setBusy(false);
  };
  const pickIdea = (idea: TaskIdea) => {
    if (!done) return;
    const s = useStore.getState();
    s.selectBot(done.botId);
    s.setDraft(done.botId, idea.prompt);
    s.focusComposer();
    finish();
  };
  const doWay = () => {
    const s = useStore.getState();
    finish();
    if (way === "subscription") s.openBotSettings(done?.botId ?? primary?.id ?? "", "general");
    else if (way === "key") s.openAppSettings("models");
    else if (way === "credits") s.openAppSettings("subscription");
  };
  // Sklubot credits are offered only when the owner sells them (off by default): the own accounts come first.
  const ways: { id: Way; icon: IconName; title: string; text: string; off?: boolean }[] = credits?.creditsForSale
    ? [{ id: "credits", icon: "bolt", title: t("onb.howCredits"), text: t("onb.howCreditsText"), off: !credits.operatorKeys }]
    : [];
  const wayLabel = way === "subscription" ? t("onb.doSub") : way === "key" ? t("onb.doKey") : way === "credits" ? t("onb.doCredits") : null;

  return (
    <Modal title={t("onb.title")} onClose={step === "ideas" ? finish : skip} size="lg" className="onb">
      <div className="modal-body onb-body">
        <p className="onb-step">{t("onb.step", { n: at + 1, total: steps.length })}</p>
        <div className="onb-dots" aria-hidden="true">{steps.map((s, i) => <span key={s} className={i <= at ? "is-on" : ""} />)}</div>
        {step === "how" && (
          <>
            <h3 className="onb-title">{t("onb.howTitle")}</h3>
            <p className="muted">{t("onb.howHint")}</p>
            <AiAccountCards onOtherKey={() => { setWay("key"); next(); }} />
            {ways.length > 0 && <div className="onb-ways" role="radiogroup" aria-label={t("onb.howTitle")}>
              {ways.map((w) => (
                <button key={w.id} type="button" role="radio" aria-checked={way === w.id} disabled={w.off} className={`onb-way ${way === w.id ? "is-selected" : ""}`} onClick={() => setWay(w.id)}>
                  <span className="onb-way-icon" aria-hidden="true"><Icon name={w.icon} size={18} /></span>
                  <span className="onb-way-text"><b>{w.title}</b><span className="muted small">{w.text}</span></span>
                  <span className="onb-way-check" aria-hidden="true">{way === w.id && <Icon name="check" size={14} />}</span>
                </button>
              ))}
            </div>}
          </>
        )}
        {step === "notify" && (
          <>
            <h3 className="onb-title">{t("onb.notifyTitle")}</h3>
            <p className="muted">{t("onb.notifyHint")}</p>
            <div className="onb-push"><PushEnable onEnabled={() => setPushAnswered(true)} /></div>
          </>
        )}
        {step === "team" && (
          <>
            <h3 className="onb-title">{t("onb.s1Title")}</h3>
            <p className="muted">{t("onb.s1Hint")}</p>
            <div className="onb-grid" role="radiogroup" aria-label={t("onb.s1Title")}>
              <button type="button" role="radio" aria-checked={pick === null} className={`onb-option ${pick === null ? "is-selected" : ""}`} onClick={() => setPick(null)}>
                <span className="onb-cast">{primary && <Character bot={primary} size={40} label={null} />}</span>
                <b>{t("onb.single")}</b>
                <span className="muted small">{t("onb.singleHint")}</span>
              </button>
              {(templates ?? []).map((tp) => (
                <button key={tp.id} type="button" role="radio" aria-checked={pick === tp.id} className={`onb-option ${pick === tp.id ? "is-selected" : ""}`} onClick={() => setPick(tp.id)}>
                  <span className="onb-cast">{tp.bots.slice(0, 3).map((b, i) => <Character key={i} bot={{ shape: b.look.shape ?? "pebble", color: b.look.color ?? "indigo", name: b.name, character: b.look.character }} size={34} label={null} />)}</span>
                  <b>{tp.title}</b>
                  <span className="muted small">{tp.description}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {step === "name" && (
          <>
            <h3 className="onb-title">{t("onb.s2Title")}</h3>
            <p className="muted">{t("onb.s2Hint")}</p>
            <div className="field">
              <label className="field-label" htmlFor={nameId}>{t("onb.nameLabel")}</label>
              <input id={nameId} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={placeholder} autoFocus />
            </div>
            {!pick && (
              <div className="field">
                <label className="field-label" htmlFor={roleId}>{t("onb.roleLabel")}</label>
                <input id={roleId} className="input" value={role} onChange={(e) => setRole(e.target.value)} maxLength={60} placeholder={primary?.label ?? ""} />
                <p className="field-hint">{t("onb.roleHint")}</p>
              </div>
            )}
          </>
        )}
        {step === "ideas" && done && (
          <>
            {wayLabel && (
              <div className="onb-next">
                <p className="onb-next-title">{t("onb.nextTitle")}</p>
                <button type="button" className="btn btn-primary" onClick={doWay}><Icon name={way === "subscription" ? "brain" : way === "key" ? "key" : "bolt"} size={15} /> {wayLabel}</button>
              </div>
            )}
            {/* L59: a real test call to the new bot's model, its result in plain words, before the guide ends. */}
            <ModelHealthLine botId={done.botId} model={primary?.model ?? ""} intro={t("modelHealth.onbTitle")} />
            <h3 className="onb-title">{t("onb.s3Title")}</h3>
            <p className="muted">{t("onb.s3Hint")}</p>
            <div className="onb-ideas">
              {done.ideas.map((idea) => (
                <button key={idea.title} type="button" className="onb-idea" onClick={() => pickIdea(idea)}>
                  <Icon name={idea.kind === "recurring" ? "clock" : "bulb"} size={16} />
                  <span><b>{idea.title}</b><span className="muted small">{idea.prompt}</span></span>
                </button>
              ))}
            </div>
          </>
        )}
        <ErrorNote>{error}</ErrorNote>
      </div>
      <div className="onb-foot">
        {step !== "ideas" ? <button type="button" className="btn btn-ghost" onClick={skip}>{t("onb.skip")}</button> : <span />}
        <div className="onb-foot-right">
          {at > 0 && step !== "ideas" && <button type="button" className="btn" onClick={() => setAt(at - 1)} disabled={busy}>{t("onb.back")}</button>}
          {step === "how" && <button type="button" className="btn btn-primary" onClick={next}>{way ? t("onb.next") : t("onb.howLater")}</button>}
          {step === "notify" && <button type="button" className="btn btn-primary" onClick={next}>{pushAnswered ? t("onb.next") : t("onb.later")}</button>}
          {step === "team" && <button type="button" className="btn btn-primary" onClick={next}>{t("onb.next")}</button>}
          {step === "name" && <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={busy}>{t(busy ? "onb.creating" : "onb.create")}</button>}
          {step === "ideas" && <button type="button" className="btn btn-primary" onClick={finish}>{t("onb.later")}</button>}
        </div>
      </div>
    </Modal>
  );
}
