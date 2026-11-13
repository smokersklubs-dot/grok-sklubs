import { useEffect, useId, useRef, useState } from "react";
import { api, enc, errText } from "../api";
import { useStore, type AppSection, type Theme } from "../store";
import type { CheckinSettings, Policy, UsageSummary } from "../types";
import { compactNumber, initials, money, plural, relTime, toolWords } from "../lib/format";
import { BotAvatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { ConfirmButton, Empty, ErrorNote, IconButton, Loading, Toggle, useDialogFocus, useEscape, useTick } from "./ui";

const SECTIONS: { id: AppSection; label: string; icon: IconName }[] = [
  { id: "general", label: "General", icon: "settings" },
  { id: "computer", label: "Computer", icon: "monitor" },
  { id: "permissions", label: "Permissions", icon: "shield" },
  { id: "connectors", label: "Connectors", icon: "plug" },
  { id: "usage", label: "Usage", icon: "chart" },
  { id: "checkins", label: "Check-ins", icon: "bell" },
  { id: "account", label: "Account", icon: "user" },
];

/* ---------- General ---------- */

const THEMES: { id: Theme; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

function GeneralSection() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  return (
    <>
      <h2>General</h2>
      <h3 className="pane-heading">Theme</h3>
      <div className="theme-tiles" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} className={`theme-tile ${theme === t.id ? "is-selected" : ""}`} onClick={() => setTheme(t.id)}>
            <span className={`theme-art is-${t.id}`} aria-hidden="true">
              <i /><i /><i />
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <p className="muted small">System follows your device's appearance and switches with it.</p>
    </>
  );
}

/* ---------- Computer ---------- */

function ComputerSection() {
  const computer = useStore((s) => s.computer);
  const bots = useStore((s) => s.bots);
  const { loadComputer, openViewer } = useStore.getState();
  const [error, setError] = useState<string | null>(null);
  const now = useTick(30_000);
  useEffect(() => {
    void loadComputer();
  }, [loadComputer]);

  return (
    <>
      <h2>Computer</h2>
      <p className="muted">Each bot gets its own browser desktop on this server — a private window it uses to open pages, fill in forms and read what's on screen. You can watch or take control at any time.</p>
      {!computer && <Loading />}
      {computer && !computer.browser && (
        <Empty icon="monitor" title="Browser engine not installed">
          Bots can't open web pages until a browser engine is installed on the server. Everything else keeps working.
        </Empty>
      )}
      {computer && computer.browser && (
        <>
          <div className="status-row">
            <span className="dot-inline dot-ok" />
            <span>Browser engine ready · {computer.desktops.filter((d) => d.open).length} of {computer.maxDesktops} desktops open</span>
          </div>
          <h3 className="pane-heading">Open desktops</h3>
          <ErrorNote>{error}</ErrorNote>
          {computer.desktops.length === 0 ? (
            <p className="muted small">No desktops are open. One opens when a bot first needs to browse.</p>
          ) : (
            <ul className="list">
              {computer.desktops.map((d) => {
                const bot = bots[d.botId];
                return (
                  <li key={d.botId} className="list-row is-card">
                    {bot ? <BotAvatar bot={bot} size={30} /> : <span className="logo-tile">?</span>}
                    <div className="list-row-text">
                      <span className="list-row-title">{bot?.name ?? "Removed bot"}{!d.open && <span className="chip">closed</span>}</span>
                      <span className="list-row-sub truncate" title={d.url ?? undefined}>{d.url || "Blank page"} · used {relTime(d.lastUsedAt, now)}</span>
                    </div>
                    {bot && <IconButton icon="eye" size={16} label={`Watch ${bot.name}'s desktop`} onClick={() => openViewer(bot.id)} />}
                    <ConfirmButton
                      className="btn btn-small"
                      label="Reset"
                      confirmLabel="Confirm reset"
                      busyLabel="Resetting…"
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
          <p className="muted small">Reset closes every page on that desktop and starts it fresh. Up to {plural(computer.maxDesktops, "bot")} can have a desktop open at once.</p>
        </>
      )}
    </>
  );
}

/* ---------- Permissions ---------- */

const MODE_WORDS: Record<Policy["mode"], string> = { always_allow: "Always allowed", blocked: "Never allowed", needs_approval: "Asks first" };

function PermissionsSection() {
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
      <h2>Permissions</h2>
      <p className="muted">Standing decisions about what your bots may do without asking.</p>
      <ErrorNote>{error}</ErrorNote>
      {!policies && <Loading />}
      {policies && policies.length === 0 && (
        <Empty icon="shield" title="No saved permissions">When you choose “Always allow” on an approval, it's remembered here so you can undo it later.</Empty>
      )}
      {policies && policies.length > 0 && (
        <ul className="list">
          {policies.map((p) => {
            const w = toolWords(p.tool);
            return (
              <li key={p.tool} className="list-row is-card">
                <div className="list-row-text">
                  <span className="list-row-title">
                    {w.app}{w.action ? ` · ${w.action}` : ""} <span className={`chip state-${p.mode}`}>{MODE_WORDS[p.mode]}</span>
                  </span>
                  <code className="list-row-sub">{p.tool}</code>
                </div>
                <button type="button" className="btn btn-small" onClick={() => void remove(p.tool)}>Ask again</button>
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
  const { loadConnectors, closeAppSettings, openModal } = useStore.getState();
  useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);
  const manage = () => {
    closeAppSettings();
    openModal({ kind: "connectors" });
  };
  return (
    <>
      <h2>Connectors</h2>
      <div className="action-row">
        <div>
          <p className="action-title">{connectors ? plural(connectors.length, "connector") : "Connectors"}</p>
          <p className="muted small">Remote tool servers your bots can use to work in other apps.</p>
        </div>
        <button type="button" className="btn btn-small" onClick={manage}>Manage connectors</button>
      </div>
      {!connectors && <Loading />}
      {connectors && connectors.length > 0 && (
        <ul className="list">
          {connectors.map((c) => (
            <li key={c.id} className="list-row is-card">
              <span className="logo-tile">{(Array.from(c.name.trim())[0] ?? "?").toUpperCase()}</span>
              <div className="list-row-text">
                <span className="list-row-title">{c.name}</span>
                <span className="list-row-sub truncate">{c.status === "error" ? c.error || "Can't connect" : `${plural(c.tools.length, "tool")} · ${c.url}`}</span>
              </div>
              <span className={`chip state-${c.status}`}>{c.status === "ready" ? "Ready" : c.status === "error" ? "Error" : "Connecting…"}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Depending on each bot's autonomy setting, it asks before changing data through a connector.</p>
    </>
  );
}

/* ---------- Usage ---------- */

function UsageSection() {
  const tick = useStore((s) => s.usageTick);
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
      <h2>Usage</h2>
      <ErrorNote>{error}</ErrorNote>
      {!usage && !error && <Loading />}
      {usage && (
        <>
          <p className="muted">This month ({usage.month}). Costs are estimates based on token counts.</p>
          <div className="stats">
            <div className="stat"><span className="stat-value">{money(usage.totals.costUsd)}</span><span className="stat-label">Estimated cost</span></div>
            <div className="stat"><span className="stat-value">{compactNumber(usage.totals.inputTokens)}</span><span className="stat-label">Input tokens</span></div>
            <div className="stat"><span className="stat-value">{compactNumber(usage.totals.outputTokens)}</span><span className="stat-label">Output tokens</span></div>
            <div className="stat"><span className="stat-value">{compactNumber(usage.totals.turns)}</span><span className="stat-label">Turns</span></div>
          </div>
          {over !== null && (
            <div className="meter-box">
              <div className="meter-head"><span>{over}% of your {money(usage.budgetUsd ?? 0)} budget</span></div>
              <div className={`meter ${over >= 100 ? "is-over" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={over} aria-label="Budget used"><span style={{ width: `${over}%` }} /></div>
            </div>
          )}
          <h3 className="pane-heading">By bot</h3>
          {usage.byBot.length === 0 ? (
            <p className="muted small">No usage recorded yet this month.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th scope="col">Bot</th><th scope="col" className="num">Turns</th><th scope="col" className="num">Input</th><th scope="col" className="num">Output</th><th scope="col" className="num">Cost</th></tr>
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
          <h3 className="pane-heading">Monthly budget</h3>
          <div className="field">
            <label className="field-label" htmlFor={id}>Budget in US dollars</label>
            <div className="row-gap">
              <input
                id={id}
                className="input input-narrow"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={budget}
                placeholder="No limit"
                onChange={(e) => {
                  touched.current = true;
                  setBudget(e.target.value);
                }}
              />
              <button type="button" className="btn btn-primary btn-small" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
              {saved && <span className="muted small" role="status">Saved</span>}
            </div>
            <p className="field-hint">{valid ? "Leave empty for no limit." : "Enter a number of dollars, or leave it empty."}</p>
          </div>
        </>
      )}
    </>
  );
}

/* ---------- Check-ins ---------- */

function CheckinsSection() {
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
    const t = window.setTimeout(() => setNote(null), 2200);
    return () => window.clearTimeout(t);
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
      setNote("Saved");
    } catch (e) {
      setCfg(before);
      setTz(before.timezone);
      setError(errText(e));
    }
  };

  const setTime = (i: number, value: string) => {
    if (!cfg || !/^\d{2}:\d{2}$/.test(value)) return;
    void put({ times: cfg.times.map((t, j) => (j === i ? value : t)) });
  };

  return (
    <>
      <h2>Check-ins</h2>
      <p className="muted">At set times each day, your primary bot looks over what's going on and messages you if something needs attention.</p>
      <ErrorNote>{error}</ErrorNote>
      {!cfg && !error && <Loading />}
      {cfg && (
        <>
          <div className="action-row">
            <div>
              <p className="action-title">Daily check-ins</p>
              <p className="muted small">{cfg.enabled ? "On" : "Off"}</p>
            </div>
            <Toggle checked={cfg.enabled} label="Daily check-ins" onChange={(v) => void put({ enabled: v })} />
          </div>
          <h3 className="pane-heading">Times</h3>
          <ul className="time-list">
            {cfg.times.map((t, i) => (
              <li key={i}>
                <label className="sr-only" htmlFor={`${id}t${i}`}>Check-in time {i + 1}</label>
                <input id={`${id}t${i}`} className="input input-narrow" type="time" value={t} onChange={(e) => setTime(i, e.target.value)} />
                <IconButton icon="close" size={15} label={`Remove ${t}`} onClick={() => void put({ times: cfg.times.filter((_, j) => j !== i) })} />
              </li>
            ))}
          </ul>
          {cfg.times.length === 0 && <p className="muted small">No times set.</p>}
          <button
            type="button"
            className="btn btn-small"
            disabled={cfg.times.length >= 6}
            title={cfg.times.length >= 6 ? "Up to six times a day" : undefined}
            onClick={() => void put({ times: [...cfg.times, ["09:00", "13:00", "17:00", "11:00", "15:00", "20:00"].find((x) => !cfg.times.includes(x)) ?? "12:00"] })}
          >
            <Icon name="plus" size={14} /> Add a time
          </button>
          <p className="muted small">Up to six a day.</p>
          <div className="field">
            <label className="field-label" htmlFor={`${id}z`}>Timezone</label>
            <div className="row-gap">
              <input id={`${id}z`} className="input" value={tz} onChange={(e) => setTz(e.target.value)} placeholder="e.g. Europe/Paris" spellCheck={false} />
              <button type="button" className="btn btn-small" disabled={tz.trim() === cfg.timezone || !tz.trim()} onClick={() => void put({ timezone: tz.trim() })}>Save</button>
            </div>
            <p className="field-hint">
              An IANA timezone name.{" "}
              <button type="button" className="link" onClick={() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone)}>Use this device's</button>
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
                  setNote("Check-in started");
                } catch (e) {
                  setError(errText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="bolt" size={15} /> {busy ? "Starting…" : "Check in now"}
            </button>
            {note && <span className="muted small" role="status">{note}</span>}
          </div>
        </>
      )}
    </>
  );
}

/* ---------- Account ---------- */

function AccountSection() {
  const user = useStore((s) => s.user);
  const logout = useStore((s) => s.logout);
  if (!user) return null;
  return (
    <>
      <h2>Account</h2>
      <div className="account-card">
        <span className="initials is-large">{initials(user.name || user.email)}</span>
        <div className="list-row-text">
          <span className="list-row-title">{user.name || "—"}</span>
          <span className="list-row-sub">{user.email}</span>
        </div>
        <button type="button" className="btn btn-danger btn-small" onClick={() => void logout()}>
          <Icon name="logout" size={14} /> Sign out
        </button>
      </div>
    </>
  );
}

/* ---------- Page ---------- */

export function AppSettings({ section }: { section: AppSection }) {
  const { closeAppSettings, openAppSettings } = useStore.getState();
  const blocked = useStore((s) => !!(s.modal || s.botSettings || s.viewerBotId));
  const root = useRef<HTMLDivElement>(null);
  useEscape(closeAppSettings, !blocked);
  useDialogFocus(root);
  return (
    <div className="app-settings" ref={root} role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1}>
      <nav className="app-settings-nav" aria-label="Settings sections">
        <button type="button" className="btn btn-ghost btn-small back" onClick={closeAppSettings}>
          <Icon name="arrowLeft" size={15} /> Back
        </button>
        <h1>Settings</h1>
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" className={`settings-nav-item ${section === s.id ? "is-active" : ""}`} aria-current={section === s.id ? "page" : undefined} onClick={() => openAppSettings(s.id)}>
            <Icon name={s.icon} size={16} />
            <span>{s.label}</span>
          </button>
        ))}
      </nav>
      <div className="app-settings-main">
        <IconButton icon="close" label="Close settings" className="app-settings-close" onClick={closeAppSettings} />
        <div className="app-settings-content settings-pane">
          {section === "general" && <GeneralSection />}
          {section === "computer" && <ComputerSection />}
          {section === "permissions" && <PermissionsSection />}
          {section === "connectors" && <ConnectorsSection />}
          {section === "usage" && <UsageSection />}
          {section === "checkins" && <CheckinsSection />}
          {section === "account" && <AccountSection />}
        </div>
      </div>
    </div>
  );
}
