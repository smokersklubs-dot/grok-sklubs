import { useState } from "react";
import { IDLE_LIVE, useStore } from "../store";
import { accentStyle } from "../lib/colors";
import { botTitle } from "../lib/format";
import { BotAvatar } from "./Avatar";
import { CallBar } from "./CallBar";
import { Composer } from "./Composer";
import { Icon } from "./Icon";
import { Transcript } from "./Transcript";
import { IconButton, Menu, MenuItem, isMac } from "./ui";

export function ChatView() {
  const bot = useStore((s) => (s.selectedId ? s.bots[s.selectedId] : undefined));
  const thread = useStore((s) => (s.selectedId ? s.threads[s.selectedId] : undefined));
  const live = useStore((s) => (s.selectedId ? s.live[s.selectedId] : undefined)) ?? IDLE_LIVE;
  const detailsOpen = useStore((s) => s.detailsOpen);
  const { toggleDetails, openViewer, openBotSettings, resetConversation, showToast, setMobileNav } = useStore.getState();
  const [menu, setMenu] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);

  if (!bot) {
    return (
      <section className="main">
        <header className="chat-head">
          <IconButton icon="menu" label="Open menu" className="only-mobile" onClick={() => setMobileNav(true)} />
        </header>
        <div className="chat-empty">
          <h2>No bot selected</h2>
          <p>Pick a bot from the sidebar, or create one to get started.</p>
        </div>
      </section>
    );
  }

  const close = () => {
    setMenu(false);
    setConfirmNew(false);
  };

  return (
    <section className="main chat" style={accentStyle(bot.color)} aria-label={`Chat with ${bot.name}`}>
      <header className="chat-head">
        <IconButton icon="menu" label="Open menu" className="only-mobile" onClick={() => setMobileNav(true)} />
        <div className="menu-wrap chat-head-center">
          <button type="button" className="bot-pill" onClick={() => (menu ? close() : setMenu(true))} aria-haspopup="menu" aria-expanded={menu}>
            <BotAvatar bot={bot} size={24} badge />
            <span className="truncate">{botTitle(bot)}</span>
            <Icon name="chevronDown" size={14} />
          </button>
          <Menu open={menu} onClose={close} align="center" label={`${bot.name} actions`}>
            <MenuItem
              icon="panel"
              hint={isMac ? "⌘⇧," : "Ctrl+Shift+,"}
              onClick={() => {
                close();
                toggleDetails();
              }}
            >
              {detailsOpen ? "Hide details" : "Show details"}
            </MenuItem>
            {bot.kind !== "room" && (
              <MenuItem
                icon="monitor"
                onClick={() => {
                  close();
                  openViewer(bot.id);
                }}
              >
                Open computer
              </MenuItem>
            )}
            <MenuItem
              icon="edit"
              danger={confirmNew}
              onClick={() => {
                if (!confirmNew) {
                  setConfirmNew(true);
                  return;
                }
                close();
                resetConversation(bot.id).then(
                  () => showToast("Started a new conversation"),
                  (e: unknown) => showToast(e instanceof Error ? e.message : "Couldn't start a new conversation"),
                );
              }}
            >
              {confirmNew ? "Click again to start over" : "New conversation"}
            </MenuItem>
            <MenuItem
              icon="settings"
              onClick={() => {
                close();
                openBotSettings(bot.id);
              }}
            >
              Bot settings
            </MenuItem>
          </Menu>
        </div>
        <span className="chat-head-right">
          {!detailsOpen && <IconButton icon="panel" label="Show details" onClick={() => toggleDetails(true)} />}
        </span>
      </header>
      <Transcript bot={bot} thread={thread} live={live} />
      <CallBar botId={bot.id} />
      <Composer bot={bot} live={live} />
    </section>
  );
}
