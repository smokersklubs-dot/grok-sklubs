import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Bot } from "../types";
import { Icon } from "./Icon";
import { Menu, MenuItem } from "./ui";
import "./VoicePlus.css";

/**
 * L150 « réflexion par conversation » (backlog A-FAIRE): next to the model above the composer, how hard the bot thinks in
 * THIS conversation (légère, moyenne, poussée, maximale). Empty = its project's preset or the bot's own level; the server
 * applies it to the owner's own messages from the next one (agent/workmodel.ts conversationEffortFor).
 */
export const EFFORTS = ["low", "medium", "high", "xhigh"] as const;
type Level = (typeof EFFORTS)[number];
const asLevel = (v: string): Level => ((EFFORTS as readonly string[]).includes(v) ? (v as Level) : "medium");

export function ComposerReasoning({ bot }: { bot: Bot }) {
  const t = useT();
  const [chosen, setChosen] = useState("");
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    let dead = false;
    api<{ conversations: { effort?: string; current: boolean }[] }>("GET", `/bots/${enc(bot.id)}/conversations`)
      .then((r) => !dead && setChosen(r.conversations.find((c) => c.current)?.effort ?? ""), () => !dead && setChosen(""));
    return () => { dead = true; };
  }, [bot.id, bot.generation]);
  const pick = async (effort: string) => {
    setMenu(false);
    try {
      await api("PATCH", `/bots/${enc(bot.id)}/conversations/${bot.generation}`, { effort });
      setChosen(effort);
      useStore.getState().showToast(effort ? t("reason.set", { level: t(`effort.${asLevel(effort)}.title`) }) : t("reason.reset"));
    } catch (e) { useStore.getState().showToast(errText(e)); }
  };
  const own = bot.effort ? t(`effort.${asLevel(bot.effort)}.title`) : "";
  const shown = chosen ? t(`effort.${asLevel(chosen)}.title`) : own || t("reason.label");
  return (
    <div className="menu-wrap">
      <button type="button" className={`chip chip-button composer-model composer-reason${chosen ? " is-chosen" : ""}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}
        title={t("reason.title")} aria-label={t("reason.aria", { level: shown })}>
        <Icon name="bulb" size={13} /> <span className="truncate">{shown}</span>{chosen && <span className="composer-model-tag">{t("c7.model.thisChat")}</span>}
        <Icon name="chevronDown" size={12} />
      </button>
      <Menu open={menu} onClose={() => setMenu(false)} side="top" label={t("reason.title")}>
        <MenuItem icon={chosen ? "refresh" : "check"} onClick={() => void pick("")}>{own ? t("reason.botDefault", { level: own }) : t("reason.botDefaultPlain")}</MenuItem>
        {EFFORTS.map((e) => <MenuItem key={e} icon={e === chosen ? "check" : "bulb"} onClick={() => void pick(e)}>{t(`effort.${e}.title`)}</MenuItem>)}
      </Menu>
    </div>
  );
}
