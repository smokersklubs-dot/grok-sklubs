import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { tn, useT } from "../i18n";
import type { ConversationGrantInfo } from "../types";
import { relTime } from "../lib/format";
import { ErrorNote, useTick } from "./ui";

/**
 * Settings → Permissions: what the owner allowed "for this conversation" on an approval card (server
 * agent/conversationgrants.ts), and still holds. Each line says which bot, which action, since when, and when it ends
 * by itself; "Retirer" ends it now. Nothing is shown while there is none (the page's own empty state speaks of rules).
 */
export function ConversationGrantsBlock() {
  const t = useT();
  const [grants, setGrants] = useState<ConversationGrantInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useTick(60_000);
  useEffect(() => {
    api<{ grants?: ConversationGrantInfo[] }>("GET", "/conversation-grants").then((r) => setGrants(r.grants ?? []), (e: unknown) => { setError(errText(e)); setGrants([]); });
  }, []);
  const revoke = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await api("DELETE", `/conversation-grants/${enc(id)}`);
      setGrants((g) => g?.filter((x) => x.id !== id) ?? null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };
  if (!grants) return null;
  const left = (ms: number) => { const h = Math.floor(ms / 3_600_000); return h >= 1 ? tn("convGrant.endsHours", h) : t("convGrant.endsSoon"); };
  return (
    <section className="conv-grants" aria-labelledby="conv-grants-h">
      <h3 id="conv-grants-h">{t("convGrant.title")}</h3>
      <p className="muted">{t("convGrant.intro")}</p>
      <ErrorNote>{error}</ErrorNote>
      {grants.length === 0 ? (
        <p className="conv-grants-none">{t("convGrant.none")}</p>
      ) : (
        <ul className="list">
          {grants.map((g) => (
            <li key={g.id} className="list-row is-card conv-grant-row">
              <div className="list-row-text">
                <span className="list-row-title">
                  <span>{g.botName} · {g.label}</span>
                  <span className="chip state-conversation">{t(g.thread ? "convGrant.chipThread" : "convGrant.chip")}</span>
                </span>
                <code className="list-row-sub">{g.place}</code>
                <span className="list-row-sub">
                  {t("convGrant.since", { when: relTime(g.grantedAt) })} · {g.uses ? tn("convGrant.uses", g.uses) : t("convGrant.unused")} · {left(g.expiresAt - Date.now())}
                </span>
              </div>
              <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void revoke(g.id)}>{t(busy === g.id ? "convGrant.revoking" : "convGrant.revoke")}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
