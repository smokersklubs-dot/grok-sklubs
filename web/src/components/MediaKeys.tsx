import { useEffect, useId, useState } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { Icon } from "./Icon";
import { ErrorNote, Loading } from "./ui";
import "./MediaKeys.css";

/* Settings → Keys → « Création (images et vidéos) » (audit Open Generative AI): the account's own keys for picture and
   video services (never shown back), and Wan2GP — free pictures and videos on the owner's own GPU, through their
   Sklubot Relais or a Wan2GP server address (self-hosted servers only). Server: mediaroutes.ts. */

type Provider = "xai" | "gemini" | "image" | "wan2gp";
interface KeyView { provider: Provider; hasKey: boolean; baseUrl: string; model: string; deviceId: string; updatedAt: number }
interface Computer { id: string; label: string; online: boolean; gpu: boolean }
interface Job { id: string; kind: "video" | "image"; status: string; jobId: string | null; createdAt: number }
export interface MediaState { keys: KeyView[]; computers: Computer[]; urlAllowed: boolean; privateUrlAllowed: boolean; jobs: Job[]; defaultPort: number }

const PAID: { id: Exclude<Provider, "wan2gp">; title: Key; sub: Key; url?: boolean }[] = [
  { id: "xai", title: "media.xai.title", sub: "media.xai.sub" },
  { id: "gemini", title: "media.gemini.title", sub: "media.gemini.sub" },
  { id: "image", title: "media.image.title", sub: "media.image.sub", url: true },
];
const JOB_STATUS: Record<string, Key> = { running: "media.job.running", submitting: "media.job.running", done: "media.job.done", failed: "media.job.failed", cancelled: "media.job.cancelled" };

function PaidKey({ p, view, onSaved }: { p: (typeof PAID)[number]; view?: KeyView; onSaved: (s: MediaState) => void }) {
  const t = useT();
  const uid = useId();
  const [key, setKey] = useState("");
  const [url, setUrl] = useState(view?.baseUrl ?? "");
  const [model, setModel] = useState(view?.model ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<MediaState>) => { setBusy(true); setError(null); try { onSaved(await fn()); setKey(""); } catch (e) { setError(errText(e)); } finally { setBusy(false); } };
  return (
    <li className="list-row is-card media-key">
      <span className="logo-tile" aria-hidden="true"><Icon name={p.id === "image" ? "image" : "play"} size={16} /></span>
      <div className="list-row-text">
        <span className="list-row-title">{t(p.title)} <span className={`chip ${view?.hasKey ? "state-ready" : ""}`}>{t(view?.hasKey ? "media.saved" : "media.none")}</span></span>
        <span className="list-row-sub">{t(p.sub)}</span>
        <div className="media-fields">
          <label className="field-label" htmlFor={`${uid}k`}>{t("media.key")}</label>
          <input id={`${uid}k`} className="input" type="password" autoComplete="off" value={key} placeholder={view?.hasKey ? t("media.keyKept") : "sk-…"} onChange={(e) => setKey(e.target.value)} />
          {p.url && <>
            <label className="field-label" htmlFor={`${uid}u`}>{t("media.address")}</label>
            <input id={`${uid}u`} className="input" inputMode="url" value={url} placeholder="https://api.openai.com/v1" onChange={(e) => setUrl(e.target.value)} />
          </>}
          <label className="field-label" htmlFor={`${uid}m`}>{t("media.model")}</label>
          <input id={`${uid}m`} className="input" value={model} placeholder={p.id === "image" ? "gpt-image-1" : t("media.modelDefault")} onChange={(e) => setModel(e.target.value)} />
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="action-row">
          <button type="button" className="btn btn-small btn-primary" disabled={busy || (!key.trim() && !view?.hasKey)} onClick={() => void act(() => api<MediaState>("PUT", `/media-keys/${p.id}`, { key, baseUrl: url, model }))}>{t(busy ? "common.working" : "common.save")}</button>
          {view && <button type="button" className="btn btn-small btn-ghost-danger" disabled={busy} onClick={() => void act(() => api<MediaState>("DELETE", `/media-keys/${p.id}`))}>{t("media.remove")}</button>}
        </div>
      </div>
    </li>
  );
}

function Wan2gp({ state, onSaved }: { state: MediaState; onSaved: (s: MediaState) => void }) {
  const t = useT();
  const uid = useId();
  const view = state.keys.find((k) => k.provider === "wan2gp");
  const [mode, setMode] = useState<"relay" | "url">(view && !view.deviceId && view.baseUrl ? "url" : "relay");
  const [device, setDevice] = useState(view?.deviceId || state.computers[0]?.id || "");
  const [port, setPort] = useState(() => { try { return view?.deviceId ? new URL(view.baseUrl).port || String(state.defaultPort) : String(state.defaultPort); } catch { return String(state.defaultPort); } });
  const [url, setUrl] = useState(view && !view.deviceId ? view.baseUrl : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const act = async (fn: () => Promise<MediaState | null>) => { setBusy(true); setError(null); setCheck(null); try { const s = await fn(); if (s) onSaved(s); } catch (e) { setError(errText(e)); } finally { setBusy(false); } };
  const chosen = state.computers.find((c) => c.id === device);
  return (
    <li className="list-row is-card media-key is-free">
      <span className="logo-tile is-free" aria-hidden="true"><Icon name="monitor" size={16} /></span>
      <div className="list-row-text">
        <span className="list-row-title">{t("media.wan.title")} <span className="chip state-ready">{t("media.free")}</span> {view && <span className="chip">{t("media.saved")}</span>}</span>
        <span className="list-row-sub">{t("media.wan.sub")}</span>
        <div className="seg-tabs media-mode" role="radiogroup" aria-label={t("media.wan.where")}>
          <button type="button" role="radio" aria-checked={mode === "relay"} className={mode === "relay" ? "is-active" : ""} onClick={() => setMode("relay")}>{t("media.wan.relay")}</button>
          {state.urlAllowed && <button type="button" role="radio" aria-checked={mode === "url"} className={mode === "url" ? "is-active" : ""} onClick={() => setMode("url")}>{t("media.wan.url")}</button>}
        </div>
        {mode === "relay" ? (
          state.computers.length === 0 ? <p className="muted small">{t("media.wan.noComputer")}</p> : (
            <div className="media-fields">
              <label className="field-label" htmlFor={`${uid}d`}>{t("media.wan.computer")}</label>
              <select id={`${uid}d`} className="input" value={device} onChange={(e) => setDevice(e.target.value)}>
                {state.computers.map((c) => <option key={c.id} value={c.id}>{c.label} — {t(!c.online ? "media.wan.offline" : c.gpu ? "media.wan.ready" : "media.wan.update")}</option>)}
              </select>
              <label className="field-label" htmlFor={`${uid}p`}>{t("media.wan.port")}</label>
              <input id={`${uid}p`} className="input input-small" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))} />
              {chosen && chosen.online && !chosen.gpu && <p className="note-line small"><Icon name="info" size={13} /> <span>{t("media.wan.updateRelais")}</span></p>}
            </div>
          )
        ) : (
          <div className="media-fields">
            <label className="field-label" htmlFor={`${uid}u`}>{t("media.wan.address")}</label>
            <input id={`${uid}u`} className="input" inputMode="url" value={url} placeholder="http://192.168.1.20:7866/mcp" onChange={(e) => setUrl(e.target.value)} />
            <p className="muted small">{t(state.privateUrlAllowed ? "media.wan.urlOwner" : "media.wan.urlPublic")}</p>
          </div>
        )}
        <p className="muted small">{t("media.wan.start")}</p>
        <code className="media-cmd">python wgp.py --mcp --mcp-api-version 1 --mcp-transport streamable-http --mcp-host 127.0.0.1 --mcp-port {port || state.defaultPort}</code>
        <ErrorNote>{error}</ErrorNote>
        {check && <p className={`note-line small ${check.ok ? "is-ok" : "is-warn"}`} role="status"><Icon name={check.ok ? "check" : "alert"} size={13} /> <span>{check.message}</span></p>}
        <div className="action-row">
          <button type="button" className="btn btn-small btn-primary" disabled={busy || (mode === "relay" ? !device : !url.trim())} onClick={() => void act(() => api<MediaState>("PUT", "/media-keys/wan2gp", mode === "relay" ? { deviceId: device, port: Number(port) || state.defaultPort } : { baseUrl: url }))}>{t(busy ? "common.working" : "common.save")}</button>
          {view && <button type="button" className="btn btn-small" disabled={busy} onClick={() => void act(async () => { setCheck(await api<{ ok: boolean; message: string }>("POST", "/media-keys/wan2gp/check")); return null; })}>{t("media.wan.check")}</button>}
          {view && <button type="button" className="btn btn-small btn-ghost-danger" disabled={busy} onClick={() => void act(() => api<MediaState>("DELETE", "/media-keys/wan2gp"))}>{t("media.remove")}</button>}
        </div>
      </div>
    </li>
  );
}

/** The section itself; `initial` lets the dev gallery show it without a server. */
export function MediaKeysSection({ initial }: { initial?: MediaState }) {
  const t = useT();
  const [state, setState] = useState<MediaState | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!initial) api<MediaState>("GET", "/media-keys").then(setState, (e) => setError(errText(e))); }, [initial]);
  const runs = state?.jobs.slice(0, 5) ?? [];
  return (
    <section className="media-keys" aria-labelledby="media-keys-h">
      <h3 className="pane-heading" id="media-keys-h">{t("media.heading")}</h3>
      <p className="muted small">{t("media.intro")}</p>
      <p className="note-line small"><Icon name="shield" size={13} /> <span>{t("media.price")}</span></p>
      <ErrorNote>{error}</ErrorNote>
      {!state ? <Loading /> : (
        <>
          <ul className="list">
            <Wan2gp state={state} onSaved={setState} />
            {PAID.map((p) => <PaidKey key={`${p.id}:${state.keys.find((k) => k.provider === p.id)?.updatedAt ?? 0}`} p={p} view={state.keys.find((k) => k.provider === p.id)} onSaved={setState} />)}
          </ul>
          {runs.length > 0 && (
            <>
              <p className="field-label">{t("media.runs")}</p>
              <ul className="list media-runs">
                {runs.map((j) => <li key={j.id} className="list-row"><Icon name={j.kind === "video" ? "play" : "image"} size={14} /> <span>{new Date(j.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span> <span className="chip">{t(JOB_STATUS[j.status] ?? "media.job.running")}</span> {j.jobId && <code className="muted small">{enc(j.jobId)}</code>}</li>)}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
