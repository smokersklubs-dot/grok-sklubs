import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { compactNumber, shortDate } from "../lib/format";
import type { Bot, ConversationSummary, Memory, PromptView, SemanticSetting } from "../types";
import { ErrorNote, Loading, Toggle } from "./ui";

/*
 * Mémoire, vague L71–L138 :
 *  - « Voir le résumé » du dernier compactage (L80/L138) ;
 *  - « Ne rien retenir » pour un bot (L88) ;
 *  - « Ajouter à ma fiche » sur une note (L88, la fiche sur moi commune à tous les bots) ;
 *  - « Ce que reçoit ce bot » : les consignes dans l’ordre, chaque morceau ouvrable, et ce que le bot voit de sa mémoire
 *    avec son coût (L137) ;
 *  - « Mémoire par le sens », désactivée par défaut, qui dit à qui les notes sont envoyées (L71).
 */

/** « Voir le résumé »: the latest summary of the current conversation, read from the server when asked. */
export function SummaryView({ bot, tick, defaultOpen = false }: { bot: Bot; tick: number | null; defaultOpen?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [s, setS] = useState<ConversationSummary | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let dead = false;
    api<{ summary: ConversationSummary | null }>("GET", `/bots/${bot.id}/summary`).then((r) => !dead && setS(r.summary), (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [open, bot.id, tick]);
  return (
    <div className="memx-summary">
      <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>{t(open ? "memx.hideSummary" : "memx.seeSummary")}</button>
      {open && (
        <div className="memx-summary-box">
          <ErrorNote>{error}</ErrorNote>
          {s === undefined && !error && <Loading />}
          {s === null && <p className="muted small">{t("memx.noSummary")}</p>}
          {s && <>
            <p className="muted small">{t("memx.summaryMeta", { date: shortDate(s.at), before: s.before, after: s.after })}</p>
            <pre className="memx-pre">{s.summary}</pre>
          </>}
        </div>
      )}
    </div>
  );
}

/** « Ne rien retenir » for one bot (its value comes with « Ce que reçoit ce bot »). */
export function NoLearnRow({ bot, initial }: { bot: Bot; initial: boolean | null }) {
  const t = useT();
  const [on, setOn] = useState<boolean | null>(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setOn(initial), [initial]);
  const save = async (next: boolean) => {
    setError(null);
    setOn(next);
    try { setOn((await api<{ noLearn: boolean }>("PUT", `/bots/${bot.id}/memory-prefs`, { noLearn: next })).noLearn); } catch (e) { setOn(!next); setError(errText(e)); }
  };
  return (
    <div className="action-row">
      <div>
        <p className="action-title">{t("memx.noLearn")}</p>
        <p className="muted small">{t("memx.noLearnHint", { name: bot.name })}</p>
        <ErrorNote>{error}</ErrorNote>
      </div>
      <Toggle checked={!!on} disabled={on === null} label={t("memx.noLearn")} onChange={(v) => void save(v)} />
    </div>
  );
}

/** « Ajouter à ma fiche »: the note goes into the shared profile every bot of the owner reads. */
export function ToProfileButton({ memory, onDone }: { memory: Memory; onDone: (text: string) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      const r = await api<{ already?: boolean }>("POST", `/memories/${memory.id}/to-profile`);
      onDone(t(r.already ? "memx.toProfileAlready" : "memx.toProfileDone"));
    } catch (e) { onDone(errText(e)); } finally { setBusy(false); }
  };
  return <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => void add()} aria-label={t("memx.toProfileLabel", { text: memory.text.slice(0, 60) })}>{t("memx.toProfile")}</button>;
}

/** « Ce que reçoit ce bot »: its instructions in order, each part openable, and what it sees of its memory, with the cost. */
export function PromptInspector({ bot, tick, onView }: { bot: Bot; tick: number; onView?: (v: PromptView) => void }) {
  const t = useT();
  const [v, setV] = useState<PromptView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    api<PromptView>("GET", `/bots/${bot.id}/prompt-view`).then((r) => { if (dead) return; setV(r); onView?.(r); }, (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id, tick]);
  const title = (s: string) => (s === "Who the bot is" ? t("memx.partIntro") : s === "For this message" ? t("memx.partTurn") : s);
  return (
    <section className="memx-inspect" aria-labelledby={`memx-${bot.id}`}>
      <h3 className="pane-heading" id={`memx-${bot.id}`}>{t("memx.inspect")}</h3>
      <p className="muted small">{t("memx.inspectHint", { name: bot.name })}</p>
      <ErrorNote>{error}</ErrorNote>
      {!v && !error && <Loading />}
      {v && <>
        <div className="memx-cost">
          <p className="action-title">{t("memx.memSeen", { name: bot.name })}</p>
          <p className="muted small">{t("memx.memLine", { total: v.memory.total, shown: v.memory.shown, hidden: v.memory.hidden, tokens: compactNumber(v.memory.tokens) })}</p>
          <p className="muted small">{t("memx.ctxLine", { tokens: compactNumber(v.context.tokens), percent: v.context.percent })}</p>
          {v.profileShared && <p className="muted small">{t("memx.profileShared")}</p>}
        </div>
        <p className="small memx-total">{t("memx.total", { count: v.parts.length, tokens: compactNumber(v.totalTokens) })}</p>
        <ol className="memx-parts">
          {v.parts.map((p, i) => (
            <li key={i}>
              <details>
                <summary>
                  <span className="memx-part-title">{title(p.title)}</span>
                  <span className={`chip ${p.kind === "turn" ? "" : "chip-quiet"}`}>{t(p.kind === "turn" ? "memx.turn" : "memx.fixed")}</span>
                  <span className="muted small memx-part-size">{t("memx.part", { tokens: compactNumber(p.tokens) })}</span>
                </summary>
                <pre className="memx-pre">{p.text}</pre>
              </details>
            </li>
          ))}
        </ol>
        <p className="muted small">{t("memx.approx")}</p>
      </>}
    </section>
  );
}

/** Settings → Memory: « Mémoire par le sens », off by default; says plainly where the notes go when it is on. */
export function SemanticRow() {
  const t = useT();
  const [s, setS] = useState<SemanticSetting | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<SemanticSetting>("GET", "/memory/semantic").then(setS, (e) => setError(errText(e))); }, []);
  const save = async (on: boolean) => {
    setError(null);
    try { setS(await api<SemanticSetting>("PUT", "/memory/semantic", { enabled: on })); } catch (e) { setError(errText(e)); }
  };
  return (
    <div className="action-row">
      <div>
        <p className="action-title">{t("memx.semantic")}</p>
        <p className="muted small">{t("memx.semanticHint", { provider: s?.provider ?? t("memx.semanticYourProvider") })}</p>
        {s && !s.provider && <p className="muted small">{t("memx.semanticNone")}</p>}
        {s?.enabled && s.provider && <p className="small">{t("memx.semanticOn", { provider: s.provider, model: s.model ?? "" })}</p>}
        <ErrorNote>{error}</ErrorNote>
      </div>
      <Toggle checked={!!s?.enabled} disabled={!s || (!s.enabled && !s.provider)} label={t("memx.semantic")} onChange={(on) => void save(on)} />
    </div>
  );
}
