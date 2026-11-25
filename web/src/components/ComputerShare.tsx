import { useEffect, useId, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import type { Bot } from "../types";
import { Icon } from "./Icon";
import { ErrorNote } from "./ui";
import "./ComputerShare.css";

/**
 * « Un ordinateur pour tous mes bots » (server computershare.ts):
 *  - Settings → Computers: the account's « pour tous mes bots » answer on a control card, shown while it holds, with
 *    « Retirer » (each bot is asked again; commands are always asked as before);
 *  - bot settings: « Ordinateur de ce bot », only when the account has two linked devices or more.
 */

export function AllBotsControlLine() {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api<{ on: boolean }>("GET", "/relay/all-bots").then((r) => { if (live) setOn(!!r.on); }, () => {});
    return () => { live = false; };
  }, []);
  if (!on && !error) return null;
  const revoke = async () => {
    setBusy(true);
    setError(null);
    try { await api("DELETE", "/relay/all-bots"); setOn(false); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return <AllBotsControlView on={on} busy={busy} error={error} onRevoke={() => void revoke()} onDismiss={() => setError(null)} />;
}

/** The line itself (also shown by the gallery, section « relais »). */
export function AllBotsControlView({ on, busy, error, onRevoke, onDismiss }: { on: boolean; busy: boolean; error: string | null; onRevoke: () => void; onDismiss: () => void }) {
  const t = useT();
  return (
    <div className="all-bots-line" role="status">
      {on && (
        <>
          <Icon name="users" size={16} />
          <div className="all-bots-text">
            <strong>{t("computerShare.allBotsTitle")}</strong>
            <span className="muted small">{t("computerShare.allBotsText")}</span>
          </div>
          <button type="button" className="btn btn-small btn-ghost-danger" disabled={busy} onClick={onRevoke}>{t(busy ? "common.saving" : "computerShare.revoke")}</button>
        </>
      )}
      <ErrorNote onDismiss={onDismiss}>{error}</ErrorNote>
    </div>
  );
}

export type DeviceChoice = { id: string; name: string; label: string; kind: "computer" | "phone"; online: boolean };

export function BotRelayDevice({ bot }: { bot: Bot }) {
  const [view, setView] = useState<{ deviceId: string | null; devices: DeviceChoice[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api<{ deviceId: string | null; devices: DeviceChoice[] }>("GET", `/bots/${enc(bot.id)}/computer`).then((r) => { if (live) setView(r); }, () => {});
    return () => { live = false; };
  }, [bot.id]);
  if (!view || view.devices.length < 2) return null;
  const choose = async (deviceId: string) => {
    setBusy(true);
    setError(null);
    try { setView(await api("PUT", `/bots/${enc(bot.id)}/computer`, { deviceId: deviceId || null })); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return <BotRelayDeviceView botName={bot.name} view={view} busy={busy} error={error} onChoose={(id) => void choose(id)} onDismiss={() => setError(null)} />;
}

/** « Ordinateur de ce bot » itself (also shown by the gallery). */
export function BotRelayDeviceView({ botName, view, busy, error, onChoose, onDismiss }: { botName: string; view: { deviceId: string | null; devices: DeviceChoice[] }; busy: boolean; error: string | null; onChoose: (deviceId: string) => void; onDismiss: () => void }) {
  const t = useT();
  const id = useId();
  const chosen = view.devices.find((d) => d.id === view.deviceId);
  return (
    <section className="computer-choice">
      <div className="action-row bot-device-row">
        <div>
          <label className="action-title" htmlFor={id}>{t("computerShare.botDevice")}</label>
          <p className="muted small">
            {chosen ? t(chosen.online ? "computerShare.botDeviceChosen" : "computerShare.botDeviceOffline", { name: botName, device: chosen.label }) : t("computerShare.botDeviceAny", { name: botName })}
          </p>
        </div>
        <select id={id} className="input bot-device-select" value={view.deviceId ?? ""} disabled={busy} onChange={(e) => onChoose(e.target.value)}>
          <option value="">{t("computerShare.connected")}</option>
          {view.devices.map((d) => <option key={d.id} value={d.id}>{d.online ? d.label : t("computerShare.offlineOption", { device: d.label })}</option>)}
        </select>
      </div>
      <ErrorNote onDismiss={onDismiss}>{error}</ErrorNote>
    </section>
  );
}
