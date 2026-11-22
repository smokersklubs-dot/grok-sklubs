import { useContext } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Bot, Row } from "../types";
import { findSecrets } from "../../../server/src/shared";
import { conversationMarkdown, exportFileName, printableHtml, turnDebug, type ExportLabels } from "../lib/chatexport";
import { renderMarkdown } from "../lib/markdown";
import { Icon } from "./Icon";
import { MenuItem } from "./ui";
import { RowContext } from "./Transcript";

/** L156: « Exporter la discussion (Markdown) », « … en PDF » (chat menu) and « Export de débogage » (under a reply). */

function save(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Every row of the main chat: earlier pages are loaded first (at most 40 pages, so a huge chat cannot freeze the page). */
async function allRows(botId: string): Promise<Row[]> {
  const s = useStore.getState();
  for (let i = 0; i < 40 && s.threads[botId]?.hasMore; i++) await useStore.getState().loadEarlier(botId).catch(() => undefined);
  return useStore.getState().threads[botId]?.rows ?? [];
}

const finder = (text: string) => findSecrets(text);

export function ExportMenuItems({ bot, onDone }: { bot: Bot; onDone: () => void }) {
  const t = useT();
  const labels = (): ExportLabels => ({ you: t("common.you"), bot: bot.name, title: t("export.title", { name: bot.name }), exportedAt: t("export.exportedAt"), step: t("export.step"), notice: t("export.notice") });
  const markdown = async () => conversationMarkdown(bot.name, await allRows(bot.id), labels(), finder);
  return (
    <>
      <MenuItem icon="download" onClick={async () => { onDone(); save(exportFileName(bot.name, Date.now(), "md"), await markdown(), "text/markdown;charset=utf-8"); }}>
        {t("export.markdown")}
      </MenuItem>
      <MenuItem icon="file" onClick={async () => {
        onDone();
        // A new window with the conversation laid out for A4, then the browser's print box (« Enregistrer en PDF »).
        const w = window.open("", "_blank");
        if (!w) { useStore.getState().showToast(t("export.popupBlocked")); return; }
        const html = printableHtml(t("export.title", { name: bot.name }), renderMarkdown(await markdown()), useStore.getState().locale);
        w.document.open(); w.document.write(html); w.document.close();
        w.focus(); setTimeout(() => w.print(), 300);
      }}>
        {t("export.pdf")}
      </MenuItem>
    </>
  );
}

/** Under one of the bot's replies: the turn that led to it (request, steps, notices, reply) as JSON, secrets masked. */
export function TurnDebugAction({ row }: { row: Row }) {
  const t = useT();
  const { mode } = useContext(RowContext);
  const bot = useStore((s) => s.bots[row.botId]);
  if (mode !== "main" || !bot || bot.access || row.body.kind !== "message" || row.body.role !== "assistant" || row.body.streaming) return null;
  return (
    <button type="button" className="msg-action" aria-label={t("export.debug")} title={t("export.debug")} onClick={() => {
      const rows = useStore.getState().threads[row.botId]?.rows ?? [];
      const report = { app: "Sklubot", bot: bot.name, model: bot.model || "default", exportedAt: new Date().toISOString(), note: t("export.debugNote"), ...turnDebug(rows, row.seq, finder) };
      save(exportFileName(`${bot.name}-tour-${row.seq}`, Date.now(), "json"), JSON.stringify(report, null, 2), "application/json");
    }}>
      <Icon name="wrench" size={15} />
    </button>
  );
}
