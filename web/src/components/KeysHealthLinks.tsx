import { useEffect, useId, useState } from "react";
import { create } from "zustand";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import { relTime } from "../lib/format";
import type { Bot, CredentialHealth, HealthState, ImportPreview, ImportReport, PublicLink, ReachState, ThirdPartySpend } from "../types";
import { Icon } from "./Icon";
import { ConfirmButton, Empty, ErrorNote, Loading, Toggle } from "./ui";

/* Wave 7 (spec 08 and Agent Reach): reading logins, the credential relay, paid third-party tools, health of keys and
   connections, project import, temporary public links. */

function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  return { busy, error, setError, run };
}
const usd = (n: number) => `${n.toFixed(2)} $`;

/* ---------- Health of keys and connections (A2) ---------- */

interface HealthStore { items: CredentialHealth[] | null; loading: boolean; load(): Promise<void>; checkAll(): Promise<void>; checkOne(kind: string, id: string): Promise<void> }
export const useHealth = create<HealthStore>((set) => ({
  items: null,
  loading: false,
  async load() {
    try { const r = await api<{ items: CredentialHealth[] }>("GET", "/health/credentials"); set({ items: r.items }); } catch { set((s) => ({ items: s.items ?? [] })); }
  },
  async checkAll() {
    set({ loading: true });
    try { const r = await api<{ items: CredentialHealth[] }>("POST", "/health/credentials/check"); set({ items: r.items }); } finally { set({ loading: false }); }
  },
  async checkOne(kind, id) {
    const r = await api<{ items: CredentialHealth[] }>("POST", `/health/credentials/${enc(kind)}/${enc(id)}/check`);
    set({ items: r.items });
  },
}));
function useHealthItems() {
  const tick = useStore((s) => s.wave7Tick);
  const items = useHealth((s) => s.items);
  useEffect(() => { void useHealth.getState().load(); }, [tick]);
  return items;
}

const STATE_CLASS: Record<HealthState, string> = { ok: "state-ready", broken: "state-error", reconnect: "state-waiting", uncertain: "state-waiting", never: "" };

/** A small "works / key refused / reconnect / uncertain / never checked" chip, for the vault and app lists. */
export function HealthBadge({ kind, id }: { kind: CredentialHealth["kind"]; id: string }) {
  const t = useT();
  const items = useHealthItems();
  const h = items?.find((x) => x.kind === kind && x.id === id);
  if (!h) return null;
  const title = [h.detail, h.checkedAt ? t("health.checkedAt", { when: relTime(h.checkedAt) }) : "", h.how].filter(Boolean).join(" · ");
  return <span className={`chip health-chip ${STATE_CLASS[h.state]}`} title={title}>{t(`health.state.${h.state}` as Key)}</span>;
}

function HealthList() {
  const t = useT();
  const items = useHealthItems();
  const loading = useHealth((s) => s.loading);
  const { busy, error, run } = useBusy();
  if (!items) return <Loading />;
  const groups: { kind: CredentialHealth["kind"]; label: Key }[] = [
    { kind: "vault", label: "health.group.vault" }, { kind: "api", label: "health.group.api" }, { kind: "native", label: "health.group.native" }, { kind: "connector", label: "health.group.connector" },
  ];
  const broken = items.filter((i) => i.state === "broken" || i.state === "reconnect").length;
  return (
    <>
      <div className="pane-intro">
        <p className="muted">{t("health.intro")}</p>
        <button type="button" className="btn btn-small" disabled={loading} onClick={() => void run("all", () => useHealth.getState().checkAll())}>
          <Icon name="refresh" size={14} /> {t(loading ? "health.checking" : "health.checkAll")}
        </button>
      </div>
      {broken > 0 && <p className="note-line health-alert" role="status"><Icon name="alert" size={14} /> <span>{t("health.brokenCount", { n: broken })}</span></p>}
      <ErrorNote>{error}</ErrorNote>
      {items.length === 0 && <Empty icon="key" title={t("health.emptyTitle")}>{t("health.emptyText")}</Empty>}
      {groups.map((g) => {
        const list = items.filter((i) => i.kind === g.kind);
        if (!list.length) return null;
        return (
          <section key={g.kind}>
            <h3 className="pane-heading">{t(g.label)}</h3>
            <ul className="list">
              {list.map((h) => (
                <li key={`${h.kind}-${h.id}`} className="list-row is-card health-row">
                  <span className={`health-dot is-${h.state}`} aria-hidden="true" />
                  <div className="list-row-text">
                    <span className="list-row-title">{h.name} <span className={`chip ${STATE_CLASS[h.state]}`}>{t(`health.state.${h.state}` as Key)}</span>{h.rateLimited && <span className="chip">{t("health.rateLimited")}</span>}</span>
                    <span className="list-row-sub">
                      {h.checkedAt ? t("health.checkedAt", { when: relTime(h.checkedAt) }) : t("health.notYet")}
                      {h.detail ? ` · ${h.detail}` : ""}{h.how ? ` · ${h.how}` : ""}
                      {h.manualToken && h.state !== "never" ? ` · ${t("health.manualToken")}` : ""}
                    </span>
                  </div>
                  {(h.kind === "vault" || h.kind === "api") && (
                    <button type="button" className="btn btn-small btn-ghost" disabled={busy !== null} onClick={() => void run(h.id, () => useHealth.getState().checkOne(h.kind, h.id))}>
                      {t(busy === h.id ? "health.checking" : "health.checkOne")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/* ---------- Project import (A6) ---------- */

function readAs(file: File, as: "text" | "base64"): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("read"));
    r.onload = () => resolve(as === "text" ? String(r.result) : String(r.result).replace(/^data:[^,]*,/, ""));
    if (as === "text") r.readAsText(file); else r.readAsDataURL(file);
  });
}

function ProjectImport() {
  const t = useT();
  const all = useStore((s) => s.bots);
  const bots = Object.values(all).filter((b) => b.kind === "agent" && !b.access);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<Record<string, { import: boolean; hosts: string; header: string; prefix: string }>>({});
  const [skillPick, setSkillPick] = useState<Record<string, boolean>>({});
  const [replace, setReplace] = useState(false);
  const [scope, setScope] = useState("shared");
  const [report, setReport] = useState<ImportReport | null>(null);
  const { busy, error, setError, run } = useBusy();
  const uid = useId();

  const onFiles = (files: FileList | null) => run("preview", async () => {
    if (!files?.length) return;
    let env = "", zip = "";
    for (const f of Array.from(files)) {
      if (/\.zip$/i.test(f.name)) zip = await readAs(f, "base64");
      else env += `${await readAs(f, "text")}\n`;
    }
    const p = await api<ImportPreview>("POST", "/import/project/preview", { ...(env.trim() ? { env } : {}), ...(zip ? { zip } : {}) });
    setPreview(p);
    setReport(null);
    setRows(Object.fromEntries(p.variables.filter((v) => v.isSecret).map((v) => [v.name, { import: v.hosts.length > 0, hosts: v.hosts.join(", "), header: v.header, prefix: v.prefix }])));
    setSkillPick(Object.fromEntries(p.skills.map((s) => [s.name, !s.exists])));
  });
  const commit = () => run("commit", async () => {
    if (!preview) return;
    const r = await api<{ report: ImportReport }>("POST", "/import/project/commit", {
      previewId: preview.previewId, replace, skillScope: scope,
      bindings: Object.entries(rows).map(([name, v]) => ({ name, import: v.import, hosts: v.hosts, header: v.header, prefix: v.prefix })),
      skills: Object.entries(skillPick).filter(([, on]) => on).map(([n]) => n),
    });
    setReport(r.report);
    setPreview(null);
    void useHealth.getState().load();
  });
  const set = (name: string, patch: Partial<{ import: boolean; hosts: string; header: string; prefix: string }>) => setRows((cur) => ({ ...cur, [name]: { ...cur[name], ...patch } }));

  return (
    <section className="project-import">
      <h3 className="pane-heading">{t("import.heading")}</h3>
      <p className="muted small">{t("import.intro")}</p>
      {!preview && (
        <label className="drop-zone" htmlFor={`${uid}f`}>
          <Icon name="upload" size={18} />
          <span>{t(busy === "preview" ? "common.working" : "import.drop")}</span>
          <input id={`${uid}f`} type="file" multiple accept=".env,.txt,.zip,text/plain,application/zip" className="sr-only" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
        </label>
      )}
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {preview && (
        <div className="import-preview">
          <p className="note-line"><Icon name="lock" size={13} /> <span>{t("import.noValues")}</span></p>
          {preview.variables.filter((v) => v.isSecret).length > 0 && (
            <table className="import-table">
              <thead><tr><th>{t("import.col.import")}</th><th>{t("import.col.name")}</th><th>{t("import.col.provider")}</th><th>{t("import.col.hosts")}</th><th>{t("import.col.header")}</th></tr></thead>
              <tbody>
                {preview.variables.filter((v) => v.isSecret).map((v) => (
                  <tr key={v.name} className={rows[v.name]?.import ? "" : "is-off"}>
                    <td><input type="checkbox" checked={!!rows[v.name]?.import} onChange={(e) => set(v.name, { import: e.target.checked })} aria-label={t("import.col.import")} /></td>
                    <td><code>{v.name}</code>{v.exists && <span className="chip">{t("import.exists")}</span>}</td>
                    <td>{v.provider ?? <span className="muted">{t("import.unknown")}</span>}</td>
                    <td><input className="input input-small" value={rows[v.name]?.hosts ?? ""} placeholder="api.example.com" onChange={(e) => set(v.name, { hosts: e.target.value })} aria-label={t("import.col.hosts")} /></td>
                    <td><code className="small">{rows[v.name]?.header}{rows[v.name]?.prefix ? ` ${rows[v.name]?.prefix.trim()} …` : ""}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {preview.ignored.length > 0 && <p className="muted small">{t("import.ignored", { list: preview.ignored.join(", ") })}</p>}
          {preview.skills.length > 0 && (
            <>
              <p className="field-label">{t("import.skills")}</p>
              <ul className="list compact">
                {preview.skills.map((s) => (
                  <li key={s.path} className="list-row">
                    <input type="checkbox" checked={!!skillPick[s.name]} onChange={(e) => setSkillPick((c) => ({ ...c, [s.name]: e.target.checked }))} aria-label={s.name} />
                    <div className="list-row-text">
                      <span className="list-row-title">{s.name}{s.exists && <span className="chip">{t("import.exists")}</span>}</span>
                      <span className="list-row-sub">{s.description || s.path}</span>
                      {s.mentionsKey && <span className="list-row-sub warn-text"><Icon name="alert" size={12} /> {t("import.skillKey")}</span>}
                    </div>
                  </li>
                ))}
              </ul>
              <label className="field-label" htmlFor={`${uid}s`}>{t("import.scope")}</label>
              <select id={`${uid}s`} className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="shared">{t("import.scopeShared")}</option>
                {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </>
          )}
          <label className="check-row"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> {t("import.replace")}</label>
          <div className="row-end">
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setPreview(null)}>{t("common.cancel")}</button>
            <button type="button" className="btn btn-primary btn-small" disabled={busy !== null} onClick={() => void commit()}>{t(busy === "commit" ? "common.working" : "import.commit")}</button>
          </div>
        </div>
      )}
      {report && (
        <div className="import-report" role="status">
          <p>{t("import.report", { created: report.created.length, updated: report.updated.length, skipped: report.skipped.length, skills: report.skills.length })}</p>
          {report.toComplete.length > 0 && <p className="warn-text small">{t("import.toComplete", { list: report.toComplete.join(", ") })}</p>}
          {report.health.length > 0 && (
            <ul className="list compact">
              {report.health.map((h) => <li key={h.name} className="list-row"><code>{h.name}</code> <span className={`chip ${STATE_CLASS[h.state]}`}>{t(`health.state.${h.state}` as Key)}</span> <span className="muted small">{h.detail}</span></li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Settings → Keys and connections. */
export function KeysSection() {
  const t = useT();
  return (
    <>
      <h2>{t("settings.section.keys")}</h2>
      <HealthList />
      <ProjectImport />
      <h3 className="pane-heading">{t("egress.heading")}</h3>
      <p className="muted small">{t("egress.accountIntro")}</p>
    </>
  );
}

/* ---------- Temporary public links (A8) ---------- */

export function PublicLinksBlock() {
  const t = useT();
  const tick = useStore((s) => s.wave7Tick);
  const [links, setLinks] = useState<PublicLink[] | null>(null);
  const { error, run } = useBusy();
  useEffect(() => { api<{ links: PublicLink[] }>("GET", "/public-links").then((r) => setLinks(r.links), () => setLinks([])); }, [tick]);
  return (
    <section>
      <h3 className="pane-heading">{t("links.heading")}</h3>
      <p className="muted small">{t("links.intro")}</p>
      <ErrorNote>{error}</ErrorNote>
      {!links ? <Loading /> : links.length === 0 ? <p className="muted small">{t("links.none")}</p> : (
        <ul className="list">
          {links.map((l) => (
            <li key={l.id} className="list-row is-card">
              <span className="logo-tile is-link" aria-hidden="true"><Icon name="globe" size={16} /></span>
              <div className="list-row-text">
                <span className="list-row-title">{l.path.split("/").pop()} <span className="chip">{l.botName}</span></span>
                <span className="list-row-sub">{t("links.expires", { when: new Date(l.expiresAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) })} · {t("links.downloads", { n: l.downloads })} · {l.size < 1_000_000 ? `${Math.max(1, Math.round(l.size / 1000))} Ko` : `${(l.size / 1_000_000).toFixed(1)} Mo`}</span>
              </div>
              <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("links.revoke")} confirmLabel={t("links.revokeConfirm")} busyLabel={t("common.working")} onConfirm={() => run(l.id, async () => { await api("DELETE", `/public-links/${enc(l.id)}`); setLinks((c) => c?.filter((x) => x.id !== l.id) ?? null); })} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- Bot settings → Reading & keys ---------- */

const READS_STATUS: Record<string, Key> = { ready: "reach.status.ready", needs_user_action: "reach.status.needs", not_added: "reach.status.notAdded", broken: "reach.status.broken", unverified: "reach.status.unverified" };

function ReadingLogins({ bot }: { bot: Bot }) {
  const t = useT();
  const tick = useStore((s) => s.wave7Tick);
  const [state, setState] = useState<ReachState | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const { busy, error, run } = useBusy();
  useEffect(() => {
    let dead = false;
    api<ReachState>("GET", `/bots/${enc(bot.id)}/reach`).then((r) => !dead && setState(r), (e) => !dead && setState({ available: false, reason: errText(e), version: null, logins: [], channels: [] }));
    return () => { dead = true; };
  }, [bot.id, tick]);
  const act = (channel: string, action: "login" | "logout") => run(`${channel}:${action}`, async () => {
    await api("POST", `/bots/${enc(bot.id)}/reach/${enc(channel)}/${action}`);
    if (action === "login") { setOpened(channel); useStore.getState().openViewer(bot.id, { control: true }); }
    const r = await api<ReachState>("GET", `/bots/${enc(bot.id)}/reach`);
    setState(r);
  });
  return (
    <section className="reach-logins">
      <h3 className="pane-heading">{t("reach.heading")}</h3>
      <p className="muted small">{t("reach.intro", { name: bot.name })}</p>
      <p className="note-line"><Icon name="shield" size={13} /> <span>{t("reach.secondary")}</span></p>
      {!state ? <Loading /> : !state.available ? <p className="muted small">{t("reach.unavailable", { reason: state.reason })}</p> : (
        <>
          <ul className="list">
            {state.logins.map((l) => (
              <li key={l.channel} className="list-row is-card">
                <span className={`logo-tile is-reach is-${l.channel}`} aria-hidden="true"><Icon name="globe" size={16} /></span>
                <div className="list-row-text">
                  <span className="list-row-title">{l.label} <span className={`chip ${l.loggedIn ? "state-ready" : ""}`}>{t(l.loggedIn ? "reach.loggedIn" : l.loggedIn === false ? "reach.loggedOut" : "reach.unknown")}</span></span>
                  <span className="list-row-sub">{t(READS_STATUS[l.status] ?? "reach.status.other", { status: l.status })}</span>
                  {opened === l.channel && <span className="list-row-sub">{t("reach.openedHint", { name: bot.name })}</span>}
                </div>
                <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void act(l.channel, "login")}>{t(busy === `${l.channel}:login` ? "common.working" : "reach.login")}</button>
                <button type="button" className="btn btn-small btn-ghost" disabled={busy !== null} onClick={() => void act(l.channel, "logout")}>{t("reach.logout")}</button>
              </li>
            ))}
          </ul>
          <p className="muted small">{t("reach.channels", { version: state.version ?? "", list: state.channels.map((c) => `${c.channel}${c.status === "ready" ? " ✓" : ""}`).join(", ") })}</p>
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}

function RelayBlock({ bot }: { bot: Bot }) {
  const t = useT();
  const { busy, error, run } = useBusy();
  const toggle = (on: boolean) => run("relay", async () => {
    const r = await api<{ bot: Bot }>("PATCH", `/bots/${enc(bot.id)}`, { relayEnabled: on });
    useStore.getState().upsertBot(r.bot);
  });
  return (
    <section>
      <h3 className="pane-heading">{t("egress.heading")}</h3>
      <div className="action-row">
        <div>
          <p className="action-title">{t("egress.toggle")}</p>
          <p className="muted small">{t("egress.intro", { name: bot.name })}</p>
        </div>
        <Toggle checked={bot.relayEnabled} disabled={busy !== null} label={t("egress.toggle")} onChange={(v) => void toggle(v)} />
      </div>
      {bot.relayEnabled && <pre className="code-sample">{`sklubot-api "Stripe" GET https://api.stripe.com/v1/balance\n# ${t("egress.codeHint")}\n$SKLUBOT_RELAY_URL/<secret>/<host>/<path>  +  X-Sklubot-Relay-Token`}</pre>}
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}

function PaidTools({ bot }: { bot: Bot }) {
  const t = useT();
  const tick = useStore((s) => s.usageTick);
  const [data, setData] = useState<{ spend: ThirdPartySpend; consents: { capability: string; provider: string }[] } | null>(null);
  const [cap, setCap] = useState(bot.thirdPartyDailyCapUsd === null ? "" : String(bot.thirdPartyDailyCapUsd));
  const { busy, error, run } = useBusy();
  const uid = useId();
  useEffect(() => { api<{ spend: ThirdPartySpend; consents: { capability: string; provider: string }[] }>("GET", `/thirdparty?bot=${enc(bot.id)}`).then(setData, () => undefined); }, [bot.id, tick]);
  const save = () => run("cap", async () => {
    const r = await api<{ bot: Bot }>("PATCH", `/bots/${enc(bot.id)}`, { thirdPartyDailyCapUsd: cap.trim() === "" ? null : Number(cap) });
    useStore.getState().upsertBot(r.bot);
  });
  return (
    <section>
      <h3 className="pane-heading">{t("paid.heading")}</h3>
      <p className="muted small">{t("paid.intro")}</p>
      <div className="field-inline">
        <label className="field-label" htmlFor={`${uid}c`}>{t("paid.cap")}</label>
        <input id={`${uid}c`} className="input input-small" inputMode="decimal" value={cap} placeholder={t("paid.noCap")} onChange={(e) => setCap(e.target.value)} />
        <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void save()}>{t("common.save")}</button>
      </div>
      {data && <p className="muted small">{t("paid.today", { today: usd(data.spend.todayUsd), month: usd(data.spend.monthUsd) })}</p>}
      {data && data.consents.length > 0 && (
        <div className="action-row">
          <p className="muted small">{t("paid.consents", { list: data.consents.map((c) => `${c.provider} (${c.capability})`).join(", ") })}</p>
          <button type="button" className="btn btn-small btn-ghost" disabled={busy !== null} onClick={() => void run("consents", async () => { await api("DELETE", `/bots/${enc(bot.id)}/paid-consents`); setData((d) => (d ? { ...d, consents: [] } : d)); })}>{t("paid.askAgain")}</button>
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}

export function BotReachTab({ bot }: { bot: Bot }) {
  return (
    <div className="settings-pane">
      <ReadingLogins bot={bot} />
      <RelayBlock bot={bot} />
      <PaidTools bot={bot} />
    </div>
  );
}
