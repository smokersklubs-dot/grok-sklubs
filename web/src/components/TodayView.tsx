import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { api, errText } from "../api";
import { intlLocale, tn, useT, type Key } from "../i18n";
import { useStore } from "../store";
import { compactNumber, money, relTime } from "../lib/format";
import { DEFAULT_MINUTES, FILES_PER_TURN, MAX_MINUTES, RESEARCH_GAP_MIN, RESEARCH_MIN_READS, TODAY_KINDS } from "../types";
import type { TodayBotDone, TodayDone, TodayKind, TodayLink, TodayNeed, TodayReport, TodaySettingsView } from "../types";
import { BotAvatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { ErrorNote, IconButton, Loading, Toggle, useTick } from "./ui";

/**
 * "Aujourd'hui": one page for the day — what only you can fix, what the bots finished (by bot), the time it saved as an
 * estimate (with its formula) and what the day cost. Data: GET /api/today (server/src/today.ts).
 */

const NEED_ICON: Record<TodayNeed["kind"], IconName> = {
  approval: "shield", question: "chat", cap: "chart", spend: "chart", paused: "pause", stalled: "clock", silent: "clock", continue: "play",
  routine: "alert", connector: "plug", disk: "folder", takeover: "hand", secret: "key", uncertain: "alert", goal: "target", review: "eye", plan: "star", incident: "shield",
};
const DONE_ICON: Record<TodayKind, IconName> = {
  task: "tasks", bgTask: "bolt", goal: "target", routine: "clock", job: "terminal", fileEdit: "file", emailSent: "mail",
  messagePosted: "chat", eventBooked: "calendar", pagePublished: "globe", research: "search",
};

/** "1 h 25", "45 min". */
export function useMinutes() {
  const t = useT();
  return (m: number) => (m < 60 ? t("today.min", { m }) : m % 60 ? t("today.hm", { h: Math.floor(m / 60), m: String(m % 60).padStart(2, "0") }) : t("today.h", { h: m / 60 }));
}

/** The day before a YYYY-MM-DD date. */
function dayBefore(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

function openLink(link: TodayLink | null) {
  if (!link) return;
  const s = useStore.getState();
  if (link.kind === "settings") return s.openAppSettings(link.section);
  if (link.kind === "surveillance") return s.setView("surveillance");
  if (!s.bots[link.botId]) return;
  if (link.kind === "botSettings") return s.openBotSettings(link.botId, link.tab);
  if (link.kind === "bot") return s.selectBot(link.botId);
  if (link.thread) {
    s.jumpTo(link.botId, link.thread);
    s.openThreadPanel(link.botId, link.thread);
  } else s.jumpTo(link.botId, link.seq);
}

type Day = "today" | "yesterday";

export function TodayView() {
  const t = useT();
  const fmtMin = useMinutes();
  const bots = useStore((s) => s.bots);
  const { setMobileNav, loadToday, openAppSettings } = useStore.getState();
  const [day, setDay] = useState<Day>("today");
  const [todayDate, setTodayDate] = useState<string | null>(null);
  const [report, setReport] = useState<TodayReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useTick(30_000);

  const load = useCallback(async (which: Day, known: string | null) => {
    setBusy(true);
    try {
      let r: TodayReport;
      if (which === "today") {
        r = await loadToday();
        setTodayDate(r.date);
      } else {
        const base = known ?? (await loadToday()).date;
        setTodayDate(base);
        r = await api<TodayReport>("GET", `/today?date=${dayBefore(base)}`);
      }
      setReport(r);
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }, [loadToday]);

  useEffect(() => { void load(day, todayDate); }, [day]); // eslint-disable-line react-hooks/exhaustive-deps
  // Fresh while it is open: every minute, and when the window comes back.
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible") void load(day, todayDate); };
    const timer = window.setInterval(again, 60_000);
    document.addEventListener("visibilitychange", again);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", again); };
  }, [day, todayDate, load]);

  const dateTitle = useMemo(() => {
    if (!report) return "";
    try {
      return new Intl.DateTimeFormat(intlLocale(), { weekday: "long", day: "numeric", month: "long", timeZone: report.timezone }).format(new Date(report.start + 3_600_000));
    } catch { return report.date; }
  }, [report]);
  const clock = useCallback((ts: number) => {
    try { return new Intl.DateTimeFormat(intlLocale(), { hour: "numeric", minute: "2-digit", timeZone: report?.timezone }).format(new Date(ts)); } catch { return ""; }
  }, [report?.timezone]);

  const doneCount = report?.done.reduce((a, g) => a + g.items.length, 0) ?? 0;
  const spent = report ? report.cost.usd + report.cost.estimatedUsd : 0;

  return (
    <section className="main tasks-view today-view" aria-label={t("today.title")}>
      <header className="tasks-head today-head">
        <IconButton icon="menu" label={t("common.openMenu")} className="only-mobile" onClick={() => setMobileNav(true)} />
        <div className="today-heading">
          <h1>{t("today.title")}</h1>
          {report && <p className="today-date">{dateTitle}</p>}
        </div>
        <div className="segmented" role="group" aria-label={t("today.dayLabel")}>
          {(["yesterday", "today"] as const).map((d) => (
            <button key={d} type="button" className={day === d ? "is-active" : ""} aria-pressed={day === d} onClick={() => setDay(d)}>
              {t(d === "today" ? "today.today" : "today.yesterday")}
            </button>
          ))}
        </div>
        <IconButton icon="refresh" label={t("today.refresh")} onClick={() => void load(day, todayDate)} disabled={busy} className={busy ? "is-spinning" : ""} />
      </header>
      <div className="tasks-body today-body">
        <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
        {!report && !error && <Loading label={t("today.loading")} />}
        {report && (
          <div className="today-grid">
            <div className="today-stats" role="list">
              <Stat icon="bell" tone={report.needs.length ? "warn" : "ok"} value={String(report.needs.length)} label={t("today.stat.needs")} />
              <Stat icon="tasks" tone="ok" value={String(doneCount)} label={t("today.stat.done")} />
              <Stat icon="clock" value={`≈ ${fmtMin(report.minutes.total)}`} label={t("today.stat.saved")} />
              <Stat icon="chart" value={money(spent)} label={t("today.stat.cost")} />
            </div>

            <Block icon="bell" title={t("today.needs.title")} hint={report.today ? null : t("today.needs.now")} count={report.needs.length}>
              {report.needs.length === 0 ? (
                <EmptyLine icon="smile" title={t("today.needs.emptyTitle")} text={t("today.needs.emptyText")} />
              ) : (
                <ul className="today-list">
                  {report.needs.map((n, i) => <NeedRow key={`${n.kind}:${n.botId}:${n.at}:${i}`} need={n} now={now} hasBot={!n.botId || !!bots[n.botId]} />)}
                </ul>
              )}
            </Block>

            <Block icon="tasks" title={t("today.done.title")} count={doneCount}>
              {report.done.length === 0 ? (
                <EmptyLine icon="tasks" title={t(report.today ? "today.done.emptyTitle" : "today.done.emptyTitleYesterday")} text={t("today.done.emptyText")} />
              ) : (
                <div className="today-groups">
                  {report.done.map((g) => <BotGroup key={g.botId} group={g} clock={clock} />)}
                </div>
              )}
            </Block>

            <Block icon="clock" title={t("today.saved.title")} badge={t("today.saved.estimate")}>
              <SavedBlock report={report} onEdit={() => openAppSettings("today")} />
            </Block>

            <Block icon="chart" title={t("today.cost.title")}>
              <CostBlock report={report} onMore={() => openAppSettings("usage")} />
            </Block>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ icon, value, label, tone }: { icon: IconName; value: string; label: string; tone?: "ok" | "warn" }) {
  return (
    <div className={`today-stat ${tone ? `is-${tone}` : ""}`} role="listitem">
      <Icon name={icon} size={16} />
      <span className="today-stat-value">{value}</span>
      <span className="today-stat-label">{label}</span>
    </div>
  );
}

function Block({ icon, title, count, hint, badge, children }: { icon: IconName; title: string; count?: number; hint?: string | null; badge?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="today-block" aria-labelledby={id}>
      <header className="today-block-head">
        <Icon name={icon} size={17} />
        <h2 id={id}>{title}</h2>
        {count !== undefined && count > 0 && <span className="count-badge">{count}</span>}
        {badge && <span className="chip today-estimate">{badge}</span>}
        {hint && <span className="today-block-hint">{hint}</span>}
      </header>
      {children}
    </section>
  );
}

function EmptyLine({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <div className="today-empty">
      <Icon name={icon} size={22} />
      <div>
        <p className="today-empty-title">{title}</p>
        <p className="today-empty-text">{text}</p>
      </div>
    </div>
  );
}

function NeedRow({ need, now, hasBot }: { need: TodayNeed; now: number; hasBot: boolean }) {
  const t = useT();
  const bot = useStore((s) => (need.botId ? s.bots[need.botId] : undefined));
  const kindLabel = t(`today.need.${need.kind}` as Key);
  const title = need.kind === "paused" ? tn("today.need.pausedTitle", need.count ?? 0) : need.kind === "plan" ? t(`today.plan.${need.title === "budget" || need.title === "suspended" ? need.title : "past_due"}` as Key) : need.kind === "disk" ? t("today.need.diskTitle", { pct: need.title }) : need.title;
  return (
    <li>
      <button type="button" className={`today-row is-need is-${need.kind}`} onClick={() => openLink(need.link)} disabled={!hasBot}>
        <span className="today-row-icon"><Icon name={NEED_ICON[need.kind]} size={17} /></span>
        <span className="today-row-main">
          <span className="today-row-title">{title || kindLabel}</span>
          {need.detail && need.kind !== "cap" && <span className="today-row-detail">{need.detail}</span>}
          <span className="today-row-meta">
            <span className="today-kind">{kindLabel}</span>
            {bot && (<><span aria-hidden="true">·</span><BotAvatar bot={bot} size={14} /> {bot.name}</>)}
            {!bot && need.botName && (<><span aria-hidden="true">·</span>{need.botName}</>)}
            {need.shared && <span className="chip">{t("today.shared")}</span>}
            <span aria-hidden="true">·</span>
            {relTime(need.at, now)}
          </span>
        </span>
        <span className="today-go">{t(need.link.kind === "settings" || need.link.kind === "botSettings" ? "today.fix" : "today.open")}<Icon name="external" size={13} /></span>
      </button>
    </li>
  );
}

function BotGroup({ group, clock }: { group: TodayBotDone; clock: (ts: number) => string }) {
  const t = useT();
  const fmtMin = useMinutes();
  const bot = useStore((s) => s.bots[group.botId]);
  const [open, setOpen] = useState(group.items.length <= 6);
  const shown = open ? group.items : group.items.slice(0, 5);
  return (
    <div className="today-group">
      <button type="button" className="today-group-head" onClick={() => bot && useStore.getState().selectBot(bot.id)} disabled={!bot}>
        {bot ? <BotAvatar bot={bot} size={26} /> : <span className="today-row-icon"><Icon name="user" size={16} /></span>}
        <span className="today-group-name">{group.botName || t("common.removedBot")}</span>
        {group.shared && <span className="chip">{t("today.shared")}</span>}
        <span className="today-group-count">{tn("today.done.count", group.items.length)}</span>
        {group.minutes > 0 && <span className="chip chip-ok">≈ {fmtMin(group.minutes)}</span>}
      </button>
      <ul className="today-list is-compact">
        {shown.map((i, n) => <DoneRow key={`${i.kind}:${i.at}:${n}`} item={i} clock={clock} />)}
      </ul>
      {group.items.length > shown.length && (
        <button type="button" className="link today-more" onClick={() => setOpen(true)}>{tn("today.done.more", group.items.length - shown.length)}</button>
      )}
    </div>
  );
}

function DoneRow({ item, clock }: { item: TodayDone; clock: (ts: number) => string }) {
  const t = useT();
  const title = item.kind === "fileEdit" ? tn("today.done.files", item.count) : item.kind === "research" ? tn("today.done.research", item.count) : item.title;
  const detail = item.kind === "fileEdit" ? (item.detail === "undone" ? t("today.done.filesUndone") : item.title) : item.kind === "research" ? item.title : item.detail;
  return (
    <li>
      <button type="button" className="today-row is-done" onClick={() => openLink(item.link)} disabled={!item.link}>
        <span className="today-row-icon"><Icon name={DONE_ICON[item.kind]} size={16} /></span>
        <span className="today-row-main">
          <span className="today-row-title">{title}</span>
          {detail && <span className="today-row-detail">{detail}</span>}
          <span className="today-row-meta"><span className="today-kind">{t(`today.kind.${item.kind}` as Key)}</span><span aria-hidden="true">·</span>{clock(item.at)}</span>
        </span>
        {item.minutes > 0 && <span className="today-minutes">+{item.minutes} min</span>}
      </button>
    </li>
  );
}

function SavedBlock({ report, onEdit }: { report: TodayReport; onEdit: () => void }) {
  const t = useT();
  const fmtMin = useMinutes();
  const lines = TODAY_KINDS.filter((k) => (report.minutes.counts[k] ?? 0) > 0);
  return (
    <div className="today-saved">
      <p className="today-saved-total">≈ {fmtMin(report.minutes.total)}</p>
      {lines.length === 0 ? (
        <p className="today-empty-text">{t("today.saved.empty")}</p>
      ) : (
        <table className="today-formula">
          <caption className="sr-only">{t("today.saved.formula")}</caption>
          <tbody>
            {lines.map((k) => {
              const n = report.minutes.counts[k] ?? 0;
              const per = report.minutes.table[k];
              return (
                <tr key={k}>
                  <th scope="row">{t(`today.kind.${k}` as Key)}{report.minutes.overridden.includes(k) && <span className="today-own" title={t("today.saved.yours")}> *</span>}</th>
                  <td className="num">{n} × {per} min</td>
                  <td className="num today-formula-sum">{fmtMin(n * per)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="today-note">{t("today.saved.how", { files: FILES_PER_TURN, reads: RESEARCH_MIN_READS, gap: RESEARCH_GAP_MIN })}</p>
      <button type="button" className="btn btn-small" onClick={onEdit}><Icon name="edit" size={14} /> {t("today.saved.edit")}</button>
    </div>
  );
}

function CostBlock({ report, onMore }: { report: TodayReport; onMore: () => void }) {
  const t = useT();
  const c = report.cost;
  const total = c.usd + c.estimatedUsd;
  const max = Math.max(...c.byBot.map((b) => b.usd), 0.000001);
  if (c.turns === 0) return <EmptyLine icon="chart" title={t("today.cost.emptyTitle")} text={t("today.cost.emptyText")} />;
  return (
    <div className="today-cost">
      <div className="today-cost-top">
        <p className="today-saved-total">{money(total)}</p>
        <p className="today-note">{t("today.cost.tokens", { in: compactNumber(c.inputTokens), out: compactNumber(c.outputTokens), turns: c.turns })}</p>
      </div>
      {c.estimatedUsd > 0 && <p className="today-note">{t("today.cost.estimated", { amount: money(c.estimatedUsd) })}</p>}
      {c.subscriptionTokens > 0 && <p className="today-note">{t("today.cost.subscription", { n: compactNumber(c.subscriptionTokens) })}</p>}
      {c.hosted && <p className="today-note">{t(c.hosted.budgetLeftEur >= 0 ? "today.cost.hosted" : "today.cost.hostedNoBudget", { spent: c.hosted.spentEur.toFixed(2), left: c.hosted.budgetLeftEur.toFixed(2) })}</p>}
      {c.byBot.length > 0 && (
        <ul className="today-bars">
          {c.byBot.slice(0, 6).map((b) => (
            <li key={b.botId}>
              <span className="today-bar-name truncate">{b.botName || t("common.removedBot")}</span>
              <span className="today-bar" aria-hidden="true"><span style={{ width: `${Math.max(3, (b.usd / max) * 100)}%` }} /></span>
              <span className="today-bar-value">{money(b.usd)}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="link" onClick={onMore}>{t("today.cost.more")}</button>
    </div>
  );
}

// ── Settings → Aujourd'hui ──────────────────────────────────────────────────────────────────────────────────────
export function TodaySettingsSection() {
  const t = useT();
  const id = useId();
  const [view, setView] = useState<TodaySettingsView | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const fill = (v: TodaySettingsView) => {
    setView(v);
    setDraft(Object.fromEntries(TODAY_KINDS.map((k) => [k, String(v.overrides[k] ?? v.defaults[k])])));
  };
  useEffect(() => { api<TodaySettingsView>("GET", "/today/settings").then(fill, (e: unknown) => setError(errText(e))); }, []);
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 2200);
    return () => window.clearTimeout(timer);
  }, [note]);

  const put = async (body: { minutes?: Record<string, number | null>; digest?: Partial<TodaySettingsView["digest"]> }) => {
    setError(null);
    try {
      fill(await api<TodaySettingsView>("PUT", "/today/settings", body));
      setNote(t("common.saved"));
      void useStore.getState().loadToday().catch(() => undefined);
    } catch (e) { setError(errText(e)); }
  };
  const saveMinutes = () => {
    const minutes: Record<string, number> = {};
    for (const k of TODAY_KINDS) {
      const n = Number(draft[k]);
      if (!Number.isFinite(n) || n < 0 || n > MAX_MINUTES) { setError(t("today.settings.minutesRange", { max: MAX_MINUTES })); return; }
      minutes[k] = Math.round(n);
    }
    void put({ minutes });
  };

  return (
    <>
      <h2>{t("settings.section.today")}</h2>
      <p className="muted">{t("today.settings.intro")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {note && <p className="muted small" role="status">{note}</p>}
      {!view && !error && <Loading />}
      {view && (
        <>
          <h3 className="pane-heading">{t("today.settings.digest")}</h3>
          <div className="action-row">
            <div>
              <p className="action-title">{t("today.settings.digestToggle")}</p>
              <p className="muted small">{t(view.digest.enabled ? "today.settings.digestOn" : "today.settings.digestOff", { hour: view.digest.hour, tz: view.timezone })}</p>
            </div>
            <Toggle checked={view.digest.enabled} label={t("today.settings.digestToggle")} onChange={(v) => void put({ digest: { enabled: v } })} />
          </div>
          <div className="today-settings-row">
            <label htmlFor={`${id}h`}>{t("today.settings.hour")}</label>
            <select id={`${id}h`} className="input input-narrow" value={view.digest.hour} onChange={(e) => void put({ digest: { hour: Number(e.target.value) } })}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{t("today.settings.hourOption", { h: String(h).padStart(2, "0") })}</option>)}
            </select>
            <span className="muted small">{t("today.settings.timezone", { tz: view.timezone })}</span>
          </div>
          <div className="action-row">
            <div>
              <p className="action-title">{t("today.settings.push")}</p>
              <p className="muted small">{view.pushDevices ? tn("today.settings.pushDevices", view.pushDevices) : t("today.settings.pushNone")}</p>
            </div>
            <Toggle checked={view.digest.push} label={t("today.settings.push")} onChange={(v) => void put({ digest: { push: v } })} />
          </div>
          <div className="action-row">
            <div>
              <p className="action-title">{t("today.settings.email")}</p>
              <p className="muted small">{view.mailConfigured ? t("today.settings.emailOk") : t("today.settings.emailNone")}</p>
            </div>
            <Toggle checked={view.digest.email && view.mailConfigured} disabled={!view.mailConfigured} label={t("today.settings.email")} onChange={(v) => void put({ digest: { email: v } })} />
          </div>
          <p className="muted small">{t("today.settings.digestHow")}</p>

          <h3 className="pane-heading">{t("today.settings.minutes")}</h3>
          <p className="muted small">{t("today.settings.minutesIntro")}</p>
          <table className="today-minutes-table">
            <thead><tr><th scope="col">{t("today.settings.kind")}</th><th scope="col">{t("today.settings.perResult")}</th><th scope="col"><span className="sr-only">{t("today.settings.reset")}</span></th></tr></thead>
            <tbody>
              {TODAY_KINDS.map((k) => (
                <tr key={k}>
                  <th scope="row">
                    <label htmlFor={`${id}${k}`}>{t(`today.kind.${k}` as Key)}</label>
                    <span className="muted small today-kind-help">{t(`today.help.${k}` as Key, { files: FILES_PER_TURN, reads: RESEARCH_MIN_READS, gap: RESEARCH_GAP_MIN })}</span>
                  </th>
                  <td>
                    <input id={`${id}${k}`} className="input input-narrow" type="number" min={0} max={MAX_MINUTES} step={1} inputMode="numeric" value={draft[k] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
                    <span className="muted small"> min</span>
                  </td>
                  <td>
                    {view.overrides[k] !== undefined && (
                      <button type="button" className="link" onClick={() => void put({ minutes: { [k]: null } })} title={t("today.settings.defaultIs", { n: DEFAULT_MINUTES[k] })}>{t("today.settings.reset")}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn btn-primary btn-small" onClick={saveMinutes}>{t("today.settings.save")}</button>
        </>
      )}
    </>
  );
}
