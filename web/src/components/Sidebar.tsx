import { useMemo, useState } from "react";
import { IDLE_LIVE, primaryBot, sortedBots, useStore } from "../store";
import type { Bot, Live } from "../types";
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

const STATUS_LABEL = { attention: "Waiting for you", working: "Working", unread: "Unread messages" } as const;

function previewOf(bot: Bot, live: Live): string {
  if (live.awaiting) return `Waiting for you: ${live.awaiting.reason}`;
  if (bot.preview) return bot.preview;
  if (live.running) return "Working…";
  return "No messages yet";
}

function BotRow({ bot, live, active, collapsed }: { bot: Bot; live: Live; active: boolean; collapsed: boolean }) {
  const selectBot = useStore((s) => s.selectBot);
  const status = statusOf(bot, live);
  const title = botTitle(bot);
  return (
    <li>
      <button
        type="button"
        className={`bot-row ${active ? "is-active" : ""}`}
        onClick={() => selectBot(bot.id)}
        aria-current={active ? "true" : undefined}
        title={collapsed ? title : undefined}
        aria-label={collapsed ? `${title}${status ? ` — ${STATUS_LABEL[status]}` : ""}` : undefined}
      >
        <span className="bot-row-avatar">
          <BotAvatar bot={bot} size={38} />
          {status && <span className={`dot dot-${status}`} title={STATUS_LABEL[status]} />}
        </span>
        {!collapsed && (
          <span className="bot-row-text">
            <span className="bot-row-name">
              <span className="truncate">{bot.name}</span>
              {bot.label && <span className="bot-row-label truncate">· {bot.label}</span>}
              {bot.kind === "room" && <Icon name="users" size={13} className="bot-row-kind" />}
            </span>
            <span className={`bot-row-preview truncate ${status === "attention" ? "is-attention" : ""}`}>{previewOf(bot, live)}</span>
          </span>
        )}
        {!collapsed && bot.unread > 0 && <span className="count-badge" aria-label={`${bot.unread} unread`}>{bot.unread > 99 ? "99+" : bot.unread}</span>}
      </button>
    </li>
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

  const collapsed = collapsedPref && !mobileNav;
  const primary = useMemo(() => primaryBot(bots), [bots]);
  const others = useMemo(() => sortedBots(bots).filter((b) => !b.primary), [bots]);
  const waiting = tasks?.filter((t) => t.state === "needs_input").length ?? 0;
  const chatActive = view === "chat";
  const primaryLive = primary ? (live[primary.id] ?? IDLE_LIVE) : IDLE_LIVE;
  const primaryStatus = primary ? statusOf(primary, primaryLive) : null;

  return (
    <>
      {mobileNav && <div className="sidebar-scrim" onClick={() => setMobileNav(false)} aria-hidden="true" />}
      <nav className={`sidebar ${collapsed ? "is-collapsed" : ""} ${mobileNav ? "is-mobile-open" : ""}`} aria-label="Bots">
        <div className="sidebar-top">
          {!collapsed && <span className="sidebar-brand">Sklubot</span>}
          <span className="sidebar-top-actions">
            {!collapsed && (
              <>
                <IconButton icon="search" label="Search" title={`Search (${modKey}K)`} onClick={() => openModal({ kind: "search" })} />
                <IconButton icon="plus" label="New bot" onClick={() => openModal({ kind: "createBot" })} />
              </>
            )}
            <IconButton
              icon="sidebar"
              className="sidebar-collapse"
              label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={`${collapsed ? "Expand" : "Collapse"} sidebar (${modKey}B)`}
              onClick={toggleSidebar}
            />
            <IconButton icon="close" className="sidebar-close" label="Close menu" onClick={() => setMobileNav(false)} />
          </span>
        </div>

        <button
          type="button"
          className={`nav-row ${view === "tasks" ? "is-active" : ""}`}
          onClick={() => setView(view === "tasks" ? "chat" : "tasks")}
          aria-pressed={view === "tasks"}
          title={collapsed ? "Tasks" : undefined}
          aria-label={collapsed ? `Tasks${waiting ? `, ${waiting} waiting on you` : ""}` : undefined}
        >
          <span className="nav-row-icon">
            <Icon name="tasks" size={19} />
            {collapsed && waiting > 0 && <span className="dot dot-attention" />}
          </span>
          {!collapsed && <span className="nav-row-label">Tasks</span>}
          {!collapsed && waiting > 0 && <span className="count-badge is-attention" aria-label={`${waiting} waiting on you`}>{waiting}</span>}
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
                <BotAvatar bot={primary} size={collapsed ? 40 : 58} badge />
                {primaryStatus && <span className={`dot dot-${primaryStatus}`} title={STATUS_LABEL[primaryStatus]} />}
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

          {!collapsed && others.length > 0 && <h2 className="sidebar-heading">Team</h2>}
          <ul className="bot-list">
            {others.map((b) => (
              <BotRow key={b.id} bot={b} live={live[b.id] ?? IDLE_LIVE} active={chatActive && selectedId === b.id} collapsed={collapsed} />
            ))}
          </ul>

          {others.length === 0 && !collapsed && (
            <button type="button" className="cta-row" onClick={() => openModal({ kind: "createBot" })}>
              <span className="cta-row-icon">
                <Icon name="plus" size={18} />
              </span>
              <span className="bot-row-text">
                <span className="bot-row-name">Create a bot</span>
                <span className="bot-row-preview">Give it one job — research, inbox, reports — and let it run.</span>
              </span>
            </button>
          )}
          {collapsed && (
            <button type="button" className="icon-btn rail-add" aria-label="New bot" title="New bot" onClick={() => openModal({ kind: "createBot" })}>
              <Icon name="plus" size={18} />
            </button>
          )}
        </div>

        {!online && !collapsed && (
          <div className="sidebar-offline" role="status">
            <span className="dot-inline dot-warn" /> Reconnecting…
          </div>
        )}

        <div className="sidebar-foot">
          {!collapsed && user && (
            <div className="menu-wrap grow">
              <button type="button" className="account-btn" onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen} title={user.email}>
                <span className="initials">{initials(user.name || user.email)}</span>
                <span className="truncate">{user.name || user.email}</span>
              </button>
              <Menu open={menuOpen} onClose={() => setMenuOpen(false)} side="top" label="Account">
                <div className="menu-head truncate">{user.email}</div>
                <MenuItem
                  icon="settings"
                  hint={`${modKey},`}
                  onClick={() => {
                    setMenuOpen(false);
                    openAppSettings();
                  }}
                >
                  Settings
                </MenuItem>
                <MenuItem
                  icon="plug"
                  onClick={() => {
                    setMenuOpen(false);
                    openModal({ kind: "connectors" });
                  }}
                >
                  Connect apps
                </MenuItem>
                <div className="menu-sep" />
                <MenuItem icon="logout" danger onClick={() => void logout()}>
                  Log out
                </MenuItem>
              </Menu>
            </div>
          )}
          <IconButton icon="plug" className="round-btn" label="Connect apps" onClick={() => openModal({ kind: "connectors" })} />
        </div>
      </nav>
    </>
  );
}
