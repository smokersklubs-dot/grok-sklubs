/**
 * L167 — « Modèle vocal temps réel » in Settings → Voice: off by default. On, calls talk to OpenAI's real-time voice model
 * with the OpenAI key the account already saved (never a new key here); the bot still does every piece of work. Server:
 * voice/realtime.ts, GET/PUT /voice/realtime.
 */
import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { Toggle } from "./ui";
import "./RealtimeVoice.css";

interface View { realtime: { enabled: boolean; model: string; voice: string; available: boolean; reason: "" | "off" | "no key" }; models: string[]; voices: string[] }

export function RealtimeVoice({ initial }: { initial?: View }) {
  const t = useT();
  const [v, setV] = useState<View | null>(initial ?? null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (initial) return;
    let live = true;
    api<View>("GET", "/voice/realtime").then((r) => { if (live) setV(r); }).catch((e) => { if (live) setFailed(errText(e)); });
    return () => { live = false; };
  }, [initial]);
  if (!v) return failed ? <p className="notice-error" role="alert">{failed}</p> : null;
  const put = async (patch: Record<string, unknown>) => {
    setFailed(null);
    const before = v;
    setV({ ...v, realtime: { ...v.realtime, ...patch } as View["realtime"] });
    try { setV(await api<View>("PUT", "/voice/realtime", patch)); } catch (e) { setV(before); setFailed(errText(e)); }
  };
  const r = v.realtime;
  return (
    <div className="realtime-voice">
      <div className="action-row">
        <div>
          <p className="action-title">{t("realtime.title")}</p>
          <p className="muted small">{t("realtime.text")}</p>
        </div>
        <Toggle checked={r.enabled} label={t("realtime.title")} onChange={(on) => void put({ enabled: on })} />
      </div>
      {r.enabled && (
        <>
          {r.reason === "no key" && <p className="realtime-voice-warn" role="status">{t("realtime.noKey")}</p>}
          {r.available && <p className="field-hint">{t("realtime.ready")}</p>}
          <div className="realtime-voice-pickers">
            <label className="field">
              <span className="field-label">{t("realtime.model")}</span>
              <select className="input input-small" value={r.model} onChange={(e) => void put({ model: e.target.value })}>
                {v.models.map((m) => <option key={m} value={m}>{m}{m.endsWith("mini") ? ` · ${t("realtime.cheaper")}` : ""}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">{t("realtime.voice")}</span>
              <select className="input input-small" value={r.voice} onChange={(e) => void put({ voice: e.target.value })}>
                {v.voices.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
          </div>
          <p className="field-hint">{t("realtime.cost")}</p>
        </>
      )}
      {failed && <p className="notice-error" role="alert">{failed}</p>}
    </div>
  );
}
