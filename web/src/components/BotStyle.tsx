import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import type { Bot } from "../types";
import { ErrorNote } from "./ui";
import "./Comfort7.css";

const STYLES = ["simple", "normal", "challenge"] as const;

/** L161 « Style par bot »: plus simple, normal, me contredire (server botstyle.ts: one line in its instructions). */
export function BotStyleField({ bot }: { bot: Bot }) {
  const t = useT();
  const [style, setStyle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (bot.kind !== "agent" || bot.access) return;
    let dead = false;
    api<{ style: string }>("GET", `/bots/${enc(bot.id)}/style`).then((r) => !dead && setStyle(r.style), (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [bot.id, bot.kind, bot.access]);
  if (bot.kind !== "agent" || bot.access) return null;
  const save = async (next: string) => {
    const before = style;
    setStyle(next); setError(null);
    try { await api("PUT", `/bots/${enc(bot.id)}/style`, { style: next }); } catch (e) { setStyle(before); setError(errText(e)); }
  };
  return (
    <div className="bot-style">
      <p className="action-title" id={`style-${bot.id}`}>{t("c7.style.title")}</p>
      <p className="muted small">{t("c7.style.hint", { name: bot.name })}</p>
      <div className="seg" role="radiogroup" aria-labelledby={`style-${bot.id}`}>
        {STYLES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={style === s} disabled={style === null} className={`seg-btn${style === s ? " is-on" : ""}`} onClick={() => void save(s)}>{t(`c7.style.${s}`)}</button>
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
