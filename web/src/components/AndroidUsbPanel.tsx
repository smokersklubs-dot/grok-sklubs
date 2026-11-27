import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { relTime } from "../lib/format";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { ErrorNote } from "./ui";
import "./AndroidUsbPanel.css";

/**
 * « Téléphones Android (USB) » of one linked computer (Settings → Computers), server androidusbroutes.ts, protocol 1.9
 * (docs/RELAIS-PROTOCOLE.md §20, A-FAIRE L177): the phones plugged into that computer, their model and Android version
 * once the phone itself allowed USB debugging, who uses each one, « Arrêter », and how to install adb when it is
 * missing (Sklubot never downloads it by itself).
 */
export interface AndroidPhoneView { serial: string; state: string; model?: string; android?: string; inUse: { botId: string; botName: string; since: number } | null }
export interface AndroidUsbData { online: boolean; supported: boolean; adb: { found: boolean; version?: string }; devices: AndroidPhoneView[]; checkedAt: number | null }

export function AndroidUsbPanel({ deviceId }: { deviceId: string }) {
  const [data, setData] = useState<AndroidUsbData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The Relais' own events (phone.started / phone.ended) refresh the devices list: read the phones again then.
  const relay = useStore((s) => s.relay);
  const load = async (fresh = false) => {
    setBusy(true);
    setError(null);
    try { setData(await api<AndroidUsbData>("GET", `/relay/devices/${enc(deviceId)}/android${fresh ? "?fresh=1" : ""}`)); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [deviceId, relay]);
  const stop = async (serial: string) => {
    setError(null);
    try { await api("POST", `/relay/devices/${enc(deviceId)}/android/stop`, { serial }); await load(true); } catch (e) { setError(errText(e)); }
  };
  return <AndroidUsbView data={data} busy={busy} error={error} onRefresh={() => void load(true)} onStop={(s) => void stop(s)} onDismiss={() => setError(null)} />;
}

export function AndroidUsbView({ data, busy, error, onRefresh, onStop, onDismiss }: { data: AndroidUsbData | null; busy: boolean; error: string | null; onRefresh: () => void; onStop: (serial: string) => void; onDismiss: () => void }) {
  const t = useT();
  return (
    <div className="android-usb">
      <p className="muted small">{t("relay.android.intro")}</p>
      {data && !data.online && <p className="muted small">{t("relay.android.offline")}</p>}
      {data && data.online && !data.supported && <p className="android-usb-guide small">{t("relay.android.update")}</p>}
      {data && data.supported && !data.adb.found && (
        <div className="android-usb-guide" role="note">
          <strong>{t("relay.android.guideTitle")}</strong>
          <ol className="steps-guide">
            <li>{t("relay.android.guide1")} <a href="https://developer.android.com/tools/releases/platform-tools" target="_blank" rel="noopener noreferrer">developer.android.com/tools/releases/platform-tools</a></li>
            <li>{t("relay.android.guide2")}</li>
            <li>{t("relay.android.guide3")}</li>
          </ol>
          <p className="small muted">{t("relay.android.noDownload")}</p>
        </div>
      )}
      {data && data.supported && data.adb.found && data.devices.length === 0 && <p className="muted small">{t("relay.android.none")}</p>}
      {data && data.devices.length > 0 && (
        <ul className="android-usb-list">
          {data.devices.map((p) => (
            <li key={p.serial} className="android-usb-row">
              <Icon name="smartphone" size={16} />
              <div className="android-usb-text">
                <span className="android-usb-name">{p.state === "device" ? (p.model ?? p.serial) : t("relay.android.unauthorizedName")}{p.android ? <span className="chip chip-quiet">{t("relay.android.version", { v: p.android })}</span> : null}</span>
                <span className="small muted android-usb-sub">
                  {p.state === "unauthorized" ? t("relay.android.unauthorized") : p.state !== "device" ? t("relay.android.notReady", { state: p.state }) : p.inUse ? t("relay.android.inUse", { bot: p.inUse.botName, when: relTime(p.inUse.since) }) : t("relay.android.free")}
                  {" · "}<code>{p.serial}</code>
                </span>
              </div>
              {p.inUse && <button type="button" className="btn btn-small btn-danger" onClick={() => onStop(p.serial)}><Icon name="stop" size={13} /> {t("relay.android.stop")}</button>}
            </li>
          ))}
        </ul>
      )}
      <div className="android-usb-foot">
        <button type="button" className="btn btn-small" onClick={onRefresh} disabled={busy}><Icon name="refresh" size={13} /> {t(busy ? "relay.android.checking" : "relay.android.refresh")}</button>
        {data?.adb.found && data.adb.version && <span className="small muted">{t("relay.android.adb", { v: data.adb.version })}</span>}
      </div>
      <ErrorNote onDismiss={onDismiss}>{error}</ErrorNote>
    </div>
  );
}
