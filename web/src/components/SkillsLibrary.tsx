import { useEffect, useId, useState, type FormEvent } from "react";
import { api, errText } from "../api";
import { useT, type Key } from "../i18n";
import { sortedBots, useStore } from "../store";
import type { GithubImportReport, GithubPreview, LibraryCategory, LibrarySkill } from "../types";
import { Icon } from "./Icon";
import { ScanFindings, SkillsCheckSection } from "./SkillScan";
import { BenchPanel, SkillsHealthSection, TeamCatalogSection } from "./SkillHealth";
import { Empty, ErrorNote, Loading } from "./ui";
import "./SkillsLibrary.css";

/* « Bibliothèque de compétences » (server/src/skillslibrary.ts, skillsgithub.ts, docs/COMPETENCES.md): the skills bundled
   with Sklubot, added to every bot or to one in a click (idempotent), and the import of SKILL.md files from a public
   GitHub repository, as drafts the owner activates in each bot's Skills tab. */

function BotTarget({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const t = useT();
  const bots = useStore((s) => s.bots);
  const agents = sortedBots(bots).filter((b) => b.kind === "agent");
  return (
    <select id={id} className="input skl-target" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="all">{t("skl.target.all")}</option>
      {agents.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );
}

function LibraryCard({ skill, onAdded }: { skill: LibrarySkill; onAdded: () => void }) {
  const t = useT();
  const showToast = useStore((s) => s.showToast);
  const uid = useId();
  const [target, setTarget] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const all = skill.botCount > 0 && skill.addedTo >= skill.botCount;
  const add = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ report: { added: { botName: string }[]; already: { botName: string }[] } }>("POST", `/skills-library/${encodeURIComponent(skill.id)}/add`, { target });
      showToast(r.report.added.length ? t("skl.added", { name: skill.title, n: r.report.added.length }) : t("skl.already", { name: skill.title }));
      onAdded();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <li className="skl-card">
      <div className="skl-card-head">
        <span className={`skl-mark is-${skill.origin}`} aria-hidden="true"><Icon name="book" size={18} /></span>
        <div className="skl-card-title">
          <h3>{skill.title}</h3>
          <p className="skl-meta">
            <span className={`skl-badge is-${skill.origin}`}>{t(`skl.origin.${skill.origin}`)}</span>
            <span>{t("skl.licence", { licence: skill.licence.replace(/ AND /g, " + ") })}</span>
            {skill.language !== "fr" && <span>{t("skl.inEnglish")}</span>}
          </p>
        </div>
      </div>
      <p className="skl-summary">{skill.summary}</p>
      <details className="skl-read">
        <summary>{t("skl.read")}</summary>
        <pre className="skl-body">{skill.body}</pre>
        <p className="skl-notice">{skill.notice}{skill.source && <> — <a href={skill.source} target="_blank" rel="noopener noreferrer">{t("skl.source")}</a></>}</p>
      </details>
      {skill.botCount > 0 && <details className="skl-read"><summary>{t("skh.bench.title")}</summary><BenchPanel path={`/skills-library/${encodeURIComponent(skill.id)}/bench`} needsBot /></details>}
      {(skill.scan?.worst === "danger" || skill.scan?.worst === "warning") && <ScanFindings scan={skill.scan} compact />}
      <p className="skl-count">{skill.botCount === 0 ? t("skl.noBots") : t("skl.count", { n: skill.addedTo, total: skill.botCount })}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      <div className="skl-actions">
        <label className="sr-only" htmlFor={`${uid}t`}>{t("skl.addTo")}</label>
        <BotTarget id={`${uid}t`} value={target} onChange={setTarget} />
        <button type="button" className="btn btn-small btn-primary" disabled={busy || skill.botCount === 0 || (all && target === "all")} onClick={() => void add()}>
          {all && target === "all" ? <><Icon name="check" size={14} /> {t("skl.everyBot")}</> : <><Icon name="plus" size={14} /> {t(busy ? "common.working" : "skl.add")}</>}
        </button>
      </div>
    </li>
  );
}

type Flag = [Key, Record<string, string | number>];
const listed = (files: string[] | undefined) => (files ?? []).slice(0, 4).join(", ") + ((files?.length ?? 0) > 4 ? "…" : "");
const flags = (s: GithubPreview["skills"][number]): Flag[] => {
  const out: Flag[] = [];
  if (s.mentionsKey) out.push(["skl.gh.flag.key", {}]);
  if (s.tooLarge) out.push(["skl.gh.flag.large", { chars: (s.chars ?? 0).toLocaleString() }]);
  // L26: files its text cites that the bot will not have, and small texts of its folder joined as annexes.
  if (s.referencedFiles?.length) out.push(["skl.gh.flag.refs", { n: s.referencedFiles.length, files: listed(s.referencedFiles) }]);
  if (s.annexes?.length) out.push(["skl.gh.flag.annexes", { n: s.annexes.length, files: listed(s.annexes) }]);
  if (s.ignoredFiles) out.push(["skl.gh.flag.files", { n: s.ignoredFiles }]);
  if (s.exists) out.push(["skl.gh.flag.exists", {}]);
  return out;
};

function GithubImport() {
  const t = useT();
  const uid = useId();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<GithubPreview | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [target, setTarget] = useState("all");
  const [report, setReport] = useState<GithubImportReport | null>(null);
  const look = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setReport(null);
    try {
      const r = await api<{ preview: GithubPreview }>("POST", "/skills-library/github/preview", { url: url.trim() });
      setPreview(r.preview);
      // Ticked by default only when the licence allows reuse and nothing is wrong with it; the owner decides.
      setPicked(Object.fromEntries(r.preview.skills.map((s) => [s.path, s.permissive && !s.tooLarge && !s.mentionsKey && !s.exists && s.scan?.worst !== "danger"])));
    } catch (err) { setError(errText(err)); setPreview(null); } finally { setBusy(false); }
  };
  const commit = async () => {
    if (!preview) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ report: GithubImportReport }>("POST", "/skills-library/github/commit", { previewId: preview.previewId, paths: Object.keys(picked).filter((k) => picked[k]), target });
      setReport(r.report); setPreview(null);
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };
  const count = Object.values(picked).filter(Boolean).length;
  return (
    <section className="skl-github" aria-labelledby={`${uid}h`}>
      <h3 id={`${uid}h`} className="pane-heading">{t("skl.gh.title")}</h3>
      <p className="muted small">{t("skl.gh.intro")}</p>
      <form className="skl-gh-form" onSubmit={look}>
        <label className="field-label" htmlFor={`${uid}u`}>{t("skl.gh.url")}</label>
        <div className="skl-gh-row">
          <input id={`${uid}u`} className="input" type="url" inputMode="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/…/…" />
          <button type="submit" className="btn btn-small" disabled={busy || !url.trim()}><Icon name="search" size={14} /> {t(busy && !preview ? "common.working" : "skl.gh.look")}</button>
        </div>
      </form>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {report && (
        <p className="skl-report" role="status"><Icon name="check" size={14} /> {t("skl.gh.done", { n: report.imported.length, skipped: report.skipped.length })}{report.flagged?.length ? ` ${t("scan.flaggedNote", { n: report.flagged.length })}` : ""}</p>
      )}
      {preview && (
        <div className="skl-preview">
          <p className="muted small">{t("skl.gh.found", { n: preview.skills.length, repo: preview.repo })}{preview.truncated ? ` ${t("skl.gh.truncated")}` : ""}</p>
          <ul className="skl-found">
            {preview.skills.map((s) => (
              <li key={s.path} className={`skl-found-row ${s.permissive && s.scan?.worst !== "danger" ? "" : "is-warn"}`}>
                <label className="check-row">
                  <input type="checkbox" disabled={s.tooLarge} checked={!!picked[s.path]} onChange={(e) => setPicked((p) => ({ ...p, [s.path]: e.target.checked }))} />
                  <span className="skl-found-text">
                    <span className="skl-found-name">{s.name}</span>
                    {s.description && <span className="skl-found-desc">{s.description}</span>}
                    <code className="skl-found-path">{s.path}</code>
                    <span className={`skl-licence ${s.permissive ? "is-ok" : "is-warn"}`}>
                      <Icon name={s.permissive ? "check" : "alert"} size={13} />
                      {s.licence === "none" ? t("skl.gh.noLicence") : s.permissive ? t("skl.gh.permissive", { licence: s.licence }) : t("skl.gh.notPermissive", { licence: s.licence === "restrictive" ? t("skl.gh.restrictive") : s.licence === "unknown" ? t("skl.gh.unknown") : s.licence })}
                    </span>
                    {flags(s).map(([k, vars]) => <span key={k} className={`skl-flag ${k === "skl.gh.flag.annexes" ? "is-info" : ""}`}><Icon name={k === "skl.gh.flag.annexes" ? "check" : "alert"} size={12} /> {t(k, vars)}</span>)}
                  </span>
                </label>
                <ScanFindings scan={s.scan} compact />
              </li>
            ))}
          </ul>
          <p className="skl-warn small"><Icon name="shield" size={13} /> {t("skl.gh.review")}</p>
          <div className="skl-actions">
            <label className="sr-only" htmlFor={`${uid}t`}>{t("skl.addTo")}</label>
            <BotTarget id={`${uid}t`} value={target} onChange={setTarget} />
            <button type="button" className="btn btn-small btn-primary" disabled={busy || count === 0} onClick={() => void commit()}>
              <Icon name="download" size={14} /> {t("skl.gh.import", { n: count })}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/* The gallery's themes, in this order (catalog.json "category"). */
const CATEGORIES: LibraryCategory[] = ["method", "writing", "design", "animation", "seo", "business", "tools"];

export function SkillsLibrarySection() {
  const t = useT();
  const [list, setList] = useState<LibrarySkill[] | null>(null);
  const [cat, setCat] = useState<LibraryCategory | null>(null);
  const [github, setGithub] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let dead = false;
    api<{ skills: LibrarySkill[]; github: boolean }>("GET", "/skills-library").then(
      (r) => { if (!dead) { setList(Array.isArray(r?.skills) ? r.skills : []); setGithub(!!r?.github); } },
      (e: unknown) => { if (!dead) { setError(errText(e)); setList((c) => c ?? []); } },
    );
    return () => { dead = true; };
  }, [tick]);
  return (
    <div className="skl-library">
      <h2>{t("settings.section.skills")}</h2>
      <p className="muted">{t("skl.intro")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {!list && <Loading />}
      {list && list.length === 0 && !error && <Empty icon="book" title={t("skl.emptyTitle")} />}
      {list && list.length > 0 && (() => {
        const present = CATEGORIES.filter((c) => list.some((s) => (s.category ?? "method") === c));
        const shown = cat ? present.filter((c) => c === cat) : present;
        return (
          <>
            <div className="filter-chips skl-filters" role="group" aria-label={t("skl.cat.filter")}>
              <button type="button" className={`filter-chip ${cat === null ? "is-selected" : ""}`} aria-pressed={cat === null} onClick={() => setCat(null)}>{t("skl.cat.all", { n: list.length })}</button>
              {present.map((c) => (
                <button key={c} type="button" className={`filter-chip ${cat === c ? "is-selected" : ""}`} aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>
                  {t(`skl.cat.${c}` as Key)} <span className="skl-filter-n">{list.filter((s) => (s.category ?? "method") === c).length}</span>
                </button>
              ))}
            </div>
            {shown.map((c) => (
              <section key={c} className="skl-theme" aria-labelledby={`skl-theme-${c}`}>
                <h3 id={`skl-theme-${c}`} className="skl-theme-title">{t(`skl.cat.${c}` as Key)}</h3>
                <ul className="skl-grid">{list.filter((s) => (s.category ?? "method") === c).map((s) => <LibraryCard key={s.id} skill={s} onAdded={() => setTick((n) => n + 1)} />)}</ul>
              </section>
            ))}
          </>
        );
      })()}
      <TeamCatalogSection />
      <SkillsHealthSection />
      <SkillsCheckSection />
      {github ? <GithubImport /> : list && <p className="muted small skl-gh-off"><Icon name="lock" size={13} /> {t("skl.gh.notInPlan")}</p>}
    </div>
  );
}
