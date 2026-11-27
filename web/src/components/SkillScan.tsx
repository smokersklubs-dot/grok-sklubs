import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { api, errText } from "../api";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import type { Bot, ScanFinding, ScanSeverity, Skill, SkillScan, SkillScanReport } from "../types";
import { Icon, type IconName } from "./Icon";
import { ConfirmButton, ErrorNote } from "./ui";
import "./SkillScan.css";

/* « Contrôle de sécurité des compétences » (server/src/skillscan.ts, docs/COMPETENCES.md): what the fixed rules found in
   a skill's text (what, where, what to do), shown before a skill is added and in each bot's Skills tab; the button
   « Vérifier mes compétences » of Settings → Skills; and the explicit acceptance of a flagged skill by its owner. */

export interface ScanState { scan: SkillScan; accepted: boolean; blocked: boolean }
const SEV_ICON: Record<ScanSeverity, IconName> = { danger: "alert", warning: "eye", info: "info" };

function Finding({ f }: { f: ScanFinding }) {
  const t = useT();
  return (
    <li className="scan-item">
      <span className="scan-what">
        <span className={`scan-sev is-${f.severity}`}>{t(`scan.sev.${f.severity}`)}</span>
        <span>{t(`scan.code.${f.code}` as Key)}</span>
        <span className="scan-where">{f.line > 0 ? t("scan.line", { n: f.line }) : t("scan.line0")}</span>
      </span>
      {f.excerpt && <code className="scan-quote">{f.excerpt}</code>}
      <p className="scan-do">{f.negated ? t("scan.negated") : t(`scan.do.${f.code}` as Key)}</p>
    </li>
  );
}

/** What the check found. Nothing when the text is clean. `compact`: the first three only (inside a list of things to tick). */
export function ScanFindings({ scan, compact }: { scan: SkillScan | null | undefined; compact?: boolean }) {
  const t = useT();
  if (!scan || scan.worst === "ok" || !scan.findings.length) return null;
  const shown = compact ? scan.findings.slice(0, 3) : scan.findings;
  const rest = scan.findings.length - shown.length;
  return (
    <span className={`scan-box is-${scan.worst}`} role="group" aria-label={t("scan.title")}>
      <span className="scan-head"><Icon name={SEV_ICON[scan.worst]} size={15} /> <span>{t(`scan.head.${scan.worst}`)}</span></span>
      <ul className="scan-list">{shown.map((f, i) => <Finding key={`${f.code}-${f.line}-${i}`} f={f} />)}</ul>
      {rest > 0 && <span className="scan-more">{t("scan.more", { n: rest })}</span>}
      {scan.truncated && !rest && <span className="scan-note">{t("scan.truncated")}</span>}
    </span>
  );
}

/** The checks of one bot's skills, by skill id; `reload` after a change. */
export function useBotScans(botId: string, dep: unknown): { scans: Record<string, ScanState>; reload: () => void } {
  const [scans, setScans] = useState<Record<string, ScanState>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let dead = false;
    api<{ scans: Record<string, ScanState> }>("GET", `/bots/${botId}/skills/scan`).then((r) => { if (!dead) setScans(r?.scans ?? {}); }, () => { /* the list still works without the check */ });
    return () => { dead = true; };
  }, [botId, dep, tick]);
  return { scans, reload: useCallback(() => setTick((n) => n + 1), []) };
}

/** « J'ai lu : accepter et activer »: the owner's explicit yes for a flagged skill (two clicks). */
function AcceptButton({ skillId, botId, name, onDone, onError }: { skillId: string; botId: string; name: string; onDone: () => void; onError: (e: string) => void }) {
  const t = useT();
  const loadBundle = useStore((s) => s.loadBundle);
  const showToast = useStore((s) => s.showToast);
  return (
    <ConfirmButton
      className="btn btn-small"
      label={<><Icon name="check" size={14} /> {t("scan.accept")}</>}
      confirmLabel={t("scan.acceptConfirm")}
      busyLabel="…"
      onConfirm={async () => {
        try {
          await api("POST", `/skills/${skillId}/scan/accept`, {});
          await loadBundle(botId).catch(() => {});
          showToast(t("scan.accepted", { name }));
          onDone();
        } catch (e) { onError(errText(e)); }
      }}
    />
  );
}

/** Under a skill of a bot's Skills tab: the findings, and the acceptance when the skill is held back. */
export function SkillRowCheck({ skill, state, onChanged }: { skill: Skill; state: ScanState | undefined; onChanged: () => void }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  if (!state || state.scan.worst === "ok" || (state.scan.worst === "info" && !skill.draft)) return null;
  return (
    <>
      <ScanFindings scan={state.scan} />
      {state.blocked && (
        <>
          <span className="list-row-sub">{t("scan.blockedHint")}</span>
          <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
          <span className="scan-actions"><AcceptButton skillId={skill.id} botId={skill.botId} name={skill.name} onDone={onChanged} onError={setError} /></span>
        </>
      )}
      {state.accepted && state.scan.worst === "danger" && <span className="list-row-sub">{t("scan.state.accepted")}</span>}
    </>
  );
}

/** The check of a text that is not saved yet (a skill a bot proposes), a moment after the last key. */
export function TextScan({ name, when, steps }: { name: string; when: string; steps: string }) {
  const [scan, setScan] = useState<SkillScan | null>(null);
  useEffect(() => {
    let dead = false;
    const id = setTimeout(() => {
      api<{ scan: SkillScan }>("POST", "/skills/scan/text", { name, when, steps }).then((r) => { if (!dead) setScan(r?.scan ?? null); }, () => { if (!dead) setScan(null); });
    }, 400);
    return () => { dead = true; clearTimeout(id); };
  }, [name, when, steps]);
  return <ScanFindings scan={scan} />;
}

/** Importing a skill from a file at a public address: the file is read and checked first, then imported. */
export function SkillImportForm({ bot, onDone }: { bot: Bot; onDone: () => void }) {
  const t = useT();
  const loadBundle = useStore((s) => s.loadBundle);
  const showToast = useStore((s) => s.showToast);
  const [url, setUrl] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{ url: string; name: string; size: number; scan: SkillScan } | null>(null);
  const checked = found && found.url === url.trim() ? found : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!checked) {
        const r = await api<{ name: string; size: number; scan: SkillScan }>("POST", `/bots/${bot.id}/skills/import/scan`, { url: url.trim() });
        setFound({ url: url.trim(), name: r.name, size: r.size, scan: r.scan });
        return;
      }
      const r = await api<{ skill: Skill; replaced: boolean }>("POST", `/bots/${bot.id}/skills/import`, { url: url.trim(), shared });
      await loadBundle(bot.id);
      showToast(r.skill.draft ? t("scan.keptDraft", { name: r.skill.name }) : t(r.replaced ? "skill.importReplaced" : "skill.imported", { name: r.skill.name }));
      onDone();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="editor skill-import" onSubmit={submit}>
      <div className="field">
        <label className="field-label" htmlFor={`imp-${bot.id}`}>{t("skill.importUrl")}</label>
        <input id={`imp-${bot.id}`} className="input" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://raw.githubusercontent.com/…/skill.md" autoFocus />
        <p className="field-hint">{t("skill.importHint")}</p>
      </div>
      <label className="check-row"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> <span>{t("skill.shareWithTeam")}</span></label>
      {checked && (
        <div role="status">
          <p className="scan-found">{t("scan.importFound", { name: checked.name || "?", size: checked.size })}</p>
          {checked.scan.worst === "ok" ? <p className="scan-ok"><Icon name="check" size={14} /> {t("scan.ok")}</p> : <ScanFindings scan={checked.scan} />}
          {checked.scan.worst === "danger" && <p className="field-hint">{t("scan.importDraftHint")}</p>}
        </div>
      )}
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      <div className="row-end">
        <button type="button" className="btn btn-small" onClick={onDone}>{t("common.cancel")}</button>
        <button type="submit" className="btn btn-primary btn-small" disabled={busy || !url.trim()}>
          {busy ? t("common.working") : !checked ? <><Icon name="shield" size={14} /> {t("scan.checkFirst")}</> : t(checked.scan.worst === "danger" ? "scan.importDraft" : "skill.import")}
        </button>
      </div>
    </form>
  );
}

/** Settings → Skills: « Vérifier mes compétences », then what was found, where, and what to do. */
export function SkillsCheckSection({ auto }: { /** Run the check at once (the dev gallery). */ auto?: boolean } = {}) {
  const t = useT();
  const uid = useId();
  const openBotSettings = useStore((s) => s.openBotSettings);
  const showToast = useStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SkillScanReport | null>(null);
  const run = useCallback(async () => {
    setBusy(true); setError(null);
    try { setReport((await api<{ report: SkillScanReport }>("POST", "/skills/scan", {})).report); }
    catch (e) { setError(errText(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { if (auto) void run(); }, [auto, run]);
  const toDraft = async (id: string, name: string) => {
    setError(null);
    try { await api("PATCH", `/skills/${id}`, { draft: true }); showToast(t("scan.madeDraft", { name })); await run(); }
    catch (e) { setError(errText(e)); }
  };
  const worst = report?.entries[0]?.scan.worst ?? "ok";
  const toRead = report ? report.entries.filter((e) => e.scan.worst !== "info").length : 0;
  return (
    <section className="scan-section" aria-labelledby={`${uid}h`}>
      <div className="scan-section-head">
        <div>
          <h3 id={`${uid}h`} className="pane-heading">{t("scan.title")}</h3>
          <p className="muted small">{t("scan.intro")}</p>
        </div>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run()}>
          <Icon name="shield" size={16} /> {t(busy ? "scan.running" : "scan.run")}
        </button>
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {report && (
        <div aria-live="polite">
          <p className={`scan-result is-${toRead ? worst : "ok"}`}>
            <Icon name={toRead ? SEV_ICON[worst === "ok" ? "info" : worst] : "check"} size={16} />
            <span>{report.skills === 0 ? t("scan.none") : toRead === 0 ? t("scan.allClean", { n: report.skills }) : t("scan.result", { n: report.skills, flagged: toRead })}</span>
          </p>
          {report.entries.length > 0 && (
            <ul className="scan-entries">
              {report.entries.map((e) => {
                const held = e.scan.worst === "danger" && !e.accepted;
                return (
                  <li key={e.skillId} className="scan-entry">
                    <div className="scan-entry-head">
                      <h4 className="scan-entry-name">{e.name}</h4>
                      <span className="scan-entry-bot">{t("scan.ofBot", { name: e.botName })}</span>
                      <span className="chip">{t(e.accepted && e.scan.worst === "danger" ? "scan.state.accepted" : e.draft ? "scan.state.draft" : "scan.state.active")}</span>
                    </div>
                    <ScanFindings scan={e.scan} />
                    {held && <p className="scan-note">{t(e.draft ? "scan.blockedHint" : "scan.activeHint")}</p>}
                    <div className="scan-actions">
                      <button type="button" className="btn btn-small" onClick={() => openBotSettings(e.botId, "skills")}><Icon name="edit" size={14} /> {t("scan.openBot")}</button>
                      {held && !e.draft && <button type="button" className="btn btn-small" onClick={() => void toDraft(e.skillId, e.name)}><Icon name="pause" size={14} /> {t("scan.toDraft")}</button>}
                      {held && <AcceptButton skillId={e.skillId} botId={e.botId} name={e.name} onDone={() => void run()} onError={setError} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="muted small scan-limits"><Icon name="info" size={13} /> <span>{t("scan.limits")}</span></p>
        </div>
      )}
    </section>
  );
}
