import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { isGithubConnector, mentionAt, replaceMention } from "../../../server/src/clientshared/chatmentions";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Bot } from "../types";
import { Icon, type IconName } from "./Icon";
import { GithubIssues } from "./GithubIssues";
import { Modal } from "./ui";
import { RepositoryPicker } from "./RepositoryPicker";

interface Choice { id: string; label: string; detail: string; icon: IconName; pick: () => void }
type Range = { start: number; end: number };

export function useComposerMentions(bot: Bot, draft: string, area: RefObject<HTMLTextAreaElement | null>, disabled: boolean) {
  const t = useT();
  const bots = useStore(s => s.bots);
  const fr = useStore(s => s.locale === "fr");
  const [mission,setMission] = useState<{bot:string; url:string} | null>(null);
  const connectors = useStore(s => s.connectors);
  const { setDraft, selectBot, openModal, showArtifact } = useStore.getState();
  const [caret, setCaret] = useState(-1);
  const [activeIndex, setActive] = useState(0);
  const [dismissed, dismiss] = useState(false);
  const [repository, setRepository] = useState<{ range: Range; draft: string; botId: string } | null>(null);
  const listId = useId();
  const current = useRef<HTMLButtonElement>(null);
  const own = bot.kind === "agent" && !bot.access;
  const range = own && !disabled && !dismissed && !repository ? mentionAt(draft, caret) : null;
  const sync = (el: HTMLTextAreaElement, changed = false) => {
    const next = el.selectionStart === el.selectionEnd ? el.selectionStart : -1;
    if (changed || next !== caret) { dismiss(false); setActive(0); }
    setCaret(next);
  };
  const replace = (at: Range, value: string) => {
    const next = replaceMention(draft, at, value);
    setDraft(bot.id, next.text);
    setCaret(next.caret);
    dismiss(true);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(next.caret, next.caret); });
  };
  const ready = (connectors ?? []).filter(c => c.status === "ready");
  const githubReady = ready.some(c => isGithubConnector(c.url) && c.tools.some(t => t.name === "search_repositories" && t.readOnly));
  const voice = ready.find(c => c.name.toLowerCase() === "voicestudio");
  const choices: Choice[] = [];
  if (range) {
    choices.push({ id: "github", label: "GitHub", detail: t("mention.github"), icon: "plug", pick: () => setRepository({ range, draft, botId: bot.id }) });
    choices.push({ id: "github-code", label: "GitHub Code", detail: fr ? "Confier un ticket à deux bots" : "Assign an issue to two bots", icon: "plug", pick: () => {
      const url = draft.match(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/issues\/[1-9]\d*/i)?.[0] ?? "";
      replace(range, ""); setMission({bot:bot.id,url});
    } });
    choices.push({ id: "voicestudio", label: "VoiceStudio", detail: t(voice ? "mention.connected" : "mention.setup"), icon: "mic", pick: () => {
      if (voice) replace(range, "@[VoiceStudio]");
      else { dismiss(true); openModal({ kind: "connectors", catalogId: "voicestudio" }); }
    } });
    choices.push({ id: "browser", label: t("workspace.web"), detail: t("mention.plugin"), icon: "globe", pick: () => {
      replace(range, ""); showArtifact({ kind: "web", token: crypto.randomUUID(), botId: bot.id, title: t("workspace.web") });
    } });
    choices.push({ id: "studio", label: t("studio.create"), detail: t("mention.plugin"), icon: "play", pick: () => {
      setDraft(bot.id, replaceMention(draft, range, "").text); dismiss(true); openModal({ kind: "videoStudio" });
    } });
    for (const c of ready) {
      if (c === voice || isGithubConnector(c.url)) continue;
      choices.push({ id: "app-" + c.id, label: c.name, detail: t("mention.connected"), icon: "plug", pick: () => replace(range, "@[" + c.name + "]") });
    }
    choices.push({ id: "catalog", label: t("mention.apps"), detail: t("mention.plugin"), icon: "plug", pick: () => { dismiss(true); openModal({ kind: "connectors" }); } });
    for (const b of Object.values(bots).filter(b => b.id !== bot.id && b.kind === "agent" && !b.access).sort((a,b) => b.lastActivityAt - a.lastActivityAt)) {
      choices.push({ id: "chat-" + b.id, label: b.name, detail: t("mention.chat"), icon: "thread", pick: () => {
        setDraft(bot.id, replaceMention(draft, range, "").text); dismiss(true); selectBot(b.id);
      } });
    }
  }
  const matches = choices.filter(c => c.label.toLowerCase().includes(range!.query)).slice(0, 12);
  const active = Math.min(activeIndex, matches.length - 1);
  const open = matches.length > 0;
  useLayoutEffect(() => { if (open) current.current?.scrollIntoView({ block: "nearest" }); }, [active, open]);
  const keyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || e.nativeEvent.isComposing || e.keyCode === 229) return false;
    if (e.key === "Escape") dismiss(true);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") setActive((active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
    else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) matches[active].pick();
    else return false;
    e.preventDefault(); e.stopPropagation(); return true;
  };
  const view = <>
    {open && <div id={listId} className="skill-picker mention-picker" role="listbox" aria-label={t("mention.title")}>
      {matches.map((c, i) => <button type="button" key={c.id} role="option" id={listId + i} aria-selected={i === active}
        className={"skill-picker-item" + (i === active ? " is-active" : "")} ref={i === active ? current : undefined}
        onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={c.pick}>
        <Icon name={c.icon} size={16} /><strong>{c.label}</strong><small>{c.detail}</small>
      </button>)}
    </div>}
    {own && mission?.bot === bot.id && <Modal title={fr ? "Mission GitHub" : "GitHub task"} onClose={() => setMission(null)}><div className="modal-body"><GithubIssues bot={bot.id} launched initialUrl={mission.url} close={() => setMission(null)} /></div></Modal>}
    {own && repository?.botId === bot.id && <RepositoryPicker connected={githubReady} close={() => { setRepository(null); dismiss(true); }}
      attach={name => { if (draft === repository.draft) replace(repository.range, "@GitHub https://github.com/" + name); setRepository(null); }}
      connect={() => { setRepository(null); dismiss(true); openModal({ kind: "connectors", catalogId: "github-repositories" }); }} />}
  </>;
  return { sync, keyDown, view, open, listId, activeId: open ? listId + active : undefined };
}
