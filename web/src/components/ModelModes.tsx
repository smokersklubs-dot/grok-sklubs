import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import type { Bot } from "../types";
import { ErrorNote } from "./ui";
import "./TeamAskPolicy.css";

/**
 * L69 named model modes (server agent/modelmodes.ts): « Équilibré » (the bot's own model), « Rapide », « Le plus fort »,
 * « Gratuit » and « Auto » (by how hard each message looks). Each mode shows the model it gives now — only models the
 * account already has, never one without a known price — and a mode with nothing to offer is greyed out.
 */
type Mode = "balanced" | "fast" | "strongest" | "free" | "auto";
interface ModeState { mode: Mode; models: Record<Exclude<Mode, "auto">, string | null>; subscription?: boolean }
const MODES: Mode[] = ["balanced", "fast", "strongest", "free", "auto"];

export function ModelModesField({ bot }: { bot: Bot }) {
  const t = useT();
  const [s, setS] = useState<ModeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (bot.kind !== "agent" || bot.access) return;
    let dead = false;
    api<ModeState>("GET", `/bots/${enc(bot.id)}/model-mode`).then((r) => !dead && setS(r), (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [bot.id, bot.kind, bot.access, bot.model]);
  if (bot.kind !== "agent" || bot.access || s?.subscription) return null;
  const save = async (mode: Mode) => {
    if (!s) return;
    const before = s; setS({ ...s, mode }); setError(null);
    try { setS({ ...before, ...(await api<ModeState>("PUT", `/bots/${enc(bot.id)}/model-mode`, { mode })) }); } catch (e) { setS(before); setError(errText(e)); }
  };
  const offered = (m: Mode) => !s || m === "balanced" || (m === "auto" ? !!(s.models.fast || s.models.strongest) : !!s.models[m]);
  const refOf = (m: Mode) => (!s ? "" : m === "auto" ? [s.models.fast, s.models.strongest].filter(Boolean).join(" · ") : m === "balanced" ? s.models.balanced || t("modes.default") : s.models[m] ?? t("modes.none"));
  return (
    <div className="model-modes" aria-busy={!s}>
      <p className="action-title">{t("modes.title")}</p>
      <p className="muted small">{t("modes.hint")}</p>
      <div className="model-modes-list" role="radiogroup" aria-label={t("modes.title")}>
        {MODES.map((m) => (
          <label key={m} className={`model-mode ${s?.mode === m ? "is-on" : ""} ${offered(m) ? "" : "is-off"}`}>
            <input type="radio" name={`model-mode-${bot.id}`} checked={s?.mode === m} disabled={!s || !offered(m)} onChange={() => void save(m)} />
            <span><strong>{t(`modes.${m}`)}</strong><span className="muted small">{t(`modes.${m}Hint`)}</span><span className="model-mode-ref muted">{refOf(m)}</span></span>
          </label>
        ))}
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </div>
  );
}
