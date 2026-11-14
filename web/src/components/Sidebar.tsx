import { useMemo, useState, type ReactNode } from "react";
import { api, errText } from "../api";
import { IDLE_LIVE, primaryBot, sortedBots, useStore } from "../store";
import type { Bot, BotSection, Live } from "../types";
import { tn, useT, t as tt } from "../i18n";
import { botTitle, initials } from "../lib/format";
import { BotAvatar } from "./Avatar";
import { Icon } from "./Icon";
import { IconButton, Menu, MenuItem, modKey } from "./ui";

function statusOf(bot: Bot, live: Live): "attention" | "working" | "unread" | null {
  if (live.awaiting) return "attention";
  if (live.running) return "working";
  if (bot.unread > 0) return "unread";
  return null;
}

const statusLabel = (status: "attention" | "working" | "unread"): string => tt(`sidebar.status.${status}`);

function previewOf(bot: Bot, live: Live): string {
  if (live.awaiting) return tt("sidebar.waitingReason", { reason: live.awaiting.reason });
  if (bot.preview) return bot.preview;
  if (live.running) return tt("sidebar.workingPreview");
  return tt("sidebar.noMessages");
}

const DRAG_TYPE = "application/x-sklubot-bot";
const FOLD_KEY = "sklubot.sidebarFolds";
function readFolds(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(FOLD_KEY) ?? "{}") as Record<string, boolean>; } catch { return {}; }
}

/** Where a bot can be filed from its menu: pinned, a section, back to the team, hidden. */
function BotMenu({ bot, open, onClose }: { bot: Bot; open: boolean; onClose: () => void }) {
  const sections = useStore((s) => s.sections);
  const { organise, markUnread, openModal, openBotSettings, showToast } = useStore.getState();
  const [moving, setMoving] = useState(false);
  const t = useT();
  const close = () => { setMoving(false); onClose(); };
  const newSection = async () => {
    const name = window.prompt(t("sections.newPrompt"))?.trim();
    if (!name) return;
    try {
      const r = await api<{ section: BotSection }>("POST", "/sections", { name });
      await useStore.getState().loadSections();
      await organise(bot.id, { sectionId: r.section.id });
    } catch (e) { showToast(errText(e)); }
  };
  return (
    <Menu open={open} onClose={close} align="right" label={t("sidebar.botMenu", { name: bot.name })} className="bot-menu">
      {moving ? (
        <>
          <div className="menu-head">{t("sidebar.moveTo")}</div>
          <MenuItem icon={bot.sectionId === null ? "check" : "users"} onClick={() => { close(); void organise(bot.id, { sectionId: null }); }}>{t("sidebar.team")}</MenuItem>
          {sections.map((sec) => (
            <MenuItem key={sec.id} icon={bot.sectionId === sec.id ? "check" : "folder"} onClick={() => { close(); void organise(bot.id, { sectionId: sec.id }); }}>{sec.name}</MenuItem>
          ))}
          <div className="menu-sep" />
          <MenuItem icon="plus" onClick={() => { close(); void newSection(); }}>{t("sections.new")}</MenuItem>
        </>
      ) : (
        <>
          <MenuItem icon="pin" onClick={() => { close(); void organise(bot.id, { pinned: !bot.pinned }); }}>{t(bot.pinned ? "sidebar.unpin" : "sidebar.pin")}</MenuItem>
          <MenuItem icon="folder" onClick={() => setMoving(true)}>{t("sidebar.moveTo")}…</MenuItem>
          {bot.kind === "agent" && <MenuItem icon="copy" onClick={() => { close(); openModal({ kind: "duplicate", botId: bot.id }); }}>{t("sidebar.duplicate")}…</MenuItem>}
          {bot.unread === 0 && <MenuItem icon="ring" onClick={() => { close(); void markUnread(bot.id); }}>{t("sidebar.markUnread")}</MenuItem>}
          {!bot.primary && <MenuItem icon={bot.listHidden ? "eye" : "eyeOff"} onClick={() => { close(); void organise(bot.id, { listHidden: !bot.listHidden }); }}>{t(bot.listHidden ? "sidebar.unhide" : "sidebar.hide")}</MenuItem>}
          <div className="menu-sep" />
          <MenuItem icon="settings" onClick={() => { close(); openBotSettings(bot.id); }}>{t("chat.botSettings")}</MenuItem>
        </>
      )}
    </Menu>
  );
}

function BotRow({ bot, live, active, collapsed }: { bot: Bot; live: Live; active: boolean; collapsed: boolean }) {
  const selectBot = useStore((s) => s.selectBot);
  const [menu, setMenu] = useState(false);
  const t = useT();
  const status = statusOf(bot, live);
  const title = botTitle(bot);
  return (
    <li className={`bot-row-wrap menu-wrap ${menu ? "has-menu" : ""}`}>
      <button
        type="button"
        className={`bot-row ${active ? "is-active" : ""}`}
        onClick={() => selectBot(bot.id)}
        onContextMenu={(e) => { if (collapsed) return; e.preventDefault(); setMenu(true); }}
        draggable={!collapsed}
        onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, bot.id); e.dataTransfer.effectAllowed = "move"; }}
        aria-current={active ? "true" : undefined}
        title={collapsed ? title : undefined}
        aria-label={collapsed ? `${title}${status ? ` — ${statusLabel(status)}` : ""}` : undefined}
      >
        <span className="bot-row-avatar">
          <BotAvatar bot={bot} size={38} />
          {status && <span className={`dot dot-${status}`} title={statusLabel(status)} />}
        </span>
        {!collapsed && (
          <span className="bot-row-text">
            <span className="bot-row-name">
              <span className="truncate">{bot.name}</span>
              {bot.label && <span className="bot-row-label truncate">· {bot.label}</span>}
              {bot.kind === "room" && <Icon name="users" size={13} className="bot-row-kind" />}
              {bot.pinned && <Icon name="pin" size={12} className="bot-row-kind" />}
              {bot.access && <Icon name="users" size={12} className="bot-row-kind" aria-label={bot.access.workspaceName} />}
            </span>
            <span className={`bot-row-preview truncate ${status === "attention" ? "is-attention" : ""}`}>{previewOf(bot, live)}</span>
          </span>
        )}
        {!collapsed && bot.unread > 0 && <span className="count-badge" aria-label={tn("sidebar.unread", bot.unread)}>{bot.unread > 99 ? "99+" : bot.unread}</span>}
      </button>
      {!collapsed && !bot.access && (
        <button type="button" className="icon-btn bot-row-more" aria-label={t("sidebar.botMenu", { name: bot.name })} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
          <Icon name="more" size={16} />
        </button>
      )}
      {menu && <BotMenu bot={bot} open={menu} onClose={() => setMenu(false)} />}
    </li>
  );
}

/** A heading with its list. Bots dragged onto it are filed there. */
function Group({ id, title, count, folded, onFold, onDropBot, actions, children }: {
  id: string; title: string; count: number; folded: boolean; onFold: () => void; onDropBot?: (botId: string) => void; actions?: ReactNode; children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const t = useT();
  const drop = onDropBot
    ? {
        onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setOver(true); } },
        onDragLeave: () => setOver(false),
        onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(false); const botId = e.dataTransfer.getData(DRAG_TYPE); if (botId) onDropBot(botId); },
      }
    : {};
  return (
    <section className={`sidebar-group ${over ? "is-drop" : ""}`} {...drop} aria-labelledby={`grp-${id}`}>
      <div className="sidebar-group-head">
        <button type="button" className="sidebar-heading sidebar-fold" id={`grp-${id}`} aria-expanded={!folded} onClick={onFold} title={t(folded ? "sidebar.expandGroup" : "sidebar.collapseGroup")}>
          <Icon name={folded ? "chevronRight" : "chevronDown"} size={12} />
          <span className="truncate">{title}</span>
          {count > 0 && <span className="sidebar-group-count">{count}</span>}
        </button>
        {actions}
      </div>
      {!folded && children}
    </section>
  );
}

/** The menu of a section of the user's: rename, delete (its bots go back to the team). */
function SectionActions({ section }: { section: BotSection }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const { showToast, loadSections } = useStore.getState();
  const rename = async () => {
    setOpen(false);
    const name = window.prompt(t("sections.renamePrompt"), section.name)?.trim();
    if (!name || name === section.name) return;
    try { await api("PATCH", `/sections/${section.id}`, { name }); await loadSections(); } catch (e) { showToast(errText(e)); }
  };
  const remove = async () => {
    setOpen(false);
    if (!window.confirm(t("sections.deleteConfirm", { name: section.name }))) return;
    try { await api("DELETE", `/sections/${section.id}`); await loadSections(); } catch (e) { showToast(errText(e)); }
  };
  return (
    <span className="menu-wrap">
      <button type="button" className="icon-btn sidebar-group-more" aria-label={t("sections.menu", { name: section.name })} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="more" size={15} />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} align="right" label={t("sections.menu", { name: section.name })}>
        <MenuItem icon="edit" onClick={() => void rename()}>{t("sections.rename")}</MenuItem>
        <MenuItem icon="trash" danger onClick={() => void remove()}>{t("sections.delete")}</MenuItem>
      </Menu>
    </span>
  );
}

export function Sidebar() {
  const bots = useStore((s) => s.bots);
  const live = useStore((s) => s.live);
  const selectedId = useStore((s) => s.selectedId);
  const view = useStore((s) => s.view);
  const collapsedPref = useStore((s) => s.sidebarCollapsed);
  const mobileNav = useStore((s) => s.mobileNav);
  const tasks = useStore((s) => s.tasks);
  const user = useStore((s) => s.user);
  const online = useStore((s) => s.online);
  const { toggleSidebar, openModal, setView, selectBot, openAppSettings, logout, setMobileNav } = useStore.getState();
  const [menuOpen, setMenuOpen] = useState(false);
  const t = useT();

  const collapsed = collapsedPref && !mobileNav;
  const primary = useMemo(() => primaryBot(bots), [bots]);
  const sections = useStore((s) => s.sections);
  const others = useMemo(() => sortedBots(bots).filter((b) => !b.primary), [bots]);
  const [folds, setFolds] = useState<Record<string, boolean>>(readFolds);
  const fold = (id: string) => setFolds((f) => {
    const next = { ...f, [id]: !f[id] };
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(next)); } catch { /* not kept */ }
    return next;
  });
  // Wave 6: bots others share with you through a workspace have their own group.
  const sharedBots = others.filter((b) => !!b.access);
  const visible = others.filter((b) => !b.listHidden && !b.access);
  const pinned = visible.filter((b) => b.pinned);
  const known = new Set(sections.map((x) => x.id));
  const bySection = (id: string) => visible.filter((b) => !b.pinned && b.sectionId === id);
  const team = visible.filter((b) => !b.pinned && (!b.sectionId || !known.has(b.sectionId)));
  const hiddenBots = others.filter((b) => b.listHidden && !b.access);
  const { organise } = useStore.getState();
  const rowsOf = (list: Bot[]) => (
    <ul className="bot-list">
      {list.map((b) => <BotRow key={b.id} bot={b} live={live[b.id] ?? IDLE_LIVE} active={chatActive && selectedId === b.id} collapsed={collapsed} />)}
    </ul>
  );
  const addSection = async () => {
    const name = window.prompt(t("sections.newPrompt"))?.trim();
    if (!name) return;
    try { await api("POST", "/sections", { name }); await useStore.getState().loadSections(); } catch (e) { useStore.getState().showToast(errText(e)); }
  };
  const waiting = tasks?.filter((t) => t.state === "needs_input").length ?? 0;
  const chatActive = view === "chat";
  const primaryLive = primary ? (live[primary.id] ?? IDLE_LIVE) : IDLE_LIVE;
  const primaryStatus = primary ? statusOf(primary, primaryLive) : null;

  return (
    <>
      {mobileNav && <div className="sidebar-scrim" onClick={() => setMobileNav(false)} aria-hidden="true" />}
      <nav className={`sidebar ${collapsed ? "is-collapsed" : ""} ${mobileNav ? "is-mobile-open" : ""}`} aria-label={t("sidebar.bots")}>
        <div className="sidebar-top">
          {!collapsed && <span className="sidebar-brand">Sklubot</span>}
          <span className="sidebar-top-actions">
            {!collapsed && (
              <>
                <IconButton icon="search" label={t("palette.open")} title={`${t("palette.open")} (${modKey}K)`} onClick={() => openModal({ kind: "search" })} />
                <IconButton icon="plus" label={t("sidebar.newBot")} onClick={() => openModal({ kind: "createBot" })} />
              </>
            )}
            <IconButton
              icon="sidebar"
              className="sidebar-collapse"
              label={t(collapsed ? "sidebar.expand" : "sidebar.collapse")}
              title={`${t(collapsed ? "sidebar.expand" : "sidebar.collapse")} (${modKey}B)`}
              onClick={toggleSidebar}
            />
            <IconButton icon="close" className="sidebar-close" label={t("sidebar.closeMenu")} onClick={() => setMobileNav(false)} />
          </span>
        </div>

        <button
          type="button"
          className={`nav-row ${view === "tasks" ? "is-active" : ""}`}
          onClick={() => setView(view === "tasks" ? "chat" : "tasks")}
          aria-pressed={view === "tasks"}
          title={collapsed ? t("sidebar.tasks") : undefined}
          aria-label={collapsed ? `${t("sidebar.tasks")}${waiting ? `, ${tn("sidebar.tasksWaiting", waiting)}` : ""}` : undefined}
        >
          <span className="nav-row-icon">
            <Icon name="tasks" size={19} />
            {collapsed && waiting > 0 && <span className="dot dot-attention" />}
          </span>
          {!collapsed && <span className="nav-row-label">{t("sidebar.tasks")}</span>}
          {!collapsed && waiting > 0 && <span className="count-badge is-attention" aria-label={tn("sidebar.tasksWaiting", waiting)}>{waiting}</span>}
        </button>

        <div className="sidebar-scroll">
          {primary && (
            <button
              type="button"
              className={`primary-tile ${chatActive && selectedId === primary.id ? "is-active" : ""}`}
              onClick={() => selectBot(primary.id)}
              aria-current={chatActive && selectedId === primary.id ? "true" : undefined}
              title={collapsed ? botTitle(primary) : undefined}
              aria-label={collapsed ? botTitle(primary) : undefined}
            >
              <span className="bot-row-avatar">
                <BotAvatar bot={primary} size={collapsed ? 40 : 58} badge interactive />
                {primaryStatus && <span className={`dot dot-${primaryStatus}`} title={statusLabel(primaryStatus)} />}
              </span>
              {!collapsed && (
                <>
                  <span className="primary-tile-name">{botTitle(primary)}</span>
                  <span className={`primary-tile-preview truncate ${primaryStatus === "attention" ? "is-attention" : ""}`}>
                    {previewOf(primary, primaryLive)}
                  </span>
                </>
              )}
            </button>
          )}

          {collapsed ? (
            rowsOf([...pinned, ...sections.flatMap((sec) => bySection(sec.id)), ...team, ...sharedBots])
          ) : (
            <>
              {pinned.length > 0 && (
                <Group id="pinned" title={t("sidebar.pinned")} count={0} folded={!!folds.pinned} onFold={() => fold("pinned")} onDropBot={(id) => void organise(id, { pinned: true })}>
                  {rowsOf(pinned)}
                </Group>
              )}
              {sections.map((sec) => (
                <Group key={sec.id} id={sec.id} title={sec.name} count={bySection(sec.id).length} folded={!!folds[sec.id]} onFold={() => fold(sec.id)} onDropBot={(id) => void organise(id, { sectionId: sec.id, pinned: false })} actions={<SectionActions section={sec} />}>
                  {bySection(sec.id).length ? rowsOf(bySection(sec.id)) : <p className="sidebar-drop-hint">{t("sections.empty")}</p>}
                </Group>
              ))}
              {(team.length > 0 || sections.length > 0) && others.length > 0 && (
                <Group id="team" title={t("sidebar.team")} count={0} folded={!!folds.team} onFold={() => fold("team")} onDropBot={(id) => void organise(id, { sectionId: null, pinned: false })}
                  actions={<button type="button" className="icon-btn sidebar-group-more" aria-label={t("sections.new")} title={t("sections.new")} onClick={() => void addSection()}><Icon name="plus" size={15} /></button>}>
                  {rowsOf(team)}
                </Group>
              )}
              {sharedBots.length > 0 && (
                <Group id="shared" title={t("sidebar.shared")} count={0} folded={!!folds.shared} onFold={() => fold("shared")}>
                  {rowsOf(sharedBots)}
                </Group>
              )}
              {hiddenBots.length > 0 && (
                <Group id="hidden" title={t("sidebar.hiddenCount", { n: hiddenBots.length })} count={0} folded={folds.hidden !== false} onFold={() => setFolds((f) => { const next = { ...f, hidden: f.hidden === false }; try { localStorage.setItem(FOLD_KEY, JSON.stringify(next)); } catch { /* not kept */ } return next; })}>
                  <div className="is-hidden-list">{rowsOf(hiddenBots)}</div>
                </Group>
              )}
            </>
          )}

          {others.length === 0 && !collapsed && (
            <button type="button" className="cta-row" onClick={() => openModal({ kind: "createBot" })}>
              <span className="cta-row-icon">
                <Icon name="plus" size={18} />
              </span>
              <span className="bot-row-text">
                <span className="bot-row-name">{t("sidebar.createBot")}</span>
                <span className="bot-row-preview">{t("sidebar.createBotHint")}</span>
              </span>
            </button>
          )}
          {collapsed && (
            <button type="button" className="icon-btn rail-add" aria-label={t("sidebar.newBot")} title={t("sidebar.newBot")} onClick={() => openModal({ kind: "createBot" })}>
              <Icon name="plus" size={18} />
            </button>
          )}
        </div>

        {!online && !collapsed && (
          <div className="sidebar-offline" role="status">
            <span className="dot-inline dot-warn" /> {t("sidebar.reconnecting")}
          </div>
        )}

        <div className="sidebar-foot">
          {!collapsed && user && (
            <div className="menu-wrap grow">
              <button type="button" className="account-btn" onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen} title={user.email}>
                <span className="initials">{initials(user.name || user.email)}</span>
                <span className="truncate">{user.name || user.email}</span>
              </button>
              <Menu open={menuOpen} onClose={() => setMenuOpen(false)} side="top" label={t("sidebar.account")}>
                <div className="menu-head truncate">{user.email}</div>
                <MenuItem
                  icon="settings"
                  hint={`${modKey},`}
                  onClick={() => {
                    setMenuOpen(false);
                    openAppSettings();
                  }}
                >
                  {t("sidebar.settings")}
                </MenuItem>
                <MenuItem
                  icon="plug"
                  onClick={() => {
                    setMenuOpen(false);
                    openModal({ kind: "connectors" });
                  }}
                >
                  {t("sidebar.connectApps")}
                </MenuItem>
                <div className="menu-sep" />
                <MenuItem icon="logout" danger onClick={() => void logout()}>
                  {t("sidebar.logout")}
                </MenuItem>
              </Menu>
            </div>
          )}
          <IconButton icon="plug" className="round-btn" label={t("sidebar.connectApps")} onClick={() => openModal({ kind: "connectors" })} />
        </div>
      </nav>
    </>
  );
}
