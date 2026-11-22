import { useEffect, useState } from "react";
import { api, enc } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Bot } from "../types";
import { MenuItem } from "./ui";

/**
 * « Mettre en sourdine » in the chat's menu (server chatmute.ts): no notification from this bot for 8 hours, or until
 * turned back on. A question that waits for your OK still notifies. Owner's own bots only.
 */
export function MuteMenuItems({ bot, onDone }: { bot: Bot; onDone: () => void }) {
  const t = useT();
  const [state, setState] = useState<{ muted: boolean; until: number | null } | null>(null);
  useEffect(() => {
    if (bot.access) return;
    let dead = false;
    api<{ muted: boolean; until: number | null }>("GET", `/bots/${enc(bot.id)}/mute`).then((v) => { if (!dead) setState(v); }).catch(() => {});
    return () => { dead = true; };
  }, [bot.id, bot.access]);
  if (bot.access || !state) return null;
  const set = (mute: "8h" | "forever" | "off") => {
    onDone();
    api<{ muted: boolean; until: number | null }>("PUT", `/bots/${enc(bot.id)}/mute`, { mute }).then(
      (v) => { setState(v); useStore.getState().showToast(t(v.muted ? "mute.done" : "mute.undone", { name: bot.name })); },
      () => useStore.getState().showToast(t("mute.failed")),
    );
  };
  if (state.muted) {
    const until = state.until ? new Date(state.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
    return (
      <MenuItem icon="bell" onClick={() => set("off")}>
        {until ? t("mute.offUntil", { time: until }) : t("mute.off")}
      </MenuItem>
    );
  }
  return (
    <>
      <MenuItem icon="bell" onClick={() => set("8h")}>{t("mute.8h")}</MenuItem>
      <MenuItem icon="bell" onClick={() => set("forever")}>{t("mute.forever")}</MenuItem>
    </>
  );
}
