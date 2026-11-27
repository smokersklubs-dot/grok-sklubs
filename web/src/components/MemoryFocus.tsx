import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import type { Bot } from "../types";
import { ErrorNote } from "./ui";
import "./Comfort7.css";

/** L67 « Retiens surtout… »: the owner's own words on what this bot should learn (server agent/memorysave.ts). */
export function MemoryFocusField({ bot }: { bot: Bot }) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    api<{ text: string }>("GET", `/bots/${enc(bot.id)}/memory-focus`).then((r) => { if (!dead) { setText(r.text); setSaved(r.text); } }, (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [bot.id]);
  const save = async () => {
    if (text === null || text.trim() === saved) return;
    setError(null);
    try { const r = await api<{ text: string }>("PUT", `/bots/${enc(bot.id)}/memory-focus`, { text }); setText(r.text); setSaved(r.text); } catch (e) { setError(errText(e)); }
  };
  return (
    <label className="memx-focus">
      <span className="action-title">{t("memx.focus")}</span>
      <span className="muted small">{t("memx.focusHint", { name: bot.name })}</span>
      <textarea className="input" rows={2} maxLength={500} disabled={text === null} value={text ?? ""} placeholder={t("memx.focusPlaceholder")}
        onChange={(e) => setText(e.target.value)} onBlur={() => void save()} />
      {text !== null && text.trim() !== saved && <span className="muted small">{t("memx.focusUnsaved")}</span>}
      <ErrorNote>{error}</ErrorNote>
    </label>
  );
}
