import { useEffect, useState, type RefObject } from "react";
import { tn, useT } from "../i18n";
import { useStore } from "../store";
import { connector, isLiveLink, type Box } from "../lib/command";
import { relTime } from "../lib/format";
import type { CommandCard, CommandLink } from "../types";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { Modal } from "./ui";

/**
 * « Centre de commandement »: the links between bots working together. On a wide screen they are drawn as curves
 * between the cards (SVG under the cards, dashes flowing from the sender while the link is live — still under
 * prefers-reduced-motion, where the arrow alone gives the direction), each with a label you can click or focus; on any
 * screen they are also listed under the cards. A click opens the exchange.
 */

export const LINK_ICON: Record<CommandLink["kind"], IconName> = { message: "chat", handoff: "hand", room: "users" };

export function useLinkWords() {
  const t = useT();
  return (l: CommandLink) => (l.kind === "room" ? t("command.link.room", { room: l.roomName }) : t(l.kind === "handoff" ? "command.link.handoff" : "command.link.message"));
}

interface Drawn { link: CommandLink; d: string; mid: { x: number; y: number } | null }

/** The curves over the canvas `box` (the element that holds the cards, each with data-card="<botId>"). */
export function LinkLayer({ box, links, cards, now, version, onOpen }: { box: RefObject<HTMLDivElement | null>; links: CommandLink[]; cards: Map<string, CommandCard>; now: number; version: string; onOpen: (l: CommandLink) => void }) {
  const t = useT();
  const words = useLinkWords();
  const [drawn, setDrawn] = useState<{ w: number; h: number; items: Drawn[] }>({ w: 0, h: 0, items: [] });

  // After the commit (not a layout effect): the canvas's ref is attached only once its children have rendered.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      const boxes = new Map<string, Box>();
      for (const c of el.querySelectorAll<HTMLElement>("[data-card]")) {
        const r = c.getBoundingClientRect();
        boxes.set(c.dataset.card!, { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
      }
      // Cards, then each label placed so far: a label never covers a card or another label.
      const all = [...boxes.values()];
      const items: Drawn[] = [];
      for (const link of links) {
        const a = boxes.get(link.from), b = boxes.get(link.to);
        if (!a || !b) continue;
        const c = connector(a, b, all);
        if (c.mid) all.push({ x: c.mid.x - 26, y: c.mid.y - 14, w: 52, h: 28 });
        items.push({ link, d: c.d, mid: c.mid });
      }
      setDrawn({ w: el.scrollWidth, h: el.scrollHeight, items });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const c of el.querySelectorAll("[data-card]")) ro.observe(c);
    return () => ro.disconnect();
  }, [box, links, version]);

  if (!drawn.items.length) return null;
  return (
    <>
      <svg className="cmd-links" width={drawn.w} height={drawn.h} viewBox={`0 0 ${drawn.w} ${drawn.h}`} aria-hidden="true">
        <defs>
          {(["message", "handoff", "room"] as const).map((k) => (
            <marker key={k} id={`cmd-arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" className={`cmd-arrow is-${k}`}>
              <path d="M1,1 L9,5 L1,9 z" />
            </marker>
          ))}
        </defs>
        {drawn.items.map(({ link, d }) => (
          <g key={link.id} className={`cmd-link is-${link.kind} ${isLiveLink(link, now) ? "is-live" : ""}`} onClick={() => onOpen(link)}>
            <path className="cmd-link-halo" d={d} />
            <path className="cmd-link-base" d={d} markerEnd={link.kind === "room" ? undefined : `url(#cmd-arrow-${link.kind})`} />
            <path className="cmd-link-flow" d={d} />
          </g>
        ))}
      </svg>
      {drawn.items.map(({ link, mid }) => {
        if (!mid) return null;
        const from = cards.get(link.from)?.name ?? "", to = cards.get(link.to)?.name ?? "";
        return (
          <button
            key={link.id}
            type="button"
            className={`cmd-link-pill is-${link.kind}`}
            style={{ left: mid.x, top: mid.y }}
            onClick={() => onOpen(link)}
            aria-label={t("command.link.label", { from, to, kind: words(link), count: tn("command.link.count", link.count) })}
            title={words(link)}
          >
            <Icon name={LINK_ICON[link.kind]} size={12} />
            <span>{link.count}</span>
          </button>
        );
      })}
    </>
  );
}

/** The same links as a list (every screen; the only way on a phone or a tablet). */
export function LinkList({ links, cards, now, onOpen }: { links: CommandLink[]; cards: Map<string, CommandCard>; now: number; onOpen: (l: CommandLink) => void }) {
  const t = useT();
  const words = useLinkWords();
  return (
    <section className="cmd-collab" aria-labelledby="cmd-collab-h">
      <header className="cmd-collab-head">
        <h2 id="cmd-collab-h"><Icon name="bolt" size={16} />{t("command.links.title")}</h2>
        <span className="cmd-collab-hint">{t("command.links.hint")}</span>
        <ul className="cmd-legend" aria-label={t("command.links.legend")}>
          {(["message", "handoff", "room"] as const).map((k) => (
            <li key={k} className={`is-${k}`}><span className="cmd-legend-line" aria-hidden="true" />{t(k === "room" ? "command.link.room" : k === "handoff" ? "command.link.handoff" : "command.link.message", { room: "" }).trim()}</li>
          ))}
        </ul>
      </header>
      {links.length === 0 ? (
        <p className="cmd-collab-empty">{t("command.links.empty")}</p>
      ) : (
        <ul className="cmd-collab-list">
          {links.map((l) => {
            const a = cards.get(l.from), b = cards.get(l.to);
            if (!a || !b) return null;
            return (
              <li key={l.id}>
                <button type="button" className={`cmd-collab-row is-${l.kind}`} onClick={() => onOpen(l)}>
                  <span className="cmd-collab-pair" aria-hidden="true">
                    <Avatar shape={a.shape} color={a.color} name={a.name} character={a.character} size={26} />
                    <span className={`cmd-collab-wire is-${l.kind} ${isLiveLink(l, now) ? "is-live" : ""}`}><Icon name={LINK_ICON[l.kind]} size={11} /></span>
                    <Avatar shape={b.shape} color={b.color} name={b.name} character={b.character} size={26} />
                  </span>
                  <span className="cmd-collab-main">
                    <span className="cmd-collab-names">{a.name} <span aria-hidden="true">{l.kind === "room" ? "·" : "→"}</span> {b.name}</span>
                    <span className="cmd-collab-meta">{words(l)} · {tn("command.link.count", l.count)} · {relTime(l.lastAt, now)}</span>
                  </span>
                  <Icon name="chevronRight" size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** What passed over one link, newest first, each line opening its place in the conversation. */
export function ExchangeModal({ link, cards, now, onClose }: { link: CommandLink; cards: Map<string, CommandCard>; now: number; onClose: () => void }) {
  const t = useT();
  const words = useLinkWords();
  const has = useStore((s) => s.bots);
  const a = cards.get(link.from), b = cards.get(link.to);
  const go = (botId: string, seq: number, thread: number) => {
    const s = useStore.getState();
    onClose();
    if (!s.bots[botId]) return;
    if (thread) { s.jumpTo(botId, thread); s.openThreadPanel(botId, thread); } else s.jumpTo(botId, seq);
  };
  const openChat = (botId: string) => { onClose(); if (useStore.getState().bots[botId]) useStore.getState().selectBot(botId); };
  return (
    <Modal title={`${a?.name ?? ""} ${link.kind === "room" ? "·" : "→"} ${b?.name ?? ""}`} onClose={onClose} size="md" className="cmd-exchange">
      <div className="modal-body cmd-exchange-body">
        <p className={`cmd-exchange-kind is-${link.kind}`}><Icon name={LINK_ICON[link.kind]} size={14} />{words(link)} · {tn("command.link.count", link.count)}</p>
        {link.kind === "handoff" && <p className="cmd-exchange-note">{t("command.link.handoffText", { from: a?.name ?? "", to: b?.name ?? "" })}</p>}
        {link.exchange.length > 0 && (
          <ol className="cmd-exchange-list">
            {link.exchange.map((e) => {
              const who = cards.get(e.fromId);
              return (
                <li key={`${e.botId}:${e.seq}`}>
                  {who && <Avatar shape={who.shape} color={who.color} name={who.name} character={who.character} size={30} />}
                  <div className="cmd-exchange-line">
                    <p className="cmd-exchange-meta"><strong>{who?.name ?? ""}</strong> → {cards.get(e.toId)?.name ?? ""} · {relTime(e.at, now)}</p>
                    <p className="cmd-exchange-text">{e.text}</p>
                    {has[e.botId] && <button type="button" className="link cmd-exchange-go" onClick={() => go(e.botId, e.seq, e.thread)}>{t("command.link.goTo")}</button>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <div className="modal-foot cmd-exchange-foot">
        {[a, b].filter((x): x is CommandCard => !!x && !!has[x.botId]).map((x) => (
          <button key={x.botId} type="button" className="btn" onClick={() => openChat(x.botId)}>{t("command.link.openChat", { name: x.name })}</button>
        ))}
        </div>
      </div>
    </Modal>
  );
}
