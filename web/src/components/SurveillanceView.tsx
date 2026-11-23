import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import { dateTime, relTime } from "../lib/format";
import type { SentinelHealth, SentinelIncidentView, SentinelLink, SentinelOverview, SentinelSettingsView, SentinelSeverity } from "../types";
import { Icon, type IconName } from "./Icon";
import { ErrorNote, IconButton, Loading, Toggle, useTick } from "./ui";
import { SubLimitList } from "./SubLimit";
import { ReportsSection } from "./ReportsSection";
import "../styles/surveillance.css";

/**
 * Page « Surveillance » (owner and hosted operators only; server: server/src/sentinel/). What the Sentinelle found: the
 * incidents still open (severity, how many, a 24-hour sparkline, Acquitter / Ouvrir), the history of resolved ones, and
 * the /api/health/deep checks. Read-only for everything but "Acquitter". Settings: Réglages → Surveillance.
 */

const SEV_ICON: Record<SentinelSeverity, IconName> = { critical: "alert", warn: "bell", info: "info" };

export function openSentinelLink(link: SentinelLink | null) {
  if (!link) return;
  const s = useStore.getState();
  if (link.kind === "health") {
    document.getElementById("surveillance-health")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (link.kind === "settings") return s.openAppSettings(link.section);
  if (!s.bots[link.botId]) return;
  if (link.kind === "botSettings") return s.openBotSettings(link.botId, link.tab);
  s.selectBot(link.botId);
}

export function SurveillanceView() {
  const t = useT();
  const { setMobileNav, openAppSettings } = useStore.getState();
  const [data, setData] = useState<SentinelOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const now = useTick(30_000);

  const load = useCallback(async () => {
    try {
      setData(await api<SentinelOverview>("GET", "/surveillance"));
      setError(null);
    } catch (e) { setError(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(again, 60_000);
    document.addEventListener("visibilitychange", again);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", again); };
  }, [load]);

  const run = async (fn: () => Promise<SentinelOverview>) => {
    setBusy(true);
    try { setData(await fn()); setError(null); void useStore.getState().loadToday().catch(() => undefined); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const scanNow = () => run(() => api<SentinelOverview>("POST", "/surveillance/scan"));
  const ack = (id: string) => run(() => api<SentinelOverview>("POST", `/surveillance/incidents/${enc(id)}/ack`));

  const open = data?.incidents ?? [];
  const status: "ok" | "warn" | "critical" = data?.counts.critical ? "critical" : data?.counts.warn ? "warn" : "ok";

  return (
    <section className="main tasks-view today-view surveillance-view" aria-label={t("surv.title")}>
      <header className="tasks-head today-head">
        <IconButton icon="menu" label={t("common.openMenu")} className="only-mobile" onClick={() => setMobileNav(true)} />
        <div className="today-heading">
          <h1>{t("surv.title")}</h1>
          <p className="today-date">{data?.lastScan ? t("surv.lastScan", { when: relTime(data.lastScan.at, now) }) : t("surv.noScanYet")}</p>
        </div>
        <button type="button" className={`btn btn-small surv-scan ${busy ? "is-spinning" : ""}`} onClick={() => void scanNow()} disabled={busy} aria-label={t("surv.scanNow")}>
          <Icon name="refresh" size={14} /> <span className="surv-scan-label">{t("surv.scanNow")}</span>
        </button>
        <IconButton icon="settings" label={t("surv.settings")} onClick={() => openAppSettings("surveillance")} />
      </header>
      <div className="tasks-body today-body">
        <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
        {!data && !error && <Loading label={t("surv.loading")} />}
        {data && (
          <div className="surv-grid">
            <div className={`surv-banner is-${status}`} role="status">
              <Icon name={status === "ok" ? "check" : status === "critical" ? "alert" : "bell"} size={20} />
              <div>
                <p className="surv-banner-title">{t(`surv.status.${status}` as Key)}</p>
                <p className="surv-banner-text">{data.everyMin > 0 ? t("surv.every", { min: data.everyMin }) : t("surv.off")}{data.everyMin > 0 && data.nextScanAt ? ` ${t("surv.next", { min: Math.max(1, Math.round((data.nextScanAt - Date.now()) / 60_000)) })}` : ""}</p>
              </div>
            </div>
            <div className="today-stats surv-stats" role="list">
              <Stat icon="alert" tone={data.counts.critical ? "danger" : undefined} value={data.counts.critical} label={t("surv.stat.critical")} />
              <Stat icon="bell" tone={data.counts.warn ? "warn" : undefined} value={data.counts.warn} label={t("surv.stat.warn")} />
              <Stat icon="info" value={data.counts.info} label={t("surv.stat.info")} />
              <Stat icon="check" tone="ok" value={data.history.filter((h) => (h.resolvedAt ?? 0) > now - 86_400_000).length} label={t("surv.stat.resolved")} />
            </div>
            <SubLimitList limits={data.limits} />

            <Block icon="shield" title={t("surv.open.title")} count={open.length}>
              {open.length === 0 ? (
                <div className="today-empty"><Icon name="smile" size={22} /><div><p className="today-empty-title">{t("surv.open.emptyTitle")}</p><p className="today-empty-text">{t("surv.open.emptyText")}</p></div></div>
              ) : (
                <ul className="surv-list">{open.map((i) => <IncidentCard key={i.id} incident={i} now={now} onAck={() => void ack(i.id)} busy={busy} />)}</ul>
              )}
            </Block>

            <ReportsSection />

            <Block icon="history" title={t("surv.history.title")} count={data.history.length} id="surveillance-history">
              {data.history.length === 0 ? (
                <p className="today-note">{t("surv.history.empty")}</p>
              ) : (
                <>
                  <ul className="surv-history">
                    {(showHistory ? data.history : data.history.slice(0, 5)).map((i) => (
                      <li key={i.id}>
                        <span className={`surv-dot is-${i.severity}`} aria-hidden="true" />
                        <span className="surv-history-title">{i.title}</span>
                        <span className="surv-history-meta">{t("surv.history.when", { from: dateTime(i.firstAt), to: i.resolvedAt ? relTime(i.resolvedAt, now) : "—", n: i.peak })}</span>
                      </li>
                    ))}
                  </ul>
                  {data.history.length > 5 && !showHistory && <button type="button" className="link" onClick={() => setShowHistory(true)}>{t("surv.history.more", { n: data.history.length - 5 })}</button>}
                </>
              )}
            </Block>

            <Block icon="monitor" title={t("surv.health.title")} id="surveillance-health">
              <HealthBlock health={data.health} />
              {data.lastScan && (
                <details className="surv-detectors">
                  <summary>{t("surv.detectors", { n: data.lastScan.detectors.length, ms: data.lastScan.durationMs })}</summary>
                  <ul>
                    {data.lastScan.detectors.map((d) => (
                      <li key={d.name} className={d.ok ? "" : "is-bad"}>
                        <Icon name={d.ok ? "check" : "alert"} size={13} /> {t(`surv.det.${d.name}` as Key)}
                        <span className="muted"> · {d.skipped ? t("surv.det.skipped") : d.ok ? `${d.ms} ms` : d.error ?? t("surv.det.failed")}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Block>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ icon, value, label, tone }: { icon: IconName; value: number; label: string; tone?: "ok" | "warn" | "danger" }) {
  return (
    <div className={`today-stat ${tone ? `is-${tone}` : ""}`} role="listitem">
      <Icon name={icon} size={16} />
      <span className="today-stat-value">{value}</span>
      <span className="today-stat-label">{label}</span>
    </div>
  );
}

function Block({ icon, title, count, id, children }: { icon: IconName; title: string; count?: number; id?: string; children: ReactNode }) {
  const hid = useId();
  return (
    <section className="today-block" aria-labelledby={hid} id={id}>
      <header className="today-block-head">
        <Icon name={icon} size={17} />
        <h2 id={hid}>{title}</h2>
        {count !== undefined && count > 0 && <span className="count-badge">{count}</span>}
      </header>
      {children}
    </section>
  );
}

/** The measure per hour over 24 hours, as small bars (the last hour on the right). */
export function Sparkline({ values, severity, label }: { values: number[]; severity: SentinelSeverity; label: string }) {
  const max = Math.max(1, ...values);
  const w = 96, h = 26, bw = w / values.length;
  return (
    <svg className={`surv-spark is-${severity}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <line x1="0" x2={w} y1={h - 0.5} y2={h - 0.5} className="surv-spark-base" />
      {values.map((v, i) => {
        const bh = v > 0 ? Math.max(2, (v / max) * (h - 2)) : 0;
        return bh ? <rect key={i} x={i * bw + 0.5} y={h - bh} width={Math.max(1, bw - 1)} height={bh} rx={1} /> : null;
      })}
    </svg>
  );
}

function IncidentCard({ incident: i, now, onAck, busy }: { incident: SentinelIncidentView; now: number; onAck: () => void; busy: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(i.severity === "critical");
  const hid = useId();
  return (
    <li className={`surv-card is-${i.severity} ${i.state === "acknowledged" ? "is-acked" : ""}`} aria-labelledby={hid}>
      <div className="surv-card-head">
        <span className="surv-card-icon"><Icon name={SEV_ICON[i.severity]} size={17} /></span>
        <div className="surv-card-main">
          <div className="surv-card-chips">
            <span className={`chip surv-sev is-${i.severity}`}>{t(`surv.sev.${i.severity}` as Key)}</span>
            <span className="chip">{t(`surv.state.${i.state}` as Key)}</span>
            {i.account && <span className="chip surv-account" title={i.account}>{i.account}</span>}
          </div>
          <h3 className="surv-card-title" id={hid}>{i.title}</h3>
          <p className="surv-card-text">{i.explanation}</p>
          <p className="surv-card-meta">
            {t("surv.meta", { first: relTime(i.firstAt, now), last: relTime(i.lastAt, now), n: i.count, peak: i.peak })}
            {i.ackedAt && <> · {t("surv.ackedBy", { who: i.ackedBy ?? "—", when: relTime(i.ackedAt, now) })}</>}
          </p>
        </div>
        <Sparkline values={i.sparkline} severity={i.severity} label={t("surv.sparkLabel", { peak: Math.max(0, ...i.sparkline) })} />
      </div>
      {open ? (
        <div className="surv-fix">
          <p className="surv-fix-title"><Icon name="wrench" size={14} /> {t("surv.fix")}</p>
          <p>{i.fix}</p>
        </div>
      ) : (
        <button type="button" className="link surv-more" onClick={() => setOpen(true)} aria-expanded={false}>{t("surv.showFix")}</button>
      )}
      <div className="surv-actions">
        {i.state !== "acknowledged" && <button type="button" className="btn btn-small" onClick={onAck} disabled={busy}><Icon name="check" size={14} /> {t("surv.ack")}</button>}
        {i.link && <button type="button" className="btn btn-small btn-primary" onClick={() => openSentinelLink(i.link)}><Icon name="external" size={14} /> {t("surv.openLink")}</button>}
      </div>
    </li>
  );
}

function HealthBlock({ health }: { health: SentinelHealth | null }) {
  const t = useT();
  if (!health) return <p className="today-note">{t("surv.health.none")}</p>;
  return (
    <>
      <p className={`surv-health-status is-${health.status}`}>{t(`surv.health.status.${health.status}` as Key)}</p>
      <ul className="surv-checks">
        {health.checks.map((c) => (
          <li key={c.name} className={`is-${c.state}`}>
            <span className={`surv-dot is-${c.state}`} aria-hidden="true" />
            <span className="surv-check-name">{t(`surv.check.${c.name}` as Key)}</span>
            <span className="surv-check-state">{t(`surv.checkState.${c.state}` as Key)}{c.code !== "ok" && c.code !== "off" && c.code !== "not_used" ? ` · ${c.code}` : ""}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

// ── Réglages → Surveillance ─────────────────────────────────────────────────────────────────────────────────────
export function SurveillanceSettingsSection() {
  const t = useT();
  const id = useId();
  const [view, setView] = useState<SentinelSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { api<SentinelSettingsView>("GET", "/surveillance/settings").then(setView, (e: unknown) => setError(errText(e))); }, []);
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 2200);
    return () => window.clearTimeout(timer);
  }, [note]);
  const put = async (body: Record<string, unknown>) => {
    setError(null);
    try { setView(await api<SentinelSettingsView>("PUT", "/surveillance/settings", body)); setNote(t("common.saved")); } catch (e) { setError(errText(e)); }
  };
  const s = view?.settings;
  return (
    <>
      <h2>{t("settings.section.surveillance")}</h2>
      <p className="muted">{t("surv.settings.intro")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {note && <p className="muted small" role="status">{note}</p>}
      {!view && !error && <Loading />}
      {view && s && (
        <>
          <h3 className="pane-heading">{t("surv.settings.channels")}</h3>
          <div className="action-row">
            <div>
              <p className="action-title">{t("surv.settings.push")}</p>
              <p className="muted small">{view.pushDevices ? t("surv.settings.pushDevices", { n: view.pushDevices }) : t("surv.settings.pushNone")}</p>
            </div>
            <Toggle checked={s.push} label={t("surv.settings.push")} onChange={(v) => void put({ push: v })} />
          </div>
          <div className="action-row">
            <div>
              <p className="action-title">{t("surv.settings.email")}</p>
              <p className="muted small">{view.mailConfigured ? t("surv.settings.emailOk", { email: view.email }) : t("surv.settings.emailNone")}</p>
            </div>
            <Toggle checked={s.email && view.mailConfigured} disabled={!view.mailConfigured} label={t("surv.settings.email")} onChange={(v) => void put({ email: v })} />
          </div>

          <h3 className="pane-heading">{t("surv.settings.what")}</h3>
          <div className="today-settings-row">
            <label htmlFor={`${id}sev`}>{t("surv.settings.minSeverity")}</label>
            <select id={`${id}sev`} className="input input-narrow surv-select" value={s.minSeverity} onChange={(e) => void put({ minSeverity: e.target.value })}>
              {(["warn", "critical"] as const).map((v) => <option key={v} value={v}>{t(`surv.settings.min.${v}` as Key)}</option>)}
              <option value="info">{t("surv.settings.min.info")}</option>
            </select>
          </div>
          <p className="muted small">{t("surv.settings.minHow")}</p>
          <div className="action-row">
            <div>
              <p className="action-title">{t("surv.settings.digest")}</p>
              <p className="muted small">{t("surv.settings.digestHow", { hour: String(s.digestHour).padStart(2, "0"), tz: s.timezone })}</p>
            </div>
            <Toggle checked={s.digest} label={t("surv.settings.digest")} onChange={(v) => void put({ digest: v })} />
          </div>
          <div className="today-settings-row">
            <label htmlFor={`${id}h`}>{t("surv.settings.digestHour")}</label>
            <select id={`${id}h`} className="input input-narrow" value={s.digestHour} onChange={(e) => void put({ digestHour: Number(e.target.value) })} disabled={!s.digest}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </select>
          </div>

          <h3 className="pane-heading">{t("surv.settings.quiet")}</h3>
          <div className="action-row">
            <div>
              <p className="action-title">{t("surv.settings.quietToggle")}</p>
              <p className="muted small">{t("surv.settings.quietHow")}</p>
            </div>
            <Toggle checked={s.quiet.enabled} label={t("surv.settings.quietToggle")} onChange={(v) => void put({ quiet: { enabled: v } })} />
          </div>
          <div className="today-settings-row">
            <label htmlFor={`${id}qs`}>{t("surv.settings.from")}</label>
            <input id={`${id}qs`} type="time" className="input input-narrow" value={s.quiet.start} disabled={!s.quiet.enabled} onChange={(e) => e.target.value && void put({ quiet: { start: e.target.value } })} />
            <label htmlFor={`${id}qe`}>{t("surv.settings.to")}</label>
            <input id={`${id}qe`} type="time" className="input input-narrow" value={s.quiet.end} disabled={!s.quiet.enabled} onChange={(e) => e.target.value && void put({ quiet: { end: e.target.value } })} />
          </div>
          <div className="today-settings-row">
            <label htmlFor={`${id}tz`}>{t("surv.settings.timezone")}</label>
            <input id={`${id}tz`} className="input surv-tz" defaultValue={s.timezone} key={s.timezone} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.timezone && void put({ timezone: e.target.value.trim() })} />
            <button type="button" className="link" onClick={() => void put({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}>{t("surv.settings.useMine")}</button>
          </div>
        </>
      )}
    </>
  );
}
