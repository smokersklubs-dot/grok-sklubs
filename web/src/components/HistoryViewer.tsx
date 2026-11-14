import { useEffect, useMemo, useRef, useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore, type HistoryTarget } from "../store";
import type { Row } from "../types";
import { accentStyle } from "../lib/colors";
import { BotAvatar } from "./Avatar";
import { Icon } from "./Icon";
import { buildItems, revealRow, RowItems } from "./Transcript";
import { Empty, ErrorNote, IconButton, Loading, Modal } from "./ui";

/** An earlier conversation of a bot, read-only, opened from a search hit. */
export function HistoryViewer({ target }: { target: HistoryTarget }) {
  const bot = useStore((s) => s.bots[target.botId]);
  const closeHistory = useStore((s) => s.closeHistory);
  const t = useT();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dead = false;
    api<{ rows: Row[] }>("GET", `/bots/${target.botId}/history/${target.generation}`).then(
      (r) => !dead && setRows(Array.isArray(r?.rows) ? r.rows : []),
      (e: unknown) => !dead && setError(errText(e)),
    );
    return () => {
      dead = true;
    };
  }, [target.botId, target.generation]);

  useEffect(() => {
    if (!bot) closeHistory();
  }, [bot, closeHistory]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => (rows ? buildItems(rows, false) : []), [rows, t]);

  useEffect(() => {
    // A thread reply is shown under the message its thread hangs on.
    const hit = rows?.find((r) => r.seq === target.seq);
    if (rows && rows.length > 0) revealRow(body.current, hit?.thread ?? target.seq);
  }, [rows, target.seq]);

  if (!bot) return null;

  return (
    <Modal
      title={t("history.title", { name: bot.name })}
      onClose={closeHistory}
      size="xl"
      className="history-viewer"
      header={
        <div className="modal-head">
          <BotAvatar bot={bot} size={30} />
          <span className="modal-head-title truncate">{bot.name}</span>
          <IconButton icon="close" label={t("common.close")} onClick={closeHistory} />
        </div>
      }
    >
      <p className="history-banner" role="note">
        <Icon name="lock" size={14} /> {t("history.banner")}
      </p>
      <div className="history-body" ref={body} style={accentStyle(bot.color, bot.character?.customColor)} tabIndex={-1}>
        {error && <div className="history-pad"><ErrorNote>{error}</ErrorNote></div>}
        {!rows && !error && <Loading />}
        {rows && rows.length === 0 && <Empty icon="history" title={t("history.emptyTitle")}>{t("history.emptyText")}</Empty>}
        {rows && rows.length > 0 && (
          <div className="transcript-inner">
            <RowItems items={items} bot={bot} readOnly all={rows} />
          </div>
        )}
      </div>
    </Modal>
  );
}
