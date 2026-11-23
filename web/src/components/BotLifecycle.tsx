import { useEffect, useRef, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Bot } from "../types";
import { Gloss } from "./Gloss";
import { Icon } from "./Icon";
import { ConfirmButton, ErrorNote, Loading } from "./ui";
import "./Comfort7.css";

/** Server bottrash.ts deletionPreview / TrashItem. */
interface Preview { conversations: number; messages: number; memories: number; skills: number; routines: number; tasks: number; rules: number; files: boolean; computer: boolean; helpers: number; days: number }
interface TrashItem { id: string; botId: string; name: string; kind: string; deletedAt: number; expiresAt: number; counts: Preview }

/**
 * L144 in a bot's settings: « Exporter ce bot » (one JSON file, without secrets nor conversations), and « Supprimer »
 * with what will go first — and what the trash can give back for 30 days.
 */
export function BotDangerZone({ bot, isRoom, onDeleted }: { bot: Bot; isRoom: boolean; onDeleted: () => void }) {
  const t = useT();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (!asked) return;
    let dead = false;
    api<Preview>("GET", `/bots/${enc(bot.id)}/deletion-preview`).then((p) => !dead && setPreview(p), (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [asked, bot.id]);
  return (
    <>
      <h3 className="pane-heading is-danger">{t("bot.danger")}</h3>
      {!isRoom && (
        <div className="action-row">
          <div>
            <p className="action-title">{t("c7.trash.export")}</p>
            <p className="muted small">{t("c7.trash.exportHint")}</p>
          </div>
          <a className="btn btn-small" href={`/api/bots/${enc(bot.id)}/export`} download><Icon name="download" size={13} /> {t("c7.trash.exportBtn")}</a>
        </div>
      )}
      <div className="action-row">
        <div>
          <p className="action-title">{t(isRoom ? "bot.deleteRoom" : "bot.deleteBot")}</p>
          <p className="muted small">{t(bot.primary ? "bot.deletePrimaryHint" : "c7.trash.deleteHint", { days: 30 })} <Gloss term="trash" /></p>
          {!bot.primary && !asked && <button type="button" className="link small" onClick={() => setAsked(true)}>{t("c7.trash.whatGoes")}</button>}
          {asked && !preview && !error && <Loading />}
          {preview && (
            <div className="trash-preview" role="note">
              <p className="small"><strong>{t("c7.trash.goes")}</strong></p>
              <ul className="small">
                <li>{t("c7.trash.count.conv", { n: preview.conversations, m: preview.messages })}</li>
                <li>{t("c7.trash.count.notes", { n: preview.memories, s: preview.skills, r: preview.routines })}</li>
                {preview.computer && <li className="is-warn">{t("c7.trash.count.computer")}</li>}
                {preview.helpers > 0 && <li>{t("c7.trash.count.helpers", { n: preview.helpers })}</li>}
              </ul>
              <p className="small muted">{t("c7.trash.back", { days: preview.days })}</p>
            </div>
          )}
        </div>
        <ConfirmButton label={t("common.delete")} confirmLabel={t("common.confirmDelete")} busyLabel={t("common.deleting")} className="btn btn-small btn-danger" disabled={bot.primary}
          onConfirm={async () => {
            setError(null);
            try {
              await api("DELETE", `/bots/${enc(bot.id)}`);
              useStore.getState().showToast(t("c7.trash.deleted", { name: bot.name }));
              onDeleted();
            } catch (e) { setError(errText(e)); }
          }} />
      </div>
      <ErrorNote>{error}</ErrorNote>
    </>
  );
}

/** Settings → Team: « Corbeille » (Restaurer, Supprimer pour de bon) and « Importer un bot » from a file. */
export function BotTrash() {
  const t = useT();
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const load = () => api<{ items: TrashItem[] }>("GET", "/bot-trash").then((r) => setItems(r.items), (e) => { setError(errText(e)); setItems([]); });
  useEffect(() => { void load(); }, []);
  const done = async (text: string) => { useStore.getState().showToast(text); await useStore.getState().loadBots(); await load(); };
  const restore = async (i: TrashItem) => {
    setError(null);
    try { const r = await api<{ bot: Bot }>("POST", `/bot-trash/${enc(i.id)}/restore`); await done(t("c7.trash.restored", { name: r.bot.name })); } catch (e) { setError(errText(e)); }
  };
  const importFile = async (f: File) => {
    setError(null);
    try {
      if (f.size > 5_000_000) throw new Error(t("c7.trash.importTooBig"));
      const data = JSON.parse(await f.text());
      const r = await api<{ bot: Bot }>("POST", "/bots/import", data);
      await done(t("c7.trash.imported", { name: r.bot.name }));
    } catch (e) { setError(e instanceof SyntaxError ? t("c7.trash.importBad") : errText(e)); }
  };
  const day = (at: number) => new Date(at).toLocaleDateString(undefined, { dateStyle: "medium" });
  return (
    <section className="bot-trash" aria-labelledby="bot-trash-h">
      <h3 className="pane-heading" id="bot-trash-h">{t("c7.trash.title")}</h3>
      <p className="muted small">{t("c7.trash.hint", { days: 30 })}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {!items && <Loading />}
      {items?.length === 0 && <p className="muted small">{t("c7.trash.empty")}</p>}
      <ul className="trash-list">
        {items?.map((i) => (
          <li key={i.id} className="action-row">
            <div>
              <p className="action-title">{i.name}</p>
              <p className="muted small">{t("c7.trash.itemMeta", { date: day(i.deletedAt), until: day(i.expiresAt), n: i.counts.conversations, m: i.counts.memories })}</p>
            </div>
            <span className="trash-actions">
              <button type="button" className="btn btn-small btn-primary" onClick={() => void restore(i)}><Icon name="refresh" size={13} /> {t("c7.trash.restore")}</button>
              <ConfirmButton className="btn btn-small btn-ghost" label={t("c7.trash.forget")} confirmLabel={t("c7.trash.forgetConfirm")} busyLabel="…"
                onConfirm={async () => { try { await api("DELETE", `/bot-trash/${enc(i.id)}`); await load(); } catch (e) { setError(errText(e)); } }} />
            </span>
          </li>
        ))}
      </ul>
      <div className="action-row">
        <div>
          <p className="action-title">{t("c7.trash.import")}</p>
          <p className="muted small">{t("c7.trash.importHint")}</p>
        </div>
        <button type="button" className="btn btn-small" onClick={() => file.current?.click()}><Icon name="upload" size={13} /> {t("c7.trash.importBtn")}</button>
        <input ref={file} type="file" accept=".json,application/json" hidden tabIndex={-1} aria-hidden="true" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importFile(f); }} />
      </div>
    </section>
  );
}
