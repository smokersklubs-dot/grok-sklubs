import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { Icon } from "./Icon";
import { ErrorNote, Toggle } from "./ui";
import "./RelayGuardPanel.css";
import "./Comfort.css";

/**
 * « Règles de sécurité » of one linked computer (Settings → Computers), server relayguardroutes.ts: the apps always
 * refused and the protected shortcuts (read-only, so the owner knows), the owner's keep-out list of apps and folders,
 * and the switch that allows terminals and commands (off by default, with a warning). Saved rules are sent to the
 * computer at once; the server refuses first, the computer again (backlog L19 / L32).
 */
interface GuardView {
  guard: { keepApps: string[]; keepFolders: string[]; projectFolders: string[]; allowTerminal: boolean; commandTimeout: number; updatedAt: number | null };
  /** nod 9: « Accès à mes fichiers » — also switchable from the chat. */
  filesOn?: boolean;
  limit: number;
  timeout: { min: number; max: number };
  builtin: { apps: { group: string; names: string[] }[]; floor: string[]; shortcuts: { combo: string; why: string; platforms: string[] | null; ownApp: boolean }[] };
}

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const MOD: Record<string, string> = { control: "Ctrl", alt: "Alt", shift: "Shift", command: "Cmd/Win" };
/** "command" is ⌘ on a Mac and the Windows key elsewhere: named for the platforms the shortcut is protected on. */
const prettyCombo = (c: string, platforms: string[] | null) => c.split("+").map((p) => (p === "command" && platforms ? (platforms.includes("darwin") ? "Cmd" : "Win") : MOD[p]) ?? (p.length === 1 ? p.toUpperCase() : p.replace(/^f(\d)/, "F$1").replace(/^./, (x) => x.toUpperCase()))).join("+");
const PLATFORM: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" };

export function RelayGuardPanel({ deviceId }: { deviceId: string }) {
  const t = useT();
  const [view, setView] = useState<GuardView | null>(null);
  const [apps, setApps] = useState("");
  const [folders, setFolders] = useState("");
  const [projects, setProjects] = useState("");
  const [timeout, setTimeoutValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const show = (v: GuardView) => { setView(v); setApps(v.guard.keepApps.join("\n")); setFolders(v.guard.keepFolders.join("\n")); setProjects(v.guard.projectFolders.join("\n")); setTimeoutValue(String(v.guard.commandTimeout)); };
  useEffect(() => {
    let dead = false;
    api<GuardView>("GET", `/relay/devices/${enc(deviceId)}/guard`).then((v) => { if (!dead) show(v); }).catch((e) => { if (!dead) setError(errText(e)); });
    return () => { dead = true; };
  }, [deviceId]);
  const save = async (patch: Partial<GuardView["guard"]> & { filesOn?: boolean }) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      show(await api<GuardView>("PUT", `/relay/devices/${enc(deviceId)}/guard`, patch));
      setSaved(true);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  if (!view) return error ? <ErrorNote>{error}</ErrorNote> : null;
  const g = view.guard;
  const secs = Number(timeout);
  const dirty = apps !== g.keepApps.join("\n") || folders !== g.keepFolders.join("\n") || projects !== g.projectFolders.join("\n") || secs !== g.commandTimeout;
  const over = lines(apps).length > view.limit || lines(folders).length > view.limit || lines(projects).length > view.limit || !Number.isFinite(secs) || secs < view.timeout.min || secs > view.timeout.max;
  return (
    <div className="relay-guard">
      <p className="muted small">{t("relay.guard.intro")}</p>

      <div className={`relay-guard-terminal ${g.allowTerminal ? "is-on" : ""}`}>
        <div className="relay-guard-row">
          <Icon name="terminal" size={16} />
          <span className="relay-guard-label">{t("relay.guard.terminal")}</span>
          <Toggle checked={g.allowTerminal} disabled={busy} label={t("relay.guard.terminal")} onChange={(on) => void save({ allowTerminal: on })} />
        </div>
        <p className="small relay-guard-warn" role="note">
          <Icon name="alert" size={13} /> <span>{t(g.allowTerminal ? "relay.guard.terminalOn" : "relay.guard.terminalOff")}</span>
        </p>
      </div>

      {view.filesOn !== undefined && (
        <div className="relay-guard-files">
          <div className="relay-guard-row">
            <Icon name="folder" size={16} />
            <span className="relay-guard-label">{t("relay.guard.files")}</span>
            <Toggle checked={view.filesOn} disabled={busy} label={t("relay.guard.files")} onChange={(on) => void save({ filesOn: on })} />
          </div>
          <p className="small muted">{t(view.filesOn ? "relay.guard.filesOn" : "relay.guard.filesOff")}</p>
        </div>
      )}

      <div className="relay-guard-keep">
        <label className="field-label" htmlFor={`projects-${deviceId}`}>{t("relay.guard.projects")}</label>
        <textarea id={`projects-${deviceId}`} className="input mono" rows={2} value={projects} onChange={(e) => { setProjects(e.target.value); setSaved(false); }} placeholder={t("relay.guard.projectsPh")} />
        <p className="field-hint">{t("relay.guard.projectsHint")}</p>
        <label className="field-label" htmlFor={`timeout-${deviceId}`}>{t("relay.guard.timeout")}</label>
        <input id={`timeout-${deviceId}`} className="input relay-guard-timeout" type="number" inputMode="numeric" min={view.timeout.min} max={view.timeout.max} value={timeout} onChange={(e) => { setTimeoutValue(e.target.value); setSaved(false); }} />
        <p className="field-hint">{t("relay.guard.timeoutHint", { min: view.timeout.min, max: view.timeout.max })}</p>
        <label className="field-label" htmlFor={`keep-apps-${deviceId}`}>{t("relay.guard.keepApps")}</label>
        <textarea id={`keep-apps-${deviceId}`} className="input" rows={3} value={apps} onChange={(e) => { setApps(e.target.value); setSaved(false); }} placeholder={t("relay.guard.keepAppsPh")} />
        <label className="field-label" htmlFor={`keep-folders-${deviceId}`}>{t("relay.guard.keepFolders")}</label>
        <textarea id={`keep-folders-${deviceId}`} className="input mono" rows={3} value={folders} onChange={(e) => { setFolders(e.target.value); setSaved(false); }} placeholder={t("relay.guard.keepFoldersPh")} />
        <p className="field-hint">{t("relay.guard.keepHint", { n: view.limit })}</p>
        <div className="relay-guard-actions">
          {saved && !dirty && <span className="small relay-guard-saved" role="status"><Icon name="check" size={13} /> {t("relay.guard.saved")}</span>}
          <button type="button" className="btn btn-small btn-primary" disabled={busy || !dirty || over} onClick={() => void save({ keepApps: lines(apps), keepFolders: lines(folders), projectFolders: lines(projects), commandTimeout: secs })}>
            {t("relay.guard.save")}
          </button>
        </div>
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>

      <details className="relay-guard-list">
        <summary>{t("relay.guard.floor")}</summary>
        <p className="muted small">{t("relay.guard.floorText")}</p>
        <ul className="relay-guard-floor">{view.builtin.floor.map((k) => <li key={k} className="small">{t(`relay.guard.floor.${k}` as Key)}</li>)}</ul>
      </details>
      <details className="relay-guard-list">
        <summary>{t("relay.guard.refusedApps")}</summary>
        <p className="muted small">{t("relay.guard.refusedAppsText")}</p>
        {view.builtin.apps.map((a) => (
          <div key={a.group} className="relay-guard-group">
            <strong className="small">{t(`relay.guard.group.${a.group}` as Key)}</strong>
            <div className="relay-guard-chips">{a.names.map((n) => <span key={n} className="chip chip-quiet">{n}</span>)}</div>
          </div>
        ))}
      </details>
      <details className="relay-guard-list">
        <summary>{t("relay.guard.shortcuts")}</summary>
        <p className="muted small">{t("relay.guard.shortcutsText")}</p>
        <ul className="relay-guard-keys">
          {view.builtin.shortcuts.map((s) => (
            <li key={`${s.combo}-${(s.platforms ?? []).join()}`}>
              <code>{prettyCombo(s.combo, s.platforms)}</code>
              <span className="muted small">
                {t(`relay.guard.why.${s.why}` as Key)}
                {s.platforms ? ` · ${s.platforms.map((p) => PLATFORM[p] ?? p).join(", ")}` : ""}
                {s.ownApp ? ` · ${t("relay.guard.ownApp")}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
