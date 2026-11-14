import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { IconButton } from "./ui";

/**
 * Find in the open chat: every match in the messages is highlighted, the current one more strongly, and next / previous
 * scroll to it. The highlights use the CSS Custom Highlight API (https://developer.mozilla.org/docs/Web/API/CSS_Custom_Highlight_API),
 * so the rendered messages are never modified. Where the API is missing, the current match is still selected and shown.
 */
type HighlightCtor = new (...ranges: Range[]) => unknown;
const highlights = (): Map<string, unknown> | null => (typeof CSS !== "undefined" && "highlights" in CSS ? (CSS as unknown as { highlights: Map<string, unknown> }).highlights : null);
const Highlight = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;

function findRanges(root: Element, needle: string): Range[] {
  const out: Range[] = [];
  const lower = needle.toLowerCase();
  for (const body of root.querySelectorAll(".msg .bubble")) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.nodeValue ?? "").toLowerCase();
      let at = text.indexOf(lower);
      while (at >= 0) {
        const r = document.createRange();
        r.setStart(node, at);
        r.setEnd(node, at + needle.length);
        out.push(r);
        at = text.indexOf(lower, at + needle.length);
      }
    }
  }
  return out;
}

export function FindBar({ botId }: { botId: string }) {
  const t = useT();
  const find = useStore((s) => (s.find?.botId === botId ? s.find : null));
  const rows = useStore((s) => s.threads[botId]?.rows);
  const { setFind, closeFind } = useStore.getState();
  const input = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  useEffect(() => {
    const reg = highlights();
    const clear = () => { reg?.delete("sklubot-find"); reg?.delete("sklubot-find-current"); };
    const needle = find?.query.trim() ?? "";
    const root = document.querySelector(".main.chat .transcript");
    if (!find || needle.length < 2 || !root) { clear(); setCount(0); return clear; }
    // Wait for the rows to be painted before measuring.
    const frame = window.requestAnimationFrame(() => {
      const ranges = findRanges(root, needle);
      setCount(ranges.length);
      clear();
      if (!ranges.length) return;
      const index = ((find.index % ranges.length) + ranges.length) % ranges.length;
      const current = ranges[index];
      if (reg && Highlight) {
        reg.set("sklubot-find", new Highlight(...ranges));
        reg.set("sklubot-find-current", new Highlight(current));
      }
      const el = current.startContainer.parentElement;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => { window.cancelAnimationFrame(frame); clear(); };
  }, [find, rows]);

  if (!find) return null;
  const shown = count ? (((find.index % count) + count) % count) + 1 : 0;
  const step = (d: number) => setFind({ index: find.index + d });

  return (
    <div className="find-bar" role="search" aria-label={t("find.label")}>
      <Icon name="search" size={15} />
      <input
        ref={input}
        className="find-input"
        value={find.query}
        placeholder={t("find.placeholder")}
        aria-label={t("find.label")}
        onChange={(e) => setFind({ query: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
          else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
        }}
      />
      <span className="find-count" aria-live="polite">{find.query.trim().length >= 2 ? t("find.count", { n: shown, total: count }) : ""}</span>
      <IconButton icon="arrowUp" size={16} label={t("find.prev")} title={`${t("find.prev")} (Shift+Enter)`} disabled={!count} onClick={() => step(-1)} />
      <IconButton icon="arrowDown" size={16} label={t("find.next")} title={`${t("find.next")} (Enter)`} disabled={!count} onClick={() => step(1)} />
      <IconButton icon="close" size={16} label={t("find.close")} onClick={closeFind} />
    </div>
  );
}
