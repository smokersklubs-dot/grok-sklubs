import { useCallback, useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { PushDevice, PushKind, PushSettings, PushState } from "../types";
import { notifyEnabled, notifySupport, setNotifyEnabled } from "../lib/notify";
import { currentSubscription, disablePush, enablePush, pushSupport } from "../lib/push";
import { relTime } from "../lib/format";
import { Icon } from "./Icon";
import { ConfirmButton, ErrorNote, Loading, Toggle } from "./ui";
import { useAnnouncements } from "../lib/announcements";

/** « Annonces » by e-mail (when the author asks for it): the reader's own choice, on by default. */
function AnnounceMailRow() {
  const t = useT();
  const on = useAnnouncements((s) => s.state?.emailOptIn);
  const [error, setError] = useState<string | null>(null);
  if (on === undefined) return null;
  return (
    <li className="list-row">
      <div className="list-row-text">
        <span className="list-row-title">{t("push.kind.announceMail")}</span>
        <span className="list-row-sub">{error ?? t("push.kind.announceMailHint")}</span>
      </div>
      <Toggle checked={on} label={t("push.kind.announceMail")} onChange={(next) => { setError(null); useAnnouncements.getState().setEmail(next).catch((e: unknown) => setError(errText(e))); }} />
    </li>
  );
}

const KINDS: PushKind[] = ["needs", "gem", "reply", "routine", "computer", "announce"];
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };

export function NotificationsSection() {
  const t = useT();
  const [state, setState] = useState<(PushState & { currentId: string | null }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const support = pushSupport();
  const [local, setLocal] = useState(() => notifyEnabled());
  const [localSupport, setLocalSupport] = useState(() => notifySupport());

  const load = useCallback(async () => {
    try {
      const sub = await currentSubscription();
      setState(await api<PushState & { currentId: string | null }>("GET", `/push${sub ? `?endpoint=${enc(sub.endpoint)}` : ""}`));
    } catch (e) {
      setError(errText(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const here = state?.currentId ? state.devices.find((d) => d.id === state.currentId) ?? null : null;

  const toggleHere = async (on: boolean) => {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      if (on) await enablePush(state);
      else await disablePush();
      await load();
    } catch (e) {
      setError(e instanceof Error && e.message === "denied" ? t("push.denied") : t("push.failed", { detail: errText(e) }));
    } finally {
      setBusy(false);
    }
  };
  const saveSettings = async (next: Partial<PushSettings>) => {
    if (!state) return;
    const merged = { ...state.settings, ...next, quiet: { ...state.settings.quiet, ...(next.quiet ?? {}) }, kinds: { ...state.settings.kinds, ...(next.kinds ?? {}) } };
    setState({ ...state, settings: merged });
    try {
      const r = await api<{ settings: PushSettings }>("PUT", "/push/settings", merged);
      setState((s) => (s ? { ...s, settings: r.settings } : s));
    } catch (e) {
      setError(errText(e));
      void load();
    }
  };
  const patchDevice = async (d: PushDevice, enabled: boolean) => {
    setState((s) => (s ? { ...s, devices: s.devices.map((x) => (x.id === d.id ? { ...x, enabled } : x)) } : s));
    try { await api("PATCH", `/push/devices/${enc(d.id)}`, { enabled }); } catch (e) { setError(errText(e)); void load(); }
  };
  const removeDevice = async (d: PushDevice) => {
    try {
      if (d.id === state?.currentId) await disablePush();
      else await api("DELETE", `/push/devices/${enc(d.id)}`);
      await load();
    } catch (e) {
      setError(errText(e));
    }
  };
  const test = async () => {
    try {
      const r = await api<{ sent: number }>("POST", "/push/test");
      useStore.getState().showToast(r.sent ? t("push.testSent", { n: r.sent }) : t("push.testNone"));
    } catch (e) {
      setError(errText(e));
    }
  };

  const hint = support === "ios-home-screen" ? t("push.iosHint") : support === "unsupported" ? t("push.unsupported") : support === "denied" ? t("push.denied") : t("push.hint");

  return (
    <>
      <h2>{t("settings.section.notifications")}</h2>
      <p className="muted">{t("push.intro")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>

      <h3 className="pane-heading">{t("push.thisDevice")}</h3>
      {support === "ios-home-screen" && (
        <div className="callout is-info" role="note">
          <Icon name="info" size={16} />
          <span>{t("push.iosHint")}</span>
        </div>
      )}
      <div className="action-row">
        <div>
          <p className="action-title">{t("push.title")}</p>
          <p className="muted small">{support === "ios-home-screen" ? t("push.iosShort") : hint}</p>
        </div>
        <Toggle checked={!!here} label={t("push.title")} disabled={support !== "ok" || busy || !state} onChange={(on) => void toggleHere(on)} />
      </div>

      {!state ? (
        <Loading />
      ) : (
        <>
          <h3 className="pane-heading">{t("push.devices")}</h3>
          {state.devices.length === 0 ? (
            <p className="muted small">{t("push.noDevices")}</p>
          ) : (
            <ul className="list">
              {state.devices.map((d) => (
                <li key={d.id} className="list-row is-card">
                  <span className="logo-tile" aria-hidden="true"><Icon name={/Android|iOS/.test(d.label) ? "phone" : "monitor"} size={17} /></span>
                  <div className="list-row-text">
                    <span className="list-row-title">
                      {d.label}
                      {d.id === state.currentId && <span className="chip state-ready">{t("push.current")}</span>}
                      {d.failures > 2 && <span className="chip state-error">{t("push.failing")}</span>}
                    </span>
                    <span className="list-row-sub">{d.lastOkAt ? t("push.lastOk", { when: relTime(d.lastOkAt) }) : t("push.added", { when: relTime(d.createdAt) })}</span>
                  </div>
                  <Toggle checked={d.enabled} label={t("push.deviceOn", { name: d.label })} onChange={(on) => void patchDevice(d, on)} />
                  <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("push.remove")} confirmLabel={t("common.confirmDelete")} onConfirm={() => removeDevice(d)} />
                </li>
              ))}
            </ul>
          )}
          {state.devices.length > 0 && (
            <button type="button" className="btn btn-small" onClick={() => void test()}>
              <Icon name="bell" size={14} /> {t("push.test")}
            </button>
          )}

          <h3 className="pane-heading">{t("push.what")}</h3>
          <ul className="list">
            {KINDS.map((k) => (
              <li key={k} className="list-row">
                <div className="list-row-text">
                  <span className="list-row-title">{t(`push.kind.${k}`)}</span>
                  <span className="list-row-sub">{t(`push.kind.${k}Hint`)}</span>
                </div>
                <Toggle checked={state.settings.kinds[k]} label={t(`push.kind.${k}`)} onChange={(on) => void saveSettings({ kinds: { ...state.settings.kinds, [k]: on } })} />
              </li>
            ))}
            <AnnounceMailRow />
          </ul>

          <h3 className="pane-heading">{t("push.quiet")}</h3>
          <div className="action-row">
            <div>
              <p className="action-title">{t("push.quietTitle")}</p>
              <p className="muted small">{t("push.quietHint")}</p>
            </div>
            <Toggle
              checked={state.settings.quiet.enabled}
              label={t("push.quietTitle")}
              onChange={(on) => void saveSettings({ quiet: { ...state.settings.quiet, enabled: on, timezone: on && state.settings.quiet.timezone === "UTC" ? browserZone() : state.settings.quiet.timezone } })}
            />
          </div>
          {state.settings.quiet.enabled && (
            <div className="quiet-hours">
              <label>
                <span className="field-label">{t("push.quietFrom")}</span>
                <input type="time" className="input input-small" value={state.settings.quiet.start} onChange={(e) => e.target.value && void saveSettings({ quiet: { ...state.settings.quiet, start: e.target.value } })} />
              </label>
              <label>
                <span className="field-label">{t("push.quietTo")}</span>
                <input type="time" className="input input-small" value={state.settings.quiet.end} onChange={(e) => e.target.value && void saveSettings({ quiet: { ...state.settings.quiet, end: e.target.value } })} />
              </label>
              <span className="muted small">{state.settings.quiet.timezone}</span>
            </div>
          )}
        </>
      )}

      <h3 className="pane-heading">{t("notify.heading")}</h3>
      <div className="action-row">
        <div>
          <p className="action-title">{t("notify.title")}</p>
          <p className="muted small">{t(localSupport === "unsupported" ? "notify.unsupported" : localSupport === "denied" ? "notify.denied" : "notify.hint")}</p>
        </div>
        <Toggle
          checked={local && localSupport === "ok"}
          label={t("notify.title")}
          disabled={localSupport !== "ok"}
          onChange={(next) => void setNotifyEnabled(next).then((on) => { setLocal(on); setLocalSupport(notifySupport()); })}
        />
      </div>
    </>
  );
}
