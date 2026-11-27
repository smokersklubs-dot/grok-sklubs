import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import { ErrorNote, Toggle } from "./ui";
import "./TeamAskPolicy.css";

/**
 * L96 « Qui peut demander à qui » (Settings → Team; server agent/askrules.ts, agent/helperinherit.ts, turnplusroutes.ts):
 * whether any bot may write to any other ("open") or only along the team's order (a section's bots go through its lead,
 * "hierarchy"); each section's lead; and whether helpers and background tasks inherit their parent bot's instructions.
 */
type Mode = "open" | "hierarchy";

export function TeamAskPolicy() {
  const t = useT();
  const sections = useStore((s) => s.sections);
  const bots = useStore((s) => s.bots);
  const [mode, setMode] = useState<Mode | null>(null);
  const [inherit, setInherit] = useState<boolean | null>(null);
  const [leads, setLeads] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    Promise.all([
      api<{ mode: Mode }>("GET", "/team/ask-policy"),
      api<{ on: boolean }>("GET", "/team/helper-inherit"),
      api<{ leads: Record<string, string | null> }>("GET", "/team/section-leads"),
    ]).then(([m, i, l]) => { if (!dead) { setMode(m.mode); setInherit(i.on); setLeads(l.leads ?? {}); } }, (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, []);
  const saveMode = async (next: Mode) => {
    const before = mode; setMode(next); setError(null);
    try { setMode((await api<{ mode: Mode }>("PUT", "/team/ask-policy", { mode: next })).mode); } catch (e) { setMode(before); setError(errText(e)); }
  };
  const saveInherit = async (on: boolean) => {
    const before = inherit; setInherit(on); setError(null);
    try { setInherit((await api<{ on: boolean }>("PUT", "/team/helper-inherit", { on })).on); } catch (e) { setInherit(before); setError(errText(e)); }
  };
  const saveLead = async (sectionId: string, botId: string) => {
    setError(null);
    try { await api("PUT", `/sections/${enc(sectionId)}/lead`, { botId }); setLeads((l) => ({ ...l, [sectionId]: botId })); } catch (e) { setError(errText(e)); }
  };
  const members = (sectionId: string) => Object.values(bots).filter((b) => b.kind === "agent" && b.sectionId === sectionId && !b.access);
  return (
    <div className="team-ask" aria-busy={mode === null}>
      <p className="action-title">{t("teamAsk.title")}</p>
      <p className="muted small">{t("teamAsk.hint")}</p>
      <div className="team-ask-modes" role="radiogroup" aria-label={t("teamAsk.title")}>
        {(["open", "hierarchy"] as const).map((m) => (
          <label key={m} className={`team-ask-mode ${mode === m ? "is-on" : ""}`}>
            <input type="radio" name="team-ask-mode" checked={mode === m} disabled={mode === null} onChange={() => void saveMode(m)} />
            <span><strong>{t(`teamAsk.${m}`)}</strong><span className="muted small">{t(`teamAsk.${m}Hint`)}</span></span>
          </label>
        ))}
      </div>
      {mode === "hierarchy" && (
        sections.length ? (
          <div className="team-ask-leads">
            <p className="small">{t("teamAsk.leads")}</p>
            {sections.map((s) => {
              const list = members(s.id);
              return (
                <label key={s.id} className="team-ask-lead small">
                  <span className="team-ask-section">{s.name}</span>
                  {list.length ? (
                    <select className="input" value={leads[s.id] ?? ""} onChange={(e) => void saveLead(s.id, e.target.value)}>
                      {list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  ) : <span className="muted">{t("teamAsk.noBots")}</span>}
                </label>
              );
            })}
          </div>
        ) : <p className="muted small">{t("teamAsk.noSections")}</p>
      )}
      <div className="team-ask-inherit">
        <div>
          <p className="action-title">{t("teamAsk.inherit")}</p>
          <p className="muted small">{t("teamAsk.inheritHint")}</p>
        </div>
        <Toggle checked={!!inherit} disabled={inherit === null} label={t("teamAsk.inherit")} onChange={(v) => void saveInherit(v)} />
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </div>
  );
}
