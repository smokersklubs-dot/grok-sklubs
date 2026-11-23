import { useEffect, useState, type RefObject } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";
import { PAGE_MODE, PAGE_READY, parsePagePick, type PagePick } from "../../../server/src/clientshared/pagecomment";
import { pageRemarkMessage, REMARK_MAX } from "../lib/remarks";
import { quickSend } from "../lib/quicksend";
import { Icon } from "./Icon";
import "./Remarks.css";

/**
 * L140 « Commenter la page »: under the page preview of the chat, « Commenter » turns on the comment layer inside the
 * page (server/src/clientshared/pagecomment.ts, served with the page on `?sklubot-comment=1`): the next click on the
 * page outlines an element instead of using it, and its description comes back here by postMessage — accepted only from
 * this iframe and re-checked. A box then takes the owner's remark; « Envoyer » sends the page, the element and the remark
 * to the bot (lib/remarks.ts). The page keeps its sandbox: nothing of the app is given to it.
 */
export function PageComment({ frame, botId, title, url }: { frame: RefObject<HTMLIFrameElement | null>; botId: string; title: string; url: string }) {
  const t = useT();
  const [on, setOn] = useState(false);
  const [pick, setPick] = useState<PagePick | null>(null);
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);

  // Tell the page whether a click comments (again each time it reloads: the layer starts switched off).
  const tell = (value: boolean) => frame.current?.contentWindow?.postMessage({ type: PAGE_MODE, on: value }, "*");
  useEffect(() => { tell(on); }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      if ((e.data as { type?: unknown } | null)?.type === PAGE_READY) { tell(on); return; }
      const p = parsePagePick(e.data);
      if (p && on) { setPick(p); setOn(false); }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!pick) return;
    const text = pageRemarkMessage(t("remarks.pageHead", { title, url }), pick, remark);
    if (!text) return;
    setBusy(true);
    const ok = await quickSend(botId, text);
    setBusy(false);
    if (ok) { setPick(null); setRemark(""); useStore.getState().showToast(t("passage.sent")); }
  };

  return (
    <div className="remark-block page-comment">
      {!pick && (
        <div className="remark-row">
          <button type="button" className={`btn btn-small ${on ? "btn-accent" : ""}`} aria-pressed={on} onClick={() => setOn((v) => !v)}>
            <Icon name="edit" size={13} /> {t(on ? "remarks.pageStop" : "remarks.pageStart")}
          </button>
          {on && <span className="remark-hint" role="status">{t("remarks.pageHint")}</span>}
        </div>
      )}
      {pick && (
        <form className="remark-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <p className="remark-target">
            <span className="remark-label">{t("remarks.pageTarget")}</span>
            <code className="remark-path">{pick.path}</code>
            {(pick.selection || pick.text) && <span className="remark-quote">« {(pick.selection || pick.text).slice(0, 140)} »</span>}
          </p>
          <textarea className="input remark-input" autoFocus rows={2} maxLength={REMARK_MAX} value={remark} placeholder={t("remarks.pagePlaceholder")} aria-label={t("remarks.pageTarget")} onChange={(e) => setRemark(e.target.value)} />
          <div className="remark-actions">
            <button type="button" className="btn btn-small btn-ghost" onClick={() => { setPick(null); setRemark(""); }}>{t("common.cancel")}</button>
            <button type="button" className="btn btn-small" onClick={() => { setPick(null); setOn(true); }}>{t("remarks.pageOther")}</button>
            <button type="submit" className="btn btn-small btn-accent" disabled={busy || !remark.trim()}>{t("passage.send")}</button>
          </div>
        </form>
      )}
    </div>
  );
}
