import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useT, type Key } from "../i18n";
import { setSoundsEnabled, soundsEnabled } from "../lib/sounds";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { ErrorNote, Toggle } from "./ui";
import "./Comfort7.css";

/** Server notifyrules.ts BellItem. */
interface BellItem { id: number; kind: string; title: string; body: string; botId: string | null; sent: boolean; reason: string; at: number; read: boolean }

/**
 * L151 « La cloche »: every notification Sklubot decided about — sent to the phone, or kept here with why it was not
 * (you were at your computer, it was quick, quiet hours, chat on mute…). Opening it marks everything read.
 */
export function NotifyBell() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BellItem[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => api<{ items: BellItem[]; unread: number }>("GET", "/bell?limit=50").then((r) => { setItems(r.items); setUnread(r.unread); }, (e) => setError(errText(e)));
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    return () => window.clearInterval(id);
  }, []);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) { await refresh(); if (unread) { await api("POST", "/bell/read").catch(() => undefined); setUnread(0); } }
  };
  const go = (i: BellItem) => { if (i.botId && useStore.getState().bots[i.botId]) { useStore.getState().selectBot(i.botId); setOpen(false); } };
  return (
    <span className="menu-wrap">
      <button type="button" className={`icon-btn notify-bell${open ? " is-active" : ""}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => void toggle()}
        aria-label={unread ? t("c7.bell.unread", { n: unread }) : t("c7.bell.title")} title={t("c7.bell.title")}>
        <Icon name="volume" size={18} />
        {unread > 0 && <span className="notify-bell-dot" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="bell-pop" role="dialog" aria-label={t("c7.bell.title")} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
          <div className="bell-head">
            <strong>{t("c7.bell.title")}</strong>
            <button type="button" className="link small" disabled={!items?.length} onClick={async () => { await api("DELETE", "/bell").catch(() => undefined); setItems([]); }}>{t("c7.bell.clear")}</button>
          </div>
          <label className="bell-sound toggle-line">
            <Toggle checked={soundsEnabled()} label={t("c7.bell.sounds")} onChange={(v) => { setSoundsEnabled(v); setItems((x) => (x ? [...x] : x)); }} />
            <span className="small">{t("c7.bell.sounds")}</span>
          </label>
          <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
          {items?.length === 0 && <p className="muted small bell-empty">{t("c7.bell.empty")}</p>}
          <ul className="bell-list">
            {items?.map((i) => (
              <li key={i.id} className={i.read ? "" : "is-new"}>
                <button type="button" className="bell-item" onClick={() => go(i)} disabled={!i.botId}>
                  <span className="bell-title truncate">{i.title}</span>
                  <span className="bell-body small">{i.body}</span>
                  <span className="muted small bell-meta">
                    <Icon name={i.sent ? "smartphone" : "monitor"} size={11} /> {i.sent ? t("c7.bell.sent") : t(`c7.bell.held.${i.reason || "other"}` as Key)} · {new Date(i.at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small bell-foot">{t("c7.bell.rule")}</p>
        </div>
      )}
    </span>
  );
}
