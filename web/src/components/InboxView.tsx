import { useCallback, useEffect, useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Card } from "../types";
import { Icon } from "./Icon";
import { CardCountdown } from "./TurnCards";
import { IconButton } from "./ui";

/**
 * « À toi » (backlog A-FAIRE L139; server inboxroutes.ts): every card that waits for you, across all your bots, newest
 * first, in tabs (all / approvals / questions / other). An approval can be answered right here with 👍 (allow once) or
 * 👎 (refuse) — the same answer as in the chat, through the same route; anything richer (an edited draft, a floor code,
 * a question with choices) opens the chat at that card. Cards that lapse show their countdown.
 */
interface Item { botId: string; botName: string; seq: number; thread: number; createdAt: number; card: Card; kind: "approval" | "question" | "other" }
type Tab = "all" | "approval" | "question" | "other";

/** The inbox's items, refreshed every 20 s and when the window comes back. */
export function useInbox() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setItems((await api<{ items: Item[] }>("GET", "/inbox")).items); setError(null); } catch (e) { setError(errText(e)); }
  }, []);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 20_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, [load]);
  return { items, error, load };
}

function title(card: Card): string {
  if (card.type === "approval" || card.type === "question") return card.type === "approval" ? card.title : card.question;
  if ("title" in card && typeof card.title === "string") return card.title;
  if ("name" in card && typeof card.name === "string") return card.name;
  if ("detail" in card && typeof card.detail === "string") return card.detail;
  return "";
}

/** The sidebar row « À toi », with the number of waiting cards. */
export function InboxNavRow({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const { items } = useInbox();
  const n = items?.length ?? 0;
  return (
    <button type="button" className={`nav-row ${view === "inbox" ? "is-active" : ""}`} onClick={() => setView(view === "inbox" ? "chat" : "inbox")} aria-pressed={view === "inbox"}
      title={collapsed ? t("inbox.title") : undefined} aria-label={collapsed ? `${t("inbox.title")}${n ? `, ${t("inbox.waiting", { n })}` : ""}` : undefined}>
      <span className="nav-row-icon"><Icon name="bell" size={19} />{collapsed && n > 0 && <span className="dot dot-attention" />}</span>
      {!collapsed && <span className="nav-row-label">{t("inbox.title")}</span>}
      {!collapsed && n > 0 && <span className="count-badge is-attention" aria-label={t("inbox.waiting", { n })}>{n}</span>}
    </button>
  );
}

export function InboxView() {
  const t = useT();
  const { items, error, load } = useInbox();
  const [tab, setTab] = useState<Tab>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const open = (i: Item) => { const s = useStore.getState(); s.selectBot(i.botId); if (i.thread) s.openThreadPanel(i.botId, i.thread); };
  const decide = async (i: Item, decision: "allow" | "deny") => {
    if (i.card.type !== "approval") return;
    setBusy(`${i.botId}/${i.seq}`); setFailed(null);
    try { await api("POST", `/approvals/${encodeURIComponent(i.card.approvalId)}`, { decision }); await load(); } catch (e) { setFailed(errText(e)); } finally { setBusy(null); }
  };
  const list = (items ?? []).filter((i) => tab === "all" || i.kind === tab);
  const count = (k: Tab) => (items ?? []).filter((i) => k === "all" || i.kind === k).length;
  return (
    <section className="main tasks-view inbox-view" aria-label={t("inbox.title")}>
      <header className="tasks-head">
        <IconButton icon="menu" label={t("common.openMenu")} className="only-mobile" onClick={() => useStore.getState().setMobileNav(true)} />
        <h1>{t("inbox.title")}</h1>
        <div className="segmented" role="group" aria-label={t("inbox.filterLabel")}>
          {(["all", "approval", "question", "other"] as Tab[]).map((k) => (
            <button key={k} type="button" aria-pressed={tab === k} className={tab === k ? "is-active" : ""} onClick={() => setTab(k)}>
              {t(`inbox.tab.${k}`)} <span className="inbox-tab-n">{count(k)}</span>
            </button>
          ))}
        </div>
      </header>
      <div className="tasks-body">
      <p className="muted inbox-lead">{t("inbox.lead")}</p>
      {error && <p className="card-error" role="alert">{error}</p>}
      {failed && <p className="card-error" role="alert">{failed}</p>}
      {items && !list.length && <p className="inbox-empty muted"><Icon name="check" size={16} /> {t("inbox.empty")}</p>}
      <ul className="inbox-list">
        {list.map((i) => {
          const c = i.card;
          const quick = c.type === "approval" && !c.draft && !c.irreversible;
          const key = `${i.botId}/${i.seq}`;
          return (
            <li key={key} className="inbox-item card">
              <div className="inbox-item-head">
                <span className="inbox-bot">{i.botName}</span>
                <span className="muted">· {t(`inbox.kind.${i.kind}`)} · {new Date(i.createdAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</span>
              </div>
              <p className="card-title inbox-item-title">{title(c) || t("inbox.untitled")}</p>
              {c.type === "approval" && c.irreversible && <p className="approval-irreversible"><Icon name="alert" size={14} /><span><strong>{t("approval.irreversible")}</strong></span></p>}
              {c.type === "approval" && <CardCountdown until={c.expiresAt ?? (c.parked ? undefined : c.parksAt)} parks={!c.expiresAt} />}
              {"expiresAt" in c && c.type !== "approval" && typeof c.expiresAt === "number" && <CardCountdown until={c.expiresAt} />}
              <div className="card-actions">
                <button type="button" className="btn btn-small" onClick={() => open(i)}>{t("inbox.open")}</button>
                <span className="spacer" />
                {quick && (
                  <>
                    <button type="button" className="btn btn-small btn-ghost" disabled={busy === key} onClick={() => void decide(i, "deny")} aria-label={t("inbox.deny", { title: title(c) })} title={t("approval.deny")}>👎</button>
                    <button type="button" className="btn btn-small btn-accent" disabled={busy === key} onClick={() => void decide(i, "allow")} aria-label={t("inbox.allow", { title: title(c) })} title={t("approval.allow")}>👍</button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      </div>
    </section>
  );
}
