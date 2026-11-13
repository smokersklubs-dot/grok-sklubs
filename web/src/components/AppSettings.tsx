import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api, enc, errText } from "../api";
import { LOCALES, tn, useT } from "../i18n";
import { useStore, type AppSection, type Theme } from "../store";
import type { CheckinSettings, Locale, Policy, UsageSummary, VaultItem } from "../types";
import { compactNumber, initials, money, relTime, toolWords } from "../lib/format";
import { BotAvatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { ConfirmButton, Empty, ErrorNote, IconButton, Loading, Toggle, useDialogFocus, useEscape, useTick } from "./ui";

const SECTIONS: { id: AppSection; icon: IconName }[] = [
  { id: "general", icon: "settings" },
  { id: "computer", icon: "monitor" },
  { id: "permissions", icon: "shield" },
  { id: "connectors", icon: "plug" },
  { id: "vault", icon: "key" },
  { id: "usage", icon: "chart" },
  { id: "checkins", icon: "bell" },
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
        </>
      )}
    </>
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
          <p className="action-title">{connectors ? tn("count.app", connectors.length) : t("settings.section.connectors")}</p>
          <p className="muted small">{t("apps.hint")}</p>
        </div>
        <button type="button" className="btn btn-small" onClick={manage}>{t("apps.manage")}</button>
      </div>
      {!connectors && <Loading />}
      {connectors && connectors.length > 0 && (
        <ul className="list">
          {connectors.map((c) => (
            <li key={c.id} className="list-row is-card">
              <span className="logo-tile">{(Array.from(c.name.trim())[0] ?? "?").toUpperCase()}</span>
              <div className="list-row-text">
                <span className="list-row-title">{c.name}</span>
                <span className="list-row-sub truncate">{c.status === "error" ? c.error || t("connector.cantConnect") : `${tn("count.tool", c.tools.length)} · ${c.url}`}</span>
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

interface VaultForm { name: string; site: string; username: string; password: string; note: string }
const EMPTY_LOGIN: VaultForm = { name: "", site: "", username: "", password: "", note: "" };

/** Add or edit one saved login. The password field starts empty: the server never sends a password back. */
function VaultEditor({ item, onSaved, onCancel }: { item: VaultItem | null; onSaved: (item: VaultItem) => void; onCancel: () => void }) {
  const t = useT();
  const [form, setForm] = useState<VaultForm>(item ? { name: item.name, site: item.site, username: item.username, password: "", note: item.note } : EMPTY_LOGIN);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const set = <K extends keyof VaultForm>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || busy) return;
    setBusy(true);
    setError(null);
    // An empty password is left out, so editing keeps the one already saved.
    const body = {
      name: form.name.trim(),
      site: form.site.trim(),
      username: form.username.trim(),
      note: form.note.trim(),
      ...(form.password ? { password: form.password } : {}),
    };
    try {
      const r = item ? await api<{ item: VaultItem }>("PATCH", `/vault/${enc(item.id)}`, body) : await api<{ item: VaultItem }>("POST", "/vault", body);
      onSaved(r.item);
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  return (
    <form className="editor" onSubmit={submit} autoComplete="off" aria-label={t(item ? "vault.editTitle" : "vault.newTitle")}>
      <div className="field">
        <label className="field-label" htmlFor={`${uid}n`}>{t("common.name")}</label>
        <input ref={first} id={`${uid}n`} className="input" value={form.name} maxLength={80} required onChange={(e) => set("name", e.target.value)} placeholder={t("vault.namePlaceholder")} autoComplete="off" />
      </div>
      <div className="form-cols is-even">
        <div className="field">
          <label className="field-label" htmlFor={`${uid}s`}>{t("vault.site")} <span className="muted">{t("common.optional")}</span></label>
          <input id={`${uid}s`} className="input" value={form.site} maxLength={300} onChange={(e) => set("site", e.target.value)} placeholder={t("vault.sitePlaceholder")} autoComplete="off" autoCapitalize="off" spellCheck={false} inputMode="url" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${uid}u`}>{t("vault.username")} <span className="muted">{t("common.optional")}</span></label>
          <input id={`${uid}u`} className="input" value={form.username} maxLength={200} onChange={(e) => set("username", e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${uid}p`}>{t("vault.password")}{!item && <> <span className="muted">{t("common.optional")}</span></>}</label>
        <div className="input-affix">
          <input id={`${uid}p`} className="input" type={reveal ? "text" : "password"} value={form.password} maxLength={500} onChange={(e) => set("password", e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} data-1p-ignore="" data-lpignore="true" />
          <IconButton icon={reveal ? "eyeOff" : "eye"} size={16} label={t(reveal ? "vault.hide" : "vault.show")} active={reveal} onClick={() => setReveal((v) => !v)} />
        </div>
        <p className="field-hint">{item?.hasPassword ? t("vault.passwordKeep") : t("vault.passwordNever")}</p>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${uid}o`}>{t("vault.note")} <span className="muted">{t("common.optional")}</span></label>
        <textarea id={`${uid}o`} className="input" rows={2} value={form.note} maxLength={1000} onChange={(e) => set("note", e.target.value)} placeholder={t("vault.notePlaceholder")} />
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="row-end">
        <button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>{t("common.cancel")}</button>
        <button type="submit" className="btn btn-primary btn-small" disabled={!form.name.trim() || busy}>{t(busy ? "common.saving" : item ? "common.save" : "vault.saveNew")}</button>
      </div>
    </form>
  );
}

function VaultSection() {
  const t = useT();
  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  useEffect(() => {
    let dead = false;
    api<{ items: VaultItem[] }>("GET", "/vault").then(
      (r) => !dead && setItems(Array.isArray(r?.items) ? r.items : []),
      (e: unknown) => {
        if (dead) return;
        setError(errText(e));
        setItems((cur) => cur ?? []);
      },
    );
    return () => {
      dead = true;
    };
  }, []);

  const saved = (item: VaultItem) => {
    setItems((cur) => {
      const list = cur ?? [];
      return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
    });
    setEditing(null);
  };
  const remove = async (item: VaultItem) => {
    setError(null);
    try {
      await api("DELETE", `/vault/${enc(item.id)}`);
      setItems((cur) => cur?.filter((x) => x.id !== item.id) ?? null);
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <>
      <h2>{t("settings.section.vault")}</h2>
      <div className="pane-intro">
        <p className="muted">{t("vault.intro")}</p>
        {editing === null && items && (
          <button type="button" className="btn btn-small" onClick={() => setEditing("new")}>
            <Icon name="plus" size={14} /> {t("vault.add")}
          </button>
        )}
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {editing === "new" && <VaultEditor item={null} onSaved={saved} onCancel={() => setEditing(null)} />}
      {!items && <Loading />}
      {items && items.length === 0 && editing === null && <Empty icon="key" title={t("vault.emptyTitle")}>{t("vault.emptyText")}</Empty>}
      {items && items.length > 0 && (
        <ul className="list">
          {items.map((item) =>
            editing === item.id ? (
              <li key={item.id}>
                <VaultEditor item={item} onSaved={saved} onCancel={() => setEditing(null)} />
              </li>
            ) : (
              <li key={item.id} className="list-row is-card vault-row">
                <span className="logo-tile is-vault" aria-hidden="true">
                  <Icon name="key" size={17} />
                </span>
                <div className="list-row-text">
                  <span className="list-row-title">
                    {item.name}
                    <span className={`chip ${item.hasPassword ? "state-ready" : ""}`}>{t(item.hasPassword ? "vault.hasPassword" : "vault.noPassword")}</span>
                  </span>
                  {(item.site || item.username) && (
                    <span className="list-row-sub">{[item.site, item.username].filter(Boolean).join(" · ")}</span>
                  )}
                  {item.note && <span className="list-row-sub">{item.note}</span>}
                </div>
                <IconButton icon="edit" size={16} label={t("vault.edit", { name: item.name })} onClick={() => setEditing(item.id)} />
                <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("common.delete")} confirmLabel={t("common.confirmDelete")} busyLabel={t("common.deleting")} onConfirm={() => remove(item)} />
              </li>
            ),
          )}
        </ul>
      )}
    </>
  );
}

/* ---------- Usage ---------- */

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
          <p className="muted">{t("usage.intro", { month: usage.month })}</p>
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

/* ---------- Account ---------- */

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
    </>
  );
}

/* ---------- Page ---------- */

export function AppSettings({ section }: { section: AppSection }) {
  const { closeAppSettings, openAppSettings } = useStore.getState();
  const blocked = useStore((s) => !!(s.modal || s.botSettings || s.viewerBotId));
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
          {section === "computer" && <ComputerSection />}
          {section === "permissions" && <PermissionsSection />}
          {section === "connectors" && <ConnectorsSection />}
          {section === "vault" && <VaultSection />}
          {section === "usage" && <UsageSection />}
          {section === "checkins" && <CheckinsSection />}
          {section === "account" && <AccountSection />}
        </div>
      </div>
    </div>
  );
}
