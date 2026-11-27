import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, errText } from "../api";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import type { TeamMdChoice, TeamMdExport, TeamMdMode, TeamMdPreview, TeamMdReport, TeamMdWarning } from "../types";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { ScanFindings } from "./SkillScan";
import { CopyButton, ErrorNote, Modal, Toggle } from "./ui";
import "./GrokImport.css";
import "./TeamTemplates.css";
import "./TeamMarkdown.css";

/* « Équipe Sklubot (.md) » (server/src/teammd.ts, teammdimport.ts, docs/FORMAT-EQUIPE.md): import a whole team from one
   Markdown file (a file, a pasted text or an https address) through a review screen — nothing is created before
   « Créer l'équipe » — and share a section or a bot as such a file (never a secret, a chat, a memory or a permission). */

const MAX_BYTES = 512 * 1024;
type Tab = "file" | "url";
interface Pick { include: boolean; name: string; skills: boolean[]; routines: boolean[]; useModel: boolean }

function initialPicks(p: TeamMdPreview): Pick[] {
  return p.bots.map((b, i) => ({
    include: p.room.bots === null || i < p.room.bots || !!b.existingId,
    name: b.existingId ? b.name : b.suggestedName,
    // A skill that looks like it holds a key, or that this Sklubot does not have, starts unticked.
    skills: b.skills.map((s) => s.known && !s.mentionsKey && s.scan?.worst !== "danger"),
    routines: b.routines.map(() => true),
    useModel: false,
  }));
}

const warnKey = (w: TeamMdWarning): Key => `tmd.warn.${w.code}` as Key;

/** The import, as a modal (the "+" menu, the command palette). */
export function TeamMdImportModal({ onClose, initialPreview, initialTab }: { onClose: () => void; initialPreview?: TeamMdPreview; initialTab?: Tab }) {
  const t = useT();
  const [title, setTitle] = useState(t("tmd.importTitle"));
  return (
    <Modal title={title} onClose={onClose} size="lg" className="grok-modal tpl-modal tmd-modal">
      <TeamMdImport onClose={onClose} onStep={(s) => setTitle(t(s === "review" ? "tmd.reviewTitle" : s === "done" ? "tmd.doneTitle" : "tmd.importTitle"))} initialPreview={initialPreview} initialTab={initialTab} />
    </Modal>
  );
}

export function TeamMdImport({ onClose, onStep, initialPreview, initialTab = "file" }: { onClose: () => void; onStep?: (s: "choose" | "review" | "done") => void; initialPreview?: TeamMdPreview; initialTab?: Tab }) {
  const t = useT();
  const uid = useId();
  const loadBots = useStore((s) => s.loadBots);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [step, setStepRaw] = useState<"choose" | "review" | "done">(initialPreview ? "review" : "choose");
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("");
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<TeamMdPreview | null>(initialPreview ?? null);
  const [picks, setPicks] = useState<Pick[]>(initialPreview ? initialPicks(initialPreview) : []);
  const [groups, setGroups] = useState<boolean[]>(initialPreview?.groups.map(() => true) ?? []);
  const [mode, setMode] = useState<TeamMdMode>(initialPreview?.existing ? "update" : "create");
  const [section, setSection] = useState(true);
  const [sectionName, setSectionName] = useState(initialPreview?.meta.name.slice(0, 40) ?? "");
  const [chiefPrimary, setChiefPrimary] = useState(initialPreview ? !initialPreview.hasPrimary : false);
  const [report, setReport] = useState<TeamMdReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const setStep = (s: "choose" | "review" | "done") => { setStepRaw(s); onStep?.(s); };
  useEffect(() => { if (initialPreview) onStep?.("review"); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const read = async (input: { text?: string; filename?: string; url?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const p = await api<TeamMdPreview>("POST", "/team-md/preview", input);
      setPreview(p);
      setPicks(initialPicks(p));
      setGroups(p.groups.map(() => true));
      setMode(p.existing ? "update" : "create");
      setSection(true);
      setSectionName(p.meta.name.slice(0, 40));
      setChiefPrimary(!p.hasPrimary && !!p.meta.chief);
      setStep("review");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) { setError(t("tmd.tooLarge")); return; }
    setFilename(file.name);
    setText(await file.text());
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const bots: TeamMdChoice[] = picks.map((p, index) => ({ index, include: p.include, name: p.name, skills: p.skills, routines: p.routines, useModel: p.useModel }));
      const r = await api<{ report: TeamMdReport }>("POST", "/team-md/commit", {
        previewId: preview.previewId, mode, bots, groups, section: section && sectionName.trim() ? sectionName.trim() : undefined, chiefPrimary,
      });
      setReport(r.report);
      setStep("done");
      await loadBots().catch(() => undefined);
      if (r.report.section) await useStore.getState().loadSections().catch(() => undefined);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const setBot = (i: number, patch: Partial<Pick>) => setPicks((cur) => cur.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const totals = useMemo(() => {
    const on = picks.filter((b) => b.include);
    const fresh = picks.filter((b, i) => b.include && !(mode === "update" && preview?.bots[i]?.existingId)).length;
    return {
      bots: on.length, fresh,
      skills: on.reduce((n, b) => n + b.skills.filter(Boolean).length, 0),
      routines: on.reduce((n, b) => n + b.routines.filter(Boolean).length, 0),
      groups: groups.filter(Boolean).length,
    };
  }, [picks, groups, mode, preview]);
  const overRoom = preview?.room.bots !== null && preview?.room.bots !== undefined && totals.fresh > preview.room.bots;
  const ruleText = (r: string) => t(`tmd.rule.${r}` as Key);

  return (
    <>
      <div className="modal-body grok-body">
        {step === "choose" && (
          <>
            <p className="muted small">{t("tmd.intro")}</p>
            <div className="seg-tabs tpl-tabs" role="tablist" aria-label={t("tmd.tabsLabel")}>
              {(["file", "url"] as Tab[]).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={`seg-tab ${tab === k ? "is-active" : ""}`} onClick={() => { setTab(k); setError(null); }}>
                  <Icon name={k === "file" ? "file" : "globe"} size={14} /> {t(`tmd.tab.${k}` as Key)}
                </button>
              ))}
            </div>
            {tab === "file" ? (
              <section className="grok-section">
                <div className="tpl-file-row">
                  <button type="button" className="btn btn-small" onClick={() => fileInput.current?.click()}><Icon name="upload" size={14} /> {t("tmd.fileChoose")}</button>
                  {filename && <span className="chip"><Icon name="file" size={12} /> {filename}</span>}
                  <input ref={fileInput} type="file" accept=".md,.markdown,text/markdown,text/plain" className="sr-only" tabIndex={-1} aria-label={t("tmd.fileChoose")} onChange={(e) => { void chooseFile(e.target.files?.[0]); e.target.value = ""; }} />
                </div>
                <label className="field-label" htmlFor={`${uid}paste`}>{t("tmd.paste")}</label>
                <textarea id={`${uid}paste`} className="input grok-paste" rows={10} value={text} spellCheck={false} placeholder={"---\nformat: sklubot-team/1\nname: …\nbots:\n  - name: …\n---"} onChange={(e) => { setText(e.target.value); if (!e.target.value) setFilename(""); }} />
              </section>
            ) : (
              <section className="grok-section">
                <label className="field-label" htmlFor={`${uid}url`}>{t("tmd.urlLabel")}</label>
                <input id={`${uid}url`} className="input" type="url" inputMode="url" value={url} placeholder="https://github.com/…/equipe.md" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && url.trim() && !busy) void read({ url: url.trim() }); }} />
                <p className="note-line small"><Icon name="shield" size={13} /> <span>{t("tmd.urlNote")}</span></p>
              </section>
            )}
            <p className="note-line small"><Icon name="lock" size={13} /> <span>{t("tmd.nothingBefore")}</span></p>
          </>
        )}

        {step === "review" && preview && (
          <section className="grok-section">
            <div className="tpl-source">
              <span className="tpl-icon"><Icon name="users" size={18} /></span>
              <div className="tpl-source-text">
                <strong>{preview.meta.name || t("tmd.unnamed")}</strong>
                {preview.meta.description && <span className="muted small">{preview.meta.description}</span>}
                <span className="tmd-chips">
                  <span className="chip"><Icon name={preview.source.kind === "url" ? "globe" : "file"} size={12} /> {t(`tmd.source.${preview.source.kind}` as Key, { label: preview.source.label })}</span>
                  {preview.meta.version && <span className="chip">v{preview.meta.version}</span>}
                  {preview.meta.author && <span className="chip">{t("tmd.by", { name: preview.meta.author })}</span>}
                </span>
              </div>
            </div>

            {preview.existing && (
              <fieldset className="grok-group tmd-mode">
                <legend>{t("tmd.existing", { name: preview.existing.name, n: preview.existing.bots })}</legend>
                <label className="check-row"><input type="radio" name={`${uid}mode`} checked={mode === "update"} onChange={() => setMode("update")} /> <span><strong>{t("tmd.modeUpdate")}</strong> <span className="muted small">{t("tmd.modeUpdateHint")}</span></span></label>
                <label className="check-row"><input type="radio" name={`${uid}mode`} checked={mode === "copy"} onChange={() => setMode("copy")} /> <span><strong>{t("tmd.modeCopy")}</strong> <span className="muted small">{t("tmd.modeCopyHint")}</span></span></label>
              </fieldset>
            )}

            <p className="callout is-info"><Icon name="shield" size={16} /> <span>{t("tmd.safeNote")}</span></p>
            {preview.removed.length > 0 && (
              <div className="callout is-warn grok-stripped" role="status">
                <Icon name="alert" size={16} />
                <div>
                  <p>{t("tmd.removed", { n: preview.removed.length })}</p>
                  <details>
                    <summary>{t("tpl.removedWhere")}</summary>
                    <ul>{preview.removed.map((r, i) => <li key={i}>{r.where} › « {r.field} » — {t(`tpl.reason.${r.reason}` as Key)}</li>)}</ul>
                  </details>
                </div>
              </div>
            )}
            {preview.masked.length > 0 && (
              <div className="callout is-warn grok-stripped" role="status">
                <Icon name="lock" size={16} />
                <div>
                  <p>{t("tpl.masked", { n: preview.masked.length })}</p>
                  <details>
                    <summary>{t("grok.strippedWhere")}</summary>
                    <ul>{preview.masked.map((s, i) => <li key={i}>{s.where} — {t(`grok.kind.${s.kind}` as Key)}</li>)}</ul>
                  </details>
                </div>
              </div>
            )}
            {preview.warnings.length > 0 && (
              <ul className="grok-warnings">
                {preview.warnings.map((w, i) => <li key={i} className="warn-text small"><Icon name="alert" size={13} /> {t(warnKey(w), { n: w.n ?? 0, detail: w.detail ?? "" })}</li>)}
              </ul>
            )}

            <h3 className="tmd-h">{t("tmd.botsTitle", { n: preview.bots.length })}</h3>
            {preview.bots.map((b, bi) => {
              const p = picks[bi];
              if (!p) return null;
              const updating = mode === "update" && !!b.existingId;
              return (
                <article key={bi} className={`grok-bot ${p.include ? "" : "is-off"}`}>
                  <header className="grok-bot-head">
                    <input type="checkbox" checked={p.include} onChange={(e) => setBot(bi, { include: e.target.checked })} aria-label={t("grok.includeBot", { name: p.name || b.name })} />
                    <Avatar shape={b.look.shape ?? "pebble"} color={b.look.color ?? "slate"} name={p.name || b.name} character={b.look.character} size={34} />
                    <input className="input grok-name" value={updating ? b.name : p.name} maxLength={60} disabled={updating} onChange={(e) => setBot(bi, { name: e.target.value })} aria-label={t("grok.botName")} />
                    {b.chief && <span className="chip state-ready">{t("tmd.chief")}</span>}
                    {updating ? <span className="chip">{t("tmd.willUpdate")}</span> : <span className="chip">{t("grok.careful")}</span>}
                  </header>
                  {!updating && b.nameTaken && <p className="small tmd-conflict"><Icon name="info" size={13} /> {t("tmd.renamed", { name: b.name, suggested: b.suggestedName })}</p>}
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
                      {b.model && (
                        <label className={`check-row small tmd-model ${b.modelAvailable ? "" : "is-off"}`}>
                          <input type="checkbox" checked={p.useModel && b.modelAvailable} disabled={!b.modelAvailable} onChange={(e) => setBot(bi, { useModel: e.target.checked })} />
                          <span>{t("tmd.useModel", { model: b.model })}{!b.modelAvailable && <span className="muted"> — {t("tmd.modelMissing")}</span>}</span>
                        </label>
                      )}
                      {b.skills.length > 0 && (
                        <fieldset className="grok-group">
                          <legend>{t("grok.skills")}</legend>
                          {b.skills.map((s, i) => (
                            <label key={i} className="grok-item tmd-item">
                              <input type="checkbox" checked={p.skills[i]} disabled={!s.known} onChange={(e) => setBot(bi, { skills: p.skills.map((x, j) => (j === i ? e.target.checked : x)) })} />
                              <span className="grok-item-text">
                                <span className="tmd-item-name">{s.name} <span className="chip">{t(s.kind === "library" ? "tmd.library" : "grok.draft")}</span></span>
                                {s.when && <span className="muted small">{s.when}</span>}
                                {!s.known && <span className="warn-text small"><Icon name="alert" size={12} /> {t("tmd.skillUnknown", { id: s.libraryId })}</span>}
                                {s.mentionsKey && <span className="warn-text small"><Icon name="key" size={12} /> {t("tmd.skillKey")}</span>}
                                <ScanFindings scan={s.scan} compact />
                              </span>
                            </label>
                          ))}
                        </fieldset>
                      )}
                      {(b.routines.length > 0 || b.unscheduled.length > 0) && (
                        <fieldset className="grok-group">
                          <legend>{t("grok.routines")} <span className="chip">{t("grok.paused")}</span></legend>
                          {b.routines.map((r, i) => (
                            <label key={i} className="grok-item tmd-item">
                              <input type="checkbox" checked={p.routines[i]} onChange={(e) => setBot(bi, { routines: p.routines.map((x, j) => (j === i ? e.target.checked : x)) })} />
                              <span className="grok-item-text">
                                <span className="tmd-item-name">{r.name}</span>
                                <span className="muted small">{r.describe} · {r.timezone} · <code>{r.cron}</code></span>
                              </span>
                            </label>
                          ))}
                          {b.unscheduled.map((u, i) => <p key={`u${i}`} className="warn-text small tmd-warn-line"><Icon name="clock" size={12} /> {t("tmd.unscheduled", { name: u })}</p>)}
                        </fieldset>
                      )}
                    </div>
                  )}
                </article>
              );
            })}

            {preview.groups.length > 0 && (
              <fieldset className="grok-group tmd-block">
                <legend><Icon name="chat" size={14} /> {t("tmd.groupsTitle")}</legend>
                {preview.groups.map((g, gi) => (
                  <label key={gi} className="grok-item tmd-item">
                    <input type="checkbox" checked={groups[gi]} onChange={(e) => setGroups((cur) => cur.map((x, j) => (j === gi ? e.target.checked : x)))} />
                    <span className="grok-item-text">
                      <span className="tmd-item-name">{g.name}{mode === "update" && g.existingId && <span className="chip">{t("tmd.willUpdate")}</span>}</span>
                      <span className="tmd-members">{g.members.map((m) => <span key={m} className="chip">{m}{m === g.lead && g.rule === "lead" ? ` · ${t("tmd.lead")}` : ""}</span>)}</span>
                      <span className="muted small">{t("tmd.whoAnswers")} {ruleText(g.rule)}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            {preview.connectors.length > 0 && (
              <fieldset className="grok-group tmd-block">
                <legend><Icon name="plug" size={14} /> {t("tmd.connectorsTitle")}</legend>
                <p className="muted small">{t("tmd.connectorsHint")}</p>
                <ul className="tmd-connectors">
                  {preview.connectors.map((c) => (
                    <li key={c.name}>
                      <Toggle checked={false} disabled onChange={() => undefined} label={t("tmd.connectLater", { app: c.name })} />
                      <span className="tmd-connector-text">
                        <strong>{c.name}</strong>
                        <span className="muted small">{[c.for.length ? t("tmd.for", { bots: c.for.join(", ") }) : "", c.why, c.inCatalog ? "" : t("tmd.notInCatalog")].filter(Boolean).join(" · ") || t("tmd.forAll")}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}

            {preview.playbook && (
              <details className="grok-instructions tmd-playbook">
                <summary><Icon name="book" size={13} /> {t("tmd.playbook")}</summary>
                <pre className="grok-prompt" tabIndex={0}>{preview.playbook}</pre>
              </details>
            )}

            <div className="tpl-section-row">
              <label className="check-row">
                <input type="checkbox" checked={section} onChange={(e) => setSection(e.target.checked)} />
                {t(mode === "update" ? "tmd.sectionUpdate" : "tpl.section")}
              </label>
              {section && <input className="input input-small" value={sectionName} maxLength={40} onChange={(e) => setSectionName(e.target.value)} aria-label={t("tpl.sectionName")} />}
            </div>
            {preview.meta.chief && (
              <label className="check-row">
                <input type="checkbox" checked={chiefPrimary} onChange={(e) => setChiefPrimary(e.target.checked)} />
                {t("tmd.chiefPrimary", { name: preview.meta.chief })}
              </label>
            )}
            <p className="grok-summary" role="status">{t("tmd.summary", { bots: totals.bots, skills: totals.skills, routines: totals.routines, groups: totals.groups })}</p>
            {overRoom && <p className="warn-text small"><Icon name="alert" size={13} /> {t("grok.overRoom", { n: preview.room.bots ?? 0 })}</p>}
          </section>
        )}

        {step === "done" && report && (
          <section className="grok-section grok-done" role="status">
            <div className="callout is-ok"><Icon name="check" size={16} /> <span>{report.mode === "update" ? t("tmd.doneUpdated", { bots: [...report.updated, ...report.created].map((b) => b.name).join(", ") }) : t("tmd.done", { bots: report.created.map((b) => b.name).join(", ") })}</span></div>
            <ul className="grok-done-list">
              {report.section && <li>{t("tpl.doneSection", { name: report.section.name })}</li>}
              <li>{t("tmd.doneSkills", { n: report.skills })}</li>
              <li>{t("grok.doneRoutines", { n: report.routines })}</li>
              {report.groups.length > 0 && <li>{t("tmd.doneGroups", { list: report.groups.map((g) => g.name).join(", ") })}</li>}
              {report.connectors.length > 0 && <li>{t("grok.doneApps", { list: report.connectors.join(", ") })}</li>}
              {report.unscheduled.length > 0 && <li className="warn-text">{t("grok.doneUnscheduled", { list: report.unscheduled.join(" ; ") })}</li>}
            </ul>
            <p className="muted small">{t("tpl.doneHint")}</p>
          </section>
        )}
        <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      </div>
      <div className="modal-foot grok-foot">
        {step === "choose" && (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
            {tab === "file"
              ? <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void read({ text, filename })}>{t(busy ? "common.working" : "tmd.read")}</button>
              : <button type="button" className="btn btn-primary" disabled={busy || !url.trim()} onClick={() => void read({ url: url.trim() })}>{t(busy ? "common.working" : "tmd.fetch")}</button>}
          </>
        )}
        {step === "review" && (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => { setStep("choose"); setError(null); }}><Icon name="arrowLeft" size={14} /> {t("tmd.back")}</button>
            <button type="button" className="btn btn-primary" disabled={busy || totals.bots === 0} onClick={() => void commit()}>{t(busy ? "common.working" : mode === "update" ? "tmd.update" : "tmd.create")}</button>
          </>
        )}
        {step === "done" && <button type="button" className="btn btn-primary" onClick={onClose}>{t("common.close")}</button>}
      </div>
    </>
  );
}

/** « Partager en fichier .md »: a section's bots (with its groups) or one bot, as a team file to download or copy. */
export function TeamMdShareModal({ onClose, sectionId, botIds }: { onClose: () => void; sectionId?: string; botIds?: string[] }) {
  const t = useT();
  const [apps, setApps] = useState(true);
  const [result, setResult] = useState<TeamMdExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${sectionId ?? ""}|${(botIds ?? []).join(",")}|${apps}`;

  useEffect(() => {
    let alive = true;
    setResult(null);
    setError(null);
    api<TeamMdExport>("POST", "/team-md/export", { sectionId, botIds, includeApps: apps })
      .then((r) => { if (alive) setResult(r); })
      .catch((e) => { if (alive) setError(errText(e)); });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = () => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([result.text], { type: "text/markdown;charset=utf-8" }));
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <Modal title={t("tmd.shareTitle")} onClose={onClose} size="lg" className="grok-modal tpl-modal tmd-modal">
      <div className="modal-body grok-body">
        <section className="grok-section">
          <p className="muted small">{t("tmd.shareIntro")}</p>
          <label className="check-row small tmd-apps-toggle">
            <Toggle checked={apps} onChange={setApps} label={t("tmd.shareApps")} />
            <span>{t("tmd.shareApps")}</span>
          </label>
          {!result && !error && <p className="muted small">{t("common.loading")}</p>}
          {result && (
            <>
              <p className="callout is-ok"><Icon name="check" size={16} /> <span>{t("tmd.shareReady", { name: result.filename, bots: result.bots, groups: result.groups, apps: result.connectors })}</span></p>
              {result.masked > 0 && <p className="callout is-warn"><Icon name="lock" size={16} /> <span>{t("tpl.exportMasked", { n: result.masked })}</span></p>}
              <pre className="grok-prompt tmd-file" tabIndex={0} aria-label={result.filename}>{result.text}</pre>
            </>
          )}
          <p className="note-line small"><Icon name="lock" size={13} /> <span>{t("tmd.shareNever")}</span></p>
          <p className="note-line small"><Icon name="globe" size={13} /> <span>{t("tmd.sharePublic")}</span></p>
        </section>
        <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      </div>
      <div className="modal-foot grok-foot">
        <button type="button" className="btn btn-ghost" onClick={onClose}>{t("common.close")}</button>
        {result && <CopyButton text={result.text} label={t("tpl.exportCopy")} className="btn" />}
        <button type="button" className="btn btn-primary" disabled={!result} onClick={download}><Icon name="download" size={14} /> {t("tmd.download")}</button>
      </div>
    </Modal>
  );
}
