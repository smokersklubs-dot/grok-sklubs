import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import type { Bot, Row } from "../types";
import { PASSAGE_ASKS, passageMessage, simplerMessage, worthQuoting, type PassageAsk } from "../lib/passage";
import { quickSend } from "../lib/quicksend";
import { Icon } from "./Icon";
import { RowContext } from "./Transcript";
import "./PassageComment.css";

/**
 * L140 « Commenter un passage »: select words in one of the bot's replies (main chat) and a small bar appears under the
 * selection: « Explique ce passage », « Plus simple », « Trop long », « Un exemple », or « Remarque… » (a box for your own
 * words). One click sends the passage as a quote plus the request (lib/passage.ts) — no need to copy the sentence into a
 * new message. Only on your own bots (a shared bot: its owner's chat), never in a read-only earlier conversation.
 */
const ASK_KEY: Record<PassageAsk, Key> = { explain: "passage.explain", simpler: "passage.simpler", shorter: "passage.shorter", example: "passage.example", remark: "passage.remark" };
const ASK_REQUEST: Record<Exclude<PassageAsk, "remark">, Key> = { explain: "passage.req.explain", simpler: "passage.req.simpler", shorter: "passage.req.shorter", example: "passage.req.example" };

interface Picked { text: string; top: number; left: number; below: boolean }

/** The selection when it lies inside one reply bubble of the bot in the chat's transcript, else null. */
function pickedReply(root: HTMLElement | null): Picked | null {
  const sel = window.getSelection();
  if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const host = (n: Node | null) => (n instanceof Element ? n : n?.parentElement ?? null)?.closest(".group.is-theirs .msg .bubble") ?? null;
  const start = host(range.startContainer);
  if (!start || start !== host(range.endContainer) || !root.contains(start)) return null;
  const text = sel.toString();
  if (!worthQuoting(text)) return null;
  const rect = range.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  // Under the selection (the phone's own copy menu sits above it), unless that falls off the chat.
  const below = rect.bottom + 56 < rootRect.bottom;
  const left = Math.min(Math.max(rect.left + rect.width / 2, rootRect.left + 8), rootRect.right - 8);
  return { text, top: below ? rect.bottom + 8 : rect.top - 8, left, below };
}

export function PassageBar({ bot }: { bot: Bot }) {
  const t = useT();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [remark, setRemark] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const enabled = !bot.access;

  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // While the remark box is open, a click inside it moves the selection: keep the passage.
        if (bar.current && document.activeElement && bar.current.contains(document.activeElement)) return;
        const root = document.querySelector<HTMLElement>(".main.chat .transcript");
        setPicked(pickedReply(root));
      });
    };
    document.addEventListener("selectionchange", update);
    const onScroll = () => setPicked((p) => (p ? pickedReply(document.querySelector<HTMLElement>(".main.chat .transcript")) : p));
    document.addEventListener("scroll", onScroll, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("selectionchange", update); document.removeEventListener("scroll", onScroll, true); };
  }, [enabled]);
  useEffect(() => { if (!picked) setRemark(null); }, [picked]);
  useEffect(() => { setPicked(null); }, [bot.id]);
  // Keep the whole bar on screen: once drawn, its centre is moved so neither edge leaves the window.
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el || !picked) return;
    const half = el.offsetWidth / 2;
    el.style.left = `${Math.min(Math.max(picked.left, half + 8), window.innerWidth - half - 8)}px`;
  }, [picked, remark]);

  if (!enabled || !picked) return null;
  const send = async (words: string) => {
    const text = passageMessage(picked.text, words);
    if (!text) return;
    setBusy(true);
    const ok = await quickSend(bot.id, text);
    setBusy(false);
    if (ok) {
      window.getSelection()?.removeAllRanges();
      setPicked(null);
      useStore.getState().showToast(t("passage.sent"));
    }
  };
  const ask = (a: PassageAsk) => (a === "remark" ? setRemark("") : void send(t(ASK_REQUEST[a])));
  return (
    <div
      ref={bar}
      className={`passage-bar ${picked.below ? "is-below" : "is-above"}`}
      style={{ top: picked.top, left: picked.left }}
      role="toolbar"
      aria-label={t("passage.bar")}
      // Keep the selection: a mousedown on a button would clear it before the click reads it.
      onMouseDown={(e) => { if (!(e.target as HTMLElement).closest("input")) e.preventDefault(); }}
      onKeyDown={(e) => { if (e.key === "Escape") { window.getSelection()?.removeAllRanges(); setPicked(null); } }}
    >
      {remark === null ? (
        PASSAGE_ASKS.map((a) => (
          <button key={a} type="button" className="passage-btn" disabled={busy} onClick={() => ask(a)}>
            {a === "remark" && <Icon name="edit" size={13} />}
            {t(ASK_KEY[a])}
          </button>
        ))
      ) : (
        <form className="passage-remark" onSubmit={(e) => { e.preventDefault(); void send(remark); }}>
          <input className="input" autoFocus value={remark} maxLength={600} placeholder={t("passage.remarkHint")} aria-label={t("passage.remark")} onChange={(e) => setRemark(e.target.value)} />
          <button type="submit" className="btn btn-small btn-accent" disabled={busy || !remark.trim()}>{t("passage.send")}</button>
        </form>
      )}
    </div>
  );
}

/**
 * L106 « Explique plus simplement »: under a reply of the bot (main chat), one click asks it to say the same thing again
 * with simpler words (short sentences, everyday words, one example).
 */
export function SimplerAction({ row }: { row: Row }) {
  const t = useT();
  const bot = useStore((s) => s.bots[row.botId]);
  const { mode } = useContext(RowContext);
  const [busy, setBusy] = useState(false);
  if (mode !== "main" || !bot || bot.access || row.body.kind !== "message" || row.body.role !== "assistant" || row.body.streaming || !row.body.text.trim()) return null;
  const text = row.body.text;
  return (
    <button
      type="button"
      className="msg-action"
      aria-label={t("passage.simplerReply")}
      title={t("passage.simplerReply")}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        if (await quickSend(row.botId, simplerMessage(text, t("passage.req.simplerReply")))) useStore.getState().showToast(t("passage.sent"));
        setBusy(false);
      }}
    >
      <Icon name="bulb" size={15} />
    </button>
  );
}
