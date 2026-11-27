import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { ErrorNote, Toggle } from "./ui";
import "./Comfort.css";

/**
 * « Transcrire les messages vocaux » (server telegramvoice.ts, comfortroutes.ts): off by default. Says which
 * speech-to-text runs and whether it costs anything (the whisper.cpp bundled with the server is free).
 */
export interface VoiceTextView { enabled: boolean; provider: string | null; cost: "local" | "own-server" | "paid" | "none"; maxSeconds: number }

export function TelegramVoiceText({ botId, initial }: { botId: string; initial?: VoiceTextView }) {
  const t = useT();
  const [view, setView] = useState<VoiceTextView | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (initial) return;
    let dead = false;
    api<VoiceTextView>("GET", `/bots/${enc(botId)}/telegram/voice-text`).then((v) => { if (!dead) setView(v); }).catch((e) => { if (!dead) setError(errText(e)); });
    return () => { dead = true; };
  }, [botId, initial]);
  if (!view) return error ? <ErrorNote>{error}</ErrorNote> : null;
  const save = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try { setView(await api<VoiceTextView>("PUT", `/bots/${enc(botId)}/telegram/voice-text`, { enabled: on })); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const provider = view.provider === "whisper-cpp" ? "whisper.cpp" : view.provider === "openai" ? "OpenAI" : view.provider === "fish" ? "Fish Audio" : "";
  return (
    <div className="action-row telegram-voice-text">
      <div>
        <p className="action-title">{t("telegram.voiceText")}</p>
        <p className="muted small">{t("telegram.voiceTextHint", { n: Math.round(view.maxSeconds / 60) })}</p>
        <p className={`small ${view.cost === "paid" ? "telegram-voice-paid" : "muted"}`}>{t(`telegram.voiceCost.${view.cost}` as Key, { provider })}</p>
        <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      </div>
      <Toggle checked={view.enabled} disabled={busy || view.cost === "none"} label={t("telegram.voiceText")} onChange={(on) => void save(on)} />
    </div>
  );
}
