import { useEffect, useId, useState } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { relTime } from "../lib/format";
import type { Bot, GrokImportPreview } from "../types";
import { Icon } from "./Icon";
import { CopyButton, ErrorNote } from "./ui";
import "./OpenAccess.css";

/* Wave 6 owner panels (server: accountnetroutes.ts): several keys per model provider and which one a bot uses first (L82),
 * where a bot may go on the internet and the owner's blocked sites (L169), outgoing webhooks (L170), and bringing bots
 * from a local Claude Code / Codex / OpenClaw / Hermes setup (L181). */

interface KeyView { id: string; name: string; resting: boolean; restUntil?: number | null; lastError?: string | null }

/** Why a key rests, in the owner's words (the server says it in English: providerkeys.ts keyFailure). */
const restKey = (why: string | null | undefined): Key => (/429/.test(why ?? "") ? "open.rest.limit" : /refused/.test(why ?? "") ? "open.rest.refused" : "open.rest.credit");

/** Settings → Models → a provider being edited → « Clés » (L82). */
export function ProviderKeysBlock({ providerId }: { providerId: string }) {
  const t = useT();
  const uid = useId();
  const [keys, setKeys] = useState<KeyView[] | null>(null);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api<{ keys: KeyView[] }>("GET", `/api-providers/${enc(providerId)}/keys`).then((r) => setKeys(Array.isArray(r?.keys) ? r.keys : []), (e) => setError(errText(e))); }, [providerId]);
  const add = async () => {
    setError(null);
    try { const r = await api<{ keys: KeyView[] }>("POST", `/api-providers/${enc(providerId)}/keys`, { name, key }); setKeys(r.keys); setName(""); setKey(""); } catch (e) { setError(errText(e)); }
  };
  const remove = async (id: string) => { try { setKeys((await api<{ keys: KeyView[] }>("DELETE", `/api-providers/${enc(providerId)}/keys/${enc(id)}`)).keys); } catch (e) { setError(errText(e)); } };
  if (!keys) return error ? <ErrorNote>{error}</ErrorNote> : null;
  return (
    <div className="field open-keys">
      <span className="field-label">{t("open.keys")}</span>
      <span className="field-hint">{t("open.keysHint")}</span>
      <ul className="list">
        {keys.map((k) => (
          <li key={k.id} className="list-row">
            <Icon name="key" size={14} />
            <span className="list-row-text">
              <span className="list-row-title">{k.name}</span>
              {k.resting && <span className="list-row-sub warn-text">{t("open.keyResting", { why: t(restKey(k.lastError)) })}</span>}
            </span>
            {k.id !== "main" && <button type="button" className="btn btn-small btn-ghost" onClick={() => void remove(k.id)}>{t("common.delete")}</button>}
          </li>
        ))}
      </ul>
      <div className="open-row">
        <input className="input input-small" aria-label={t("open.keyName")} placeholder={t("open.keyName")} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} id={`${uid}n`} />
        <input className="input input-small" type="password" aria-label={t("open.keyValue")} placeholder={t("open.keyValue")} value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} data-1p-ignore="" data-lpignore="true" />
        <button type="button" className="btn btn-small" disabled={!name.trim() || !key.trim()} onClick={() => void add()}><Icon name="plus" size={14} /> {t("open.keyAdd")}</button>
      </div>
      <span className="field-hint">{t("open.keysNoSub")}</span>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </div>
  );
}

/** Bot settings → Sécurité → « Clé utilisée » per provider with several keys (L82). */
export function BotProviderKeysBlock({ bot }: { bot: Bot }) {
  const t = useT();
  const [data, setData] = useState<{ choices: Record<string, string>; providers: { id: string; name: string; keys: KeyView[] }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api<typeof data>("GET", `/bots/${bot.id}/provider-keys`).then((r) => setData({ choices: r?.choices ?? {}, providers: Array.isArray(r?.providers) ? r.providers : [] }), (e) => setError(errText(e))); }, [bot.id]);
  const choose = async (providerId: string, keyId: string) => {
    try { const r = await api<{ choices: Record<string, string> }>("PUT", `/bots/${bot.id}/provider-keys`, { providerId, keyId: keyId || null }); setData((d) => (d ? { ...d, choices: r.choices } : d)); } catch (e) { setError(errText(e)); }
  };
  if (!data || data.providers.length === 0) return error ? <ErrorNote>{error}</ErrorNote> : null;
  return (
    <>
      <h3 className="pane-heading">{t("open.botKeys")}</h3>
      <p className="muted small">{t("open.botKeysHint", { name: bot.name })}</p>
      {data.providers.map((p) => (
        <label key={p.id} className="field">
          <span className="field-label">{p.name}</span>
          <select className="input" value={data.choices[p.id] ?? ""} onChange={(e) => void choose(p.id, e.target.value)}>
            <option value="">{t("open.botKeysOrder")}</option>
            {p.keys.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </label>
      ))}
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </>
  );
}

type NetMode = "all" | "list" | "none";
/** Bot settings → Sécurité → « Accès à Internet » and the owner's « Sites interdits » (L169). */
export function BotNetworkBlock({ bot }: { bot: Bot }) {
  const t = useT();
  const uid = useId();
  const [mode, setMode] = useState<NetMode | null>(null);
  const [hosts, setHosts] = useState("");
  const [blocked, setBlocked] = useState("");
  const [saved, setSaved] = useState<"bot" | "blocked" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<{ policy: { mode: NetMode; hosts: string[] }; blocked: string[] }>("GET", `/bots/${bot.id}/network`).then((r) => { setMode(r?.policy?.mode ?? "all"); setHosts((r?.policy?.hosts ?? []).join("\n")); setBlocked((r?.blocked ?? []).join("\n")); }, (e) => setError(errText(e)));
  }, [bot.id]);
  const save = async (next: NetMode = mode ?? "all") => {
    setError(null); setSaved(null);
    try { const r = await api<{ policy: { mode: NetMode; hosts: string[] } }>("PUT", `/bots/${bot.id}/network`, { mode: next, hosts }); setMode(r.policy.mode); setHosts(r.policy.hosts.join("\n")); setSaved("bot"); } catch (e) { setError(errText(e)); }
  };
  const saveBlocked = async () => {
    setError(null); setSaved(null);
    try { const r = await api<{ hosts: string[] }>("PUT", "/network/blocked-sites", { hosts: blocked }); setBlocked(r.hosts.join("\n")); setSaved("blocked"); } catch (e) { setError(errText(e)); }
  };
  if (!mode) return error ? <ErrorNote>{error}</ErrorNote> : null;
  return (
    <>
      <h3 className="pane-heading">{t("open.net")}</h3>
      <p className="muted small">{t("open.netHint", { name: bot.name })}</p>
      <div className="seg-tabs open-net-modes" role="radiogroup" aria-label={t("open.net")}>
        {(["all", "list", "none"] as NetMode[]).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={`seg-tab ${mode === m ? "is-active" : ""}`} onClick={() => { setMode(m); if (m !== "list") void save(m); }}>{t(`open.net.${m}` as Key)}</button>
        ))}
      </div>
      {mode === "list" && (
        <div className="field">
          <label className="field-label" htmlFor={`${uid}l`}>{t("open.netList")}</label>
          <textarea id={`${uid}l`} className="input mono" rows={4} value={hosts} onChange={(e) => setHosts(e.target.value)} placeholder={"wikipedia.org\napi.github.com"} />
          <div className="row-end">{saved === "bot" && <span className="muted small" role="status">{t("common.saved")}</span>}<button type="button" className="btn btn-small" onClick={() => void save("list")}>{t("common.save")}</button></div>
        </div>
      )}
      {mode !== "list" && saved === "bot" && <p className="muted small" role="status">{t("common.saved")}</p>}
      <p className="field-hint">{t("open.netCovered")}</p>
      <div className="field">
        <label className="field-label" htmlFor={`${uid}b`}>{t("open.blocked")}</label>
        <textarea id={`${uid}b`} className="input mono" rows={3} value={blocked} onChange={(e) => setBlocked(e.target.value)} placeholder={"exemple-interdit.com"} />
        <p className="field-hint">{t("open.blockedHint")}</p>
        <div className="row-end">{saved === "blocked" && <span className="muted small" role="status">{t("common.saved")}</span>}<button type="button" className="btn btn-small" onClick={() => void saveBlocked()}>{t("common.save")}</button></div>
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </>
  );
}

const EVENTS = ["message.created", "task.finished", "approval.pending"] as const;
interface Delivery { id: string; event: string; status: "pending" | "done" | "failed"; attempts: number; lastStatus: number | null; lastError: string; createdAt: number }
interface Hook { id: string; url: string; events: string[]; active: boolean; deliveries: Delivery[] }
/** Bot settings → Accès API → « Webhooks sortants » (L170). */
export function BotWebhooksBlock({ bot }: { bot: Bot }) {
  const t = useT();
  const uid = useId();
  const [hooks, setHooks] = useState<Hook[] | null>(null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["message.created"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<{ webhooks: Hook[] }>("GET", `/bots/${bot.id}/webhooks`).then((r) => setHooks(Array.isArray(r?.webhooks) ? r.webhooks : []), (e) => setError(errText(e)));
  useEffect(() => { void load(); }, [bot.id]);
  const act = async (fn: () => Promise<{ webhooks: Hook[]; secret?: string }>) => { setError(null); try { const r = await fn(); setHooks(Array.isArray(r?.webhooks) ? r.webhooks : []); if (r?.secret) setSecret(r.secret); } catch (e) { setError(errText(e)); } };
  if (!hooks) return error ? <ErrorNote>{error}</ErrorNote> : null;
  return (
    <>
      <h3 className="pane-heading">{t("open.hooks")}</h3>
      <p className="muted small">{t("open.hooksHint")}</p>
      {secret && (
        <div className="callout is-info open-secret" role="status">
          <Icon name="key" size={16} />
          <div><p>{t("open.hookSecret")}</p><code className="mono">{secret}</code><div className="row-start"><CopyButton text={secret} /><button type="button" className="btn btn-small btn-ghost" onClick={() => setSecret(null)}>{t("common.close")}</button></div></div>
        </div>
      )}
      {hooks.length > 0 && (
        <ul className="list">
          {hooks.map((h) => (
            <li key={h.id} className="list-row is-card open-hook">
              <span className="list-row-text">
                <span className="list-row-title mono truncate">{h.url}</span>
                <span className="list-row-sub">{h.events.map((e) => t(`open.event.${e}` as Key)).join(" · ")}{h.active ? "" : ` · ${t("open.hookOff")}`}</span>
                {h.deliveries.slice(0, 3).map((d) => (
                  <span key={d.id} className={`list-row-sub ${d.status === "failed" ? "warn-text" : ""}`}>{t(`open.delivery.${d.status}` as Key)} · {t(`open.event.${d.event}` as Key)} · {relTime(d.createdAt)}{d.lastError ? ` · ${d.lastError}` : ""}</span>
                ))}
              </span>
              <span className="open-hook-actions">
                <button type="button" className="btn btn-small btn-ghost" onClick={() => void act(() => api("POST", `/bots/${bot.id}/webhooks/${enc(h.id)}/test`))}>{t("open.hookTest")}</button>
                <button type="button" className="btn btn-small btn-ghost" onClick={() => void act(() => api("PATCH", `/bots/${bot.id}/webhooks/${enc(h.id)}`, { active: !h.active }))}>{t(h.active ? "open.hookPause" : "open.hookResume")}</button>
                <button type="button" className="btn btn-small btn-ghost" onClick={() => void act(() => api("DELETE", `/bots/${bot.id}/webhooks/${enc(h.id)}`))}>{t("common.delete")}</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="field">
        <label className="field-label" htmlFor={`${uid}u`}>{t("open.hookUrl")}</label>
        <input id={`${uid}u`} className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://exemple.com/webhook" spellCheck={false} autoCapitalize="off" />
        <div className="chip-row">
          {EVENTS.map((e) => (
            <label key={e} className="check-chip"><input type="checkbox" checked={events.includes(e)} onChange={(x) => setEvents((cur) => (x.target.checked ? [...cur, e] : cur.filter((y) => y !== e)))} /> {t(`open.event.${e}` as Key)}</label>
          ))}
        </div>
        <div className="row-end"><button type="button" className="btn btn-small" disabled={!url.trim() || !events.length} onClick={() => void act(async () => { const r = await api<{ webhooks: Hook[]; secret: string }>("POST", `/bots/${bot.id}/webhooks`, { url, events }); setUrl(""); return r; })}><Icon name="plus" size={14} /> {t("open.hookAdd")}</button></div>
        <p className="field-hint">{t("open.hookSigned")}</p>
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </>
  );
}

/** The same rule as server/src/localimport.ts excludedWhy: these files are never read nor sent. */
export function neverRead(path: string): boolean {
  const name = (path.split(/[\\/]/).pop() ?? "").toLowerCase();
  return /^\.env(\..*)?$|^auth\.json$|^\.credentials\.json$|credential|\.pem$|\.key$|^id_(rsa|ed25519|ecdsa)|token|secret|\.sqlite3?$|\.db$|\.kdbx$/.test(name)
    || /^config\.toml$|^config\.ya?ml$|^openclaw\.json5?$|^settings(\.local)?\.json$|^\.claude\.json$|^\.mcp\.json$|^mcp\.json$/.test(name);
}
const WANTED = /\.(md|json)$/i;
export type LocalPreview = GrokImportPreview & { source: string; excluded: { path: string; why: string }[] };

/** « Importer depuis un dossier » inside the Grok import window (L181): picks a folder, reads only Markdown and JSON. */
export function LocalImportPicker({ onPreview }: { onPreview: (p: LocalPreview) => void }) {
  const t = useT();
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true); setError(null);
    try {
      const files: { path: string; text: string }[] = [];
      let left = 0;
      for (const f of Array.from(list)) {
        const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        if (/(^|\/)(node_modules|\.git)\//.test(path) || !WANTED.test(path) || f.size > 200_000) continue;
        if (neverRead(path)) { left++; files.push({ path, text: "" }); continue; } // its NAME only, so the preview can list it
        files.push({ path, text: await f.text() });
        if (files.length >= 300) break;
      }
      setSkipped(left);
      onPreview(await api<LocalPreview>("POST", "/import/local/preview", { files: files.map((f) => (neverRead(f.path) ? { path: f.path } : f)) }));
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="open-local">
      <p className="field-label">{t("open.local")}</p>
      <p className="muted small">{t("open.localHint")}</p>
      <label className="btn btn-small open-local-pick" htmlFor={`${uid}d`}><Icon name="folder" size={14} /> {t(busy ? "common.working" : "open.localPick")}</label>
      <input id={`${uid}d`} type="file" className="sr-only" multiple {...{ webkitdirectory: "" }} onChange={(e) => void pick(e.target.files)} />
      <p className="note-line small"><Icon name="lock" size={13} /> <span>{t("open.localSecrets")}</span></p>
      {skipped > 0 && <p className="muted small">{t("open.localSkipped", { n: skipped })}</p>}
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </div>
  );
}

/** Step 3 of a local import: which files were not read, and why. */
export function LocalExcludedNote({ preview }: { preview: LocalPreview }) {
  const t = useT();
  const shown = preview.excluded.filter((e) => e.why !== "unknown");
  if (!shown.length) return null;
  return (
    <div className="callout is-info open-excluded">
      <Icon name="lock" size={16} />
      <div>
        <p>{t("open.excluded", { n: shown.length })}</p>
        <details><summary>{t("grok.strippedWhere")}</summary><ul>{shown.map((e) => <li key={e.path}><span className="mono">{e.path}</span> — {t(`open.why.${e.why}` as Key)}</li>)}</ul></details>
      </div>
    </div>
  );
}
