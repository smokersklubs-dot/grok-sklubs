import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { create } from "zustand";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Bot, FileEntry } from "../types";
import type { PersonalCommand } from "../../../server/src/personalcommands";
import { Icon } from "./Icon";
import "./ComposerSlash.css";

/**
 * L152 in the web chat:
 *  - « Commandes personnelles »: type `/` in the box and your own shortcuts are listed (server personalcommands.ts); picking
 *    one puts its words in the box, to read and send — nothing goes out on its own. « Gérer mes commandes… » opens Settings.
 *  - `@fichier`: after `@`, the files of the bot's library (~/files) are offered with the apps (ComposerMentions.tsx); a pick
 *    writes `~/files/<name>` so the bot knows exactly which file you mean.
 */
interface CommandsState { list: PersonalCommand[] | null; load(force?: boolean): Promise<void>; save(list: PersonalCommand[]): Promise<string | null> }
export const usePersonalCommands = create<CommandsState>((set, get) => ({
  list: null,
  async load(force = false) {
    if (get().list && !force) return;
    try { set({ list: (await api<{ commands: PersonalCommand[] }>("GET", "/me/commands")).commands }); } catch { set({ list: get().list ?? [] }); }
  },
  async save(list) {
    try { set({ list: (await api<{ commands: PersonalCommand[] }>("PUT", "/me/commands", { commands: list })).commands }); return null; } catch (e) { return errText(e); }
  },
}));

/** The `/word` being typed (whole draft, one line), or null. `/s…` up to `/skill` belongs to the skill picker. */
export function slashQuery(draft: string): string | null {
  const m = /^\/([a-z0-9-]*)$/i.exec(draft);
  if (!m) return null;
  return m[1].toLowerCase();
}

export function useSlashCommands(bot: Bot, draft: string, put: (text: string) => void, disabled: boolean) {
  const t = useT();
  const query = disabled || bot.access ? null : slashQuery(draft);
  const list = usePersonalCommands((s) => s.list);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const current = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (query !== null) void usePersonalCommands.getState().load(); }, [query !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActive(0); }, [query]);
  // The skill picker owns `/s`, `/sk`… `/skill`: personal commands step aside for those prefixes unless one matches.
  const matches = query === null ? [] : (list ?? []).filter((c) => c.name.startsWith(query) || c.name.includes(query)).slice(0, 8);
  const skillPrefix = query !== null && "skill".startsWith(query) && query.length > 0;
  const open = query !== null && dismissed !== draft && (matches.length > 0 || (!skillPrefix && list !== null));
  const items = [...matches.map((c) => ({ id: c.name, pick: () => put(c.text) })), { id: "__manage", pick: () => { put(""); useStore.getState().openAppSettings("shortcuts"); } }];
  const at = Math.min(active, items.length - 1);
  useLayoutEffect(() => { if (open) current.current?.scrollIntoView({ block: "nearest" }); }, [at, open]);
  const keyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (e.key === "Escape") { setDismissed(draft); e.preventDefault(); return true; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setActive((at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length); return true; }
    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") { e.preventDefault(); items[at].pick(); return true; }
    return false;
  };
  const view = open ? (
    <div className="skill-picker slash-picker" role="listbox" aria-label={t("slash.title")}>
      <div className="skill-picker-head"><Icon name="bolt" size={13} /> {t("slash.title")}</div>
      {matches.length === 0 && <div className="skill-picker-empty">{t(list?.length ? "slash.none" : "slash.empty")}</div>}
      {matches.map((c, i) => (
        <button key={c.name} ref={i === at ? current : undefined} type="button" role="option" aria-selected={i === at} className={`skill-picker-item ${i === at ? "is-active" : ""}`}
          onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => put(c.text)}>
          <span className="skill-picker-name">/{c.name}</span>
          <span className="skill-picker-desc">{c.text}</span>
        </button>
      ))}
      <button ref={at === items.length - 1 ? current : undefined} type="button" role="option" aria-selected={at === items.length - 1} className={`skill-picker-item slash-manage ${at === items.length - 1 ? "is-active" : ""}`}
        onMouseEnter={() => setActive(items.length - 1)} onMouseDown={(e) => e.preventDefault()} onClick={items[items.length - 1].pick}>
        <Icon name="settings" size={13} /> {t("slash.manage")}
      </button>
    </div>
  ) : null;
  return { open, view, keyDown };
}

/** The bot's library files (top level), loaded once per bot while `wanted` (an `@` is being typed). */
export function useBotFiles(botId: string, wanted: boolean): FileEntry[] {
  const [files, setFiles] = useState<{ botId: string; list: FileEntry[] } | null>(null);
  useEffect(() => {
    if (!wanted || files?.botId === botId) return;
    let dead = false;
    api<{ entries: FileEntry[] }>("GET", `/bots/${botId}/files`).then((r) => !dead && setFiles({ botId, list: r.entries.filter((e) => !e.dir).sort((a, b) => b.modifiedAt - a.modifiedAt) }), () => !dead && setFiles({ botId, list: [] }));
    return () => { dead = true; };
  }, [wanted, botId, files?.botId]);
  return files?.botId === botId ? files.list : [];
}

/** How a picked file is written in the message: the path the bot uses for its library. */
export const fileMention = (name: string) => `\`~/files/${name}\``;

/** Settings → Raccourcis: your own `/` commands (add, change, remove). */
export function PersonalCommandsSection() {
  const t = useT();
  const list = usePersonalCommands((s) => s.list);
  const [draft, setDraft] = useState<PersonalCommand[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { void usePersonalCommands.getState().load(true); }, []);
  useEffect(() => { if (list && draft === null) setDraft(list); }, [list, draft]);
  const rows = draft ?? [];
  const change = (i: number, patch: Partial<PersonalCommand>) => { setSaved(false); setDraft(rows.map((c, j) => (j === i ? { ...c, ...patch } : c))); };
  const save = async () => {
    const e = await usePersonalCommands.getState().save(rows.filter((c) => c.name.trim() || c.text.trim()));
    setError(e); setSaved(!e);
    if (!e) setDraft(usePersonalCommands.getState().list);
  };
  return (
    <section className="settings-block personal-commands" aria-labelledby="pc-title">
      <h2 id="pc-title">{t("slash.settingsTitle")}</h2>
      <p className="muted">{t("slash.settingsHint")}</p>
      {draft === null ? <p className="muted">{t("common.loading")}</p> : (
        <>
          {rows.length === 0 && <p className="muted small">{t("slash.empty")}</p>}
          <ul className="pc-list">
            {rows.map((c, i) => (
              <li key={i} className="pc-row">
                <label className="pc-name"><span className="sr-only">{t("slash.name")}</span><span aria-hidden="true">/</span>
                  <input className="input" value={c.name} maxLength={24} placeholder={t("slash.namePlaceholder")} aria-label={t("slash.name")} onChange={(e) => change(i, { name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
                </label>
                <textarea className="input pc-text" rows={2} value={c.text} maxLength={2000} placeholder={t("slash.textPlaceholder")} aria-label={t("slash.text")} onChange={(e) => change(i, { text: e.target.value })} />
                <button type="button" className="icon-btn" aria-label={t("slash.remove", { name: c.name || "…" })} title={t("slash.remove", { name: c.name || "…" })} onClick={() => { setSaved(false); setDraft(rows.filter((_, j) => j !== i)); }}>
                  <Icon name="trash" size={15} />
                </button>
              </li>
            ))}
          </ul>
          {error && <p className="card-error" role="alert">{error}</p>}
          <div className="pc-actions">
            <button type="button" className="btn btn-small" disabled={rows.length >= 30} onClick={() => { setSaved(false); setDraft([...rows, { name: "", text: "" }]); }}><Icon name="plus" size={14} /> {t("slash.add")}</button>
            <button type="button" className="btn btn-small btn-accent" onClick={() => void save()}>{t("common.save")}</button>
            {saved && <span className="muted small" role="status">{t("slash.saved")}</span>}
          </div>
        </>
      )}
    </section>
  );
}
