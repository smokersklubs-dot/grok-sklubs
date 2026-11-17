import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { sortedBots, useStore } from "../store";
import type { Bot, Routine, SearchHit } from "../types";
import { botTitle, relTime } from "../lib/format";
import { Avatar, BotAvatar } from "./Avatar";
import { Icon, Spinner, type IconName } from "./Icon";
import { Snippet } from "./Modals";
import { Modal, modKey, useTick } from "./ui";

/**
 * Quick search and commands (Ctrl/Cmd+K, or the button in the header on a phone): jump to a bot, search messages
 * across bots, find in the open chat, and run commands. Keyboard first: type, ↑/↓, Enter, Esc.
 * The list follows the WAI-ARIA combobox pattern (https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).
 */
interface Command { id: string; icon: IconName; label: string; hint?: string; keywords: string; run: () => void | Promise<void> }

type Item = { kind: "command"; command: Command } | { kind: "bot"; bot: Bot } | { kind: "hit"; hit: SearchHit };

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const bots = useStore((s) => s.bots);
  const selectedId = useStore((s) => s.selectedId);
  const theme = useStore((s) => s.theme);
  const computer = useStore((s) => s.computer);
  const t = useT();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const [found, setFound] = useState<{ q: string; hits: SearchHit[]; error: string | null } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const now = useTick(60_000);
  const needle = q.trim();
  const lower = needle.toLowerCase();
  const searching = needle.length >= 2;
  const current = selectedId ? bots[selectedId] : undefined;

  const commands = useMemo<Command[]>(() => {
    const s = useStore.getState();
    const list: Command[] = [
      { id: "new-bot", icon: "plus", label: t("palette.cmd.newBot"), keywords: "new bot create nouveau créer", run: () => s.openModal({ kind: "createBot" }) },
      { id: "new-room", icon: "users", label: t("palette.cmd.newRoom"), keywords: "group room salon groupe", run: () => s.openModal({ kind: "createRoom" }) },
      { id: "settings", icon: "settings", label: t("palette.cmd.settings"), hint: `${modKey},`, keywords: "settings preferences réglages", run: () => { s.openModal(null); s.openAppSettings(); } },
      { id: "notifications", icon: "bell", label: t("palette.cmd.notifications"), keywords: "push notifications alertes", run: () => { s.openModal(null); s.openAppSettings("notifications"); } },
      { id: "vault", icon: "key", label: t("palette.cmd.vault"), keywords: "vault password coffre mot de passe secret totp", run: () => { s.openModal(null); s.openAppSettings("vault"); } },
      { id: "theme", icon: theme === "dark" ? "sun" : "moon", label: t("palette.cmd.theme"), keywords: "theme dark light thème sombre clair", run: () => {
        const dark = document.documentElement.getAttribute("data-theme") === "dark";
        s.setTheme(dark ? "light" : "dark");
      } },
      { id: "today", icon: "sun", label: t("palette.cmd.today"), keywords: "today aujourd'hui journée résumé digest", run: () => s.setView("today") },
      { id: "tasks", icon: "tasks", label: t("palette.cmd.tasks"), keywords: "tasks tâches", run: () => s.setView("tasks") },
      { id: "sidebar", icon: "sidebar", label: t("palette.cmd.sidebar"), hint: `${modKey}B`, keywords: "sidebar barre latérale", run: () => s.toggleSidebar() },
      { id: "apps", icon: "plug", label: t("palette.cmd.apps"), keywords: "apps connectors connecter applis", run: () => s.openModal({ kind: "connectors" }) },
    ];
    if (current) {
      list.push({ id: "find", icon: "search", label: t("palette.cmd.find", { name: current.name }), keywords: "find search chat discussion chercher", run: () => s.openFind(current.id, "") });
      if (current.kind === "agent") {
        if (computer?.browser) list.push({ id: "computer", icon: "monitor", label: t("palette.cmd.computer", { name: current.name }), keywords: "computer screen ordinateur écran", run: () => s.openViewer(current.id) });
        list.push({ id: "gems", icon: "star", label: t("palette.cmd.gems", { name: current.name }), keywords: "gem hunt pépites chasse", run: async () => {
          const r = await api<{ routine: Routine }>("POST", `/bots/${enc(current.id)}/gem-hunt`, { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, time: "08:40" });
          await api("POST", `/routines/${enc(r.routine.id)}/run`);
          s.showToast(t("palette.gemsStarted", { name: current.name }));
        } });
        list.push({ id: "duplicate", icon: "copy", label: t("palette.cmd.duplicate", { name: current.name }), keywords: "duplicate copy dupliquer copier", run: () => s.openModal({ kind: "duplicate", botId: current.id }) });
      }
      list.push({ id: "pin", icon: "pin", label: t(current.pinned ? "palette.cmd.unpin" : "palette.cmd.pin", { name: current.name }), keywords: "pin épingler", run: () => s.organise(current.id, { pinned: !current.pinned }) });
      list.push({ id: "bot-settings", icon: "edit", label: t("palette.cmd.botSettings", { name: current.name }), keywords: "bot settings réglages du bot", run: () => s.openBotSettings(current.id) });
    }
    return list;
  }, [t, theme, current, computer?.browser]);

  const matched = useMemo(() => (lower ? commands.filter((c) => `${c.label} ${c.keywords}`.toLowerCase().includes(lower)) : commands), [commands, lower]);
  const botResults = useMemo(() => {
    const all = sortedBots(bots).sort((a, b) => Number(b.primary) - Number(a.primary) || Number(b.pinned) - Number(a.pinned));
    return lower ? all.filter((b) => `${b.name} ${b.label} ${b.description}`.toLowerCase().includes(lower)) : all.filter((b) => !b.listHidden).slice(0, 8);
  }, [bots, lower]);

  // Messages: asked 250 ms after the last keystroke; only the latest answer is kept.
  useEffect(() => {
    if (!searching) return;
    let dead = false;
    const timer = window.setTimeout(() => {
      api<{ hits: SearchHit[] }>("GET", `/search?q=${enc(needle)}`).then(
        (r) => !dead && setFound({ q: needle, hits: Array.isArray(r?.hits) ? r.hits : [], error: null }),
        (e: unknown) => !dead && setFound({ q: needle, hits: [], error: errText(e) }),
      );
    }, 250);
    return () => { dead = true; window.clearTimeout(timer); };
  }, [needle, searching]);
  const loadingHits = searching && found?.q !== needle;
  const hits = searching && found?.q === needle ? found.hits : [];
  const hitsError = searching && found?.q === needle ? found.error : null;

  // "Find in this chat" comes first when there is something to look for.
  const findHere: Command | null = current && searching ? { id: "find-q", icon: "search", label: t("palette.findHere", { q: needle, name: current.name }), keywords: "", run: () => useStore.getState().openFind(current.id, needle) } : null;
  const items: Item[] = [
    ...(findHere ? [{ kind: "command", command: findHere } as Item] : []),
    ...(lower ? botResults.map((bot) => ({ kind: "bot", bot }) as Item) : []),
    ...matched.map((command) => ({ kind: "command", command }) as Item),
    ...(lower ? [] : botResults.map((bot) => ({ kind: "bot", bot }) as Item)),
    ...hits.map((hit) => ({ kind: "hit", hit }) as Item),
  ];

  useEffect(() => setIndex(0), [q]);
  useEffect(() => { list.current?.querySelector(".is-highlight")?.scrollIntoView({ block: "nearest" }); }, [index]);

  const activate = (item: Item | undefined) => {
    if (!item) return;
    const s = useStore.getState();
    onClose();
    if (item.kind === "bot") s.selectBot(item.bot.id);
    else if (item.kind === "command") Promise.resolve().then(() => item.command.run()).catch((e: unknown) => s.showToast(errText(e)));
    else {
      const h = item.hit;
      if (h.current && h.thread) { s.jumpTo(h.botId, h.thread); s.openThreadPanel(h.botId, h.thread); }
      else if (h.current) s.jumpTo(h.botId, h.seq);
      else s.openHistory({ botId: h.botId, generation: h.generation, seq: h.seq });
    }
  };

  const optionId = (i: number) => `palette-opt-${i}`;
  let groupShown = "";
  const groupOf = (it: Item) => (it.kind === "hit" ? "messages" : it.kind === "bot" ? "bots" : "commands");

  return (
    <Modal title={t("palette.title")} onClose={onClose} size="md" hideTitle className="search-modal palette">
      <div className="search-field">
        <Icon name="search" size={18} />
        <input
          className="search-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("palette.placeholder")}
          aria-label={t("palette.label")}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={items.length ? optionId(index) : undefined}
          aria-autocomplete="list"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, items.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); activate(items[index]); }
          }}
        />
        <kbd>Esc</kbd>
      </div>
      <ul className="search-results" id="palette-results" role="listbox" ref={list} aria-label={t("palette.label")}>
        {items.map((it, i) => {
          const group = groupOf(it);
          const heading = group !== groupShown ? group : null;
          groupShown = group;
          const cls = `search-row ${i === index ? "is-highlight" : ""} ${it.kind === "hit" ? "is-hit" : ""}`;
          let inner: ReactNode;
          if (it.kind === "command") {
            inner = (
              <>
                <span className="palette-icon"><Icon name={it.command.icon} size={17} /></span>
                <span className="bot-row-text"><span className="bot-row-name truncate">{it.command.label}</span></span>
                {it.command.hint && <kbd className="menu-item-hint">{it.command.hint}</kbd>}
              </>
            );
          } else if (it.kind === "bot") {
            const b = it.bot;
            inner = (
              <>
                <BotAvatar bot={b} size={30} badge />
                <span className="bot-row-text">
                  <span className="bot-row-name truncate">{botTitle(b)}{b.listHidden && <span className="chip">{t("sidebar.hidden")}</span>}</span>
                  <span className="bot-row-preview truncate">{b.preview || b.description || (b.kind === "room" ? t("search.room") : t("sidebar.noMessages"))}</span>
                </span>
              </>
            );
          } else {
            const h = it.hit;
            const b = bots[h.botId];
            inner = (
              <>
                {b ? <BotAvatar bot={b} size={28} /> : <Avatar shape="circle" color="slate" name={h.botName} size={28} />}
                <span className="bot-row-text">
                  <span className="search-hit-head">
                    <span className="bot-row-name truncate">{b?.name ?? h.botName}</span>
                    <span className="search-hit-meta">{h.role === "user" ? t("common.you") : t("search.roleBot")} · {relTime(h.at, now)}</span>
                    {!h.current && <span className="chip">{t("search.earlier")}</span>}
                  </span>
                  <Snippet text={h.snippet} query={needle} />
                </span>
              </>
            );
          }
          return (
            <li key={`${it.kind}:${i}`} role="presentation">
              {heading && <div className="search-group" role="presentation">{t(`palette.group.${heading}`)}</div>}
              <div id={optionId(i)} role="option" aria-selected={i === index} className={cls} onMouseEnter={() => setIndex(i)} onClick={() => activate(it)}>
                {inner}
              </div>
            </li>
          );
        })}
        {searching && loadingHits && <li className="search-state" role="status"><Spinner size={14} /> {t("search.searching")}</li>}
        {hitsError && <li className="search-state is-error" role="alert">{hitsError}</li>}
        {searching && !loadingHits && !hitsError && hits.length === 0 && <li className="search-state">{t("search.noMessages", { q: needle })}</li>}
        {!items.length && !searching && <li className="search-none">{t("palette.none", { q: needle })}</li>}
      </ul>
      <div className="palette-foot" aria-hidden="true">
        <span><kbd>↑</kbd><kbd>↓</kbd> {t("palette.move")}</span>
        <span><kbd>Enter</kbd> {t("palette.choose")}</span>
        <span><kbd>Esc</kbd> {t("common.close")}</span>
      </div>
    </Modal>
  );
}
