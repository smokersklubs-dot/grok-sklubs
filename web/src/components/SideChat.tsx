import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { IDLE_LIVE, useStore } from "../store";
import { quickSend } from "../lib/quicksend";
import { SIDE_MIN_WIDTH, sideBotId, sideCandidates, useSideChat } from "../lib/sidechat";
import { BotAvatar } from "./Avatar";
import { Icon } from "./Icon";
import { IconButton, MenuItem } from "./ui";
import { Transcript } from "./Transcript";
import "./SideChat.css";

/**
 * L146 « discussions côte à côte »: a second bot's live chat beside the selected one (lib/sidechat.ts). The same
 * transcript as the main chat (it scrolls live), a short message box, a menu to change the bot, « Ouvrir en grand »
 * (makes it the main chat) and Close. Offered only on windows at least 1 100 px wide.
 */
function useWidth() {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  useEffect(() => { const on = () => setW(window.innerWidth); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, []);
  return w;
}

/** The id of the bot shown beside the main chat now, or null (App.tsx lays out the third column with it). */
export function useSideBot(): string | null {
  const side = useSideChat((s) => s.botId);
  const mainId = useStore((s) => s.selectedId);
  const bots = useStore((s) => s.bots);
  return sideBotId(side, mainId, (id) => !!bots[id], useWidth());
}

export function SideChat({ botId }: { botId: string }) {
  const t = useT();
  const bot = useStore((s) => s.bots[botId]);
  const thread = useStore((s) => s.threads[botId]);
  const live = useStore((s) => s.live[botId]) ?? IDLE_LIVE;
  const mainId = useStore((s) => s.selectedId);
  const all = useStore((s) => s.bots);
  const { open, close } = useSideChat();
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
        <label className="sr-only" htmlFor="side-chat-bot">{t("side.change")}</label>
        <select id="side-chat-bot" className="input input-small side-chat-select" value={bot.id} onChange={(e) => open(e.target.value)}>
          {sideCandidates(Object.values(all), mainId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {live.running && <span className="dot-inline dot-pulse" title={t("side.working")} />}
        <span className="spacer" />
        <button type="button" className="btn btn-small btn-ghost" onClick={() => { close(); useStore.getState().selectBot(bot.id); }} title={t("side.mainHint")}><Icon name="expand" size={14} /> <span className="side-chat-text">{t("side.main")}</span></button>
        <IconButton icon="close" label={t("side.close")} onClick={close} />
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

/** « Ouvrir une discussion à côté » in the chat's menu: puts the first other bot beside; hidden on narrow windows. */
export function SideChatMenuItem({ onDone }: { onDone: () => void }) {
  const t = useT();
  const mainId = useStore((s) => s.selectedId);
  const all = useStore((s) => s.bots);
  const width = useWidth();
  const side = useSideChat((s) => s.botId);
  const first = sideCandidates(Object.values(all), mainId)[0];
  if (width < SIDE_MIN_WIDTH || !first) return null;
  const shown = !!side && side !== mainId && !!all[side];
  return <MenuItem icon="panel" onClick={() => { onDone(); if (shown) useSideChat.getState().close(); else useSideChat.getState().open(first.id); }}>{t(shown ? "side.closeMenu" : "side.open")}</MenuItem>;
}
