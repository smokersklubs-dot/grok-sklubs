import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api, ApiError, enc, errText } from "../api";
import { LOCALES, tn, useT, type Key } from "../i18n";
import { useStore, type AppSection, type Theme } from "../store";
import type { AuditEntry, CheckinSettings, DeskTestRun, Locale, Policy, SharedPage, SubscriptionUsage, UsageSummary } from "../types";
import { ENGINE_BRAND, ENGINE_TOOL } from "../lib/engines";
import { clockTime, compactNumber, dateTime, dayLabel, initials, money, relTime, shortDate, toolWords } from "../lib/format";
import { connectorError } from "../lib/connectorError";
import { BotAvatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { ConfirmButton, CopyButton, Empty, ErrorNote, IconButton, Loading, Toggle, useDialogFocus, useEscape, useTick } from "./ui";
import { useNative } from "./NativeApps";
import { VaultSection } from "./VaultSection";
import { DevicesSection } from "./MyComputer";
import { NotificationsSection } from "./NotificationsSection";
import { ModelsSection } from "./Reliability";
import { ProfileSection } from "./ProfileSection";
import { MemorySettingsSection, RulesSection } from "./Wave5";
import { JournalView, PageVisibility, SpendSettingsBlock } from "./Wave5b";
import { MailSection, VoiceSection, WorkspacesSection } from "./Wave6";
import { KeysSection, PublicLinksBlock } from "./Wave7";
import { GoogleAccountBlock, GoogleLoginSettings } from "./GoogleLogin";

const SECTIONS: { id: AppSection; icon: IconName }[] = [
  { id: "general", icon: "settings" },
  { id: "profile", icon: "user" },
  { id: "models", icon: "brain" },
  { id: "notifications", icon: "bell" },
  { id: "computer", icon: "monitor" },
  { id: "devices", icon: "cursor" },
  { id: "permissions", icon: "shield" },
  { id: "rules", icon: "book" },
  { id: "memory", icon: "brain" },
  { id: "connectors", icon: "plug" },
  { id: "vault", icon: "key" },
  { id: "keys", icon: "shield" },
  { id: "pages", icon: "globe" },
  { id: "usage", icon: "chart" },
  { id: "checkins", icon: "bell" },
  { id: "activity", icon: "history" },
  { id: "team", icon: "users" },
  { id: "workspaces", icon: "users" },
  { id: "voice", icon: "mic" },
  { id: "email", icon: "mail" },
  { id: "account", icon: "user" },
];

/* ---------- General ---------- */

const THEMES: Theme[] = ["system", "light", "dark"];

function GeneralSection() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const locale = useStore((s) => s.locale);
  const setLocale = useStore((s) => s.setLocale);
  const t = useT();
  const [error, setError] = useState<string | null>(null);

  const chooseLocale = (next: Locale) => {
    setError(null);
    // The store switches straight away, saves with PUT /prefs, and switches back if that fails.
    setLocale(next).catch((e: unknown) => setError(t("general.languageFailed", { error: errText(e) })));
  };

  return (
    <>
      <h2>{t("settings.section.general")}</h2>
      <h3 className="pane-heading">{t("general.theme")}</h3>
      <div className="theme-tiles" role="radiogroup" aria-label={t("general.theme")}>
        {THEMES.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={theme === id} className={`theme-tile ${theme === id ? "is-selected" : ""}`} onClick={() => setTheme(id)}>
            <span className={`theme-art is-${id}`} aria-hidden="true">
              <i /><i /><i />
            </span>
            <span>{t(`theme.${id}`)}</span>
          </button>
        ))}
      </div>
      <p className="muted small">{t("general.themeHint")}</p>

      <h3 className="pane-heading">{t("general.language")}</h3>
      <div className="choice-list lang-choices" role="radiogroup" aria-label={t("general.language")}>
        {LOCALES.map((l) => (
          <button key={l.id} type="button" role="radio" aria-checked={locale === l.id} lang={l.id} className={`choice ${locale === l.id ? "is-selected" : ""}`} onClick={() => chooseLocale(l.id)}>
            <span className="choice-title">{l.label}</span>
          </button>
        ))}
      </div>
      <p className="muted small">{t("general.languageHint")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>

      <h3 className="pane-heading">{t("notify.heading")}</h3>
      <div className="action-row">
        <p className="muted small">{t("push.moved")}</p>
        <button type="button" className="btn btn-small" onClick={() => useStore.getState().openAppSettings("notifications")}>
          <Icon name="bell" size={14} /> {t("settings.section.notifications")}
        </button>
      </div>

      <h3 className="pane-heading">{t("general.apps")}</h3>
      <ul className="list">
        <li className="list-row is-card">
          <div className="list-row-text">
            <span className="list-row-title">{t("general.apps.title")}</span>
            <span className="list-row-sub">{t("general.apps.hint")}</span>
          </div>
          <a className="btn btn-small" href="/telecharger" target="_blank" rel="noopener">
            <Icon name="download" size={14} /> {t("general.apps.open")}
          </a>
        </li>
      </ul>

      {!/SklubotAndroid/.test(navigator.userAgent) && (
        <>
          <h3 className="pane-heading">{t("general.phone")}</h3>
          <ul className="list">
            <li className="list-row is-card">
              <div className="list-row-text">
                <span className="list-row-title">{t("general.phone.android")}</span>
                <span className="list-row-sub">{t("general.phone.androidHint")}</span>
              </div>
              <a className="btn btn-small" href="/download/sklubot.apk" download="sklubot.apk">{t("general.phone.androidGet")}</a>
            </li>
            <li className="list-row is-card">
              <div className="list-row-text">
                <span className="list-row-title">{t("general.phone.iphone")}</span>
                <span className="list-row-sub">{t("general.phone.iphoneHint")}</span>
              </div>
            </li>
          </ul>
        </>
      )}
    </>
  );
}

/* ---------- Computer ---------- */

function ComputerSection() {
  const computer = useStore((s) => s.computer);
  const bots = useStore((s) => s.bots);
  const { loadComputer, openViewer } = useStore.getState();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const now = useTick(30_000);
  useEffect(() => {
    void loadComputer();
  }, [loadComputer]);

  return (
    <>
      <h2>{t("settings.section.computer")}</h2>
      <p className="muted">
        {t(computer?.kind === "linux" ? "computer.introLinux" : "computer.introBrowser")}
      </p>
      {!computer && <Loading />}
      {computer && !computer.browser && (
        <Empty icon="monitor" title={t("computer.noneTitle")}>
          {t("computer.noneText")}
        </Empty>
      )}
      {computer && computer.browser && (
        <>
          <div className="status-row">
            <span className="dot-inline dot-ok" />
            <span>
              {t(computer.kind === "linux" ? "computer.statusLinux" : "computer.statusBrowser", { open: computer.desktops.filter((d) => d.open).length, max: computer.maxDesktops })}
            </span>
          </div>
          <h3 className="pane-heading">{t(computer.kind === "linux" ? "computer.headingLinux" : "computer.headingBrowser")}</h3>
          <ErrorNote>{error}</ErrorNote>
          {computer.desktops.length === 0 ? (
            <p className="muted small">{t(computer.kind === "linux" ? "computer.emptyLinux" : "computer.emptyBrowser")}</p>
          ) : (
            <ul className="list">
              {computer.desktops.map((d) => {
                const bot = bots[d.botId];
                return (
                  <li key={d.botId} className="list-row is-card">
                    {bot ? <BotAvatar bot={bot} size={30} /> : <span className="logo-tile">?</span>}
                    <div className="list-row-text">
                      <span className="list-row-title">{bot?.name ?? t("common.removedBot")}{!d.open && <span className="chip">{t(computer.kind === "linux" ? "computer.chipAsleep" : "computer.chipClosed")}</span>}</span>
                      <span className="list-row-sub truncate" title={d.url ?? undefined}>{computer.kind === "linux" ? t(d.open ? "computer.awake" : "computer.asleep") : d.url || t("computer.blank")} · {t("computer.used", { when: relTime(d.lastUsedAt, now) })}</span>
                    </div>
                    {bot && <IconButton icon="eye" size={16} label={t("computer.watch", { name: bot.name })} onClick={() => openViewer(bot.id)} />}
                    {bot && computer.kind === "linux" && (
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={async () => {
                          setError(null);
                          try {
                            await api("POST", `/bots/${d.botId}/desktop/${d.open ? "sleep" : "wake"}`);
                            await loadComputer();
                          } catch (e) {
                            setError(errText(e));
                          }
                        }}
                      >
                        {t(d.open ? "computer.sleep" : "computer.wake")}
                      </button>
                    )}
                    <ConfirmButton
                      className="btn btn-small"
                      label={t(computer.kind === "linux" ? "computer.erase" : "computer.reset")}
                      confirmLabel={t(computer.kind === "linux" ? "computer.eraseConfirm" : "computer.resetConfirm")}
                      onConfirm={async () => {
                        setError(null);
                        try {
                          await api("POST", `/bots/${d.botId}/desktop/reset`);
                          await loadComputer();
                        } catch (e) {
                          setError(errText(e));
                        }
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          <p className="muted small">
            {tn(computer.kind === "linux" ? "computer.footLinux" : "computer.footBrowser", computer.maxDesktops)}
          </p>
          {computer.kind === "linux" && <DeskTest />}
        </>
      )}
    </>
  );
}

/**
 * The desk test (B-10): an end-to-end check of a bot computer, on two computers of invented bots (no real bot, no data
 * of yours). Each check shows passed or failed with its time; the pictures taken along the way open in a new tab.
 */
function DeskTest() {
  const t = useT();
  const [run, setRun] = useState<DeskTestRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    api<{ run: DeskTestRun | null }>("GET", "/computer/desk-test").then((r) => setRun(r.run), () => undefined);
  }, []);
  // While it runs, the result is refreshed every 2 s.
  useEffect(() => {
    if (run?.status !== "running") return;
    const timer = window.setInterval(() => {
      api<{ run: DeskTestRun | null }>("GET", "/computer/desk-test").then((r) => setRun(r.run), () => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [run?.status]);
  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      setRun((await api<{ run: DeskTestRun }>("POST", "/computer/desk-test")).run);
    } catch (e) {
      setError(errText(e));
    } finally {
      setStarting(false);
    }
  };
  const running = run?.status === "running";
  const failed = run?.checks.filter((c) => !c.ok).length ?? 0;
  return (
    <div className="desk-test">
      <h3 className="pane-heading">{t("desk.title")}</h3>
      <p className="muted small">{t("desk.intro")}</p>
      <div className="row-gap">
        <button type="button" className="btn btn-small btn-primary" disabled={running || starting} onClick={() => void start()}>
          <Icon name="play" size={12} /> {t(running ? "desk.running" : run ? "desk.again" : "desk.start")}
        </button>
        {run && !running && (
          <span className={`desk-verdict is-${run.status}`} role="status">
            {run.status === "passed" ? t("desk.passed", { n: run.checks.length, s: Math.round(((run.finishedAt ?? run.startedAt) - run.startedAt) / 1000) }) : run.status === "error" ? t("desk.error", { error: run.error ?? "" }) : t("desk.failed", { n: failed })}
          </span>
        )}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {run && run.checks.length > 0 && (
        <ol className="desk-checks">
          {run.checks.map((c) => (
            <li key={c.id} className={c.ok ? "is-ok" : "is-fail"}>
              <span className={`desk-mark ${c.ok ? "is-ok" : "is-fail"}`}>{t(c.ok ? "desk.ok" : "desk.fail")}</span>
              <span className="desk-label">{t(`desk.check.${c.id}` as Key)}</span>
              <span className="desk-detail truncate" title={c.detail}>{c.detail}</span>
              <span className="desk-ms">{c.ms < 1000 ? `${c.ms} ms` : `${(c.ms / 1000).toFixed(1)} s`}</span>
            </li>
          ))}
          {running && <li className="is-pending"><span className="dot-inline dot-pulse" /> {t("desk.next")}</li>}
        </ol>
      )}
      {run && run.shots.length > 0 && (
        <div className="desk-shots">
          {run.shots.map((name) => (
            <a key={name} href={`/api/computer/desk-test/shots/${enc(name)}`} target="_blank" rel="noreferrer" title={name}>
              <img src={`/api/computer/desk-test/shots/${enc(name)}`} alt={name} loading="lazy" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Permissions ---------- */

function PermissionsSection() {
  const t = useT();
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api<{ policies: Policy[] }>("GET", "/policies").then(
      (r) => setPolicies(r.policies),
      (e: unknown) => {
        setError(errText(e));
        setPolicies((p) => p ?? []);
      },
    );
  useEffect(() => {
    void load();
  }, []);

  const remove = async (tool: string) => {
    setError(null);
    try {
      await api("DELETE", `/policies/${enc(tool)}`);
      setPolicies((p) => p?.filter((x) => x.tool !== tool) ?? null);
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <>
      <h2>{t("settings.section.permissions")}</h2>
      <p className="muted">{t("permissions.intro")}</p>
      <ErrorNote>{error}</ErrorNote>
      {!policies && <Loading />}
      {policies && policies.length === 0 && (
        <Empty icon="shield" title={t("permissions.emptyTitle")}>{t("permissions.emptyText")}</Empty>
      )}
      {policies && policies.length > 0 && (
        <ul className="list">
          {policies.map((p) => {
            const w = toolWords(p.tool);
            return (
              <li key={p.tool} className="list-row is-card">
                <div className="list-row-text">
                  <span className="list-row-title">
                    {w.app}{w.action ? ` · ${w.action}` : ""} <span className={`chip state-${p.mode}`}>{t(`permissions.mode.${p.mode}`)}</span>
                  </span>
                  <code className="list-row-sub">{p.tool}</code>
                </div>
                <button type="button" className="btn btn-small" onClick={() => void remove(p.tool)}>{t("permissions.askAgain")}</button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/* ---------- Connectors ---------- */

function ConnectorsSection() {
  const connectors = useStore((s) => s.connectors);
  const native = useNative();
  const { loadConnectors, closeAppSettings, openModal } = useStore.getState();
  const t = useT();
  useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);
  const manage = () => {
    closeAppSettings();
    openModal({ kind: "connectors" });
  };
  return (
    <>
      <h2>{t("settings.section.connectors")}</h2>
      <div className="action-row">
        <div>
          <p className="action-title">{connectors ? tn("count.app", connectors.length + (native?.accounts.length ?? 0)) : t("settings.section.connectors")}</p>
          <p className="muted small">{t("apps.hint")}</p>
        </div>
        <button type="button" className="btn btn-small" onClick={manage}>{t("apps.manage")}</button>
      </div>
      {!connectors && <Loading />}
      {native && native.accounts.length > 0 && (
        <ul className="list">
          {native.accounts.map((a) => (
            <li key={a.id} className="list-row is-card">
              <span className={`logo-tile native-${a.app}`}>{(Array.from(a.name.trim())[0] ?? "?").toUpperCase()}</span>
              <div className="list-row-text">
                <span className="list-row-title">{a.name}</span>
                <span className="list-row-sub truncate">{a.identity ?? t("native.notSignedYet")} · {t("native.builtIn")}</span>
              </div>
              <span className={`chip state-${a.status}`}>{t(`connector.status.${a.status}`)}</span>
            </li>
          ))}
        </ul>
      )}
      {connectors && connectors.length > 0 && (
        <ul className="list">
          {connectors.map((c) => (
            <li key={c.id} className="list-row is-card">
              <span className="logo-tile">{(Array.from(c.name.trim())[0] ?? "?").toUpperCase()}</span>
              <div className="list-row-text">
                <span className="list-row-title">{c.name}</span>
                <span className="list-row-sub truncate">{c.status === "error" ? connectorError(c, t, t("connector.cantConnect")) : `${tn("count.tool", c.tools.length)} · ${c.url}`}</span>
              </div>
              <span className={`chip state-${c.status}`}>{t(`connector.status.${c.status}`)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">{t("apps.foot")}</p>
    </>
  );
}

/* ---------- Vault (saved logins) ---------- */

/* ---------- Usage ---------- */

/** Share used of each subscription's 5-hour and 7-day windows, as last reported by the provider's tool. */
function SubscriptionUsageBlock({ subs }: { subs: SubscriptionUsage[] }) {
  const t = useT();
  const meter = (label: string, value: number | null) => {
    const percent = value === null ? null : Math.max(0, Math.min(100, Math.round(value * 100)));
    return (
      <div className="meter-box">
        <div className="meter-head">
          <span>{label}</span>
          <span className={percent === null ? "muted small" : ""}>{percent === null ? t("usage.notReported") : `${percent} %`}</span>
        </div>
        {percent !== null && (
          <div className={`meter ${percent >= 90 ? "is-over" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}><span style={{ width: `${percent}%` }} /></div>
        )}
      </div>
    );
  };
  return (
    <>
      <h3 className="pane-heading">{t("usage.subscriptions")}</h3>
      <p className="muted small">{t("usage.subIntro")}</p>
      <div className="sub-usage">
        {subs.map((s) => (
          <div key={s.engine} className="sub-usage-card">
            <div className="sub-usage-head">
              <span className="choice-title">{ENGINE_BRAND[s.engine]} <span className="muted small">· {ENGINE_TOOL[s.engine]}</span></span>
              {s.at > 0 && <span className="muted small">{t("usage.subAt", { when: relTime(s.at) })}</span>}
            </div>
            {meter(t("usage.fiveHour"), s.fiveHour)}
            {meter(t("usage.sevenDay"), s.sevenDay)}
            {s.resetsAt !== null && <p className="field-hint">{t("usage.resets", { when: dateTime(s.resetsAt) })}</p>}
          </div>
        ))}
      </div>
    </>
  );
}

function UsageSection() {
  const tick = useStore((s) => s.usageTick);
  const t = useT();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [budget, setBudget] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const touched = useRef(false);
  const id = useId();

  useEffect(() => {
    let dead = false;
    api<UsageSummary>("GET", "/usage").then(
      (u) => {
        if (dead) return;
        setUsage(u);
        if (!touched.current) setBudget(u.budgetUsd === null ? "" : String(u.budgetUsd));
      },
      (e: unknown) => !dead && setError(errText(e)),
    );
    return () => {
      dead = true;
    };
  }, [tick]);

  const parsed = budget.trim() === "" ? null : Number(budget);
  const valid = parsed === null || (Number.isFinite(parsed) && parsed >= 0);
  const dirty = usage !== null && valid && parsed !== usage.budgetUsd;

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    try {
      const u = await api<UsageSummary>("PUT", "/usage/budget", { budgetUsd: parsed });
      touched.current = false;
      setUsage(u);
      setBudget(u.budgetUsd === null ? "" : String(u.budgetUsd));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const over = usage && usage.budgetUsd !== null && usage.budgetUsd > 0 ? Math.min(100, Math.round((usage.totals.costUsd / usage.budgetUsd) * 100)) : null;

  return (
    <>
      <h2>{t("settings.section.usage")}</h2>
      <ErrorNote>{error}</ErrorNote>
      {!usage && !error && <Loading />}
      {usage && (
        <>
          {usage.nearBudget && (
            <div className="callout is-warn" role="status">
              <Icon name="alert" size={16} />
              <span>{t("usage.nearBudget", { budget: money(usage.budgetUsd ?? 0) })}</span>
            </div>
          )}
          <div className="pane-intro">
            <p className="muted">{t("usage.intro", { month: usage.month })}</p>
            <a className="btn btn-small" href="/api/usage.csv" download>
              <Icon name="download" size={14} /> {t("usage.csv")}
            </a>
          </div>
          <div className="stats">
            <div className="stat"><span className="stat-value">{money(usage.totals.costUsd)}</span><span className="stat-label">{t("usage.cost")}</span></div>
            <div className="stat"><span className="stat-value">{compactNumber(usage.totals.inputTokens)}</span><span className="stat-label">{t("usage.input")}</span></div>
            <div className="stat"><span className="stat-value">{compactNumber(usage.totals.outputTokens)}</span><span className="stat-label">{t("usage.output")}</span></div>
            <div className="stat"><span className="stat-value">{compactNumber(usage.totals.turns)}</span><span className="stat-label">{t("usage.turns")}</span></div>
          </div>
          {over !== null && (
            <div className="meter-box">
              <div className="meter-head"><span>{t("usage.meter", { percent: over, budget: money(usage.budgetUsd ?? 0) })}</span></div>
              <div className={`meter ${over >= 100 ? "is-over" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={over} aria-label={t("usage.meterLabel")}><span style={{ width: `${over}%` }} /></div>
            </div>
          )}
          {(usage.subscriptions ?? []).length > 0 && <SubscriptionUsageBlock subs={usage.subscriptions} />}
          <h3 className="pane-heading">{t("usage.byBot")}</h3>
          {usage.byBot.length === 0 ? (
            <p className="muted small">{t("usage.none")}</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th scope="col">{t("usage.colBot")}</th><th scope="col" className="num">{t("usage.turns")}</th><th scope="col" className="num">{t("usage.colInput")}</th><th scope="col" className="num">{t("usage.colOutput")}</th><th scope="col" className="num">{t("usage.colCost")}</th></tr>
                </thead>
                <tbody>
                  {usage.byBot.map((b) => (
                    <tr key={b.botId}>
                      <th scope="row">{b.name}</th>
                      <td className="num">{compactNumber(b.turns)}</td>
                      <td className="num">{compactNumber(b.inputTokens)}</td>
                      <td className="num">{compactNumber(b.outputTokens)}</td>
                      <td className="num">{money(b.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3 className="pane-heading">{t("spend.heading")}</h3>
          <SpendSettingsBlock />
          <h3 className="pane-heading">{t("usage.monthly")}</h3>
          <div className="field">
            <label className="field-label" htmlFor={id}>{t("usage.budgetLabel")}</label>
            <div className="row-gap">
              <input
                id={id}
                className="input input-narrow"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={budget}
                placeholder={t("usage.noLimit")}
                onChange={(e) => {
                  touched.current = true;
                  setBudget(e.target.value);
                }}
              />
              <button type="button" className="btn btn-primary btn-small" disabled={!dirty || saving} onClick={() => void save()}>{t(saving ? "common.saving" : "common.save")}</button>
              {saved && <span className="muted small" role="status">{t("common.saved")}</span>}
            </div>
            <p className="field-hint">{t(valid ? "usage.hintOk" : "usage.hintBad")}</p>
          </div>
        </>
      )}
    </>
  );
}

/* ---------- Check-ins ---------- */

function CheckinsSection() {
  const t = useT();
  const [cfg, setCfg] = useState<CheckinSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tz, setTz] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();

  useEffect(() => {
    api<CheckinSettings>("GET", "/checkins").then(
      (c) => {
        setCfg(c);
        setTz(c.timezone);
      },
      (e: unknown) => setError(errText(e)),
    );
  }, []);
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 2200);
    return () => window.clearTimeout(timer);
  }, [note]);

  const put = async (patch: Partial<CheckinSettings>) => {
    if (!cfg) return;
    const before = cfg;
    setCfg({ ...cfg, ...patch });
    setError(null);
    try {
      const c = await api<CheckinSettings>("PUT", "/checkins", patch);
      setCfg(c);
      setTz(c.timezone);
      setNote(t("common.saved"));
    } catch (e) {
      setCfg(before);
      setTz(before.timezone);
      setError(errText(e));
    }
  };

  const setTime = (i: number, value: string) => {
    if (!cfg || !/^\d{2}:\d{2}$/.test(value)) return;
    void put({ times: cfg.times.map((x, j) => (j === i ? value : x)) });
  };

  return (
    <>
      <h2>{t("settings.section.checkins")}</h2>
      <p className="muted">{t("checkins.intro")}</p>
      <ErrorNote>{error}</ErrorNote>
      {!cfg && !error && <Loading />}
      {cfg && (
        <>
          <div className="action-row">
            <div>
              <p className="action-title">{t("checkins.daily")}</p>
              <p className="muted small">{t(cfg.enabled ? "checkins.on" : "checkins.off")}</p>
            </div>
            <Toggle checked={cfg.enabled} label={t("checkins.daily")} onChange={(v) => void put({ enabled: v })} />
          </div>
          <h3 className="pane-heading">{t("checkins.times")}</h3>
          <ul className="time-list">
            {cfg.times.map((time, i) => (
              <li key={i}>
                <label className="sr-only" htmlFor={`${id}t${i}`}>{t("checkins.timeLabel", { n: i + 1 })}</label>
                <input id={`${id}t${i}`} className="input input-narrow" type="time" value={time} onChange={(e) => setTime(i, e.target.value)} />
                <IconButton icon="close" size={15} label={t("checkins.removeTime", { time })} onClick={() => void put({ times: cfg.times.filter((_, j) => j !== i) })} />
              </li>
            ))}
          </ul>
          {cfg.times.length === 0 && <p className="muted small">{t("checkins.noTimes")}</p>}
          <button
            type="button"
            className="btn btn-small"
            disabled={cfg.times.length >= 6}
            title={cfg.times.length >= 6 ? t("checkins.maxTitle") : undefined}
            onClick={() => void put({ times: [...cfg.times, ["09:00", "13:00", "17:00", "11:00", "15:00", "20:00"].find((x) => !cfg.times.includes(x)) ?? "12:00"] })}
          >
            <Icon name="plus" size={14} /> {t("checkins.addTime")}
          </button>
          <p className="muted small">{t("checkins.maxHint")}</p>
          <div className="field">
            <label className="field-label" htmlFor={`${id}z`}>{t("checkins.timezone")}</label>
            <div className="row-gap">
              <input id={`${id}z`} className="input" value={tz} onChange={(e) => setTz(e.target.value)} placeholder={t("checkins.tzPlaceholder")} spellCheck={false} />
              <button type="button" className="btn btn-small" disabled={tz.trim() === cfg.timezone || !tz.trim()} onClick={() => void put({ timezone: tz.trim() })}>{t("common.save")}</button>
            </div>
            <p className="field-hint">
              {t("checkins.tzHint")}{" "}
              <button type="button" className="link" onClick={() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone)}>{t("checkins.tzDevice")}</button>
            </p>
          </div>
          <div className="row-gap">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await api("POST", "/checkins/now");
                  setNote(t("checkins.started"));
                } catch (e) {
                  setError(errText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="bolt" size={15} /> {t(busy ? "common.starting" : "checkins.now")}
            </button>
            {note && <span className="muted small" role="status">{note}</span>}
          </div>
        </>
      )}
    </>
  );
}

/* ---------- Shared pages ---------- */

function PagesSection() {
  const tick = useStore((s) => s.pagesTick);
  const bots = useStore((s) => s.bots);
  const t = useT();
  const [pages, setPages] = useState<SharedPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    api<{ pages: SharedPage[] }>("GET", "/pages").then(
      (r) => {
        if (dead) return;
        setPages(Array.isArray(r?.pages) ? r.pages : []);
        setError(null);
      },
      (e: unknown) => {
        if (dead) return;
        setError(errText(e));
        setPages((cur) => cur ?? []);
      },
    );
    return () => {
      dead = true;
    };
  }, [tick]);

  const stop = async (page: SharedPage) => {
    setError(null);
    try {
      await api("DELETE", `/pages/${enc(page.token)}`);
      setPages((cur) => cur?.filter((x) => x.token !== page.token) ?? null);
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <>
      <h2>{t("settings.section.pages")}</h2>
      <p className="muted">{t("pages.intro")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {!pages && <Loading />}
      {pages && pages.length === 0 && !error && <Empty icon="globe" title={t("pages.emptyTitle")}>{t("pages.emptyText")}</Empty>}
      {pages && pages.length > 0 && (
        <ul className="list">
          {pages.map((page) => {
            const bot = bots[page.botId];
            return (
              <li key={page.token} className="page-row">
                <div className="page-row-head">
                  {bot ? <BotAvatar bot={bot} size={30} /> : <span className="logo-tile">?</span>}
                  <div className="list-row-text">
                    <span className="list-row-title">{page.title || t("pages.untitled")}</span>
                    <span className="list-row-sub">{t("pages.by", { name: bot?.name ?? t("common.removedBot"), date: shortDate(page.createdAt) })}</span>
                  </div>
                  <PageVisibility page={page} onChanged={(v) => setPages((cur) => cur?.map((x) => (x.token === page.token ? { ...x, visibility: v } : x)) ?? null)} />
                  <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("pages.stop")} confirmLabel={t("pages.stopConfirm")} busyLabel={t("pages.stopping")} onConfirm={() => stop(page)} />
                </div>
                <div className="hook">
                  <code className="truncate" title={page.url}>{page.url}</code>
                  <CopyButton text={page.url} label={t("pages.copy")} onFail={() => setError(t("routine.copyFailed"))} />
                  <a className="btn btn-small" href={page.url} target="_blank" rel="noopener noreferrer">
                    <Icon name="external" size={13} /> {t("pages.open")}
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <PublicLinksBlock />
    </>
  );
}

/* ---------- Activity log ---------- */

const AUDIT_PAGE = 50;
const AUDIT_KINDS: AuditEntry["kind"][] = ["tool", "approval", "computer", "routine", "apps", "vault", "channel", "account", "system"];
const AUDIT_ICON: Record<AuditEntry["kind"], IconName> = {
  tool: "wrench", approval: "shield", computer: "cursor", account: "user", apps: "plug", vault: "key", routine: "clock", channel: "send", system: "info",
};

/** Settings → Activity: the detailed usage journal (one line per action, with what allowed it) and the activity log. */
function ActivitySection() {
  const t = useT();
  const [view, setView] = useState<"journal" | "log">("journal");
  return (
    <>
      <h2>{t("settings.section.activity")}</h2>
      <div className="seg-tabs" role="tablist" aria-label={t("settings.section.activity")}>
        <button type="button" role="tab" aria-selected={view === "journal"} className={`seg-tab ${view === "journal" ? "is-active" : ""}`} onClick={() => setView("journal")}><Icon name="chart" size={13} /> {t("journal.title")}</button>
        <button type="button" role="tab" aria-selected={view === "log"} className={`seg-tab ${view === "log" ? "is-active" : ""}`} onClick={() => setView("log")}><Icon name="history" size={13} /> {t("audit.title")}</button>
      </div>
      {view === "journal" ? <><p className="muted">{t("journal.intro")}</p><JournalView /></> : <ActivityLog />}
    </>
  );
}

function ActivityLog() {
  const bots = useStore((s) => s.bots);
  const t = useT();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<AuditEntry["kind"] | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = async (before?: number) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ entries: AuditEntry[] }>("GET", `/audit?limit=${AUDIT_PAGE}${before !== undefined ? `&before=${before}` : ""}`);
      if (!alive.current) return;
      const page = Array.isArray(r?.entries) ? r.entries : [];
      setEntries((cur) => {
        if (before === undefined || !cur) return page;
        const seen = new Set(cur.map((e) => e.id));
        return [...cur, ...page.filter((e) => !seen.has(e.id))];
      });
      setMore(page.length >= AUDIT_PAGE);
    } catch (e) {
      if (!alive.current) return;
      setError(errText(e));
      setEntries((cur) => cur ?? []);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = entries?.filter((e) => !kind || e.kind === kind) ?? [];
  const days: { label: string; items: AuditEntry[] }[] = [];
  for (const e of shown) {
    const label = dayLabel(e.at);
    const last = days[days.length - 1];
    if (last && last.label === label) last.items.push(e);
    else days.push({ label, items: [e] });
  }
  const oldest = entries && entries.length > 0 ? entries[entries.length - 1].id : undefined;

  return (
    <>
      <p className="muted">{t("audit.intro")}</p>
      <div className="filter-chips" role="group" aria-label={t("audit.filter")}>
        <button type="button" className={`filter-chip ${kind === null ? "is-selected" : ""}`} aria-pressed={kind === null} onClick={() => setKind(null)}>{t("audit.all")}</button>
        {AUDIT_KINDS.map((k) => (
          <button key={k} type="button" className={`filter-chip ${kind === k ? "is-selected" : ""}`} aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
            <Icon name={AUDIT_ICON[k]} size={12} /> {t(`audit.kind.${k}`)}
          </button>
        ))}
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {!entries && <Loading />}
      {entries && entries.length === 0 && !error && <Empty icon="history" title={t("audit.emptyTitle")}>{t("audit.emptyText")}</Empty>}
      {entries && entries.length > 0 && shown.length === 0 && <p className="muted small">{t("audit.noneOfKind")}</p>}
      {days.map((day) => (
        <section key={day.label} className="audit-day" aria-label={day.label}>
          <h3 className="audit-day-label">{day.label}</h3>
          <ul className="audit-list">
            {day.items.map((e) => {
              const bot = e.botId ? bots[e.botId] : undefined;
              return (
                <li key={e.id} className="audit-row">
                  <time className="audit-time" dateTime={new Date(e.at).toISOString()}>{clockTime(e.at)}</time>
                  <span className={`audit-icon is-${e.kind}`} title={t(`audit.kind.${e.kind}`)}>
                    <Icon name={AUDIT_ICON[e.kind] ?? "info"} size={14} />
                    <span className="sr-only">{t(`audit.kind.${e.kind}`)}</span>
                  </span>
                  {bot && <span className="audit-bot" title={bot.name}><BotAvatar bot={bot} size={20} /></span>}
                  <span className="audit-text">{e.text}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {entries && more && (
        <div className="earlier">
          <button type="button" className="btn btn-small" disabled={busy} onClick={() => void load(oldest)}>{t(busy ? "common.loading" : "audit.more")}</button>
        </div>
      )}
    </>
  );
}

/* ---------- Team (export / import) ---------- */

function TeamSection() {
  const loadBots = useStore((s) => s.loadBots);
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const importFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error(t("team.badFile"));
      }
      if (!data || typeof data !== "object") throw new Error(t("team.badFile"));
      const r = await api<{ created: number }>("POST", "/import/team", data);
      const n = typeof r?.created === "number" ? r.created : 0;
      setNote(tn("team.created", n));
      await loadBots().catch(() => undefined);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <h2>{t("settings.section.team")}</h2>
      <p className="muted">{t("team.intro")}</p>
      <div className="action-row">
        <div>
          <p className="action-title">{t("team.export")}</p>
          <p className="muted small">{t("team.exportHint")}</p>
        </div>
        <a className="btn btn-small" href="/api/export/team" download>
          <Icon name="download" size={14} /> {t("team.export")}
        </a>
      </div>
      <div className="action-row">
        <div>
          <p className="action-title">{t("team.import")}</p>
          <p className="muted small">{t("team.importHint")}</p>
        </div>
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => input.current?.click()}>
          <Icon name="upload" size={14} /> {t(busy ? "team.importing" : "team.import")}
        </button>
        <input ref={input} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-label={t("team.import")} onChange={(e) => void importFile(e.target.files?.[0])} />
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {note && (
        <div className="callout is-ok" role="status">
          <Icon name="check" size={16} />
          <span>{note}</span>
        </div>
      )}
    </>
  );
}

/* ---------- Account ---------- */

function PasswordForm() {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const uid = useId();
  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready = current.length > 0 && next.length >= 8 && confirm === next;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api("PUT", "/account/password", { current, next });
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t("account.wrongPassword") : errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="editor" onSubmit={submit}>
      <div className="field">
        <label className="field-label" htmlFor={`${uid}c`}>{t("account.currentPassword")}</label>
        <input id={`${uid}c`} className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </div>
      <div className="form-cols is-even">
        <div className="field">
          <label className="field-label" htmlFor={`${uid}n`}>{t("account.newPassword")}</label>
          <input id={`${uid}n`} className="input" type="password" value={next} minLength={8} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-invalid={tooShort || undefined} />
          <p className={`field-hint ${tooShort ? "is-error" : ""}`}>{t("account.passwordRule")}</p>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${uid}r`}>{t("account.confirmPassword")}</label>
          <input id={`${uid}r`} className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-invalid={mismatch || undefined} />
          {mismatch && <p className="field-hint is-error">{t("account.mismatch")}</p>}
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="row-end">
        {done && <span className="muted small" role="status">{t("account.passwordChanged")}</span>}
        <button type="submit" className="btn btn-primary btn-small" disabled={!ready || busy}>{t(busy ? "common.saving" : "account.changePassword")}</button>
      </div>
    </form>
  );
}

function DeleteAccount() {
  const t = useT();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const uid = useId();

  const remove = async () => {
    setError(null);
    try {
      await api("DELETE", "/account", { password });
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t("account.wrongPassword") : errText(err));
    }
  };

  return (
    <div className="danger-box">
      <div>
        <p className="action-title">{t("account.delete")}</p>
        <p className="muted small">{t("account.deleteHint")}</p>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${uid}p`}>{t("account.deletePassword")}</label>
        <div className="row-gap">
          <input id={`${uid}p`} className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <ConfirmButton className="btn btn-small btn-danger" label={t("account.delete")} confirmLabel={t("account.deleteConfirm")} busyLabel={t("common.deleting")} disabled={!password} onConfirm={remove} />
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

function AccountSection() {
  const user = useStore((s) => s.user);
  const logout = useStore((s) => s.logout);
  const t = useT();
  if (!user) return null;
  return (
    <>
      <h2>{t("settings.section.account")}</h2>
      <div className="account-card">
        <span className="initials is-large">{initials(user.name || user.email)}</span>
        <div className="list-row-text">
          <span className="list-row-title">{user.name || "—"}</span>
          <span className="list-row-sub">{user.email}</span>
        </div>
        <button type="button" className="btn btn-danger btn-small" onClick={() => void logout()}>
          <Icon name="logout" size={14} /> {t("account.signOut")}
        </button>
      </div>

      <h3 className="pane-heading">{t("account.passwordHeading")}</h3>
      <GoogleAccountBlock><PasswordForm /></GoogleAccountBlock>
      <GoogleLoginSettings />

      <h3 className="pane-heading">{t("account.dataHeading")}</h3>
      <div className="action-row">
        <div>
          <p className="action-title">{t("account.export")}</p>
          <p className="muted small">{t("account.exportHint")}</p>
        </div>
        <a className="btn btn-small" href="/api/export/data" download>
          <Icon name="download" size={14} /> {t("account.export")}
        </a>
      </div>

      <h3 className="pane-heading is-danger">{t("bot.danger")}</h3>
      <DeleteAccount />
    </>
  );
}

/* ---------- Page ---------- */

export function AppSettings({ section }: { section: AppSection }) {
  const { closeAppSettings, openAppSettings } = useStore.getState();
  const blocked = useStore((s) => !!(s.modal || s.botSettings || s.viewerBotId || s.relayViewerId));
  const root = useRef<HTMLDivElement>(null);
  const t = useT();
  useEscape(closeAppSettings, !blocked);
  useDialogFocus(root);
  return (
    <div className="app-settings" ref={root} role="dialog" aria-modal="true" aria-label={t("settings.title")} tabIndex={-1}>
      <nav className="app-settings-nav" aria-label={t("settings.sections")}>
        <button type="button" className="btn btn-ghost btn-small back" onClick={closeAppSettings}>
          <Icon name="arrowLeft" size={15} /> {t("settings.back")}
        </button>
        <h1>{t("settings.title")}</h1>
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" className={`settings-nav-item ${section === s.id ? "is-active" : ""}`} aria-current={section === s.id ? "page" : undefined} onClick={() => openAppSettings(s.id)}>
            <Icon name={s.icon} size={16} />
            <span>{t(`settings.section.${s.id}`)}</span>
          </button>
        ))}
      </nav>
      <div className="app-settings-main">
        <IconButton icon="close" label={t("settings.close")} className="app-settings-close" onClick={closeAppSettings} />
        <div className="app-settings-content settings-pane">
          {section === "general" && <GeneralSection />}
          {section === "profile" && <ProfileSection />}
          {section === "models" && <ModelsSection />}
          {section === "notifications" && <NotificationsSection />}
          {section === "computer" && <ComputerSection />}
          {section === "devices" && <DevicesSection />}
          {section === "permissions" && <PermissionsSection />}
          {section === "rules" && <RulesSection />}
          {section === "memory" && <MemorySettingsSection />}
          {section === "connectors" && <ConnectorsSection />}
          {section === "vault" && <VaultSection />}
          {section === "keys" && <KeysSection />}
          {section === "pages" && <PagesSection />}
          {section === "activity" && <ActivitySection />}
          {section === "team" && <TeamSection />}
          {section === "workspaces" && <WorkspacesSection />}
          {section === "voice" && <VoiceSection />}
          {section === "email" && <MailSection />}
          {section === "usage" && <UsageSection />}
          {section === "checkins" && <CheckinsSection />}
          {section === "account" && <AccountSection />}
        </div>
      </div>
    </div>
  );
}
