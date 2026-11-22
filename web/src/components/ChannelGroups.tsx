import { useId } from "react";
import { enc } from "../api";
import { useT } from "../i18n";
import { relTime } from "../lib/format";
import type { ChannelGroup, ContactChannel } from "../types";
import { ConfirmButton } from "./ui";

/**
 * Bot settings → "Canaux" → "Groupes" (server channelgroups.ts, DS-Bot item 4): the Slack channels, Discord server channels
 * and Telegram groups where someone called the bot. The owner turns one on (or refuses it), and chooses when the bot
 * answers there (when called, or every message) and for whom (approved people, or anyone in the group). Approvals never
 * go to a group: they stay in the app and the owner's private messages.
 */
const LABEL: Record<ContactChannel, string> = { telegram: "Telegram", slack: "Slack", discord: "Discord" };

export type GroupAct = (method: "PATCH" | "DELETE", path: string, body?: unknown) => Promise<boolean>;

export function ChannelGroups({ groups, act }: { groups: ChannelGroup[]; act: GroupAct }) {
  const t = useT();
  const uid = useId();
  const pending = groups.filter((g) => g.status === "pending");
  const allowed = groups.filter((g) => g.status === "allowed");
  const blocked = groups.filter((g) => g.status === "blocked");
  const set = (g: ChannelGroup, change: Partial<Pick<ChannelGroup, "status" | "trigger" | "who">>) => act("PATCH", `/channel-groups/${enc(g.id)}`, change);
  return (
    <section className="channels-section" aria-labelledby={`${uid}h`}>
      <h3 className="pane-heading" id={`${uid}h`}>{t("channels.groups.heading")}</h3>
      <p className="muted small">{t("channels.groups.intro")}</p>
      <h4 className="channels-sub">{t("channels.groups.pending")}</h4>
      {pending.length === 0 ? <p className="muted small">{t("channels.groups.noPending")}</p> : (
        <ul className="channels-list">
          {pending.map((g) => (
            <li key={g.id} className="channels-item">
              <div className="channels-item-main">
                <span className="channels-name truncate">{g.name}</span>
                <span className="chip">{LABEL[g.channel]}</span>
                {g.lastSeenAt && <span className="muted small">{t("channels.groups.calledAt", { when: relTime(g.lastSeenAt) })}</span>}
              </div>
              <div className="channels-item-actions">
                <button type="button" className="btn btn-small btn-primary" onClick={() => void set(g, { status: "allowed" })}>{t("channels.groups.turnOn")}</button>
                <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("channels.groups.refuse")} confirmLabel={t("channels.groups.refuseConfirm")} busyLabel={t("channels.groups.refusing")} onConfirm={async () => { await set(g, { status: "blocked" }); }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <h4 className="channels-sub">{t("channels.groups.on")}</h4>
      {allowed.length === 0 ? <p className="muted small">{t("channels.groups.noneOn")}</p> : (
        <ul className="channels-list">
          {allowed.map((g) => (
            <li key={g.id} className="channels-item channels-group">
              <div className="channels-item-main">
                <span className="channels-name truncate">{g.name}</span>
                <span className="chip">{LABEL[g.channel]}</span>
              </div>
              <div className="channels-group-settings">
                <label className="field-label" htmlFor={`${uid}${g.id}t`}>{t("channels.groups.when")}</label>
                <select id={`${uid}${g.id}t`} className="input" value={g.trigger} onChange={(e) => void set(g, { trigger: e.target.value === "all" ? "all" : "mention" })}>
                  <option value="mention">{t("channels.groups.whenMention")}</option>
                  <option value="all">{t("channels.groups.whenAll")}</option>
                </select>
                <label className="field-label" htmlFor={`${uid}${g.id}w`}>{t("channels.groups.who")}</label>
                <select id={`${uid}${g.id}w`} className="input" value={g.who} onChange={(e) => void set(g, { who: e.target.value === "everyone" ? "everyone" : "approved" })}>
                  <option value="approved">{t("channels.groups.whoApproved")}</option>
                  <option value="everyone">{t("channels.groups.whoEveryone")}</option>
                </select>
                {g.trigger === "all" && <p className="field-hint">{t(g.channel === "discord" ? "channels.groups.allHintDiscord" : g.channel === "slack" ? "channels.groups.allHintSlack" : "channels.groups.allHintTelegram")}</p>}
              </div>
              <div className="channels-item-actions">
                <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("channels.groups.turnOff")} confirmLabel={t("channels.groups.turnOffConfirm")} busyLabel={t("channels.groups.refusing")} onConfirm={async () => { await set(g, { status: "blocked" }); }} ariaLabel={t("channels.groups.turnOffAria", { name: g.name })} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {blocked.length > 0 && (
        <>
          <h4 className="channels-sub">{t("channels.groups.off")}</h4>
          <ul className="channels-list">
            {blocked.map((g) => (
              <li key={g.id} className="channels-item">
                <div className="channels-item-main">
                  <span className="channels-name truncate">{g.name}</span>
                  <span className="chip">{LABEL[g.channel]}</span>
                </div>
                <div className="channels-item-actions">
                  <button type="button" className="btn btn-small" onClick={() => void set(g, { status: "allowed" })}>{t("channels.groups.turnOn")}</button>
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => void act("DELETE", `/channel-groups/${enc(g.id)}`)}>{t("channels.groups.forget")}</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small">{t("channels.groups.private")}</p>
    </section>
  );
}
