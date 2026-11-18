import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errText } from "../api";
import { intlLocale, tn, useT, type Key } from "../i18n";
import { useStore } from "../store";
import { commandStateOf, COMMAND_STATES, type Bot, type CommandCard, type CommandLink, type CommandState, type CommandView as View, type Live } from "../types";
import { filterCards, sortCards, stateCounts, teamOf, visibleLinks, type CommandFilter } from "../lib/command";
import { compactNumber, money, relTime } from "../lib/format";
import { useScreen } from "../lib/screen";
import { activityPhrase } from "./Transcript";
import { BotAvatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { ExchangeModal, LinkLayer, LinkList } from "./CommandLinks";
import { IncidentsSection } from "./Incidents";
import { resumeWidest, setPaused } from "./Pause";
import { Empty, ErrorNote, IconButton, Loading, Modal, useTick } from "./ui";
import "../styles/command.css";

/**
 * « Centre de commandement »: the whole team on one live page — a card per bot (mascot, role, state word, what it does
 * now, its mission, its computer, today's consumption, its last result, open incidents) with its actions, the links
 * between bots working together, and the header's figures. Data: GET /api/command (server/src/command.ts), merged with
 * the live state the event stream already brings (store.live, bots, pauses, computers), and loaded again a moment after
 * an event that changes the cards. Phone: a list; tablet: two columns; wide screen: the canvas with its connectors.
 */

const STATE_ICON: Record<CommandState, IconName> = { working: "bolt", waiting: "hand", error: "alert", paused: "pause", idle: "moon" };
const MISSION_ICON: Record<NonNullable<CommandCard["mission"]>["kind"], IconName> = { goal: "target", bgTask: "bolt", task: "tasks", job: "terminal" };
const WIDE = "(min-width: 1100px)";

function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/** What in the store means the cards changed: turns starting or stopping, waits, pauses, computers, the roster. */
function liveKey(live: Record<string, Live>): string {
  return Object.entries(live).map(([id, l]) => `${id}:${l.running ? 1 : 0}${l.awaiting ? 1 : 0}`).sort().join(",");
}

function useCommand() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const load = useCallback(async () => {
    setBusy(true);
    try { setView(await api<View>("GET", "/command")); setError(null); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }, []);
  const soon = useCallback(() => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => void load(), 1200); }, [load]);
  useEffect(() => {
    void load();
    let key = liveKey(useStore.getState().live);
    const off = useStore.subscribe((s, prev) => {
      const next = s.live === prev.live ? key : liveKey(s.live);
      if (next !== key || s.bots !== prev.bots || s.pauses !== prev.pauses || s.computer !== prev.computer || s.tasks !== prev.tasks || s.usageTick !== prev.usageTick || s.sections !== prev.sections) { key = next; soon(); }
    });
    const again = () => { if (document.visibilityState === "visible") void load(); };
    const poll = window.setInterval(again, 30_000);
    document.addEventListener("visibilitychange", again);
    return () => { off(); window.clearInterval(poll); window.clearTimeout(timer.current); document.removeEventListener("visibilitychange", again); };
  }, [load, soon]);
  return { view, error, busy, load, setError };
}

export function CommandView() {
  const t = useT();
  const { view, error, busy, load, setError } = useCommand();
  const live = useStore((s) => s.live);
  const storeBots = useStore((s) => s.bots);
  const online = useStore((s) => s.online);
  const { setMobileNav, openModal } = useStore.getState();
  const now = useTick(15_000);
  const wide = useWide();
  const [filter, setFilter] = useState<CommandFilter>({ query: "", state: "all", team: "all" });
  const [openLink, setOpenLink] = useState<CommandLink | null>(null);
  const [incidentsOf, setIncidentsOf] = useState<string | null>(null);
  const canvas = useRef<HTMLDivElement>(null);

  // The live state of the stream wins over the answer's (it is newer); the state word follows it.
  const cards = useMemo(() => (view?.cards ?? []).map((c): CommandCard => {
    const l = live[c.botId] ?? c.live;
    const pause = storeBots[c.botId] ? storeBots[c.botId].pause : c.pause;
    return { ...c, live: l, pause, state: commandStateOf({ paused: !!pause, live: l, awaiting: c.awaiting, incidentsWaiting: c.incidentsWaiting ?? 0, missions: c.missions }) };
  }), [view, live, storeBots]);
  const byId = useMemo(() => new Map(cards.map((c) => [c.botId, c])), [cards]);
  const counts = useMemo(() => stateCounts(cards), [cards]);
  const shown = useMemo(() => sortCards(filterCards(cards, filter)), [cards, filter]);
  const links = useMemo(() => visibleLinks(view?.links ?? [], new Set(shown.map((c) => c.botId))), [view, shown]);
  const sections = view?.sections ?? [];
  const groups = useMemo(() => {
    const order = [...sections.map((s) => s.id), "none", "shared"];
    const map = new Map<string, CommandCard[]>();
    for (const c of shown) { const k = teamOf(c); map.set(k, [...(map.get(k) ?? []), c]); }
    return order.filter((k) => map.has(k)).map((k) => ({ id: k, cards: map.get(k)! }));
  }, [shown, sections]);
  const teamName = (id: string) => (id === "shared" ? t("command.filter.shared") : id === "none" ? t("command.filter.noSection") : sections.find((s) => s.id === id)?.name ?? "");
  const owned = cards.some((c) => !c.shared);
  const pausedAll = useStore((s) => !!s.pauses.all) || !!view?.pausedAll;

  return (
    <section className="main tasks-view command-view" aria-label={t("command.title")}>
      <header className="tasks-head cmd-head">
        <IconButton icon="menu" label={t("common.openMenu")} className="only-mobile" onClick={() => setMobileNav(true)} />
        <div className="cmd-heading">
          <h1>{t("command.title")}</h1>
          <p className="cmd-sub">
            <span className={`cmd-live-dot ${online ? "is-on" : ""}`} aria-hidden="true" />
            {online ? t("command.live") : t("command.offline")}<span className="cmd-sub-extra"> · {t("command.subtitle")}</span>
          </p>
        </div>
        {owned && (
          <button type="button" className="btn btn-small cmd-pause-all" title={t(pausedAll ? "command.resumeAll" : "command.pauseAll")} onClick={() => void setPaused({ kind: "all" }, !pausedAll)}>
            <Icon name={pausedAll ? "play" : "pause"} size={14} /><span className="cmd-pause-all-text">{t(pausedAll ? "command.resumeAll" : "command.pauseAll")}</span>
          </button>
        )}
        <IconButton icon="refresh" label={t("command.refresh")} onClick={() => void load()} disabled={busy} className={busy ? "is-spinning" : ""} />
      </header>
      <div className="tasks-body cmd-body">
        <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
        {!view && !error && <Loading label={t("command.loading")} />}
        {view && (
          <>
            <Kpis view={view} />
            {cards.length === 0 ? (
              <div className="cmd-empty">
                <Empty icon="users" title={t("command.empty.title")}>{t("command.empty.text")}</Empty>
                <button type="button" className="btn btn-primary" onClick={() => openModal({ kind: "createBot" })}>{t("command.empty.create")}</button>
              </div>
            ) : (
              <>
                <Toolbar filter={filter} setFilter={setFilter} counts={counts} sections={sections} hasShared={cards.some((c) => c.shared)} hasLoose={cards.some((c) => !c.shared && !c.sectionId)} />
                {shown.length === 0 ? (
                  <div className="cmd-empty">
                    <Empty icon="search" title={t("command.noMatch.title")}>{t("command.noMatch.text")}</Empty>
                    <button type="button" className="btn" onClick={() => setFilter({ query: "", state: "all", team: "all" })}>{t("command.noMatch.reset")}</button>
                  </div>
                ) : (
                  <div className={`cmd-canvas ${wide ? "is-wide" : ""}`} ref={canvas}>
                    {wide && <LinkLayer box={canvas} links={links} cards={byId} now={now} version={`${shown.map((c) => c.botId).join()}|${groups.length}`} onOpen={setOpenLink} />}
                    {groups.map((g) => (
                      <section key={g.id} className="cmd-lane" aria-label={groups.length > 1 || g.id !== "none" ? teamName(g.id) : t("command.title")}>
                        {(groups.length > 1 || g.id !== "none") && (
                          <h2 className="cmd-lane-head">
                            <span>{teamName(g.id)}</span>
                            <span className="cmd-lane-count">{g.cards.length}</span>
                            {sections.find((s) => s.id === g.id)?.paused && <span className="chip cmd-chip-paused"><Icon name="pause" size={11} />{t("command.state.paused")}</span>}
                          </h2>
                        )}
                        <ul className="cmd-grid">
                          {g.cards.map((c) => <li key={c.botId} className="cmd-cell"><BotCard card={c} view={view} now={now} onIncidents={() => setIncidentsOf(c.botId)} /></li>)}
                        </ul>
                      </section>
                    ))}
                  </div>
                )}
                <LinkList links={links} cards={byId} now={now} onOpen={setOpenLink} />
                <p className="cmd-updated">{t("command.updated", { time: relTime(view.generatedAt, Math.max(now, view.generatedAt)) })}</p>
              </>
            )}
          </>
        )}
      </div>
      {openLink && <ExchangeModal link={openLink} cards={byId} now={now} onClose={() => setOpenLink(null)} />}
      {incidentsOf && storeBots[incidentsOf] && (
        <Modal title={t("command.incidentsTitle", { name: storeBots[incidentsOf].name })} onClose={() => { setIncidentsOf(null); void load(); }} size="lg">
          <div className="modal-body"><IncidentsSection bot={storeBots[incidentsOf]} /></div>
        </Modal>
      )}
    </section>
  );
}

function usageText(u: { usd: number; tokens: number }, view: View): string {
  if (view.kpis.display === "tokens") return compactNumber(u.tokens);
  if (view.kpis.display === "eur") {
    const eur = u.usd * (view.kpis.eurPerUsd ?? 1);
    try { return new Intl.NumberFormat(intlLocale(), { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(eur); } catch { return `${eur.toFixed(2)} €`; }
  }
  return money(u.usd);
}

function Kpis({ view }: { view: View }) {
  const t = useT();
  const k = view.kpis;
  const usage = k.display === "eur" && k.usage.eur !== null ? usageText({ usd: k.usage.usd, tokens: k.usage.tokens }, view) : usageText(k.usage, view);
  const items: { icon: IconName; value: string; label: string; tone: string; sub?: string }[] = [
    { icon: "bolt", value: String(k.working), label: t("command.kpi.working"), tone: k.working ? "ok" : "" },
    { icon: "hand", value: String(k.waiting), label: t("command.kpi.waiting"), tone: k.waiting ? "warn" : "" },
    { icon: "alert", value: String(k.incidents), label: t("command.kpi.incidents"), tone: k.incidents ? "danger" : "" },
    { icon: "chart", value: usage, label: t("command.kpi.usage"), tone: "", sub: k.display !== "tokens" && k.usage.tokens ? t("command.kpi.tokens", { n: compactNumber(k.usage.tokens) }) : undefined },
    { icon: "monitor", value: k.computersMax ? `${k.computersOn} / ${k.computersMax}` : "—", label: k.computersMax ? t("command.kpi.computers") : t("command.kpi.computersNone"), tone: "" },
  ];
  return (
    <ul className="cmd-kpis">
      {items.map((i) => (
        <li key={i.label} className={`cmd-kpi ${i.tone ? `is-${i.tone}` : ""}`}>
          <span className="cmd-kpi-icon"><Icon name={i.icon} size={16} /></span>
          <span className="cmd-kpi-value">{i.value}</span>
          <span className="cmd-kpi-label">{i.label}{i.sub && <span className="cmd-kpi-sub"> · {i.sub}</span>}</span>
        </li>
      ))}
    </ul>
  );
}

function Toolbar({ filter, setFilter, counts, sections, hasShared, hasLoose }: {
  filter: CommandFilter; setFilter: (f: CommandFilter) => void; counts: Record<CommandState | "all", number>;
  sections: View["sections"]; hasShared: boolean; hasLoose: boolean;
}) {
  const t = useT();
  const states: (CommandState | "all")[] = ["all", ...COMMAND_STATES];
  return (
    <div className="cmd-toolbar">
      <label className="cmd-search">
        <Icon name="search" size={15} />
        <input className="input" type="search" value={filter.query} placeholder={t("command.search")} aria-label={t("command.searchLabel")} onChange={(e) => setFilter({ ...filter, query: e.target.value })} />
      </label>
      {(sections.length > 0 || hasShared) && (
        <select className="input input-small cmd-team" value={filter.team} aria-label={t("command.filter.team")} onChange={(e) => setFilter({ ...filter, team: e.target.value })}>
          <option value="all">{t("command.filter.allTeams")}</option>
          {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          {hasLoose && sections.length > 0 && <option value="none">{t("command.filter.noSection")}</option>}
          {hasShared && <option value="shared">{t("command.filter.shared")}</option>}
        </select>
      )}
      <div className="cmd-states" role="group" aria-label={t("command.filter.state")}>
        {states.map((s) => (
          <button key={s} type="button" className={`cmd-state-btn ${s !== "all" ? `is-${s}` : ""} ${filter.state === s ? "is-active" : ""}`} aria-pressed={filter.state === s} onClick={() => setFilter({ ...filter, state: s })} disabled={s !== "all" && counts[s] === 0 && filter.state !== s}>
            {s !== "all" && <span className="cmd-state-dot" aria-hidden="true" />}
            {t(`command.state.${s}` as Key)}
            <span className="cmd-state-n">{counts[s]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** What the card says the bot is doing right now. */
function nowLine(c: CommandCard, now: number, t: ReturnType<typeof useT>): { icon: IconName; text: string } {
  if (c.state === "paused" && c.pause) {
    const why = t(`command.pausedBy.${c.pause.by}` as Key);
    return { icon: "pause", text: c.pause.queued ? `${why} · ${tn("command.queued", c.pause.queued)}` : why };
  }
  if (c.live.awaiting) return { icon: "hand", text: c.live.awaiting.reason || t("activity.waiting") };
  if (c.live.running) return { icon: "bolt", text: c.live.caption || activityPhrase(c.live, [], now) };
  if (c.awaiting) return { icon: "hand", text: tn("command.awaiting", c.awaiting) };
  if (c.state === "error") return { icon: "alert", text: t("command.incidentWaiting") };
  if (c.missions) return { icon: "bolt", text: t("command.workingOn") };
  return { icon: "moon", text: t("command.idleSince", { time: relTime(c.lastActivityAt, now) }) };
}

function BotCard({ card: c, view, now, onIncidents }: { card: CommandCard; view: View; now: number; onIncidents: () => void }) {
  const t = useT();
  const bot: Bot | undefined = useStore((s) => s.bots[c.botId]);
  const { selectBot, openViewer, showToast } = useStore.getState();
  const [busy, setBusy] = useState(false);
  const line = nowLine(c, now, t);
  const avatar = { id: c.botId, shape: c.shape, color: c.color, name: c.name, primary: c.primary, character: c.character };
  const running = c.live.running || c.missions > 0;
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } catch (e) { showToast(errText(e)); } finally { setBusy(false); } };
  const stop = () => act(async () => {
    if (!window.confirm(t("command.confirmStop", { name: c.name }))) return;
    await api("POST", `/bots/${c.botId}/stop`);
    showToast(t("command.stopped", { name: c.name }));
  });
  const titleId = `cmd-card-${c.botId}`;
  return (
    <article className={`cmd-card is-${c.state}`} data-card={c.botId} aria-labelledby={titleId}>
      <header className="cmd-card-head">
        <BotAvatar bot={avatar} size={46} badge />
        <div className="cmd-card-id">
          <h3 id={titleId} className="cmd-card-name">{c.name}</h3>
          {(c.label || c.shared) && <p className="cmd-card-role">{c.label || t("command.sharedBy", { owner: c.shared!.ownerName, ws: c.shared!.workspaceName })}</p>}
        </div>
        <span className={`cmd-state is-${c.state}`}><Icon name={STATE_ICON[c.state]} size={12} />{t(`command.state.${c.state}` as Key)}</span>
      </header>

      <p className={`cmd-now is-${c.state} ${c.live.running ? "is-running" : ""}`} aria-live="polite">
        <span className="cmd-now-icon"><Icon name={line.icon} size={13} /></span>
        <span className="cmd-now-text">{line.text}</span>
      </p>

      <div className="cmd-card-mid">
        <div className="cmd-mission">
          <p className="cmd-label">{t("command.mission")}{c.missions > 1 && <span className="cmd-more">{t("command.missionMore", { n: c.missions - 1 })}</span>}</p>
          {c.mission ? (
            <p className="cmd-mission-title"><Icon name={MISSION_ICON[c.mission.kind]} size={13} /><span><span className="sr-only">{t(`command.mission.${c.mission.kind}` as Key)} : </span>{c.mission.title}</span></p>
          ) : <p className="cmd-muted">{t("command.noMission")}</p>}
        </div>
        {c.computer?.power === "on" && c.can.computer && <Screen card={c} />}
      </div>

      <dl className="cmd-facts">
        {c.computer && (
          <div className={`cmd-fact is-computer is-${c.computer.power}`}>
            <dt className="sr-only">{t("details.computer")}</dt>
            <dd><span className="cmd-power" aria-hidden="true" />{c.computer.shared && c.computer.name ? t("command.computer.shared", { name: c.computer.name }) : t(`command.computer.${c.computer.power}` as Key)}</dd>
          </div>
        )}
        {c.usage && (
          <div className="cmd-fact">
            <dt>{t("command.usageToday")}</dt>
            <dd className="cmd-num">{usageText(c.usage, view)}</dd>
          </div>
        )}
        {c.incidents !== null && (
          <div className={`cmd-fact ${c.incidents ? "is-incidents" : ""}`}>
            <dt className="sr-only">{t("command.kpi.incidents")}</dt>
            <dd>{c.incidents ? tn("command.incidents", c.incidents) : t("command.noIncident")}</dd>
          </div>
        )}
      </dl>

      <div className="cmd-result">
        <p className="cmd-label">{t("command.lastResult")}{c.lastResult && <span className="cmd-when"> · {relTime(c.lastResult.at, now)}</span>}</p>
        {c.lastResult ? <p className="cmd-result-title"><Icon name="check" size={13} /><span>{c.lastResult.title}</span></p> : <p className="cmd-muted">{t("command.noResult")}</p>}
      </div>

      <footer className="cmd-actions">
        <button type="button" className={`btn btn-small ${c.state === "waiting" ? "btn-primary" : ""} cmd-open`} onClick={() => selectBot(c.botId)} disabled={!bot}>
          <Icon name="chat" size={14} />{t(c.state === "waiting" ? "command.action.answer" : "command.action.chat")}
        </button>
        <span className="cmd-actions-tools">
          {c.can.pause && bot && (c.pause
            ? <IconButton icon="play" label={t("command.action.resume")} onClick={() => void act(() => resumeWidest(bot))} disabled={busy} />
            : <IconButton icon="pause" label={t("command.action.pause")} onClick={() => void act(() => setPaused({ kind: "bot", bot }, true))} disabled={busy} />)}
          {c.can.stop && running && !c.pause && <IconButton icon="stop" label={t("command.action.stop")} onClick={() => void stop()} disabled={busy} />}
          {c.can.computer && c.computer && <IconButton icon="monitor" label={t("command.action.computer")} onClick={() => openViewer(c.botId)} />}
          {c.can.incidents && bot && (
            <button type="button" className={`icon-btn cmd-incidents-btn ${c.incidents ? "has-count" : ""}`} onClick={onIncidents} aria-label={`${t("command.action.incidents")}${c.incidents ? ` (${c.incidents})` : ""}`} title={t("command.action.incidents")}>
              <Icon name="alert" size={16} />
              {!!c.incidents && <span className="cmd-incidents-n" aria-hidden="true">{c.incidents}</span>}
            </button>
          )}
        </span>
      </footer>
    </article>
  );
}

/** The computer's screen, small and live — fetched only while the card is on screen and the computer on. */
function Screen({ card: c }: { card: CommandCard }) {
  const t = useT();
  const box = useRef<HTMLButtonElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const io = new IntersectionObserver((es) => setSeen(es.some((e) => e.isIntersecting)), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const on = c.computer?.power === "on";
  const { url, status } = useScreen(c.botId, 20_000, on && seen);
  return (
    <button ref={box} type="button" className={`cmd-screen ${on ? "is-on" : ""}`} onClick={() => useStore.getState().openViewer(c.botId)} aria-label={t("command.action.computer")} title={t("command.action.computer")}>
      {on && url && status === "ok" ? <img src={url} alt={t("command.computer.screen", { name: c.name })} /> : <Icon name="monitor" size={18} />}
    </button>
  );
}
