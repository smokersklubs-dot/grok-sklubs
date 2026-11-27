import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import type { Bot } from "../types";
import { ErrorNote, Toggle } from "./ui";
import "./Comfort7.css";

interface ShortReplies { enabled: boolean; maxSentences: number; maxWords: number; channels: ("web" | "telegram" | "voice")[] }
const CHANNELS = ["web", "telegram", "voice"] as const;

/** L132 « Réponses courtes »: a bot setting with numbered rules and the channels it applies to (server shortreplies.ts). */
export function ShortRepliesField({ bot }: { bot: Bot }) {
  const t = useT();
  const [s, setS] = useState<ShortReplies | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (bot.kind !== "agent" || bot.access) return;
    let dead = false;
    api<ShortReplies>("GET", `/bots/${enc(bot.id)}/short-replies`).then((r) => !dead && setS(r), (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [bot.id, bot.kind, bot.access]);
  if (bot.kind !== "agent" || bot.access) return null;
  const save = async (patch: Partial<ShortReplies>) => {
    if (!s) return;
    const before = s;
    setS({ ...s, ...patch }); setError(null);
    try { setS(await api<ShortReplies>("PUT", `/bots/${enc(bot.id)}/short-replies`, patch)); } catch (e) { setS(before); setError(errText(e)); }
  };
  return (
    <div className="bot-style short-replies">
      <div className="short-head">
        <div>
          <p className="action-title">{t("short.title")}</p>
          <p className="muted small">{t("short.hint", { name: bot.name })}</p>
        </div>
        <Toggle checked={!!s?.enabled} disabled={!s} label={t("short.title")} onChange={(v) => void save({ enabled: v })} />
      </div>
      {s?.enabled && (
        <div className="short-rules">
          <label className="small">{t("short.sentences")}
            <select className="input" value={s.maxSentences} onChange={(e) => void save({ maxSentences: Number(e.target.value) })}>
              {[...new Set([1, 2, 3, 4, 5, 6, 8, 10, s.maxSentences])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="small">{t("short.words")}
            <select className="input" value={s.maxWords} onChange={(e) => void save({ maxWords: Number(e.target.value) })}>
              {[...new Set([20, 40, 60, 80, 100, 150, 200, 300, s.maxWords])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <fieldset className="short-channels">
            <legend className="small">{t("short.channels")}</legend>
            {CHANNELS.map((ch) => (
              <label key={ch} className="small check">
                <input type="checkbox" checked={s.channels.includes(ch)} onChange={(e) => void save({ channels: e.target.checked ? [...s.channels, ch] : s.channels.filter((x) => x !== ch) })} />
                {t(`short.ch.${ch}`)}
              </label>
            ))}
          </fieldset>
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
