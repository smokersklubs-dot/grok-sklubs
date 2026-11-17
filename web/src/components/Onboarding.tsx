/**
 * The guided first run of a new public account (server publicsignup.ts, POST /api/onboarding/commit): 1. a team template
 * from the real gallery, or "un seul assistant"; 2. its name; 3. a first suggested task, written into the composer for the
 * person to send. Skippable at every step. The import is the team-file one: careful bots, draft skills, paused routines.
 */
import { useEffect, useId, useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { TaskIdea, TemplateSummary } from "../types";
import { Character } from "./Character";
import { Icon } from "./Icon";
import { ErrorNote, Modal } from "./ui";
import "../styles/firstrun.css";

export function Onboarding() {
  const user = useStore((s) => s.user);
  const primary = useStore((s) => Object.values(s.bots).find((b) => b.kind === "agent" && b.primary) ?? null);
  const t = useT();
  const nameId = useId();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ botId: string; ideas: TaskIdea[] } | null>(null);
  const [closed, setClosed] = useState(false);
  const pending = !!user?.onboarding;
  useEffect(() => {
    if (!pending) return;
    api<{ templates: TemplateSummary[] }>("GET", "/templates").then((r) => setTemplates(r.templates), () => setTemplates([]));
  }, [pending]);
  if (!user?.onboarding || closed) return null;

  const chosen = pick ? templates?.find((x) => x.id === pick) ?? null : null;
  const placeholder = chosen?.bots[0]?.name ?? primary?.name ?? "";
  const finish = () => { setClosed(true); useStore.setState((s) => ({ user: s.user ? { ...s.user, onboarding: undefined } : s.user })); };
  const skip = () => { void api("POST", "/onboarding/skip").catch(() => undefined); finish(); };
  const create = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ botId: string; ideas: TaskIdea[] }>("POST", "/onboarding/commit", { template: pick ?? undefined, name: name.trim() || undefined });
      await useStore.getState().loadBots();
      useStore.getState().selectBot(r.botId);
      setDone(r);
      setStep(3);
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

  return (
    <Modal title={t("onb.title")} onClose={step === 3 ? finish : skip} size="lg" className="onb">
      <div className="modal-body onb-body">
        <p className="onb-step">{t("onb.step", { n: step })}</p>
        <div className="onb-dots" aria-hidden="true">{[1, 2, 3].map((n) => <span key={n} className={n <= step ? "is-on" : ""} />)}</div>
        {step === 1 && (
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
        {step === 2 && (
          <>
            <h3 className="onb-title">{t("onb.s2Title")}</h3>
            <p className="muted">{t("onb.s2Hint")}</p>
            <div className="field">
              <label className="field-label" htmlFor={nameId}>{t("onb.nameLabel")}</label>
              <input id={nameId} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={placeholder} autoFocus />
            </div>
          </>
        )}
        {step === 3 && done && (
          <>
            <h3 className="onb-title">{t("onb.s3Title")}</h3>
            <p className="muted">{t("onb.s3Hint")}</p>
            {user.emailUnverified && <p className="callout is-warn"><Icon name="mail" size={14} /> {t("onb.unverified")}</p>}
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
        {step < 3 ? <button type="button" className="btn btn-ghost" onClick={skip}>{t("onb.skip")}</button> : <span />}
        <div className="onb-foot-right">
          {step === 2 && <button type="button" className="btn" onClick={() => setStep(1)} disabled={busy}>{t("onb.back")}</button>}
          {step === 1 && <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>{t("onb.next")}</button>}
          {step === 2 && <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={busy}>{t(busy ? "onb.creating" : "onb.create")}</button>}
          {step === 3 && <button type="button" className="btn btn-primary" onClick={finish}>{t("onb.later")}</button>}
        </div>
      </div>
    </Modal>
  );
}
