import { useId, useMemo, useState } from "react";
import { api, errText } from "../api";
import { useLocale, useT, type Key } from "../i18n";
import { useStore } from "../store";
import { GROK_EXPORT_PROMPT_EN, GROK_EXPORT_PROMPT_FR } from "../types";
import type { GrokImportChoice, GrokImportPreview, GrokImportReport, GrokImportWarning } from "../types";
import { Icon } from "./Icon";
import { ScanFindings } from "./SkillScan";
import { CopyButton, ErrorNote, Modal } from "./ui";
import "./GrokImport.css";

/* "Importer depuis Grok Bot" (server/src/grokimport.ts, docs/IMPORT-GROK.md): 1. copy our prompt into the other
   assistant; 2. paste its reply; 3. tick what to keep. Nothing is created before "Import". */

interface BotPick {
  include: boolean; name: string;
  skills: { include: boolean; name: string }[];
  routines: { include: boolean; name: string; cron: string }[];
  memories: boolean[];
  apps: boolean[];
}

function initialPicks(p: GrokImportPreview): BotPick[] {
  return p.bots.map((b, i) => ({
    // Within the plan's room, the first bots are ticked; the others wait for the user's choice.
    include: p.room.bots === null || i < p.room.bots,
    name: b.name,
    skills: b.skills.map((s) => ({ include: true, name: s.name })),
    routines: b.routines.map((r) => ({ include: true, name: r.name, cron: r.cron })),
    // Memories are personal: none is ticked until the user has read it.
    memories: b.memories.map(() => false),
    apps: b.apps.map(() => true),
  }));
}

const CRON_RE = /^\S+ \S+ \S+ \S+ \S+$/;

export function GrokImportButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-small" onClick={() => setOpen(true)}>
        <Icon name="download" size={14} /> {t("grok.open")}
      </button>
      {open && <GrokImportModal onClose={() => setOpen(false)} />}
    </>
  );
}

function Steps({ step }: { step: number }) {
  const t = useT();
  const labels: Key[] = ["grok.step1", "grok.step2", "grok.step3"];
  return (
    <ol className="grok-steps" aria-label={t("grok.stepsLabel")}>
      {labels.map((k, i) => (
        <li key={k} className={i + 1 === step ? "is-current" : i + 1 < step ? "is-done" : ""} aria-current={i + 1 === step ? "step" : undefined}>
          <span className="grok-step-num">{i + 1 < step ? <Icon name="check" size={12} /> : i + 1}</span>
          <span className="grok-step-label">{t(k)}</span>
        </li>
      ))}
    </ol>
  );
}

function warningText(t: ReturnType<typeof useT>, w: GrokImportWarning): string {
  return t(`grok.warn.${w.code}` as Key, { n: w.n ?? 0, detail: w.detail ?? "" });
}

export function GrokImportModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const loadBots = useStore((s) => s.loadBots);
  const uid = useId();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [lang, setLang] = useState<"fr" | "en">(locale === "fr" ? "fr" : "en");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<GrokImportPreview | null>(null);
  const [picks, setPicks] = useState<BotPick[]>([]);
  const [report, setReport] = useState<GrokImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prompt = lang === "fr" ? GROK_EXPORT_PROMPT_FR : GROK_EXPORT_PROMPT_EN;

  const analyse = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await api<GrokImportPreview>("POST", "/import/grok/preview", { text });
      setPreview(p);
      setPicks(initialPicks(p));
      setStep(3);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const bots: GrokImportChoice[] = picks.map((b, index) => ({
        index, include: b.include, name: b.name,
        skills: b.skills.map((s, i) => ({ index: i, include: s.include, name: s.name })),
        routines: b.routines.map((r, i) => ({ index: i, include: r.include, name: r.name, cron: r.cron })),
        memories: b.memories.flatMap((on, i) => (on ? [i] : [])),
        apps: b.apps.flatMap((on, i) => (on ? [i] : [])),
      }));
      const r = await api<{ report: GrokImportReport }>("POST", "/import/grok/commit", { previewId: preview.previewId, bots });
      setReport(r.report);
      setStep(4);
      await loadBots().catch(() => undefined);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const setBot = (i: number, patch: Partial<BotPick>) => setPicks((cur) => cur.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const totals = useMemo(() => {
    const on = picks.filter((b) => b.include);
    return {
      bots: on.length,
      skills: on.reduce((n, b) => n + b.skills.filter((s) => s.include).length, 0),
      routines: on.reduce((n, b) => n + b.routines.filter((r) => r.include && CRON_RE.test(r.cron.trim())).length, 0),
      memories: on.reduce((n, b) => n + b.memories.filter(Boolean).length, 0),
    };
  }, [picks]);
  const overRoom = preview?.room.bots !== null && preview?.room.bots !== undefined && totals.bots > preview.room.bots;

  return (
    <Modal title={t("grok.title")} onClose={onClose} size="lg" className="grok-modal">
      <div className="modal-body grok-body">
        {step < 4 && <Steps step={step} />}

        {step === 1 && (
          <section className="grok-section">
            <p className="muted">{t("grok.intro")}</p>
            <ol className="grok-howto">
              <li>{t("grok.howto1")}</li>
              <li>{t("grok.howto2")}</li>
              <li>{t("grok.howto3")}</li>
            </ol>
            <div className="grok-prompt-head">
              <div className="seg-tabs" role="tablist" aria-label={t("grok.promptLang")}>
                <button type="button" role="tab" aria-selected={lang === "fr"} className={`seg-tab ${lang === "fr" ? "is-active" : ""}`} onClick={() => setLang("fr")}>Français</button>
                <button type="button" role="tab" aria-selected={lang === "en"} className={`seg-tab ${lang === "en" ? "is-active" : ""}`} onClick={() => setLang("en")}>English</button>
              </div>
              <CopyButton text={prompt} label={t("grok.copyPrompt")} className="btn btn-small btn-primary" />
            </div>
            <pre className="grok-prompt" tabIndex={0} aria-label={t("grok.promptLabel")}>{prompt}</pre>
            <p className="note-line small"><Icon name="lock" size={13} /> <span>{t("grok.noSecrets")}</span></p>
            <p className="muted small">{t("grok.notAffiliated")}</p>
          </section>
        )}

        {step === 2 && (
          <section className="grok-section">
            <label className="field-label" htmlFor={`${uid}reply`}>{t("grok.pasteLabel")}</label>
            <p className="muted small">{t("grok.pasteHint")}</p>
            <textarea
              id={`${uid}reply`}
              className="input grok-paste"
              rows={12}
              value={text}
              spellCheck={false}
              placeholder={t("grok.pastePlaceholder")}
              onChange={(e) => setText(e.target.value)}
            />
            <p className="muted small grok-size">{t("grok.size", { kb: Math.ceil(new Blob([text]).size / 1000) })}</p>
          </section>
        )}

        {step === 3 && preview && (
          <section className="grok-section">
            <p className="callout is-info"><Icon name="shield" size={16} /> <span>{t("grok.safeNote")}</span></p>
            {preview.stripped.length > 0 && (
              <div className="callout is-warn grok-stripped" role="status">
                <Icon name="lock" size={16} />
                <div>
                  <p>{t("grok.stripped", { n: preview.stripped.length })}</p>
                  <details>
                    <summary>{t("grok.strippedWhere")}</summary>
                    <ul>
                      {preview.stripped.map((s, i) => <li key={i}>{s.where} — {t(`grok.kind.${s.kind}` as Key)}</li>)}
                    </ul>
                  </details>
                </div>
              </div>
            )}
            {preview.warnings.length > 0 && (
              <ul className="grok-warnings">
                {preview.warnings.map((w, i) => <li key={i} className="warn-text small"><Icon name="alert" size={13} /> {warningText(t, w)}</li>)}
              </ul>
            )}

            {preview.bots.map((b, bi) => {
              const p = picks[bi];
              if (!p) return null;
              return (
                <article key={bi} className={`grok-bot ${p.include ? "" : "is-off"}`}>
                  <header className="grok-bot-head">
                    <input type="checkbox" checked={p.include} onChange={(e) => setBot(bi, { include: e.target.checked })} aria-label={t("grok.includeBot", { name: p.name || b.name })} />
                    <input className="input grok-name" value={p.name} maxLength={60} onChange={(e) => setBot(bi, { name: e.target.value })} aria-label={t("grok.botName")} />
                    {b.nameTaken && p.name.trim().toLowerCase() === b.name.toLowerCase() && <span className="chip">{t("grok.nameTaken")}</span>}
                    <span className="chip">{t("grok.careful")}</span>
                  </header>
                  {b.role && <p className="grok-role">{b.role}</p>}
                  {p.include && (
                    <div className="grok-parts">
                      {(b.personality || b.instructions) && (
                        <details className="grok-instructions">
                          <summary>{t("grok.instructions")}</summary>
                          {b.personality && <p className="small"><strong>{t("grok.personality")}</strong> {b.personality}</p>}
                          {b.instructions && <p className="small grok-pre">{b.instructions}</p>}
                        </details>
                      )}

                      {b.skills.length > 0 && (
                        <fieldset className="grok-group">
                          <legend>{t("grok.skills")} <span className="chip">{t("grok.draft")}</span></legend>
                          {b.skills.map((s, i) => (
                            <div key={i} className="grok-item">
                              <input type="checkbox" checked={p.skills[i].include} onChange={(e) => setBot(bi, { skills: p.skills.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)) })} aria-label={t("grok.includeItem", { name: p.skills[i].name })} />
                              <div className="grok-item-text">
                                <input className="input input-small" value={p.skills[i].name} maxLength={80} onChange={(e) => setBot(bi, { skills: p.skills.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label={t("grok.skillName")} />
                                {s.when && <span className="muted small">{t("grok.when", { when: s.when })}</span>}
                                <ScanFindings scan={s.scan} compact />
                              </div>
                            </div>
                          ))}
                        </fieldset>
                      )}

                      {b.routines.length > 0 && (
                        <fieldset className="grok-group">
                          <legend>{t("grok.routines")} <span className="chip">{t("grok.paused")}</span></legend>
                          {b.routines.map((r, i) => {
                            const pr = p.routines[i];
                            const cronOk = CRON_RE.test(pr.cron.trim());
                            return (
                              <div key={i} className="grok-item">
                                <input type="checkbox" checked={pr.include} onChange={(e) => setBot(bi, { routines: p.routines.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)) })} aria-label={t("grok.includeItem", { name: pr.name })} />
                                <div className="grok-item-text">
                                  <div className="grok-item-row">
                                    <input className="input input-small" value={pr.name} maxLength={80} onChange={(e) => setBot(bi, { routines: p.routines.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label={t("grok.routineName")} />
                                    <input className={`input input-small grok-cron ${cronOk ? "" : "is-invalid"}`} value={pr.cron} placeholder="0 8 * * 1-5" onChange={(e) => setBot(bi, { routines: p.routines.map((x, j) => (j === i ? { ...x, cron: e.target.value } : x)) })} aria-label={t("grok.cron")} spellCheck={false} />
                                  </div>
                                  <span className="muted small">{r.schedule || r.describe}{r.timezone ? ` · ${r.timezone}` : ""}</span>
                                  {!cronOk && pr.include && <span className="warn-text small">{t("grok.needCron")}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </fieldset>
                      )}

                      {b.memories.length > 0 && (
                        <fieldset className="grok-group">
                          <legend>
                            {t("grok.memories")}
                            <button type="button" className="btn btn-ghost btn-small" onClick={() => setBot(bi, { memories: p.memories.map(() => !p.memories.every(Boolean)) })}>
                              {t(p.memories.every(Boolean) ? "grok.untickAll" : "grok.tickAll")}
                            </button>
                          </legend>
                          <p className="muted small">{t("grok.memoriesHint")}</p>
                          {b.memories.map((m, i) => (
                            <label key={i} className="grok-item grok-memory">
                              <input type="checkbox" checked={p.memories[i]} onChange={(e) => setBot(bi, { memories: p.memories.map((x, j) => (j === i ? e.target.checked : x)) })} />
                              <span className="grok-item-text">
                                <span>{m.text}</span>
                                {m.flagged && <span className="warn-text small"><Icon name="alert" size={12} /> {t("grok.memoryFlagged")}</span>}
                              </span>
                            </label>
                          ))}
                        </fieldset>
                      )}

                      {b.apps.length > 0 && (
                        <fieldset className="grok-group">
                          <legend>{t("grok.apps")}</legend>
                          <p className="muted small">{t("grok.appsHint")}</p>
                          <div className="grok-apps">
                            {b.apps.map((a, i) => (
                              <label key={i} className="check-row grok-app">
                                <input type="checkbox" checked={p.apps[i]} onChange={(e) => setBot(bi, { apps: p.apps.map((x, j) => (j === i ? e.target.checked : x)) })} />
                                {t("grok.connect", { app: a })}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      )}
                    </div>
                  )}
                </article>
              );
            })}

            <p className="grok-summary" role="status">
              {t("grok.summary", { bots: totals.bots, skills: totals.skills, routines: totals.routines, memories: totals.memories })}
            </p>
            {overRoom && <p className="warn-text small"><Icon name="alert" size={13} /> {t("grok.overRoom", { n: preview.room.bots ?? 0 })}</p>}
          </section>
        )}

        {step === 4 && report && (
          <section className="grok-section grok-done" role="status">
            <div className="callout is-ok"><Icon name="check" size={16} /> <span>{t("grok.done", { bots: report.bots.map((b) => b.name).join(", ") })}</span></div>
            <ul className="grok-done-list">
              <li>{t("grok.doneSkills", { n: report.skills })}</li>
              <li>{t("grok.doneRoutines", { n: report.routines })}</li>
              <li>{t("grok.doneMemories", { n: report.memories })}</li>
              {report.apps.length > 0 && <li>{t("grok.doneApps", { list: report.apps.join(", ") })}</li>}
              {report.unscheduled.length > 0 && <li className="warn-text">{t("grok.doneUnscheduled", { list: report.unscheduled.join(" ; ") })}</li>}
            </ul>
            <p className="muted small">{t("grok.doneHint")}</p>
          </section>
        )}

        <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      </div>
      <div className="modal-foot grok-foot">
        {step === 1 && (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
            <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>{t("grok.next")} <Icon name="chevronRight" size={14} /></button>
          </>
        )}
        {step === 2 && (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}><Icon name="arrowLeft" size={14} /> {t("grok.back")}</button>
            <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void analyse()}>{t(busy ? "common.working" : "grok.analyse")}</button>
          </>
        )}
        {step === 3 && (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => { setStep(2); setError(null); }}><Icon name="arrowLeft" size={14} /> {t("grok.back")}</button>
            <button type="button" className="btn btn-primary" disabled={busy || totals.bots === 0} onClick={() => void commit()}>{t(busy ? "common.working" : "grok.import")}</button>
          </>
        )}
        {step === 4 && <button type="button" className="btn btn-primary" onClick={onClose}>{t("common.close")}</button>}
      </div>
    </Modal>
  );
}
