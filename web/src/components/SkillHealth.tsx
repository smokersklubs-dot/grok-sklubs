import { useEffect, useId, useState } from "react";
import { api, errText } from "../api";
import { useT, type Key } from "../i18n";
import { relTime } from "../lib/format";
import { sortedBots, useStore } from "../store";
import type { BenchResult, Bot, CatalogSkill, CuratorSuggestion, Skill, SkillHealth, SkillHealthReport, SkillVersion } from "../types";
import { Icon } from "./Icon";
import { ConfirmButton, ErrorNote, Loading, Toggle } from "./ui";
import "./SkillHealth.css";

/* « Santé des compétences » (server/src/skillhealth.ts, skillcatalog.ts, docs/COMPETENCES.md): how often each skill is
   read, its failures, the curator's suggestions (one action each, the owner decides), pin / lock / « seulement quand je
   le demande » / « toujours en entier », the scope of a shared skill, older versions, the « Mettre à jour » chip, the
   team catalogue and the « avec / sans » test bench. */

/** The account's skill health, reloaded when `tick` changes. */
export function useSkillHealth(tick?: unknown) {
  const [report, setReport] = useState<SkillHealthReport | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let dead = false;
    api<{ report: SkillHealthReport }>("GET", "/skills/health").then((r) => { if (!dead && r?.report) setReport(r.report); }, () => { /* the list still works without it */ });
    return () => { dead = true; };
  }, [tick, n]);
  return { report, setReport, reload: () => setN((x) => x + 1) };
}

function usesText(t: ReturnType<typeof useT>, h: SkillHealth): string {
  if (h.inline) return t("skh.inline");
  if (!h.uses) return t("skh.neverRead");
  return t(h.uses === 1 ? "skh.read_one" : "skh.read_other", { n: h.uses, when: h.lastUsedAt ? relTime(h.lastUsedAt) : "" });
}

/** One line under a skill: reads, failures and its marks; the « Mettre à jour » chip when its source has a newer text. */
export function SkillHealthLine({ h, onChanged }: { h: SkillHealth | undefined; onChanged: () => void }) {
  const t = useT();
  const showToast = useStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!h) return null;
  const update = async () => {
    setBusy(true); setError(null);
    try { await api("POST", `/skills/${h.skillId}/update`, {}); showToast(t("skh.updated", { name: h.name })); onChanged(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <span className="skh-line">
      <span className={`skh-stat ${!h.uses && !h.inline ? "is-quiet" : ""}`}>{usesText(t, h)}</span>
      {h.failures > 0 && <span className="skh-stat is-warn">{t(h.failures === 1 ? "skh.fail_one" : "skh.fail_other", { n: h.failures })}</span>}
      {h.state === "archived" && <span className="chip skh-chip is-archived">{t("skh.archived")}</span>}
      {h.state === "stale" && <span className="chip skh-chip is-stale">{t("skh.stale")}</span>}
      {h.pinned && <span className="chip skh-chip"><Icon name="pin" size={11} /> {t("skh.pinned")}</span>}
      {h.locked && <span className="chip skh-chip"><Icon name="lock" size={11} /> {t("skh.locked")}</span>}
      {h.onlyOnRequest && <span className="chip skh-chip">{t("skh.onRequest")}</span>}
      {h.alwaysFull && <span className="chip skh-chip">{t("skh.alwaysFull")}</span>}
      {h.similar[0] && <span className="chip skh-chip is-warn" title={t("skh.similarTitle", { name: h.similar[0].name, bot: h.similar[0].botName })}>{t("skh.similar", { name: h.similar[0].name })}</span>}
      {h.update && (
        <button type="button" className="chip skh-update" disabled={busy} onClick={() => void update()} title={t(h.update.kind === "library" ? "skh.updateLibrary" : "skh.updateCatalog")}>
          <Icon name="refresh" size={11} /> {t(busy ? "common.working" : "skh.update")}
        </button>
      )}
      {error && <span className="skh-error">{error}</span>}
    </span>
  );
}

/** The curator's card: what it saw and one action each; nothing changes until the owner clicks. */
export function CuratorCard({ suggestions, onChanged, showBot }: { suggestions: CuratorSuggestion[]; onChanged: () => void; showBot?: boolean }) {
  const t = useT();
  const openBotSettings = useStore((s) => s.openBotSettings);
  const bots = useStore((s) => s.bots);
  const [error, setError] = useState<string | null>(null);
  if (!suggestions.length) return null;
  const meta = async (id: string, body: Record<string, unknown>) => {
    setError(null);
    try { await api("PATCH", `/skills/${id}/meta`, body); onChanged(); } catch (e) { setError(errText(e)); }
  };
  const botIdOf = (name: string) => sortedBots(bots).find((b) => b.name === name)?.id;
  return (
    <section className="skh-curator" aria-labelledby="skh-curator-title">
      <h3 id="skh-curator-title" className="skh-curator-title"><Icon name="bulb" size={15} /> {t("skh.curator.title")}</h3>
      <p className="muted small">{t("skh.curator.hint")}</p>
      <ul className="skh-suggestions">
        {suggestions.map((s) => (
          <li key={`${s.kind}:${s.skillId}`} className="skh-suggestion">
            <div className="skh-suggestion-text">
              <span className="skh-suggestion-name">{s.name}{showBot && <span className="muted"> · {s.botName}</span>}</span>
              <span className="small">{t(`skh.curator.${s.kind}` as Key, { days: s.detail, score: s.detail, other: s.otherName ?? "", problem: s.detail })}</span>
            </div>
            <div className="skh-suggestion-actions">
              {(s.kind === "never_used" || s.kind === "stale") && <>
                <button type="button" className="btn btn-small" onClick={() => void meta(s.skillId, { state: "archived" })}>{t("skh.archive")}</button>
                <button type="button" className="btn btn-small btn-ghost" onClick={() => void meta(s.skillId, { pinned: true, state: "active" })}>{t("skh.keep")}</button>
              </>}
              {s.kind === "archived" && <button type="button" className="btn btn-small" onClick={() => void meta(s.skillId, { state: "active" })}>{t("skh.bringBack")}</button>}
              {s.kind === "duplicate" && <button type="button" className="btn btn-small" onClick={() => void meta(s.skillId, { state: "archived" })}>{t("skh.archiveThis")}</button>}
              {(s.kind === "failing" || s.kind === "duplicate") && botIdOf(s.botName) && <button type="button" className="btn btn-small btn-ghost" onClick={() => openBotSettings(botIdOf(s.botName)!, "skills")}>{t("skh.open")}</button>}
            </div>
          </li>
        ))}
      </ul>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </section>
  );
}

/** « Avec / sans »: the same request answered with and without the skill, side by side, on the bot's own model. */
export function BenchPanel({ path, botId, needsBot }: { path: string; botId?: string; needsBot?: boolean }) {
  const t = useT();
  const uid = useId();
  const bots = useStore((s) => s.bots);
  const agents = sortedBots(bots).filter((b) => b.kind === "agent");
  const [bot, setBot] = useState(botId ?? agents[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BenchResult | null>(null);
  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    try { setResult((await api<{ result: BenchResult }>("POST", path, { prompt: prompt.trim(), botId: bot })).result); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="skh-bench">
      <p className="muted small">{t("skh.bench.hint")}</p>
      {needsBot && agents.length > 1 && (
        <div className="field">
          <label className="field-label" htmlFor={`${uid}b`}>{t("skh.bench.bot")}</label>
          <select id={`${uid}b`} className="input" value={bot} onChange={(e) => setBot(e.target.value)}>{agents.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </div>
      )}
      <div className="field">
        <label className="field-label" htmlFor={`${uid}p`}>{t("skh.bench.prompt")}</label>
        <textarea id={`${uid}p`} className="input" rows={2} maxLength={2000} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t("skh.bench.placeholder")} />
      </div>
      <div className="row-end">
        <button type="button" className="btn btn-small btn-primary" disabled={busy || prompt.trim().length < 10 || (needsBot && !bot)} onClick={() => void run()}>
          <Icon name="play" size={13} /> {t(busy ? "skh.bench.running" : "skh.bench.run")}
        </button>
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {result && (
        <div className="skh-bench-grid">
          <figure className="skh-bench-col is-with"><figcaption>{t("skh.bench.with")} <span className="muted">· {t("skh.bench.chars", { n: result.withSkill.chars })}</span></figcaption><div className="skh-bench-text">{result.withSkill.text}</div></figure>
          <figure className="skh-bench-col"><figcaption>{t("skh.bench.without")} <span className="muted">· {t("skh.bench.chars", { n: result.without.chars })}</span></figcaption><div className="skh-bench-text">{result.without.text}</div></figure>
        </div>
      )}
    </div>
  );
}

function Versions({ skillId, onChanged }: { skillId: string; onChanged: () => void }) {
  const t = useT();
  const showToast = useStore((s) => s.showToast);
  const [list, setList] = useState<SkillVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    api<{ versions: SkillVersion[] }>("GET", `/skills/${skillId}/versions`).then((r) => !dead && setList(r.versions ?? []), (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [skillId]);
  if (!list) return error ? <ErrorNote>{error}</ErrorNote> : <Loading />;
  if (!list.length) return <p className="muted small">{t("skh.versions.none")}</p>;
  return (
    <ul className="skh-versions">
      {list.map((v) => (
        <li key={v.id} className="skh-version">
          <details>
            <summary>{t("skh.versions.from", { when: relTime(v.savedAt) })} <span className="muted small">· {t("skh.bench.chars", { n: v.body.length })}</span></summary>
            <pre className="skh-version-body">{v.body}</pre>
          </details>
          <ConfirmButton className="btn btn-small" label={t("skh.versions.restore")} confirmLabel={t("common.confirm")} busyLabel="…"
            onConfirm={async () => {
              try { await api("POST", `/skills/${skillId}/versions/${v.id}/restore`, {}); showToast(t("skh.versions.restored")); onChanged(); } catch (e) { setError(errText(e)); }
            }} />
        </li>
      ))}
      {error && <li><ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote></li>}
    </ul>
  );
}

function ScopePicker({ h, onChanged }: { h: SkillHealth; onChanged: () => void }) {
  const t = useT();
  const bots = useStore((s) => s.bots);
  const sections = useStore((s) => s.sections);
  const others = sortedBots(bots).filter((b: Bot) => b.kind === "agent" && b.id !== h.botId);
  const [error, setError] = useState<string | null>(null);
  const sc = h.scope;
  const everyone = !sc.bots.length && !sc.sections.length;
  const save = async (next: typeof sc) => { setError(null); try { await api("PATCH", `/skills/${h.skillId}/meta`, { scope: next }); onChanged(); } catch (e) { setError(errText(e)); } };
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <fieldset className="skh-scope">
      <legend className="field-label">{t("skh.scope.title")}</legend>
      <p className="muted small">{everyone ? t("skh.scope.all") : t("skh.scope.some")}</p>
      <div className="filter-chips" role="group" aria-label={t("skh.scope.title")}>
        {(sections ?? []).map((s) => (
          <button key={s.id} type="button" className={`filter-chip ${sc.sections.includes(s.id) ? "is-selected" : ""}`} aria-pressed={sc.sections.includes(s.id)} onClick={() => void save({ ...sc, sections: toggle(sc.sections, s.id) })}>{s.name}</button>
        ))}
        {others.map((b) => {
          const state = sc.exclude.includes(b.id) ? "excluded" : sc.bots.includes(b.id) ? "on" : "off";
          return (
            <button key={b.id} type="button" className={`filter-chip ${state === "on" ? "is-selected" : ""} ${state === "excluded" ? "skh-excluded" : ""}`} aria-pressed={state === "on"}
              title={t(`skh.scope.${state}` as Key)}
              onClick={() => void save(state === "off" ? { ...sc, bots: [...sc.bots, b.id] } : state === "on" ? { ...sc, bots: sc.bots.filter((x) => x !== b.id), exclude: [...sc.exclude, b.id] } : { ...sc, exclude: sc.exclude.filter((x) => x !== b.id) })}>
              {state === "excluded" && <Icon name="close" size={11} />} {b.name}
            </button>
          );
        })}
      </div>
      <p className="muted small">{t("skh.scope.howto")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </fieldset>
  );
}

/** « Santé et réglages » of one skill (bot's Skills tab): marks, archive, scope, versions, catalogue, bench. */
export function SkillHealthPanel({ h, skill, onChanged, defaultOpen = false }: { h: SkillHealth | undefined; skill: Skill; onChanged: () => void; defaultOpen?: boolean }) {
  const t = useT();
  const showToast = useStore((s) => s.showToast);
  const [open, setOpen] = useState(defaultOpen);
  const [error, setError] = useState<string | null>(null);
  if (!h) return null;
  const meta = async (body: Record<string, unknown>) => { setError(null); try { await api("PATCH", `/skills/${h.skillId}/meta`, body); onChanged(); } catch (e) { setError(errText(e)); } };
  const publish = async () => {
    setError(null);
    try { const r = await api<{ entry: CatalogSkill }>("POST", `/skills/${h.skillId}/publish`, {}); showToast(t("skh.cat.published", { name: h.name, v: r.entry.version })); onChanged(); }
    catch (e) { setError(errText(e)); }
  };
  return (
    <details className="skh-panel" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>{t("skh.panel")}</summary>
      {open && (
        <div className="skh-panel-body">
          {h.lastFailure && <p className="skh-failure"><Icon name="alert" size={13} /> {t("skh.lastFailure", { problem: h.lastFailure })}</p>}
          <div className="skh-toggles">
            <span className="skh-toggle"><Toggle checked={h.pinned} label={t("skh.pin")} onChange={(on) => void meta({ pinned: on })} /> <span>{t("skh.pin")}<small className="muted">{t("skh.pinHint")}</small></span></span>
            <span className="skh-toggle"><Toggle checked={h.locked} label={t("skh.lock")} onChange={(on) => void meta({ locked: on })} /> <span>{t("skh.lock")}<small className="muted">{t("skh.lockHint")}</small></span></span>
            <span className="skh-toggle"><Toggle checked={h.onlyOnRequest} label={t("skh.onRequestLabel")} onChange={(on) => void meta({ onlyOnRequest: on })} /> <span>{t("skh.onRequestLabel")}<small className="muted">{t("skh.onRequestHint", { name: h.name })}</small></span></span>
            {h.sections > 1 && <span className="skh-toggle"><Toggle checked={h.alwaysFull} label={t("skh.alwaysFullLabel")} onChange={(on) => void meta({ alwaysFull: on })} /> <span>{t("skh.alwaysFullLabel")}<small className="muted">{t("skh.alwaysFullHint", { n: h.sections })}</small></span></span>}
          </div>
          {skill.shared && <ScopePicker h={h} onChanged={onChanged} />}
          <div className="skh-panel-actions">
            {h.state === "archived"
              ? <button type="button" className="btn btn-small" onClick={() => void meta({ state: "active" })}><Icon name="refresh" size={13} /> {t("skh.bringBack")}</button>
              : <button type="button" className="btn btn-small" onClick={() => void meta({ state: "archived" })}>{t("skh.archive")}</button>}
            {!skill.draft && <button type="button" className="btn btn-small" onClick={() => void publish()}><Icon name="upload" size={13} /> {t("skh.cat.publish")}</button>}
          </div>
          <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
          <h4 className="skh-sub">{t("skh.versions.title", { n: h.versions })}</h4>
          <Versions skillId={h.skillId} onChanged={onChanged} />
          <h4 className="skh-sub">{t("skh.bench.title")}</h4>
          <BenchPanel path={`/skills/${h.skillId}/bench`} botId={h.botId} />
        </div>
      )}
    </details>
  );
}

/** Under the skill editor: « presque identique à … » as the owner types (L131). */
export function DuplicateHint({ name, description, body, exceptId }: { name: string; description: string; body: string; exceptId?: string }) {
  const t = useT();
  const [similar, setSimilar] = useState<{ name: string; botName: string; score: number }[]>([]);
  useEffect(() => {
    if (name.trim().length < 3 && body.trim().length < 40) { setSimilar([]); return; }
    let dead = false;
    const id = setTimeout(() => {
      api<{ similar: { name: string; botName: string; score: number }[] }>("POST", "/skills/duplicates", { name, description, body, exceptId })
        .then((r) => !dead && setSimilar(r?.similar ?? []), () => {});
    }, 600);
    return () => { dead = true; clearTimeout(id); };
  }, [name, description, body, exceptId]);
  if (!similar.length) return null;
  return <p className="skh-dup" role="status"><Icon name="alert" size={13} /> {t("skh.dupHint", { name: similar[0].name, bot: similar[0].botName, score: Math.round(similar[0].score * 100) })}</p>;
}

/** The owner's view of every skill of the account (Settings → Skills). */
export function SkillsHealthSection() {
  const t = useT();
  const { report, reload } = useSkillHealth();
  const [filter, setFilter] = useState<"all" | "never" | "failing" | "similar" | "archived">("all");
  if (!report) return null;
  const s = report.skills;
  const counts = { all: s.length, never: s.filter((h) => !h.uses && !h.inline && h.state !== "archived").length, failing: s.filter((h) => h.failures > 0).length, similar: s.filter((h) => h.similar.length).length, archived: s.filter((h) => h.state === "archived").length };
  const shown = s.filter((h) => filter === "all" || (filter === "never" ? !h.uses && !h.inline && h.state !== "archived" : filter === "failing" ? h.failures > 0 : filter === "similar" ? h.similar.length > 0 : h.state === "archived"));
  return (
    <section className="skh-owner" aria-labelledby="skh-owner-title">
      <h3 id="skh-owner-title" className="skl-theme-title">{t("skh.owner.title")}</h3>
      <p className="muted small">{t("skh.owner.hint", { stale: report.staleAfterDays, archive: report.archiveAfterDays })}</p>
      {s.length === 0 ? <p className="muted">{t("skh.owner.empty")}</p> : <>
        <CuratorCard suggestions={report.suggestions} onChanged={reload} showBot />
        <div className="filter-chips" role="group" aria-label={t("skh.owner.filter")}>
          {(["all", "never", "failing", "similar", "archived"] as const).map((k) => (
            <button key={k} type="button" className={`filter-chip ${filter === k ? "is-selected" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{t(`skh.owner.f.${k}` as Key)} <span className="skl-filter-n">{counts[k]}</span></button>
          ))}
        </div>
        <ul className="skh-table">
          {shown.map((h) => (
            <li key={h.skillId} className="skh-row">
              <span className="skh-row-name">{h.name}<span className="muted small"> · {h.botName}</span></span>
              <SkillHealthLine h={h} onChanged={reload} />
            </li>
          ))}
        </ul>
      </>}
    </section>
  );
}

/** L135 — « Catalogue de l'équipe »: the account's own vetted skills, versioned, added to any of its bots. */
export function TeamCatalogSection() {
  const t = useT();
  const showToast = useStore((s) => s.showToast);
  const bots = useStore((s) => s.bots);
  const agents = sortedBots(bots).filter((b) => b.kind === "agent");
  const [list, setList] = useState<CatalogSkill[] | null>(null);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Record<string, string>>({});
  useEffect(() => {
    let dead = false;
    api<{ catalog: CatalogSkill[] }>("GET", "/skills-catalog").then((r) => !dead && setList(r?.catalog ?? []), (e) => { if (!dead) { setList([]); setError(errText(e)); } });
    return () => { dead = true; };
  }, [tick]);
  const add = async (c: CatalogSkill) => {
    setError(null);
    try { const r = await api<{ report: { added: string[]; already: string[] } }>("POST", `/skills-catalog/${c.id}/add`, { target: target[c.id] ?? "all" }); showToast(r.report.added.length ? t("skl.added", { name: c.name, n: r.report.added.length }) : t("skl.already", { name: c.name })); setTick((n) => n + 1); }
    catch (e) { setError(errText(e)); }
  };
  return (
    <section className="skh-catalog" aria-labelledby="skh-cat-title">
      <h3 id="skh-cat-title" className="skl-theme-title">{t("skh.cat.title")}</h3>
      <p className="muted small">{t("skh.cat.hint")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {!list ? <Loading /> : list.length === 0 ? <p className="muted small skh-cat-empty"><Icon name="book" size={13} /> {t("skh.cat.empty")}</p> : (
        <ul className="skl-grid">
          {list.map((c) => (
            <li key={c.id} className="skl-card">
              <div className="skl-card-title">
                <h3>{c.name}</h3>
                <p className="skl-meta"><span className="skl-badge">{t("skh.cat.version", { v: c.version })}</span><span>{t("skh.cat.from", { bot: c.fromBot, when: relTime(c.updatedAt) })}</span></p>
              </div>
              {c.description && <p className="skl-summary">{c.description}</p>}
              <p className="skl-count">{t("skl.count", { n: c.addedTo, total: c.botCount })}</p>
              <div className="skl-actions">
                <select className="input skl-target" aria-label={t("skl.addTo")} value={target[c.id] ?? "all"} onChange={(e) => setTarget((x) => ({ ...x, [c.id]: e.target.value }))}>
                  <option value="all">{t("skl.target.all")}</option>
                  {agents.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <button type="button" className="btn btn-small btn-primary" onClick={() => void add(c)}><Icon name="plus" size={14} /> {t("skl.add")}</button>
                <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("skh.cat.remove")} confirmLabel={t("common.confirm")} busyLabel="…"
                  onConfirm={async () => { try { await api("DELETE", `/skills-catalog/${c.id}`); setTick((n) => n + 1); } catch (e) { setError(errText(e)); } }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
