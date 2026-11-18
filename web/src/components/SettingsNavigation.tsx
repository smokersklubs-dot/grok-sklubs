import { useState } from "react";
import { useT, type Key } from "../i18n";
import { useStore, type AppSection } from "../store";
import { Icon, type IconName } from "./Icon";

type Entry = [AppSection, IconName, string?];
const groups: { title: Key; entries: Entry[] }[] = [
  { title: "settings.group.personal", entries: [
    ["general", "settings", "theme thème langue apparence language appearance"], ["profile", "user"],
    ["notifications", "bell"], ["voice", "mic", "micro audio lecture"], ["shortcuts", "settings", "clavier keyboard"],
  ] },
  { title: "settings.group.team", entries: [
    ["today", "sun"], ["team", "users"], ["workspaces", "users"], ["memory", "brain"],
    ["skills", "book"], ["pages", "globe"], ["checkins", "bell"], ["activity", "history"],
  ] },
  { title: "settings.group.tools", entries: [
    ["models", "brain", "chatgpt codex claude abonnement subscription cerveau llm api"],
    ["computer", "monitor", "ordinateur linux cloud navigateur browser"], ["devices", "cursor", "ordinateur pc windows mac relais relay"],
    ["connectors", "plug", "plugins extensions integrations"], ["vault", "key", "mots de passe passwords"],
    ["permissions", "shield"], ["rules", "book"], ["keys", "shield"], ["email", "mail"],
  ] },
  { title: "settings.group.owner", entries: [
    ["account", "user"], ["usage", "chart", "facturation billing"], ["subscription", "star"], ["surveillance", "shield"], ["admin", "shield"],
  ] },
];
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function SettingsNavigation({ section }: { section: AppSection }) {
  const t = useT();
  const hosted = useStore((s) => s.hosted);
  const sentinel = useStore((s) => s.sentinel);
  const { openAppSettings, closeAppSettings } = useStore.getState();
  const [query, setQuery] = useState("");
  const label = (id: AppSection) => t(id === "subscription" && !hosted?.creditsForSale ? "settings.section.aiAccounts" : `settings.section.${id}`);
  const visible = (id: AppSection) => id === "subscription" ? !!hosted : id === "admin" ? !!hosted?.operator : id === "surveillance" ? sentinel : true;
  const available = groups.map((group) => ({ ...group, entries: group.entries.filter(([id]) => visible(id)) }));
  const terms = fold(query).trim().split(/\s+/);
  const matches = available.map((group) => ({ ...group, entries: group.entries.filter(([id, , aliases]) =>
    terms.every((term) => fold(`${label(id)} ${aliases ?? ""} ${t(group.title)}`).includes(term))) }));
  return <nav className="app-settings-nav" aria-label={t("settings.sections")}>
    <button className="btn btn-ghost btn-small back" type="button" onClick={closeAppSettings}><Icon name="arrowLeft" size={15} /> {t("settings.back")}</button>
    <h1>{t("settings.title")}</h1>
    <select className="input settings-mobile-select" value={section} aria-label={t("settings.sections")} onChange={(e) => openAppSettings(e.target.value as AppSection)}>
      {available.map((g) => <optgroup key={g.title} label={t(g.title)}>{g.entries.map(([id]) => <option key={id} value={id}>{label(id)}</option>)}</optgroup>)}
    </select>
    <div className="settings-desktop-index">
      <input type="search" className="input settings-filter" value={query} aria-label={t("settings.find")} placeholder={t("settings.find")} onChange={(e) => setQuery(e.target.value)} />
      {matches.map((g) => g.entries.length > 0 && <div key={g.title} className="settings-nav-group">
        <h2>{t(g.title)}</h2>
        {g.entries.map(([id, icon]) => <button key={id} type="button" className={`settings-nav-item ${section === id ? "is-active" : ""}`} aria-current={section === id ? "page" : undefined} onClick={() => openAppSettings(id)}>
          <Icon name={icon} size={16} /> <span>{label(id)}</span>
        </button>)}
      </div>)}
      {!matches.some((g) => g.entries.length) && <p className="muted small" role="status">{t("settings.emptySearch")}</p>}
    </div>
  </nav>;
}

const shortcuts: [Key, string][] = [
  ["keys.searchAction", "K"], ["keys.sidebarAction", "B"], ["keys.settingsAction", ","],
  ["keys.detailsAction", "Shift + ,"], ["keys.composeAction", "I"],
];
export function KeyboardShortcuts() {
  const t = useT();
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
  return <><h2>{t("settings.section.shortcuts")}</h2><dl className="settings-shortcuts">
    {shortcuts.map(([key, combo]) => <div key={key}><dt>{t(key)}</dt><dd><kbd>{modifier} + {combo}</kbd></dd></div>)}
  </dl></>;
}
