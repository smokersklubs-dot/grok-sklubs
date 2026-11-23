import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Bot } from "../types";
import { Icon } from "./Icon";
import { ConfirmButton, ErrorNote, Loading } from "./ui";
import "./LiveDocs.css";

/**
 * Wave 7 settings panels:
 *  - VaultLivePanel (Settings → Vault): 1Password / Bitwarden live, read only (server vaultlive.ts, L179);
 *  - PluginsPanel (bot → Local tools): plugins to review and install (server plugins.ts, L174);
 *  - RemoteAgentsPanel (bot → Local tools): other agents by A2A or ACP (server remoteagents.ts, L172).
 */
type Provider = "1password" | "bitwarden";
interface LiveStatus { providers: { provider: Provider; connected: boolean; links: number }[] }
interface LiveItem { ref: string; name: string; site: string; username: string; vault: string }

export function VaultLivePanel() {
  const t = useT();
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [open, setOpen] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setStatus(await api<LiveStatus>("GET", "/vault-live")); } catch (e) { setError(errText(e)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const label = (p: Provider) => (p === "1password" ? "1Password" : "Bitwarden");
  return (
    <section className="ext-panel" aria-labelledby="vault-live-h">
      <h3 id="vault-live-h">{t("vaultLive.title")}</h3>
      <p className="muted">{t("vaultLive.intro")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {!status && !error && <Loading />}
      {status && (
        <ul className="list">
          {status.providers.map((p) => (
            <li key={p.provider} className="list-row is-card ext-row">
              <span className="logo-tile is-vault" aria-hidden="true"><Icon name="lock" size={17} /></span>
              <div className="list-row-text">
                <span className="list-row-title">{label(p.provider)} <span className={`chip ${p.connected ? "state-ready" : ""}`}>{p.connected ? t("vaultLive.connected") : t("vaultLive.notConnected")}</span></span>
                <span className="list-row-sub">{t("vaultLive.links", { n: p.links })}</span>
              </div>
              <button type="button" className="btn btn-small" onClick={() => setOpen(open === p.provider ? null : p.provider)} aria-expanded={open === p.provider}>{p.connected ? t("vaultLive.pick") : t("vaultLive.connect")}</button>
              {p.connected && <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("vaultLive.disconnect")} confirmLabel={t("common.confirmDelete")} busyLabel={t("common.deleting")} onConfirm={async () => { await api("DELETE", `/vault-live?provider=${p.provider}`); await load(); }} />}
            </li>
          ))}
        </ul>
      )}
      {open && status && (status.providers.find((p) => p.provider === open)?.connected
        ? <LivePicker provider={open} onLinked={load} />
        : <LiveConnect provider={open} onDone={() => { void load(); }} />)}
      <p className="field-hint">{t("vaultLive.safety")}</p>
    </section>
  );
}

function LiveConnect({ provider, onDone }: { provider: Provider; onDone: () => void }) {
  const t = useT();
  const [f, setF] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api("PUT", "/vault-live", { ...f, provider }); onDone(); } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };
  return (
    <form className="ext-form" onSubmit={submit}>
      {provider === "1password" ? (
        <>
          <label className="field-label">{t("vaultLive.opToken")}<input className="input" type="password" autoComplete="off" required onChange={set("token")} /></label>
          <label className="field-label">{t("vaultLive.opVault")}<input className="input" onChange={set("vault")} /></label>
          <p className="field-hint">{t("vaultLive.opHint")}</p>
        </>
      ) : (
        <>
          <label className="field-label">{t("vaultLive.bwServer")}<input className="input" placeholder="https://vault.bitwarden.com" onChange={set("server")} /></label>
          <label className="field-label">client_id<input className="input" autoComplete="off" required onChange={set("clientId")} /></label>
          <label className="field-label">client_secret<input className="input" type="password" autoComplete="off" required onChange={set("clientSecret")} /></label>
          <label className="field-label">{t("vaultLive.bwPassword")}<input className="input" type="password" autoComplete="off" required onChange={set("password")} /></label>
          <p className="field-hint">{t("vaultLive.bwHint")}</p>
        </>
      )}
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      <button type="submit" className="btn btn-small btn-primary" disabled={busy}>{t("vaultLive.connect")}</button>
    </form>
  );
}

function LivePicker({ provider, onLinked }: { provider: Provider; onLinked: () => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<LiveItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async (e?: FormEvent) => {
    e?.preventDefault(); setBusy(true); setError(null);
    try { setItems((await api<{ items: LiveItem[] }>("GET", `/vault-live/items?provider=${provider}&q=${enc(q)}`)).items); } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };
  const link = async (it: LiveItem) => {
    try { await api("POST", "/vault-live/link", { provider, ref: it.ref }); useStore.setState((s) => ({ vaultTick: s.vaultTick + 1 })); useStore.getState().showToast(t("vaultLive.linked", { name: it.name })); onLinked(); } catch (err) { setError(errText(err)); }
  };
  return (
    <div className="ext-form">
      <form className="ext-search" onSubmit={search} role="search">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("vaultLive.search")} aria-label={t("vaultLive.search")} />
        <button type="submit" className="btn btn-small" disabled={busy}>{t("vaultLive.find")}</button>
      </form>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {items && items.length === 0 && <p className="muted">{t("vaultLive.none")}</p>}
      {items && items.length > 0 && (
        <ul className="list">
          {items.map((it) => (
            <li key={it.ref} className="list-row ext-row">
              <div className="list-row-text"><span className="list-row-title">{it.name}</span><span className="list-row-sub">{[it.site, it.username, it.vault].filter(Boolean).join(" · ")}</span></div>
              <button type="button" className="btn btn-small" onClick={() => void link(it)}>{t("vaultLive.link")}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Plugins ──
interface Finding { code: string; severity: "danger" | "warning" | "info"; line: number; excerpt: string }
interface Plugin { id: string; name: string; version: string; status: "review" | "active" | "blocked"; worst: "ok" | "info" | "warning" | "danger"; findings: Finding[]; accepted: boolean; networkNotes: string[]; proposedBy: "owner" | "bot"; manifest: { description: string; run: { command: string; args: string[] }; tools: { name: string; readOnly: boolean; committing: boolean }[]; permissions: { network: "none" | "bot" | string[]; files: "none" | "workspace" } } }

export function PluginsPanel({ bot }: { bot: Bot }) {
  const t = useT();
  const tick = useStore((s) => s.localToolsTick[bot.id] ?? 0);
  const [list, setList] = useState<Plugin[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setList((await api<{ plugins: Plugin[] }>("GET", `/bots/${bot.id}/plugins`)).plugins); } catch (e) { setError(errText(e)); } }, [bot.id]);
  useEffect(() => { void load(); }, [load, tick]);
  const propose = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    try { await api("POST", `/bots/${bot.id}/plugins`, { manifest: text }); setText(""); setAdding(false); await load(); } catch (err) { setError(errText(err)); }
  };
  const install = async (p: Plugin, accept = false) => { setError(null); try { await api("POST", `/bots/${bot.id}/plugins/${p.id}/install`, { accept }); await load(); } catch (err) { setError(errText(err)); await load(); } };
  const net = (p: Plugin) => (p.manifest.permissions.network === "none" ? t("plugins.netNone") : p.manifest.permissions.network === "bot" ? t("plugins.netBot") : p.manifest.permissions.network.join(", "));
  return (
    <section className="ext-panel" aria-labelledby={`plugins-h-${bot.id}`}>
      <div className="pane-intro">
        <h3 id={`plugins-h-${bot.id}`}>{t("plugins.title")}</h3>
        {!adding && <div className="pane-intro-actions"><button type="button" className="btn btn-small" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> {t("plugins.add")}</button></div>}
      </div>
      <p className="muted">{t("plugins.intro", { name: bot.name })}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {adding && (
        <form className="ext-form" onSubmit={propose}>
          <label className="field-label">{t("plugins.manifest")}<textarea className="input ext-manifest" value={text} onChange={(e) => setText(e.target.value)} required spellCheck={false} /></label>
          <div className="livedoc-actions"><button type="submit" className="btn btn-small btn-primary">{t("plugins.review")}</button><button type="button" className="btn btn-small btn-ghost" onClick={() => setAdding(false)}>{t("common.cancel")}</button></div>
        </form>
      )}
      {!list && !error && <Loading />}
      {list && list.length === 0 && !adding && <p className="muted">{t("plugins.empty")}</p>}
      {list && list.length > 0 && (
        <ul className="list">
          {list.map((p) => (
            <li key={p.id} className="list-row is-card ext-plugin">
              <div className="list-row-text">
                <span className="list-row-title">{p.name} <span className="muted">{p.version}</span> <span className={`chip ${p.status === "active" ? "state-ready" : p.status === "blocked" ? "state-error" : ""}`}>{t(`plugins.status.${p.status}`)}</span>{p.proposedBy === "bot" && <span className="chip">{t("plugins.byBot")}</span>}</span>
                <span className="list-row-sub">{p.manifest.description}</span>
                <span className="list-row-sub">{t("plugins.runs", { cmd: [p.manifest.run.command, ...p.manifest.run.args].join(" ") })}</span>
                <span className="list-row-sub">{t("plugins.perms", { net: net(p), files: p.manifest.permissions.files === "workspace" ? t("plugins.filesWs") : t("plugins.filesNone") })}</span>
                <span className="list-row-sub">{t("plugins.tools", { list: p.manifest.tools.map((x) => `${x.name}${x.committing ? " ⚠" : x.readOnly ? " 👁" : ""}`).join(", ") })}</span>
                {p.networkNotes.map((n) => <span key={n} className="list-row-sub ext-warn">{n}</span>)}
                <span className={`list-row-sub ${p.worst === "danger" ? "ext-danger" : p.worst === "warning" ? "ext-warn" : ""}`}>{t(`plugins.scan.${p.worst}`, { n: p.findings.length })}</span>
                {p.findings.slice(0, 5).map((f, i) => <span key={i} className="list-row-sub ext-finding">{t(`plugins.sev.${f.severity}`)} · « {f.excerpt} »</span>)}
              </div>
              <div className="ext-actions">
                {p.status !== "active" && (p.worst === "danger" && !p.accepted
                  ? <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("plugins.acceptInstall")} confirmLabel={t("plugins.acceptConfirm")} busyLabel={t("plugins.installing")} onConfirm={() => install(p, true)} />
                  : <button type="button" className="btn btn-small btn-primary" onClick={() => void install(p)}>{t("plugins.install")}</button>)}
                <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("common.delete")} confirmLabel={t("common.confirmDelete")} busyLabel={t("common.deleting")} onConfirm={async () => { await api("DELETE", `/bots/${bot.id}/plugins/${p.id}`); await load(); }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Other agents ──
interface Agent { id: string; kind: "a2a" | "acp"; name: string; url: string; hasToken: boolean; command: string; args: string[]; permissions: "refuse" | "allow_in_computer"; card: { description?: string; skills?: string[]; endpoint?: string } }

export function RemoteAgentsPanel() {
  const t = useT();
  const [list, setList] = useState<Agent[] | null>(null);
  const [adding, setAdding] = useState<"a2a" | "acp" | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setList((await api<{ agents: Agent[] }>("GET", "/remote-agents")).agents); } catch (e) { setError(errText(e)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const add = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    const payload = adding === "a2a" ? { kind: "a2a", url: f.url, token: f.token, name: f.name } : { kind: "acp", name: f.name, command: f.command, args: (f.args ?? "").split("\n").map((x) => x.trim()).filter(Boolean), permissions: "refuse" };
    try { await api("POST", "/remote-agents", payload); setAdding(null); setF({}); await load(); } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };
  const perm = async (a: Agent, allow: boolean) => { try { setList((await api<{ agents: Agent[] }>("PATCH", `/remote-agents/${a.id}`, { permissions: allow ? "allow_in_computer" : "refuse" })).agents); } catch (err) { setError(errText(err)); } };
  return (
    <section className="ext-panel" aria-labelledby="ragents-h">
      <div className="pane-intro">
        <h3 id="ragents-h">{t("ragents.title")}</h3>
        {!adding && <div className="pane-intro-actions"><button type="button" className="btn btn-small" onClick={() => setAdding("a2a")}><Icon name="globe" size={14} /> A2A</button><button type="button" className="btn btn-small" onClick={() => setAdding("acp")}><Icon name="terminal" size={14} /> ACP</button></div>}
      </div>
      <p className="muted">{t("ragents.intro")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {adding && (
        <form className="ext-form" onSubmit={add}>
          <label className="field-label">{t("ragents.name")}<input className="input" onChange={set("name")} /></label>
          {adding === "a2a" ? (
            <>
              <label className="field-label">{t("ragents.url")}<input className="input" type="url" required placeholder="https://agent.example" onChange={set("url")} /></label>
              <label className="field-label">{t("ragents.token")}<input className="input" type="password" autoComplete="off" onChange={set("token")} /></label>
            </>
          ) : (
            <>
              <label className="field-label">{t("ragents.command")}<input className="input" required placeholder="npx" onChange={set("command")} /></label>
              <label className="field-label">{t("ragents.args")}<textarea className="input" rows={3} onChange={set("args")} /></label>
              <p className="field-hint">{t("ragents.acpHint")}</p>
            </>
          )}
          <div className="livedoc-actions"><button type="submit" className="btn btn-small btn-primary" disabled={busy}>{t("ragents.add")}</button><button type="button" className="btn btn-small btn-ghost" onClick={() => setAdding(null)}>{t("common.cancel")}</button></div>
        </form>
      )}
      {list && list.length === 0 && !adding && <p className="muted">{t("ragents.empty")}</p>}
      {list && list.length > 0 && (
        <ul className="list">
          {list.map((a) => (
            <li key={a.id} className="list-row is-card ext-row">
              <div className="list-row-text">
                <span className="list-row-title">{a.name} <span className="chip">{a.kind === "a2a" ? "A2A" : "ACP"}</span></span>
                <span className="list-row-sub">{a.kind === "a2a" ? a.card.endpoint || a.url : [a.command, ...a.args].join(" ")}</span>
                {a.card.description && <span className="list-row-sub">{a.card.description}</span>}
                {a.kind === "acp" && (
                  <label className="livedoc-bot"><input type="checkbox" checked={a.permissions === "allow_in_computer"} onChange={(e) => void perm(a, e.target.checked)} /> {t("ragents.allowInComputer")}</label>
                )}
              </div>
              <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("common.delete")} confirmLabel={t("common.confirmDelete")} busyLabel={t("common.deleting")} onConfirm={async () => { setList((await api<{ agents: Agent[] }>("DELETE", `/remote-agents/${a.id}`)).agents); }} />
            </li>
          ))}
        </ul>
      )}
      <p className="field-hint">{t("ragents.safety")}</p>
    </section>
  );
}
