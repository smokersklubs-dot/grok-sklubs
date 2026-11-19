import { useState } from "react";
import { useT } from "../i18n";
import { IDLE_LIVE, useStore } from "../store";
import { accentStyle } from "../lib/colors";
import { botTitle } from "../lib/format";
import { BotAvatar } from "./Avatar";
import { CallBar } from "./CallBar";
import { CallHeadButton } from "./CallHeadButton";
import { Composer } from "./Composer";
import { WorkContext } from "./WorkContext";
import { Icon } from "./Icon";
import { Transcript } from "./Transcript";
import { FindBar } from "./FindBar";
import { FilePreviewPanel } from "./SpendSkillsFiles";
import { PausedBadge, resumeWidest, setPaused } from "./Pause";
import { SharedBadge } from "./WorkspacesMailVoice";
import { IconButton, Menu, MenuItem, isMac, modKey } from "./ui";
import { ReadAloudChip, ReadAloudMenuItem, useReadAloud } from "./ListenControls";

export function ChatView() {
  const bot = useStore((s) => (s.selectedId ? s.bots[s.selectedId] : undefined));
  const thread = useStore((s) => (s.selectedId ? s.threads[s.selectedId] : undefined));
  const live = useStore((s) => (s.selectedId ? s.live[s.selectedId] : undefined)) ?? IDLE_LIVE;
  const detailsOpen = useStore((s) => s.detailsOpen);
  const recording = useStore((s) => (s.selectedId ? s.recordings[s.selectedId] : null));
  const { toggleDetails, openViewer, openBotSettings, resetConversation, showToast, setMobileNav, openModal, openFind } = useStore.getState();
  const finding = useStore((s) => !!s.find && s.find.botId === s.selectedId);
  const [menu, setMenu] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const t = useT();
  useReadAloud(bot, thread);

  if (!bot) {
    return (
      <section className="main">
        <header className="chat-head">
          <IconButton icon="menu" label={t("common.openMenu")} className="only-mobile" onClick={() => setMobileNav(true)} />
          <span className="chat-head-right">
            <IconButton icon="command" label={t("palette.open")} onClick={() => openModal({ kind: "search" })} />
          </span>
        </header>
        <div className="chat-empty">
          <h2>{t("chat.noBot")}</h2>
          <p>{t("chat.noBotHint")}</p>
          <button type="button" className="btn btn-small" onClick={() => openModal({ kind: "templates" })}><Icon name="star" size={14} /> {t("tpl.open")}</button>
        </div>
      </section>
    );
  }

  const close = () => {
    setMenu(false);
    setConfirmNew(false);
  };

  return (
    <section className="main chat" style={accentStyle(bot.color, bot.character?.customColor)} aria-label={t("chat.with", { name: bot.name })}>
      <header className="chat-head">
        <IconButton icon="menu" label={t("common.openMenu")} className="only-mobile" onClick={() => setMobileNav(true)} />
        <div className="menu-wrap chat-head-center">
          <button type="button" className="bot-pill" onClick={() => (menu ? close() : setMenu(true))} aria-haspopup="menu" aria-expanded={menu}>
            <BotAvatar bot={bot} size={24} badge />
            <span className="truncate">{botTitle(bot)}</span>
            <PausedBadge bot={bot} />
            <Icon name="chevronDown" size={14} />
          </button>
          <Menu open={menu} onClose={close} align="center" label={t("chat.actions", { name: bot.name })}>
            <MenuItem
              icon="panel"
              hint={isMac ? "⌘⇧," : "Ctrl+Shift+,"}
              onClick={() => {
                close();
                toggleDetails();
              }}
            >
              {t(detailsOpen ? "chat.hideDetails" : "chat.showDetails")}
            </MenuItem>
            {bot.kind !== "room" && !bot.access && (
              <MenuItem
                icon="monitor"
                onClick={() => {
                  close();
                  openViewer(bot.id);
                }}
              >
                {t("chat.openComputer")}
              </MenuItem>
            )}
            {!bot.access && <MenuItem
              icon="edit"
              danger={confirmNew}
              onClick={() => {
                if (!confirmNew) {
                  setConfirmNew(true);
                  return;
                }
                close();
                resetConversation(bot.id).then(
                  () => showToast(t("chat.started")),
                  (e: unknown) => showToast(e instanceof Error ? e.message : t("chat.startFailed")),
                );
              }}
            >
              {t(confirmNew ? "chat.confirmNew" : "chat.newConversation")}
            </MenuItem>}
            <ReadAloudMenuItem bot={bot} onDone={close} />
            <MenuItem
              icon="search"
              onClick={() => {
                close();
                openFind(bot.id);
              }}
            >
              {t("find.inChat")}
            </MenuItem>
            {!bot.access && bot.kind === "agent" && (
              bot.pause
                ? <MenuItem icon="play" onClick={() => { close(); void resumeWidest(bot); }}>{t(bot.pause.by === "all" ? "pause.resumeAll" : bot.pause.by === "section" ? "pause.resumeSection" : "pause.resumeBot")}</MenuItem>
                : <MenuItem icon="pause" onClick={() => { close(); void setPaused({ kind: "bot", bot }, true); }}>{t("pause.pauseBot")}</MenuItem>
            )}
            {!bot.access && <MenuItem
              icon="settings"
              onClick={() => {
                close();
                openBotSettings(bot.id);
              }}
            >
              {t("chat.botSettings")}
            </MenuItem>}
          </Menu>
        </div>
        <span className="chat-head-right">
          <SharedBadge bot={bot} />
          <ReadAloudChip bot={bot} />
          <CallHeadButton bot={bot} />
          {recording && recording.status !== "error" && (
            <button type="button" className="rec-chip" onClick={() => openViewer(bot.id, { control: true })} title={t("teach.openViewer")}>
              <span className={recording.status === "recording" ? "rec-dot" : "rec-dot is-still"} aria-hidden="true" />
              {t(recording.status === "recording" ? "teach.rec" : recording.status === "processing" ? "teach.processingShort" : "teach.reviewShort")}
            </button>
          )}
          <IconButton icon="command" label={t("palette.open")} title={`${t("palette.open")} (${modKey}K)`} onClick={() => openModal({ kind: "search" })} />
          {!detailsOpen && <IconButton icon="panel" label={t("chat.showDetails")} onClick={() => toggleDetails(true)} />}
        </span>
      </header>
      {bot.kind === "agent" && !bot.access && <WorkContext key={bot.id + ":" + bot.model} bot={bot} />}
      {finding && <FindBar key={bot.id} botId={bot.id} />}
      <div className="chat-body-row">
        <Transcript bot={bot} thread={thread} live={live} />
        <FilePreviewPanel />
      </div>
      <CallBar botId={bot.id} />
      {bot.access && !bot.access.canTalk ? (
        <div className="composer-readonly" role="note"><Icon name="eye" size={15} /> {t("ws.readOnly", { owner: bot.access.ownerName })}</div>
      ) : <Composer bot={bot} live={live} />}
    </section>
  );
}
