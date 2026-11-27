import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { IDLE_LIVE, useStore } from "../store";
import { quickSend } from "../lib/quicksend";
import { GRID_MIN_WIDTH, MAX_SIDE, SIDE_MIN_WIDTH, sideBotIds, sideCandidates, useSideChat } from "../lib/sidechat";
import { openChatLayouts } from "./ChatLayouts";
import { BotAvatar } from "./Avatar";
import { Icon } from "./Icon";
import { IconButton, MenuItem } from "./ui";
import { Transcript } from "./Transcript";
import "./SideChat.css";

/**
 * L146 « discussions côte à côte »: other bots' live chats beside the selected one (lib/sidechat.ts). The same
 * transcript as the main chat (it scrolls live), a short message box, a menu to change the bot, « Ouvrir en grand »
 * (makes it the main chat) and Close. One beside it from 1 100 px; from 1 400 px up to three, in a 2×2 grid with the main
 * chat (« Ajouter une discussion »). « Dispositions » (ChatLayouts.tsx) saves and brings back an arrangement on this device.
 */
export function useWidth() {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  useEffect(() => { const on = () => setW(window.innerWidth); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, []);
  return w;
}

/** The ids of the bots shown beside the main chat now, in grid order (App.tsx lays out the columns / the grid with them). */
export function useSideBots(): string[] {
  const ids = useSideChat((s) => s.ids);
  const mainId = useStore((s) => s.selectedId);
  const bots = useStore((s) => s.bots);
  return sideBotIds(ids, mainId, (id) => !!bots[id], useWidth());
}

export function SideChat({ botId }: { botId: string }) {
  const t = useT();
  const bot = useStore((s) => s.bots[botId]);
  const thread = useStore((s) => s.threads[botId]);
  const live = useStore((s) => s.live[botId]) ?? IDLE_LIVE;
  const mainId = useStore((s) => s.selectedId);
  const all = useStore((s) => s.bots);
  const ids = useSideChat((s) => s.ids);
  const others = ids.filter((x) => x !== botId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!bot) return null;
  const send = async () => {
    setBusy(true);
    if (await quickSend(bot.id, text)) setText("");
    setBusy(false);
  };
  const canTalk = !bot.access || bot.access.canTalk;
  return (
    <section className="main side-chat" aria-label={t("side.label", { name: bot.name })}>
      <header className="side-chat-head">
        <BotAvatar bot={bot} size={28} />
        <label className="sr-only" htmlFor={`side-chat-bot-${bot.id}`}>{t("side.change")}</label>
        <select id={`side-chat-bot-${bot.id}`} className="input input-small side-chat-select" value={bot.id} onChange={(e) => useSideChat.getState().set(ids.map((x) => (x === bot.id ? e.target.value : x)))}>
          {sideCandidates(Object.values(all), mainId).filter((b) => b.id === bot.id || !others.includes(b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {live.running && <span className="dot-inline dot-pulse" title={t("side.working")} />}
        <span className="spacer" />
        <button type="button" className="btn btn-small btn-ghost" onClick={() => { const main = useStore.getState().selectedId; useSideChat.getState().set(ids.map((x) => (x === bot.id ? main ?? "" : x)).filter(Boolean)); useStore.getState().selectBot(bot.id); }} title={t("side.mainHint")}><Icon name="expand" size={14} /> <span className="side-chat-text">{t("side.main")}</span></button>
        <IconButton icon="close" label={t("side.close")} onClick={() => useSideChat.getState().remove(bot.id)} />
      </header>
      <div className="chat-body-row side-chat-body">
        <Transcript bot={bot} thread={thread} live={live} />
      </div>
      {canTalk && (
        <form className="side-chat-composer" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void send(); }}>
          <input className="input" value={text} maxLength={8000} placeholder={t("side.placeholder", { name: bot.name })} aria-label={t("side.placeholder", { name: bot.name })} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-accent" disabled={busy || !text.trim()} aria-label={t("passage.send")}><Icon name="send" size={15} /></button>
        </form>
      )}
    </section>
  );
}

/**
 * The chat menu's entries: « Ouvrir une discussion à côté » (or « Fermer les discussions à côté »), « Ajouter une
 * discussion » (the 2×2 grid, from 1 400 px, up to three beside) and « Dispositions… ». Hidden on narrow windows.
 */
export function SideChatMenuItem({ onDone }: { onDone: () => void }) {
  const t = useT();
  const mainId = useStore((s) => s.selectedId);
  const all = useStore((s) => s.bots);
  const width = useWidth();
  const shown = useSideBots();
  const free = sideCandidates(Object.values(all), mainId).filter((b) => !shown.includes(b.id));
  if (width < SIDE_MIN_WIDTH || (!free.length && !shown.length)) return null;
  const s = useSideChat.getState();
  return (
    <>
      <MenuItem icon="panel" onClick={() => { onDone(); if (shown.length) s.close(); else if (free[0]) s.open(free[0].id); }}>{t(shown.length ? (shown.length > 1 ? "grid.closeAll" : "side.closeMenu") : "side.open")}</MenuItem>
      {width >= GRID_MIN_WIDTH && shown.length >= 1 && shown.length < MAX_SIDE && free[0] && <MenuItem icon="plus" onClick={() => { onDone(); s.set([...shown, free[0].id]); }}>{t("grid.add")}</MenuItem>}
      <MenuItem icon="folder" onClick={() => { onDone(); openChatLayouts(); }}>{t("grid.layouts")}</MenuItem>
    </>
  );
}
