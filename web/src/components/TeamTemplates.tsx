import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, errText } from "../api";
import { useT, type Key } from "../i18n";
import { sortedBots, useStore } from "../store";
import { TEMPLATE_CATEGORIES, TEMPLATE_ICONS } from "../types";
import type { GrokImportWarning, TeamFileChoice, TeamFileExport, TeamFilePreview, TeamFileReport, TemplateCategory, TemplateSummary } from "../types";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { ScanFindings } from "./SkillScan";
import { CopyButton, ErrorNote, Modal } from "./ui";
import "./GrokImport.css";
import "./TeamTemplates.css";

/* "Modèles d'équipe" (server/src/teamfile.ts, docs/MODELES-EQUIPE.md): a gallery of built-in templates, a team file
   from the computer or from a link, then the same review screen as the Grok import. Nothing is created before "Create". */

type Tab = "gallery" | "file" | "url";
interface BotPick {
  include: boolean; name: string;
  skills: { include: boolean; name: string }[];
  routines: { include: boolean; name: string; cron: string }[];
  apps: boolean[];
}
const CRON_RE = /^\S+ \S+ \S+ \S+ \S+$/;

function initialPicks(p: TeamFilePreview): BotPick[] {
  return p.bots.map((b, i) => ({
    include: p.room.bots === null || i < p.room.bots,
    name: b.name,
    skills: b.skills.map((s) => ({ include: true, name: s.name })),
    routines: b.routines.map((r) => ({ include: true, name: r.name, cron: r.cron })),
    apps: b.apps.map(() => true),
  }));
}

function warningText(t: ReturnType<typeof useT>, w: GrokImportWarning): string {
  const own = ["no_version", "newer_version", "too_many_bots"].includes(w.code);
  return t((own ? `tpl.warn.${w.code}` : `grok.warn.${w.code}`) as Key, { n: w.n ?? 0, detail: w.detail ?? "" });
}

/** Lower-case, without accents: for the gallery search. */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function TemplatesModal({ onClose, tab: initialTab = "gallery" }: { onClose: () => void; tab?: Tab }) {
  const t = useT();
  const loadBots = useStore((s) => s.loadBots);
  const uid = useId();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [step, setStep] = useState<"choose" | "review" | "done">("choose");
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<TemplateCategory | "all">("all");
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("");
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<TeamFilePreview | null>(null);
  const [picks, setPicks] = useState<BotPick[]>([]);
  const [section, setSection] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [report, setReport] = useState<TeamFileReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    api<{ templates: TemplateSummary[] }>("GET", "/templates")
      .then((r) => { if (alive) setTemplates(r.templates); })
      .catch((e) => { if (alive) { setTemplates([]); setError(errText(e)); } });
    return () => { alive = false; };
  }, []);

  const shown = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    return (templates ?? []).filter((tp) => {
      if (cat !== "all" && tp.category !== cat) return false;
      const hay = fold([tp.title, tp.description, tp.tags.join(" "), ...tp.bots.map((b) => `${b.name} ${b.role}`)].join(" "));
      return words.every((w) => hay.includes(w));
    });
  }, [templates, query, cat]);
  const cats = useMemo(() => TEMPLATE_CATEGORIES.filter((c) => (templates ?? []).some((tp) => tp.category === c)), [templates]);

  const read = async (input: { template?: string; text?: string; url?: string; filename?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const p = await api<TeamFilePreview>("POST", "/templates/preview", input);
      setPreview(p);
      setPicks(initialPicks(p));
      setSection(p.bots.length > 1);
      setSectionName(p.meta.title.slice(0, 40));
      setStep("review");
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
      const bots: TeamFileChoice[] = picks.map((b, index) => ({
        index, include: b.include, name: b.name,
        skills: b.skills.map((s, i) => ({ index: i, include: s.include, name: s.name })),
        routines: b.routines.map((r, i) => ({ index: i, include: r.include, name: r.name, cron: r.cron })),
        apps: b.apps.flatMap((on, i) => (on ? [i] : [])),
      }));
      const r = await api<{ report: TeamFileReport }>("POST", "/templates/commit", { previewId: preview.previewId, bots, section: section && sectionName.trim() ? sectionName.trim() : undefined });
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

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > 200_000) { setError(t("api.failed", { status: 413 })); return; }
    setFilename(file.name);
    setText(await file.text());
  };

  const setBot = (i: number, patch: Partial<BotPick>) => setPicks((cur) => cur.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const totals = useMemo(() => {
    const on = picks.filter((b) => b.include);
    return {
      bots: on.length,
      skills: on.reduce((n, b) => n + b.skills.filter((s) => s.include).length, 0),
      routines: on.reduce((n, b) => n + b.routines.filter((r) => r.include && CRON_RE.test(r.cron.trim())).length, 0),
    };
  }, [picks]);
  const overRoom = preview?.room.bots !== null && preview?.room.bots !== undefined && totals.bots > preview.room.bots;

  return (
    <Modal title={step === "review" ? t("tpl.reviewTitle") : t("tpl.title")} onClose={onClose} size="lg" className="grok-modal tpl-modal">
      <div className="modal-body grok-body">
        {step === "choose" && (
          <>
            <div className="seg-tabs tpl-tabs" role="tablist" aria-label={t("tpl.tabsLabel")}>
              {(["gallery", "file", "url"] as Tab[]).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={`seg-tab ${tab === k ? "is-active" : ""}`} onClick={() => { setTab(k); setError(null); }}>
                  <Icon name={k === "gallery" ? "star" : k === "file" ? "file" : "globe"} size={14} /> {t(`tpl.tab.${k}` as Key)}
                </button>
              ))}
            </div>

            {tab === "gallery" && (
              <section className="grok-section">
                <p className="muted small">{t("tpl.openHint")}</p>
                <div className="tpl-search">
                  <Icon name="search" size={15} />
                  <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("tpl.searchPlaceholder")} aria-label={t("tpl.search")} />
                </div>
                {cats.length > 1 && (
                  <div className="tpl-cats" role="group" aria-label={t("tpl.filterLabel")}>
                    {(["all", ...cats] as const).map((c) => (
                      <button key={c} type="button" className={`tpl-cat ${cat === c ? "is-active" : ""}`} aria-pressed={cat === c} onClick={() => setCat(c)}>
                        {t(`tpl.cat.${c}` as Key)}
                      </button>
                    ))}
                  </div>
                )}
                {templates === null && <p className="muted small">{t("tpl.loading")}</p>}
                {templates !== null && shown.length === 0 && <p className="muted small">{t("tpl.none")}</p>}
                <ul className="tpl-grid">
                  {shown.map((tp) => (
                    <li key={tp.id}>
                      <button type="button" className="tpl-card" disabled={busy} onClick={() => void read({ template: tp.id })} aria-label={`${t("tpl.use")} : ${tp.title}`}>
                        <span className="tpl-card-head">
                          <span className="tpl-icon"><Icon name={(TEMPLATE_ICONS as readonly string[]).includes(tp.icon) ? (tp.icon as IconName) : "users"} size={18} /></span>
                          <span className="tpl-card-title">{tp.title}</span>
                          {tp.category && <span className="chip">{t(`tpl.cat.${tp.category}` as Key)}</span>}
                        </span>
                        <span className="tpl-card-desc">{tp.description}</span>
                        <span className="tpl-card-foot">
                          <span className="tpl-faces" aria-hidden="true">
                            {tp.bots.slice(0, 4).map((b, i) => <Avatar key={i} shape={b.look.shape ?? "pebble"} color={b.look.color ?? "slate"} name={b.name} character={b.look.character} size={30} />)}
                          </span>
                          <span className="muted small">{t("tpl.counts", { bots: tp.bots.length, skills: tp.skills, routines: tp.routines })}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {tab === "file" && (
              <section className="grok-section">
                <p className="muted small">{t("tpl.fileIntro")}</p>
                <div className="tpl-file-row">
                  <button type="button" className="btn btn-small" onClick={() => fileInput.current?.click()}><Icon name="upload" size={14} /> {t("tpl.fileChoose")}</button>
                  {filename && <span className="chip"><Icon name="file" size={12} /> {filename}</span>}
                  <input ref={fileInput} type="file" accept=".md,.markdown,text/markdown,text/plain" className="sr-only" tabIndex={-1} aria-label={t("tpl.fileChoose")} onChange={(e) => { void chooseFile(e.target.files?.[0]); e.target.value = ""; }} />
                </div>
                <label className="field-label" htmlFor={`${uid}paste`}>{t("tpl.filePaste")}</label>
                <textarea id={`${uid}paste`} className="input grok-paste" rows={10} value={text} spellCheck={false} placeholder={"---\nformat: sklubot-equipe\nversion: 1\ntitle: …\n---\n\n## Bot: …"} onChange={(e) => { setText(e.target.value); if (!e.target.value) setFilename(""); }} />
              </section>
            )}

            {tab === "url" && (
              <section className="grok-section">
                <p className="muted small">{t("tpl.urlIntro")}</p>
                <label className="field-label" htmlFor={`${uid}url`}>{t("tpl.urlLabel")}</label>
                <input id={`${uid}url`} className="input" type="url" inputMode="url" value={url} placeholder="https://raw.githubusercontent.com/…/equipe.md" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && url.trim() && !busy) void read({ url: url.trim() }); }} />
                <p className="note-line small"><Icon name="shield" size={13} /> <span>{t("tpl.urlNote")}</span></p>
              </section>
            )}
          </>
        )}

        {step === "review" && preview && (
          <section className="grok-section">
            <div className="tpl-source">
              <span className="tpl-icon"><Icon name={(TEMPLATE_ICONS as readonly string[]).includes(preview.meta.icon) ? (preview.meta.icon as IconName) : "users"} size={18} /></span>
              <div className="tpl-source-text">
                <strong>{preview.meta.title || t("tpl.title")}</strong>
                {preview.meta.description && <span className="muted small">{preview.meta.description}</span>}
                <span className="chip tpl-source-chip">
                  <Icon name={preview.source.kind === "template" ? "star" : preview.source.kind === "url" ? "globe" : "file"} size={12} />
                  {t(`tpl.source.${preview.source.kind}` as Key, { label: preview.source.label })}
                </span>
              </div>
            </div>
            <p className="callout is-info"><Icon name="shield" size={16} /> <span>{t("tpl.safeNote")}</span></p>
            {preview.removed.length > 0 && (
              <div className="callout is-warn grok-stripped" role="status">
                <Icon name="alert" size={16} />
                <div>
                  <p>{t("tpl.removed", { n: preview.removed.length })}</p>
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
                    <Avatar shape={b.look.shape ?? "pebble"} color={b.look.color ?? "slate"} name={p.name || b.name} character={b.look.character} size={34} />
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
                                  <span className="muted small">{r.describe || r.schedule}{r.timezone ? ` · ${r.timezone}` : ""}</span>
                                  {!cronOk && pr.include && <span className="warn-text small">{t("grok.needCron")}</span>}
                                </div>
                              </div>
                            );
                          })}
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

            <div className="tpl-section-row">
              <label className="check-row">
                <input type="checkbox" checked={section} onChange={(e) => setSection(e.target.checked)} />
                {t("tpl.section")}
              </label>
              {section && <input className="input input-small" value={sectionName} maxLength={40} onChange={(e) => setSectionName(e.target.value)} aria-label={t("tpl.sectionName")} />}
            </div>
            <p className="grok-summary" role="status">{t("tpl.summary", { bots: totals.bots, skills: totals.skills, routines: totals.routines })}</p>
            {overRoom && <p className="warn-text small"><Icon name="alert" size={13} /> {t("grok.overRoom", { n: preview.room.bots ?? 0 })}</p>}
          </section>
        )}

        {step === "done" && report && (
          <section className="grok-section grok-done" role="status">
            <div className="callout is-ok"><Icon name="check" size={16} /> <span>{t("tpl.done", { bots: report.bots.map((b) => b.name).join(", ") })}</span></div>
            <ul className="grok-done-list">
              {report.section && <li>{t("tpl.doneSection", { name: report.section.name })}</li>}
              <li>{t("grok.doneSkills", { n: report.skills })}</li>
              <li>{t("grok.doneRoutines", { n: report.routines })}</li>
              {report.apps.length > 0 && <li>{t("grok.doneApps", { list: report.apps.join(", ") })}</li>}
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
            {tab === "file" && <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void read({ text, filename })}>{t(busy ? "common.working" : "tpl.fileRead")}</button>}
            {tab === "url" && <button type="button" className="btn btn-primary" disabled={busy || !url.trim()} onClick={() => void read({ url: url.trim() })}>{t(busy ? "common.working" : "tpl.urlRead")}</button>}
          </>
        )}
        {step === "review" && (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => { setStep("choose"); setError(null); }}><Icon name="arrowLeft" size={14} /> {t("tpl.backToGallery")}</button>
            <button type="button" className="btn btn-primary" disabled={busy || totals.bots === 0} onClick={() => void commit()}>{t(busy ? "common.working" : "tpl.create")}</button>
          </>
        )}
        {step === "done" && <button type="button" className="btn btn-primary" onClick={onClose}>{t("common.close")}</button>}
      </div>
    </Modal>
  );
}

/** "Exporter en modèle": tick bots (a section's, or the ones given), name the template, see the file, download it. */
export function ExportTemplateModal({ onClose, sectionId, botIds }: { onClose: () => void; sectionId?: string; botIds?: string[] }) {
  const t = useT();
  const uid = useId();
  const allBots = useStore((s) => s.bots);
  const sections = useStore((s) => s.sections);
  const agents = useMemo(() => sortedBots(allBots).filter((b) => b.kind === "agent" && !b.access), [allBots]);
  const sec = sectionId ? sections.find((s) => s.id === sectionId) : undefined;
  const [picked, setPicked] = useState<Set<string>>(() => new Set(
    botIds?.length ? botIds : sectionId ? agents.filter((b) => b.sectionId === sectionId).map((b) => b.id) : agents.filter((b) => !b.primary).map((b) => b.id),
  ));
  const [title, setTitle] = useState(sec?.name ?? (botIds?.length === 1 ? agents.find((b) => b.id === botIds[0])?.name ?? "" : ""));
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string>("users");
  const [category, setCategory] = useState<string>("");
  const [result, setResult] = useState<TeamFileExport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prepare = async () => {
    setBusy(true);
    setError(null);
    try {
      const ids = agents.filter((b) => picked.has(b.id)).map((b) => b.id);
      setResult(await api<TeamFileExport>("POST", "/templates/export", { botIds: ids, title, description, icon, category: category || undefined }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
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
    <Modal title={t("tpl.exportTitle")} onClose={onClose} size="lg" className="grok-modal tpl-modal">
      <div className="modal-body grok-body">
        {!result ? (
          <section className="grok-section">
            <p className="muted small">{t("tpl.exportHint")}</p>
            {agents.length === 0 ? <p className="muted">{t("tpl.noBots")}</p> : (
              <fieldset className="grok-group">
                <legend>{t("tpl.exportBots")}</legend>
                <div className="tpl-export-bots">
                  {agents.map((b) => (
                    <label key={b.id} className="check-row tpl-export-bot">
                      <input type="checkbox" checked={picked.has(b.id)} onChange={(e) => setPicked((cur) => { const n = new Set(cur); if (e.target.checked) n.add(b.id); else n.delete(b.id); return n; })} />
                      <Avatar shape={b.shape} color={b.color} name={b.name} character={b.character} size={24} />
                      <span className="truncate">{b.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="tpl-export-fields">
              <label className="field">
                <span className="field-label">{t("tpl.exportName")}</span>
                <input className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">{t("tpl.exportDescription")}</span>
                <input className="input" value={description} maxLength={400} onChange={(e) => setDescription(e.target.value)} />
              </label>
              <div className="tpl-export-pair">
                <label className="field">
                  <span className="field-label">{t("tpl.exportCategory")}</span>
                  <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">{t("tpl.exportNone")}</option>
                    {TEMPLATE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`tpl.cat.${c}` as Key)}</option>)}
                  </select>
                </label>
                <div className="field">
                  <span className="field-label" id={`${uid}icon`}>{t("tpl.exportIcon")}</span>
                  <div className="tpl-icons" role="radiogroup" aria-labelledby={`${uid}icon`}>
                    {TEMPLATE_ICONS.slice(0, 12).map((i) => (
                      <button key={i} type="button" role="radio" aria-checked={icon === i} aria-label={i} className={`tpl-icon-pick ${icon === i ? "is-active" : ""}`} onClick={() => setIcon(i)}>
                        <Icon name={i as IconName} size={15} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <p className="note-line small"><Icon name="lock" size={13} /> <span>{t("tpl.exportNever")}</span></p>
          </section>
        ) : (
          <section className="grok-section">
            <p className="callout is-ok"><Icon name="check" size={16} /> <span>{t("tpl.exportReady", { name: result.filename, n: result.bots })}</span></p>
            {result.masked > 0 && <p className="callout is-warn"><Icon name="lock" size={16} /> <span>{t("tpl.exportMasked", { n: result.masked })}</span></p>}
            <pre className="grok-prompt tpl-export-text" tabIndex={0} aria-label={result.filename}>{result.text}</pre>
            <p className="note-line small"><Icon name="lock" size={13} /> <span>{t("tpl.exportNever")}</span></p>
          </section>
        )}
        <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      </div>
      <div className="modal-foot grok-foot">
        {!result ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
            <button type="button" className="btn btn-primary" disabled={busy || picked.size === 0} onClick={() => void prepare()}>{t(busy ? "common.working" : "tpl.exportPrepare")}</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setResult(null)}><Icon name="arrowLeft" size={14} /> {t("tpl.exportEdit")}</button>
            <CopyButton text={result.text} label={t("tpl.exportCopy")} className="btn" />
            <button type="button" className="btn btn-primary" onClick={download}><Icon name="download" size={14} /> {t("tpl.exportDownload")}</button>
          </>
        )}
      </div>
    </Modal>
  );
}
