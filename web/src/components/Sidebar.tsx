import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, errText } from "../api";
import { IDLE_LIVE, primaryBot, sortedBots, useStore } from "../store";
import type { Bot, BotSection, Live } from "../types";
import { tn, useT, t as tt } from "../i18n";
import { botTitle, initials } from "../lib/format";
import { BotAvatar } from "./Avatar";
import { Icon } from "./Icon";
import { IconButton, Menu, MenuItem, Modal, modKey } from "./ui";
import { PauseAllNotice, PausedBadge, setPaused } from "./Pause";
import { AnnouncementBell } from "./AnnouncementCard";
import { useAnnouncements } from "../lib/announcements";

function statusOf(bot: Bot, live: Live): "attention" | "working" | "unread" | null {
  if (live.awaiting) return "attention";
  if (live.running) return "working";
  if (bot.unread > 0) return "unread";
  return null;
}

const statusLabel = (status: "attention" | "working" | "unread"): string => tt(`sidebar.status.${status}`);

function previewOf(bot: Bot, live: Live): string {
  // A paused bot already has its badge: the line says what waits for it, else its last message.
  if (bot.pause && !live.running && bot.pause.queued > 0) return tn("pause.queued", bot.pause.queued);
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
          {bot.kind === "agent" && !bot.access && <MenuItem icon="download" onClick={() => { close(); openModal({ kind: "exportTemplate", botIds: [bot.id] }); }}>{t("tpl.export")}…</MenuItem>}
          {bot.unread === 0 && <MenuItem icon="ring" onClick={() => { close(); void markUnread(bot.id); }}>{t("sidebar.markUnread")}</MenuItem>}
          {bot.kind === "agent" && (
            bot.pause?.self
              ? <MenuItem icon="play" onClick={() => { close(); void setPaused({ kind: "bot", bot }, false); }}>{t("pause.resumeBot")}</MenuItem>
              : <MenuItem icon="pause" onClick={() => { close(); void setPaused({ kind: "bot", bot }, true); }}>{t("pause.pauseBot")}</MenuItem>
          )}
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
        aria-label={collapsed ? `${title}${bot.pause ? ` — ${t("pause.badge")}` : ""}${status ? ` — ${statusLabel(status)}` : ""}` : undefined}
      >
        <span className={`bot-row-avatar ${bot.pause ? "is-paused" : ""}`}>
          <BotAvatar bot={bot} size={38} />
          {status && <span className={`dot dot-${status}`} title={statusLabel(status)} />}
          {collapsed && <PausedBadge bot={bot} compact />}
        </span>
        {!collapsed && (
          <span className="bot-row-text">
            <span className="bot-row-name">
              <span className="truncate">{bot.name}</span>
              {bot.label && <span className="bot-row-label truncate">· {bot.label}</span>}
              {bot.kind === "room" && <Icon name="users" size={13} className="bot-row-kind" />}
              {bot.pinned && <Icon name="pin" size={12} className="bot-row-kind" />}
              {bot.access && <Icon name="users" size={12} className="bot-row-kind" aria-label={bot.access.workspaceName} />}
              <PausedBadge bot={bot} />
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
  const [instructions, setInstructions] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
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
  const saveInstructions = async () => {
    if (instructions === null || saving) return;
    setSaving(true);
    setError("");
    try {
      await api("PATCH", `/sections/${section.id}`, { instructions });
      await loadSections();
      setInstructions(null);
    } catch (e) { setError(errText(e)); }
    finally { setSaving(false); }
  };
  return (
    <span className="menu-wrap sidebar-group-actions">
      {section.paused && <span className="pause-badge is-compact" title={t("pause.sectionPaused")} aria-label={t("pause.sectionPaused")}><Icon name="pause" size={10} /></span>}
      <button type="button" className="icon-btn sidebar-group-more" aria-label={t("sections.menu", { name: section.name })} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="more" size={15} />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} align="right" label={t("sections.menu", { name: section.name })}>
        {section.paused
          ? <MenuItem icon="play" onClick={() => { setOpen(false); void setPaused({ kind: "section", section }, false); }}>{t("pause.resumeSection")}</MenuItem>
          : <MenuItem icon="pause" onClick={() => { setOpen(false); void setPaused({ kind: "section", section }, true); }}>{t("pause.pauseSection")}</MenuItem>}
        <MenuItem icon="download" onClick={() => { setOpen(false); useStore.getState().openModal({ kind: "exportTemplate", sectionId: section.id }); }}>{t("tpl.export")}…</MenuItem>
        <MenuItem icon="edit" onClick={() => { setOpen(false); setInstructions(section.instructions ?? ""); setError(""); }}>{t("sections.instructions")}</MenuItem>
        <MenuItem icon="edit" onClick={() => void rename()}>{t("sections.rename")}</MenuItem>
        <MenuItem icon="trash" danger onClick={() => void remove()}>{t("sections.delete")}</MenuItem>
      </Menu>
      {instructions !== null && createPortal(
        <Modal title={t("sections.project", { name: section.name })} onClose={() => { if (!saving) setInstructions(null); }} size="sm">
          <form onSubmit={e => { e.preventDefault(); void saveInstructions(); }}>
            <div className="modal-body">
              <label className="field"><span>{t("sections.instructions")}</span>
                <textarea className="input" rows={6} maxLength={4000} value={instructions} onChange={e => setInstructions(e.target.value)} />
              </label>
              <p className="muted">{t("sections.instructionsHelp")}</p>
              {error && <p role="alert">{error}</p>}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" disabled={saving} onClick={() => setInstructions(null)}>{t("common.cancel")}</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{t("common.save")}</button>
            </div>
          </form>
        </Modal>, document.body)}
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
  const todayReport = useStore((s) => s.today);
  const sentinel = useStore((s) => s.sentinel);
  const author = useAnnouncements((s) => !!s.state?.canAuthor);
  const user = useStore((s) => s.user);
  const online = useStore((s) => s.online);
  const pausedAll = useStore((s) => !!s.pauses.all);
  const { toggleSidebar, openModal, setView, selectBot, openAppSettings, logout, setMobileNav } = useStore.getState();
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [primaryProjects, setPrimaryProjects] = useState(false);
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
  // "Aujourd'hui": what waits for the user right now (from the last report loaded; its needs are always "now").
  const needs = todayReport?.needs.length ?? 0;
  // Critical incidents of the Sentinelle not acknowledged yet (they are among the Today needs of the owner/operators).
  const critical = todayReport?.needs.filter((n) => n.kind === "incident").length ?? 0;
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
                <AnnouncementBell />
                <IconButton icon="search" label={t("palette.open")} title={`${t("palette.open")} (${modKey}K)`} onClick={() => openModal({ kind: "search" })} />
                <span className="menu-wrap">
                  <IconButton icon="plus" label={t("sidebar.newBot")} onClick={() => setAddOpen((v) => !v)} active={addOpen} />
                  <Menu open={addOpen} onClose={() => setAddOpen(false)} align="right" label={t("sidebar.newBot")}>
                    <MenuItem icon="plus" onClick={() => { setAddOpen(false); openModal({ kind: "createBot" }); }}>{t("sidebar.newBot")}</MenuItem>
                    <MenuItem icon="folder" onClick={() => { setAddOpen(false); void addSection(); }}>{t("sections.newProject")}</MenuItem>
                    <MenuItem icon="star" onClick={() => { setAddOpen(false); openModal({ kind: "templates" }); }}>{t("tpl.open")}…</MenuItem>
                    <MenuItem icon="upload" onClick={() => { setAddOpen(false); openModal({ kind: "templates", tab: "file" }); }}>{t("tpl.importFile")}…</MenuItem>
                  </Menu>
                </span>
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
          className={`nav-row ${view === "today" ? "is-active" : ""}`}
          onClick={() => setView(view === "today" ? "chat" : "today")}
          aria-pressed={view === "today"}
          title={collapsed ? t("sidebar.today") : undefined}
          aria-label={collapsed ? `${t("sidebar.today")}${needs ? `, ${tn("sidebar.todayNeeds", needs)}` : ""}` : undefined}
        >
          <span className="nav-row-icon">
            <Icon name="sun" size={19} />
            {collapsed && needs > 0 && <span className="dot dot-attention" />}
          </span>
          {!collapsed && <span className="nav-row-label">{t("sidebar.today")}</span>}
          {!collapsed && needs > 0 && <span className="count-badge is-attention" aria-label={tn("sidebar.todayNeeds", needs)}>{needs}</span>}
        </button>

        {/* « Centre de commandement » (CommandView.tsx): the whole team, live. */}
        <button
          type="button"
          className={`nav-row ${view === "command" ? "is-active" : ""}`}
          onClick={() => setView(view === "command" ? "chat" : "command")}
          aria-pressed={view === "command"}
          title={collapsed ? t("sidebar.command") : undefined}
          aria-label={collapsed ? t("sidebar.command") : undefined}
        >
          <span className="nav-row-icon"><Icon name="users" size={19} /></span>
          {!collapsed && <span className="nav-row-label">{t("sidebar.command")}</span>}
        </button>

        {sentinel && (
          <button
            type="button"
            className={`nav-row ${view === "surveillance" ? "is-active" : ""}`}
            onClick={() => setView(view === "surveillance" ? "chat" : "surveillance")}
            aria-pressed={view === "surveillance"}
            title={collapsed ? t("sidebar.surveillance") : undefined}
            aria-label={collapsed ? `${t("sidebar.surveillance")}${critical ? `, ${t("sidebar.surveillanceCritical", { n: critical })}` : ""}` : undefined}
          >
            <span className="nav-row-icon">
              <Icon name="shield" size={19} />
              {collapsed && critical > 0 && <span className="dot dot-attention" />}
            </span>
            {!collapsed && <span className="nav-row-label">{t("sidebar.surveillance")}</span>}
            {!collapsed && critical > 0 && <span className="count-badge is-attention" aria-label={t("sidebar.surveillanceCritical", { n: critical })}>{critical}</span>}
          </button>
        )}

        {author && (
          <button
            type="button"
            className={`nav-row ${view === "announcements" ? "is-active" : ""}`}
            onClick={() => setView(view === "announcements" ? "chat" : "announcements")}
            aria-pressed={view === "announcements"}
            title={collapsed ? t("sidebar.announcements") : undefined}
            aria-label={collapsed ? t("sidebar.announcements") : undefined}
          >
            <span className="nav-row-icon"><Icon name="send" size={19} /></span>
            {!collapsed && <span className="nav-row-label">{t("sidebar.announcements")}</span>}
          </button>
        )}
        {collapsed && <AnnouncementBell row />}

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
            <div className="primary-project-wrap">
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
                  {primary.pause && <PausedBadge bot={primary} />}
                  <span className={`primary-tile-preview truncate ${primaryStatus === "attention" ? "is-attention" : ""}`}>
                    {previewOf(primary, primaryLive)}
                  </span>
                </>
              )}
            </button>
            {!collapsed && sections.length > 0 && <span className="menu-wrap primary-project-menu">
              <IconButton icon="folder" label={t("sections.selectProject", { name: primary.name })} onClick={() => setPrimaryProjects(v => !v)} />
              <Menu open={primaryProjects} onClose={() => setPrimaryProjects(false)} align="right" label={t("sections.selectProject", { name: primary.name })}>
                <MenuItem icon={!primary.sectionId ? "check" : "folder"} onClick={() => { setPrimaryProjects(false); void organise(primary.id, { sectionId: null }); }}>{t("sections.noProject")}</MenuItem>
                {sections.map(sec => <MenuItem key={sec.id} icon={primary.sectionId === sec.id ? "check" : "folder"} onClick={() => { setPrimaryProjects(false); void organise(primary.id, { sectionId: sec.id }); }}>{sec.name}</MenuItem>)}
              </Menu>
            </span>}
            </div>
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
                <Group key={sec.id} id={sec.id} title={sec.name} count={bySection(sec.id).length + (primary?.sectionId === sec.id ? 1 : 0)} folded={!!folds[sec.id]} onFold={() => fold(sec.id)} onDropBot={(id) => void organise(id, { sectionId: sec.id, pinned: false })} actions={<SectionActions section={sec} />}>
                  {primary?.sectionId === sec.id && <button className="nav-row" onClick={() => selectBot(primary.id)}><Icon name="star" size={15} />{botTitle(primary)}</button>}
                  {rowsOf(bySection(sec.id))}
                  {!bySection(sec.id).length && primary?.sectionId !== sec.id && <p className="sidebar-drop-hint">{t("sections.empty")}</p>}
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
          {others.length === 0 && !collapsed && (
            <button type="button" className="cta-row" onClick={() => openModal({ kind: "templates" })}>
              <span className="cta-row-icon">
                <Icon name="star" size={18} />
              </span>
              <span className="bot-row-text">
                <span className="bot-row-name">{t("tpl.open")}</span>
                <span className="bot-row-preview">{t("tpl.openHint")}</span>
              </span>
            </button>
          )}
          {collapsed && (
            <button type="button" className="icon-btn rail-add" aria-label={t("sidebar.newBot")} title={t("sidebar.newBot")} onClick={() => openModal({ kind: "createBot" })}>
              <Icon name="plus" size={18} />
            </button>
          )}
        </div>

        <PauseAllNotice collapsed={collapsed} />

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
                {pausedAll
                  ? <MenuItem icon="play" onClick={() => { setMenuOpen(false); void setPaused({ kind: "all" }, false); }}>{t("pause.resumeAll")}</MenuItem>
                  : <MenuItem icon="pause" onClick={() => { setMenuOpen(false); void setPaused({ kind: "all" }, true); }}>{t("pause.pauseAll")}</MenuItem>}
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
