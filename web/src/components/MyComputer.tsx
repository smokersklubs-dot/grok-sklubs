import { AllBotsControlLine } from "./ComputerShare";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import { relTime } from "../lib/format";
import type { RelayDevice } from "../types";
import { Icon, Spinner } from "./Icon";
import { ConfirmButton, CopyButton, Empty, ErrorNote, IconButton, Loading, useDialogFocus, useEscape } from "./ui";
import { RelayGuardPanel } from "./RelayGuardPanel"; import { AndroidUsbPanel } from "./AndroidUsbPanel";

/**
 * The user's own computers, linked with the Sklubot Relais app (docs/RELAIS-PROTOCOLE.md): their state, the live
 * view while a bot controls one, a Stop button, and the pairing screen in Settings → Computers.
 */

type ViewState = "connecting" | "idle" | "starting" | "live" | "stopped" | "offline";

/**
 * The relay's frames for one computer, through the server (WebSocket /api/relay/devices/:id/view). Each frame is
 * acknowledged once it is decoded and on screen, so a slow browser slows the relay down instead of piling up frames.
 * Closing (unmount, `enabled` false) tells the server nobody watches any more, and it stops the view.
 */
export function useRelayFrames(deviceId: string, enabled: boolean): { src: string | null; view: ViewState; still: boolean } {
  const [src, setSrc] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>("connecting");
  const [still, setStill] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    let dead = false;
    let ws: WebSocket | null = null;
    let retry: number | undefined;
    const open = () => {
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${scheme}://${location.host}/api/relay/devices/${enc(deviceId)}/view`);
      const sock = ws;
      sock.onmessage = (e: MessageEvent<string>) => {
        let m: { type?: string; view?: ViewState; seq?: number; data?: string; still?: boolean };
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === "status" && m.view) setView(m.view);
        if (m.type === "frame" && typeof m.data === "string") {
          const url = `data:image/jpeg;base64,${m.data}`;
          const img = new Image();
          const shown = () => {
            if (dead) return;
            setSrc(url);
            setStill(!!m.still);
            if (!m.still && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ type: "ack", seq: m.seq }));
          };
          img.onload = shown;
          img.onerror = shown;
          img.src = url;
        }
      };
      sock.onclose = () => { if (!dead) { setView("offline"); retry = window.setTimeout(open, 3000); } };
    };
    open();
    return () => { dead = true; window.clearTimeout(retry); try { ws?.close(); } catch { /* closed */ } };
  }, [deviceId, enabled]);
  return { src, view, still };
}

const PLATFORM: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux", android: "Android" };
export const platformName = (p: string) => PLATFORM[p] ?? p;
/** A phone (the Sklubot Android app, relay protocol 1.2) or a computer (Sklubot Relais). */
export const deviceIcon = (d: Pick<RelayDevice, "kind">) => (d.kind === "phone" ? "smartphone" : "monitor");
/** Inside the Sklubot Android app (its WebView adds this to the user agent): it can open its own phone-relay screen. */
const inAndroidApp = () => typeof navigator !== "undefined" && /SklubotAndroid\//.test(navigator.userAgent);

function useStatusText(): (d: RelayDevice) => string {
  const t = useT();
  return (d) => {
    if (d.status === "offline") return d.lastSeenAt ? t("relay.offlineSince", { when: relTime(d.lastSeenAt) }) : t("relay.offline");
    if (d.status === "paused") return t("relay.paused");
    if (d.locked) return t("relay.locked");
    if (d.asking) return t(d.asking.kind === "command" ? "relay.askingCommand" : "relay.askingSession", { bot: d.asking.botName });
    if (d.session) return t("relay.controlledBy", { bot: d.session.botName });
    return t("relay.online");
  };
}

function StatusDot({ d }: { d: RelayDevice }) {
  const tone = d.status !== "online" ? "is-off" : d.locked ? "is-locked" : d.session ? "is-busy" : "is-on";
  return <span className={`relay-dot ${tone}`} aria-hidden="true" />;
}

function StopButton({ d, small = true }: { d: RelayDevice; small?: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  if (!d.session || d.status !== "online") return null;
  const stop = async () => {
    setBusy(true);
    try {
      await api("POST", `/relay/devices/${enc(d.id)}/stop`);
      useStore.getState().showToast(t("relay.stopped", { bot: d.session?.botName ?? "" }));
    } catch (e) {
      useStore.getState().showToast(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={`btn ${small ? "btn-small" : ""} btn-danger relay-stop`} disabled={busy} onClick={() => void stop()} title={t("relay.stopHint")}>
      <Icon name="stop" size={12} /> {t("relay.stop")}
    </button>
  );
}

/** A picture of the computer: live frames while a bot has control and the panel is visible, else the last one seen. */
function Thumb({ d, live }: { d: RelayDevice; live: boolean }) {
  const { src, view } = useRelayFrames(d.id, live);
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    if (live) return;
    let dead = false;
    let url: string | null = null;
    fetch(`/api/relay/devices/${enc(d.id)}/last`, { credentials: "same-origin" }).then(async (r) => {
      if (dead || r.status !== 200) return;
      url = URL.createObjectURL(await r.blob());
      setLast(url);
    }).catch(() => undefined);
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [d.id, live, d.session?.since]);
  const shown = live ? src : last;
  return (
    <span className={`screen-thumb ${live && view === "live" ? "is-live" : ""}`}>
      {shown ? <img src={shown} alt="" /> : live && view !== "offline" ? <span className="dot-inline dot-pulse" /> : <Icon name={deviceIcon(d)} size={22} />}
    </span>
  );
}

/** True while the browser tab is visible. */
function useTabVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

/** "My computer" in a bot's details panel. */
export function MyComputerSection() {
  const devices = useStore((s) => s.relay);
  const viewerOpen = useStore((s) => !!s.relayViewerId);
  const { openRelayViewer, openAppSettings } = useStore.getState();
  const tabVisible = useTabVisible();
  const statusText = useStatusText();
  const t = useT();
  if (!devices) return null;
  return (
    <section className="section">
      <div className="section-head">
        <h3>{t("relay.mine")}</h3>
        <button type="button" className="link" onClick={() => openAppSettings("devices")}>{t("details.manage")}</button>
      </div>
      {devices.length === 0 ? (
        <div className="relay-empty">
          <p className="muted small">{t("relay.noneHint")}</p>
          <button type="button" className="btn btn-small" onClick={() => openAppSettings("devices")}>
            <Icon name="plus" size={14} /> {t("relay.link")}
          </button>
        </div>
      ) : (
        <ul className="list relay-list">
          {devices.map((d) => (
            <li key={d.id} className="screen-card-wrap">
              <button type="button" className="screen-card" onClick={() => openRelayViewer(d.id)} aria-label={t("relay.open", { name: d.name })}>
                <Thumb d={d} live={d.status === "online" && !!d.session && tabVisible && !viewerOpen} />
                <span className="screen-card-text">
                  <span className="list-row-title truncate">{d.name}</span>
                  <span className="list-row-sub truncate"><StatusDot d={d} /> {statusText(d)}</span>
                </span>
              </button>
              <div className="screen-actions" role="group">
                <IconButton icon="expand" size={14} label={t("relay.watch")} onClick={() => openRelayViewer(d.id)} />
              </div>
              {d.session && d.status === "online" && <div className="relay-card-stop"><StopButton d={d} /></div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The computer full size: the live view while a bot has control, with Stop always at hand. */
export function RelayViewer({ deviceId }: { deviceId: string }) {
  const d = useStore((s) => s.relay?.find((x) => x.id === deviceId));
  const close = useStore((s) => s.closeRelayViewer);
  const root = useRef<HTMLDivElement>(null);
  const statusText = useStatusText();
  const t = useT();
  const live = !!d && d.status === "online" && !!d.session;
  const { src, view, still } = useRelayFrames(deviceId, !!d && d.status === "online");
  useEscape(close);
  useDialogFocus(root);
  if (!d) return null;
  return (
    <div className="viewer relay-viewer" ref={root} role="dialog" aria-modal="true" aria-label={t("relay.viewerTitle", { name: d.name })} tabIndex={-1} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <header className="viewer-bar">
        <span className="logo-tile is-relay" aria-hidden="true"><Icon name={deviceIcon(d)} size={16} /></span>
        <div className="viewer-title">
          <strong>{t("relay.viewerTitle", { name: d.name })}</strong>
          <span>
            {live && view === "live" && !still && <span className="dot-inline dot-live" />}
            {statusText(d)} · {platformName(d.platform)}
          </span>
        </div>
        <IconButton icon="close" label={t("common.close")} onClick={close} />
      </header>
      <div className="viewer-stage relay-stage" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
        {src ? <img className={`relay-frame ${still || !live ? "is-still" : ""}`} src={src} alt={t("relay.screenAlt", { name: d.name })} /> : null}
        {!live && (
          <div className={`viewer-empty ${src ? "relay-over" : ""}`}>
            <Icon name={d.locked ? "lock" : deviceIcon(d)} size={40} />
            <h3>{d.status === "offline" ? t(d.kind === "phone" ? "relay.phoneOfflineTitle" : "relay.offlineTitle") : d.status === "paused" ? t("relay.paused") : d.locked ? t("relay.locked") : t("relay.noSessionTitle")}</h3>
            <p>{d.status !== "online" ? t(d.kind === "phone" ? "relay.phoneOfflineText" : "relay.offlineText") : d.locked ? t(d.kind === "phone" ? "relay.phoneLockedText" : "relay.lockedText") : t(d.kind === "phone" ? "relay.phoneNoSessionText" : "relay.noSessionText")}</p>
          </div>
        )}
        {live && !src && (
          <div className="viewer-empty">
            {d.kind === "phone" ? <Icon name="smartphone" size={40} /> : <Spinner size={28} />}
            <p>{d.kind === "phone" ? t("relay.phoneNoSessionText") : t("common.connecting")}</p>
          </div>
        )}
      </div>
      <footer className="viewer-foot">
        <span className="viewer-hint"><Icon name="eye" size={15} /> {t("relay.watchOnly")}</span>
        <StopButton d={d} small={false} />
        <button type="button" className="btn btn-small" onClick={close}>{t("common.close")}</button>
      </footer>
      {live && d.session && (
        <div className="viewer-control-bar is-relay" role="status">
          <span className="dot-inline dot-live" /> {t("relay.controlBar", { bot: d.session.botName, name: d.name })}
        </div>
      )}
    </div>
  );
}

/** Settings → Computers: link a computer with its code, see the linked ones, remove one. */
export function DevicesSection() {
  const devices = useStore((s) => s.relay);
  const downloads = useStore((s) => s.relayDownloads);
  const statusText = useStatusText();
  const t = useT();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<RelayDevice | null>(null);
  useEffect(() => { void useStore.getState().loadRelay(); }, []);

  const pair = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setLinked(null);
    try {
      const r = await api<{ device: RelayDevice }>("POST", "/relay/pairings", { code });
      setLinked(r.device);
      setCode("");
      void useStore.getState().loadRelay();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (d: RelayDevice) => {
    setError(null);
    try {
      await api("DELETE", `/relay/devices/${enc(d.id)}`);
      useStore.setState((s) => ({ relay: s.relay?.filter((x) => x.id !== d.id) ?? null }));
    } catch (err) {
      setError(errText(err));
    }
  };
  const address = location.origin;

  return (
    <>
      <h2>{t("settings.section.devices")}</h2>
      <p className="muted">{t("relay.intro")}</p>

      <section className="relay-pair" aria-labelledby="relay-pair-title">
        <h3 className="pane-heading" id="relay-pair-title">{t("relay.link")}</h3>
        <ol className="steps-guide">
          <li>
            {t("relay.step1")}{" "}
            <span className="relay-downloads">
              {(downloads?.files ?? []).map((f) => (
                <a key={f.name} className="chip chip-link" href={f.url} download>
                  <Icon name="download" size={12} /> {t(`relay.platform.${f.platform}`)}{(() => { const k = relayKind(f.name); return k ? <span className="muted"> · {t(`relay.kind.${k}`)}</span> : null; })()}
                </a>
              ))}
              {downloads && (
                <a className="chip chip-link" href={downloads.releasesUrl} target="_blank" rel="noopener noreferrer">
                  <Icon name="external" size={12} /> {t("relay.releases")}
                </a>
              )}
            </span>
          </li>
          <li>
            {t("relay.step2")}
            <div className="hook relay-address">
              <code className="truncate">{address}</code>
              <CopyButton text={address} label={t("relay.copy")} />
            </div>
          </li>
          <li>{t("relay.step3")}</li>
        </ol>
        <form className="relay-code-form" onSubmit={(e) => void pair(e)}>
          <label className="sr-only" htmlFor="relay-code">{t("relay.codeLabel")}</label>
          <input
            id="relay-code"
            className="input relay-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX"
            maxLength={12}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || code.replace(/[^A-Za-z0-9]/g, "").length < 8}>
            {t(busy ? "relay.linking" : "relay.linkBtn")}
          </button>
        </form>
        <p className="field-hint">{t("relay.codeHint")}</p>
        <div className="relay-phone" role="note">
          <Icon name="smartphone" size={16} />
          <div>
            <strong>{t("relay.phoneTitle")}</strong>
            <p className="muted small">{t("relay.phoneSteps")}</p>
            {inAndroidApp() && <a className="btn btn-small" href="sklubot://relay">{t("relay.phoneOpen")}</a>}
          </div>
        </div>
        {linked && (
          <p className="relay-linked" role="status"><Icon name="check" size={14} /> {t("relay.linked", { name: linked.name, platform: platformName(linked.platform) })}</p>
        )}
        <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      </section>

      <h3 className="pane-heading">{t("relay.linkedHeading")}</h3>
      {!devices && <Loading />}
      {devices && devices.length === 0 && <Empty icon="monitor" title={t("relay.emptyTitle")}>{t("relay.emptyText")}</Empty>}
      {devices && devices.length > 0 && (
        <ul className="list">
          {devices.map((d) => (
            <li key={d.id} className="page-row relay-row">
              <div className="page-row-head">
                <span className="logo-tile is-relay" aria-hidden="true"><Icon name={deviceIcon(d)} size={16} /></span>
                <div className="list-row-text">
                  <span className="list-row-title">{d.name} <span className="chip chip-quiet">{d.kind === "phone" ? t("relay.phoneChip", { platform: platformName(d.platform) }) : platformName(d.platform)}</span></span>
                  <span className="list-row-sub"><StatusDot d={d} /> {statusText(d)}{d.appVersion ? ` · ${t("relay.version", { v: d.appVersion })}` : ""} · {t("relay.since", { when: relTime(d.createdAt) })}</span>
                </div>
                <StopButton d={d} />
                <button type="button" className="btn btn-small" onClick={() => useStore.getState().openRelayViewer(d.id)}>{t("relay.watch")}</button>
                <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("relay.remove")} confirmLabel={t("relay.removeConfirm")} busyLabel={t("common.deleting")} onConfirm={() => remove(d)} />
              </div>
              {d.kind !== "phone" && (
                <details className="relay-guard-details">
                  <summary><Icon name="shield" size={15} /> {t("relay.guard.title")}</summary>
                  <RelayGuardPanel deviceId={d.id} />
                </details>
              )}
              {d.kind !== "phone" && d.capabilities.includes("android.devices") && (
                <details className="relay-guard-details"><summary><Icon name="smartphone" size={15} /> {t("relay.android.title")}</summary><AndroidUsbPanel deviceId={d.id} /></details>
              )}
            </li>
          ))}
        </ul>
      )}
      <AllBotsControlLine />
      <p className="muted small">{t("relay.privacy")}</p>
    </>
  );
}

/** Which kind of file a download is, so two Windows (or Linux) buttons read differently. */
function relayKind(name: string): "exe" | "zip" | "deb" | "appimage" | "dmg" | null {
  const m = /\.(exe|zip|deb|AppImage|dmg)$/i.exec(name);
  return m ? (m[1].toLowerCase() as "exe" | "zip" | "deb" | "appimage" | "dmg") : null;
}
