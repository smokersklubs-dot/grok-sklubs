import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { relTime } from "../lib/format";
import type { Bot, BotChannels, ChannelContact, ContactChannel } from "../types";
import { Icon } from "./Icon";
import { ChannelGroups } from "./ChannelGroups";
import { ConfirmButton, CopyButton, ErrorNote, IconButton, Loading, Toggle } from "./ui";
import "./BotChannels.css";

/**
 * Bot settings → "Canaux" (server channelroutes.ts, L162): who besides the owner may talk to the bot (access requests
 * with their code, the allow-list, blocked people), and the bot's Slack, Discord and IMAP connections. Owner only.
 */
const LABEL: Record<ContactChannel | "imap", string> = { telegram: "Telegram", slack: "Slack", discord: "Discord", imap: "IMAP" };

type Act = (method: "PUT" | "POST" | "DELETE" | "PATCH", path: string, body?: unknown) => Promise<boolean>;

export function BotChannelsTab({ bot }: { bot: Bot }) {
  const t = useT();
  const [view, setView] = useState<BotChannels | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = () => api<BotChannels>("GET", `/bots/${enc(bot.id)}/channels`).then((v) => alive.current && (setView(v), setLoadError(null)), (e: unknown) => alive.current && setLoadError(errText(e)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [bot.id]);
  // While a link code or a request waits: refreshed every 5 s (the owner is often switching to Slack or Discord).
  const waiting = !!view && ((view.slack.connected && !view.slack.linked) || (view.discord.connected && !view.discord.linked) || view.contacts.some((c) => c.status === "pending") || (view.groups ?? []).some((g) => g.status === "pending"));
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, bot.id]);

  const act: Act = async (method, path, body) => {
    setError(null);
    try {
      const r = await api<BotChannels | { channels: BotChannels }>(method, `/bots/${enc(bot.id)}${path}`, body);
      if (alive.current) setView("channels" in r ? r.channels : r);
      return true;
    } catch (err) {
      if (alive.current) setError(errText(err));
      return false;
    }
  };

  return (
    <div className="settings-pane bot-channels">
      <p className="muted">{t("channels.intro", { name: bot.name })}</p>
      {loadError && !view && <ErrorNote>{loadError}</ErrorNote>}
      {!view && !loadError && <Loading />}
      {view && (
        <>
          <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
          <Contacts contacts={view.contacts} act={act} />
          <ChannelGroups groups={view.groups ?? []} act={act} />
          <SlackCard view={view} act={act} />
          <DiscordCard view={view} act={act} />
          <ImapCard view={view} act={act} />
        </>
      )}
    </div>
  );
}

/* ---------- Who may talk to the bot ---------- */

function Contacts({ contacts, act }: { contacts: ChannelContact[]; act: Act }) {
  const t = useT();
  const uid = useId();
  const [code, setCode] = useState("");
  const [channel, setChannel] = useState<ContactChannel>("telegram");
  const [externalId, setExternalId] = useState("");
  const [name, setName] = useState("");
  const pending = contacts.filter((c) => c.status === "pending");
  const allowed = contacts.filter((c) => c.status === "allowed");
  const blocked = contacts.filter((c) => c.status === "blocked");
  const approve = async (e: FormEvent) => { e.preventDefault(); if (code.trim() && (await act("POST", "/contacts/approve", { code: code.trim() }))) setCode(""); };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (externalId.trim() && (await act("POST", "/contacts", { channel, externalId: externalId.trim(), name: name.trim() }))) { setExternalId(""); setName(""); }
  };
  return (
    <section className="channels-section" aria-labelledby={`${uid}h`}>
      <h3 className="pane-heading" id={`${uid}h`}>{t("channels.access.heading")}</h3>
      <p className="muted small">{t("channels.access.intro")}</p>

      <h4 className="channels-sub">{t("channels.access.pending")}</h4>
      {pending.length === 0 ? <p className="muted small">{t("channels.access.noPending")}</p> : (
        <ul className="channels-list">
          {pending.map((c) => (
            <li key={c.id} className="channels-item">
              <div className="channels-item-main">
                <span className="channels-name truncate">{c.name}</span>
                <span className="chip">{LABEL[c.channel]}</span>
                <code className="channels-code" aria-label={t("channels.access.codeAria")}>{c.code}</code>
                {c.expiresAt && <span className="muted small">{t("channels.access.expires", { n: Math.max(1, Math.round((c.expiresAt - Date.now()) / 60_000)) })}</span>}
              </div>
              <div className="channels-item-actions">
                <button type="button" className="btn btn-small btn-primary" onClick={() => void act("POST", "/contacts/approve", { code: c.code })}>{t("channels.access.approve")}</button>
                <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("channels.access.refuse")} confirmLabel={t("channels.access.refuseConfirm")} busyLabel={t("channels.access.refusing")} onConfirm={async () => { await act("POST", `/contacts/${enc(c.id)}/block`); }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="channels-inline" onSubmit={approve} autoComplete="off">
        <label className="field-label" htmlFor={`${uid}c`}>{t("channels.access.codeLabel")}</label>
        <div className="channels-inline-row">
          <input id={`${uid}c`} className="input channels-code-input" value={code} maxLength={8} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD2345" autoCapitalize="characters" spellCheck={false} />
          <button type="submit" className="btn btn-small" disabled={code.trim().length !== 8}>{t("channels.access.approve")}</button>
        </div>
        <p className="field-hint">{t("channels.access.codeHint")}</p>
      </form>

      <h4 className="channels-sub">{t("channels.access.allowed")}</h4>
      {allowed.length === 0 ? <p className="muted small">{t("channels.access.noAllowed")}</p> : (
        <ul className="channels-list">
          {allowed.map((c) => (
            <li key={c.id} className="channels-item">
              <div className="channels-item-main">
                <span className="channels-name truncate">{c.name}</span>
                <span className="chip">{LABEL[c.channel]}</span>
                <span className="muted small truncate">{c.lastSeenAt ? t("channels.access.lastSeen", { when: relTime(c.lastSeenAt) }) : t("channels.access.notYet")}</span>
              </div>
              <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("channels.access.revoke")} confirmLabel={t("channels.access.revokeConfirm")} busyLabel={t("channels.access.revoking")} onConfirm={async () => { await act("DELETE", `/contacts/${enc(c.id)}`); }} ariaLabel={t("channels.access.revokeAria", { name: c.name })} />
            </li>
          ))}
        </ul>
      )}
      {blocked.length > 0 && (
        <>
          <h4 className="channels-sub">{t("channels.access.blocked")}</h4>
          <ul className="channels-list">
            {blocked.map((c) => (
              <li key={c.id} className="channels-item is-muted">
                <div className="channels-item-main">
                  <span className="channels-name truncate">{c.name}</span>
                  <span className="chip">{LABEL[c.channel]}</span>
                </div>
                <button type="button" className="btn btn-small" onClick={() => void act("DELETE", `/contacts/${enc(c.id)}`)}>{t("channels.access.unblock")}</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <details className="channels-details">
        <summary>{t("channels.access.addTitle")}</summary>
        <form className="editor" onSubmit={add} autoComplete="off">
          <div className="channels-grid">
            <div className="field">
              <label className="field-label" htmlFor={`${uid}s`}>{t("channels.access.service")}</label>
              <select id={`${uid}s`} className="input" value={channel} onChange={(e) => setChannel(e.target.value as ContactChannel)}>
                {(["telegram", "slack", "discord"] as const).map((x) => <option key={x} value={x}>{LABEL[x]}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${uid}i`}>{t("channels.access.id")}</label>
              <input id={`${uid}i`} className="input" value={externalId} maxLength={30} onChange={(e) => setExternalId(e.target.value)} placeholder={t(`channels.access.idPlaceholder.${channel}` as Key)} spellCheck={false} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${uid}n`}>{t("channels.access.name")}</label>
              <input id={`${uid}n`} className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <p className="field-hint">{t(`channels.access.idHint.${channel}` as Key)}</p>
          <div className="row-end"><button type="submit" className="btn btn-small btn-primary" disabled={!externalId.trim()}>{t("channels.access.add")}</button></div>
        </form>
      </details>
    </section>
  );
}

/* ---------- A secret input (token, password), never shown back ---------- */

function Secret({ id, label, value, onChange, placeholder, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: ReactNode }) {
  const t = useT();
  const [reveal, setReveal] = useState(false);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="input-affix">
        <input id={id} className="input" type={reveal ? "text" : "password"} value={value} maxLength={300} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" autoCapitalize="off" spellCheck={false} data-1p-ignore="" data-lpignore="true" />
        <IconButton icon={reveal ? "eyeOff" : "eye"} size={16} label={t(reveal ? "telegram.hideToken" : "telegram.showToken")} active={reveal} onClick={() => setReveal((v) => !v)} />
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

function State({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div className="status-row">
      <span className={`dot-inline ${ok ? "dot-ok" : "dot-pulse"}`} />
      <span role="status">{children}</span>
    </div>
  );
}

function LinkCode({ code, hint }: { code: string; hint: string }) {
  const t = useT();
  return (
    <div className="field">
      <span className="field-label">{t("channels.link.label")}</span>
      <div className="hook">
        <code className="truncate">{code}</code>
        <CopyButton text={code} label={t("telegram.copyCode")} />
      </div>
      <p className="field-hint">{hint}</p>
    </div>
  );
}

/* ---------- Slack ---------- */

function SlackCard({ view, act }: { view: BotChannels; act: Act }) {
  const t = useT();
  const uid = useId();
  const s = view.slack;
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [busy, setBusy] = useState(false);
  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (await act("PUT", "/channels/slack", { botToken: botToken.trim(), appToken: appToken.trim() })) { setBotToken(""); setAppToken(""); }
    setBusy(false);
  };
  return (
    <section className="channels-section channels-card">
      <h3 className="pane-heading"><Icon name="chat" size={16} /> Slack</h3>
      {!s.connected ? (
        <>
          <p className="muted small">{t("channels.slack.intro")}</p>
          <ol className="steps-guide">
            <li>{t("channels.slack.step1")}</li>
            <li>{t("channels.slack.step2")}</li>
            <li>{t("channels.slack.step3")}</li>
            <li>{t("channels.slack.step4")}</li>
          </ol>
          <form className="editor" onSubmit={connect} autoComplete="off">
            <Secret id={`${uid}b`} label={t("channels.slack.botToken")} value={botToken} onChange={setBotToken} placeholder="xoxb-…" />
            <Secret id={`${uid}a`} label={t("channels.slack.appToken")} value={appToken} onChange={setAppToken} placeholder="xapp-…" hint={t("channels.tokenSafe")} />
            <div className="row-end"><button type="submit" className="btn btn-primary btn-small" disabled={busy || !botToken.trim() || !appToken.trim()}>{t(busy ? "common.connecting" : "channels.connect")}</button></div>
          </form>
        </>
      ) : (
        <>
          <State ok={s.linked && s.online}>{s.linked ? t(s.online ? "channels.slack.linked" : "channels.offline", { team: s.team ?? "" }) : t("channels.slack.waiting", { team: s.team ?? "" })}</State>
          {s.linkCode && <LinkCode code={s.linkCode} hint={t("channels.slack.linkHint", { bot: s.botUser ?? "" })} />}
          {s.error && <p className="small channels-error">{t("channels.lastError", { error: s.error })}</p>}
          <div className="row-end"><ConfirmButton className="btn btn-small btn-ghost-danger" label={t("channels.disconnect")} confirmLabel={t("channels.disconnectConfirm")} busyLabel={t("telegram.disconnecting")} onConfirm={async () => { await act("DELETE", "/channels/slack"); }} /></div>
        </>
      )}
    </section>
  );
}

/* ---------- Discord ---------- */

function DiscordCard({ view, act }: { view: BotChannels; act: Act }) {
  const t = useT();
  const uid = useId();
  const d = view.discord;
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (await act("PUT", "/channels/discord", { token: token.trim() })) setToken("");
    setBusy(false);
  };
  return (
    <section className="channels-section channels-card">
      <h3 className="pane-heading"><Icon name="chat" size={16} /> Discord</h3>
      {!d.connected ? (
        <>
          <p className="muted small">{t("channels.discord.intro")}</p>
          <ol className="steps-guide">
            <li>{t("channels.discord.step1")}</li>
            <li>{t("channels.discord.step2")}</li>
            <li>{t("channels.discord.step3")}</li>
          </ol>
          <form className="editor" onSubmit={connect} autoComplete="off">
            <Secret id={`${uid}t`} label={t("channels.discord.token")} value={token} onChange={setToken} hint={t("channels.tokenSafe")} />
            <div className="row-end"><button type="submit" className="btn btn-primary btn-small" disabled={busy || !token.trim()}>{t(busy ? "common.connecting" : "channels.connect")}</button></div>
          </form>
        </>
      ) : (
        <>
          <State ok={d.linked && d.online}>{d.linked ? t(d.online ? "channels.discord.linked" : "channels.offline", { team: "Discord" }) : t("channels.discord.waiting")}</State>
          {d.inviteUrl && (
            <a className="telegram-link" href={d.inviteUrl} target="_blank" rel="noopener noreferrer"><Icon name="external" size={13} /> {t("channels.discord.invite")}</a>
          )}
          {d.linkCode && <LinkCode code={d.linkCode} hint={t("channels.discord.linkHint", { bot: d.botUser ?? "" })} />}
          {d.error && <p className="small channels-error">{d.error === "MESSAGE_CONTENT_INTENT" ? t("channels.groups.allHintDiscord") : t("channels.lastError", { error: d.error })}</p>}
          <div className="row-end"><ConfirmButton className="btn btn-small btn-ghost-danger" label={t("channels.disconnect")} confirmLabel={t("channels.disconnectConfirm")} busyLabel={t("telegram.disconnecting")} onConfirm={async () => { await act("DELETE", "/channels/discord"); }} /></div>
        </>
      )}
    </section>
  );
}

/* ---------- IMAP ---------- */

function ImapCard({ view, act }: { view: BotChannels; act: Act }) {
  const t = useT();
  const uid = useId();
  const m = view.imap;
  const [host, setHost] = useState(m.host ?? "");
  const [port, setPort] = useState(String(m.port ?? 993));
  const [username, setUsername] = useState(m.username ?? "");
  const [password, setPassword] = useState("");
  const [mailbox, setMailbox] = useState(m.mailbox ?? "INBOX");
  const [senders, setSenders] = useState(m.allowedSenders.join(", "));
  const [every, setEvery] = useState(String(m.everyMinutes));
  const [autoReply, setAutoReply] = useState(m.autoReply);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (await act("PUT", "/channels/imap", { host: host.trim(), port: Number(port), username: username.trim(), password, mailbox: mailbox.trim(), allowedSenders: senders, everyMinutes: Number(every), autoReply })) setPassword("");
    setBusy(false);
  };
  const senderOf = (from: string) => /<([^>]+)>/.exec(from)?.[1] ?? from;
  return (
    <section className="channels-section channels-card">
      <h3 className="pane-heading"><Icon name="mail" size={16} /> {t("channels.imap.heading")}</h3>
      <p className="muted small">{t("channels.imap.intro")}</p>
      {m.connected && (
        <State ok={!m.error}>{m.error ? t("channels.lastError", { error: m.error }) : m.lastCheckAt ? t("channels.imap.checked", { when: relTime(m.lastCheckAt) }) : t("channels.imap.saved")}</State>
      )}
      {m.held.length > 0 && (
        <>
          <h4 className="channels-sub">{t("channels.imap.held")}</h4>
          <ul className="channels-list">
            {m.held.map((h) => (
              <li key={`${h.from}${h.at}`} className="channels-item">
                <div className="channels-item-main">
                  <span className="channels-name truncate">{h.from}</span>
                  <span className="muted small truncate">{h.subject || t("channels.imap.noSubject")} · {relTime(h.at)}</span>
                </div>
                <button type="button" className="btn btn-small btn-primary" onClick={() => void act("POST", "/channels/imap/senders", { address: senderOf(h.from) })}>{t("channels.imap.approveSender")}</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <form className="editor" onSubmit={save} autoComplete="off">
        <div className="channels-grid">
          <div className="field">
            <label className="field-label" htmlFor={`${uid}h`}>{t("channels.imap.host")}</label>
            <input id={`${uid}h`} className="input" value={host} maxLength={200} onChange={(e) => setHost(e.target.value)} placeholder="imap.exemple.fr" spellCheck={false} />
          </div>
          <div className="field channels-port">
            <label className="field-label" htmlFor={`${uid}p`}>{t("channels.imap.port")}</label>
            <input id={`${uid}p`} className="input" inputMode="numeric" value={port} maxLength={5} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} />
          </div>
        </div>
        <div className="channels-grid">
          <div className="field">
            <label className="field-label" htmlFor={`${uid}u`}>{t("channels.imap.username")}</label>
            <input id={`${uid}u`} className="input" value={username} maxLength={200} onChange={(e) => setUsername(e.target.value)} spellCheck={false} autoCapitalize="off" />
          </div>
          <Secret id={`${uid}w`} label={t("channels.imap.password")} value={password} onChange={setPassword} placeholder={m.connected ? t("channels.imap.passwordKept") : ""} />
        </div>
        <div className="channels-grid">
          <div className="field">
            <label className="field-label" htmlFor={`${uid}f`}>{t("channels.imap.folder")}</label>
            <input id={`${uid}f`} className="input" value={mailbox} maxLength={200} onChange={(e) => setMailbox(e.target.value)} spellCheck={false} />
          </div>
          <div className="field channels-port">
            <label className="field-label" htmlFor={`${uid}e`}>{t("channels.imap.every")}</label>
            <select id={`${uid}e`} className="input" value={every} onChange={(e) => setEvery(e.target.value)}>
              {["1", "2", "5", "10", "15", "30", "60"].map((x) => <option key={x} value={x}>{t("channels.imap.minutes", { n: x })}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${uid}s`}>{t("channels.imap.senders")}</label>
          <textarea id={`${uid}s`} className="input" rows={2} value={senders} onChange={(e) => setSenders(e.target.value)} placeholder="camille@exemple.fr, @partenaire.fr" spellCheck={false} />
          <p className="field-hint">{t("channels.imap.sendersHint")}</p>
        </div>
        <div className="channels-toggle">
          <span className="grow">
            <span className="channels-toggle-title">{t("channels.imap.autoReply")}</span>
            <span className="muted small">{t("channels.imap.autoReplyHint")}</span>
          </span>
          <Toggle checked={autoReply} onChange={setAutoReply} label={t("channels.imap.autoReply")} />
        </div>
        <p className="field-hint">{t("channels.imap.safety")}</p>
        <div className="row-end channels-actions">
          {m.connected && <button type="button" className="btn btn-small" onClick={() => void act("POST", "/channels/imap/check")}>{t("channels.imap.checkNow")}</button>}
          {m.connected && <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("channels.disconnect")} confirmLabel={t("channels.disconnectConfirm")} busyLabel={t("telegram.disconnecting")} onConfirm={async () => { await act("DELETE", "/channels/imap"); }} />}
          <button type="submit" className="btn btn-primary btn-small" disabled={busy || !host.trim() || !username.trim() || (!m.connected && !password)}>{t(busy ? "common.connecting" : m.connected ? "channels.imap.save" : "channels.connect")}</button>
        </div>
      </form>
    </section>
  );
}
