import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import type { Bot, Card, VaultItem } from "../types";
import { relTime } from "../lib/format";
import { Icon } from "./Icon";
import { ErrorNote, Loading, Toggle } from "./ui";
import "./SecurityLot1.css";

/* Lot 1 security (docs/SECURITE.md): the account's switches (L44, L39), a bot's network journal and the hosts it may
 * test (L39, L38), who a bot may e-mail (L42), a vault item's allowed bots, "ask every time" and history (L41), and the
 * two-factor code on a floor approval card (L44). Server: server/src/securityroutes.ts. */

interface SecuritySettings { floorSecondFactor: boolean; netAlerts: boolean }
interface SandboxStatus { image: boolean | null; profile: boolean; oldComputers: number; unsandboxed: number; state: "ok" | "warn" | "unknown" }
interface Freshness { installed: string | null; latest: string | null; behind: number | null; state: "ok" | "warn" | "unknown"; sandbox?: SandboxStatus }
/** L48: which sentence tells the owner about the browser's own sandbox (server: browserfreshness.ts). */
export function sandboxKey(s: SandboxStatus): Key | null {
  if (s.state === "unknown" || s.image === null) return null;
  if (!s.image) return "security.sandboxNoImage";
  if (!s.profile) return "security.sandboxNoProfile";
  if (s.unsandboxed > 0) return "security.sandboxFallback";
  if (s.oldComputers > 0) return "security.sandboxOld";
  return "security.sandboxOk";
}

let settingsOnce: Promise<SecuritySettings | null> | null = null;
const loadSettings = () => (settingsOnce ??= api<{ settings: SecuritySettings }>("GET", "/security/settings").then((r) => r.settings, () => null));

/** The same rule as the server (floorapproval.ts needsFloorCode): an irreversible action, or a single-use card that says why. */
export const needsFloorCode = (card: Pick<Extract<Card, { type: "approval" }>, "irreversible" | "once" | "why">) => !!card.irreversible || (!!card.once && !!card.why);

/** Whether this approval card must carry the approver's two-factor code (the option is on and the card is a floor one). */
export function useFloorCode(card: Extract<Card, { type: "approval" }>): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => { if (card.status === "pending" && needsFloorCode(card)) void loadSettings().then((s) => setOn(!!s?.floorSecondFactor)); }, [card.status, card.irreversible, card.once, card.why]);
  return on && card.status === "pending" && needsFloorCode(card);
}

export function FloorCodeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <label className="field floor-code">
      <span className="field-label"><Icon name="shield" size={13} /> {t("security.floorCode")}</span>
      <input className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={14} value={value} onChange={(e) => onChange(e.target.value)} placeholder="123 456" />
    </label>
  );
}

/** Settings → Permissions → « Sécurité » : the two switches; the server's owner also sees the bots' browser freshness. */
export function SecuritySettingsBlock() {
  const t = useT();
  const [data, setData] = useState<{ settings: SecuritySettings; twoFactor: boolean } | null>(null);
  const [code, setCode] = useState("");
  const [askCode, setAskCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browser, setBrowser] = useState<Freshness | null>(null);
  useEffect(() => {
    void api<{ settings: SecuritySettings; twoFactor: boolean }>("GET", "/security/settings").then(setData, (e) => setError(errText(e)));
    void api<{ browser: Freshness }>("GET", "/security/browser").then((r) => setBrowser(r.browser), () => undefined);
  }, []);
  const save = async (patch: Partial<SecuritySettings> & { code?: string }) => {
    setError(null);
    try {
      const r = await api<{ settings: SecuritySettings; twoFactor: boolean }>("PUT", "/security/settings", patch);
      setData(r); settingsOnce = null; setAskCode(false); setCode("");
    } catch (e) { setError(errText(e)); }
  };
  if (!data) return error ? <ErrorNote>{error}</ErrorNote> : <Loading />;
  const s = data.settings;
  return (
    <section className="security-block" aria-labelledby="security-title">
      <h3 className="pane-heading" id="security-title"><Icon name="shield" size={15} /> {t("security.title")}</h3>
      <div className="action-row">
        <div><p className="action-title">{t("security.floor")}</p><p className="muted small">{t(data.twoFactor ? "security.floorHint" : "security.floorNeeds2fa")}</p></div>
        <Toggle checked={s.floorSecondFactor} disabled={!data.twoFactor && !s.floorSecondFactor} label={t("security.floor")}
          onChange={(next) => { if (!next && s.floorSecondFactor) setAskCode(true); else void save({ floorSecondFactor: next }); }} />
      </div>
      {askCode && (
        <form className="field-inline" onSubmit={(e) => { e.preventDefault(); void save({ floorSecondFactor: false, code }); }}>
          <FloorCodeField value={code} onChange={setCode} />
          <button type="submit" className="btn btn-small btn-primary">{t("security.turnOff")}</button>
          <button type="button" className="btn btn-small" onClick={() => { setAskCode(false); setCode(""); }}>{t("common.cancel")}</button>
        </form>
      )}
      <div className="action-row">
        <div><p className="action-title">{t("security.netAlerts")}</p><p className="muted small">{t("security.netAlertsHint")}</p></div>
        <Toggle checked={s.netAlerts} label={t("security.netAlerts")} onChange={(next) => void save({ netAlerts: next })} />
      </div>
      {browser && (
        <p className={`muted small security-browser is-${browser.state}`} role={browser.state === "warn" ? "alert" : undefined}>
          <Icon name={browser.state === "warn" ? "alert" : "monitor"} size={13} />{" "}
          {browser.state === "unknown" ? t("security.browserUnknown") : t(browser.state === "warn" ? "security.browserBehind" : "security.browserOk", { n: String(browser.behind ?? 0), installed: browser.installed ?? "?", latest: browser.latest ?? "?" })}
        </p>
      )}
      {browser?.sandbox && sandboxKey(browser.sandbox) && (
        <p className={`muted small security-browser is-${browser.sandbox.state}`} role={browser.sandbox.state === "warn" ? "alert" : undefined}>
          <Icon name={browser.sandbox.state === "warn" ? "alert" : "lock"} size={13} />{" "}
          {t(sandboxKey(browser.sandbox)!, { n: String(browser.sandbox.unsandboxed > 0 ? browser.sandbox.unsandboxed : browser.sandbox.oldComputers) })}
        </p>
      )}
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </section>
  );
}

interface HostEntry { host: string; via: string; firstAt: number; lastAt: number; count: number; tainted: boolean; fresh: boolean }

/** Bot settings → « Sécurité » : where it connects (L39) and which hosts it may test (L38). */
export function BotSecurityTab({ bot }: { bot: Bot }) {
  const t = useT();
  const [data, setData] = useState<{ hosts: HostEntry[]; testHosts: string[] } | null>(null);
  const [hosts, setHosts] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void api<{ hosts: HostEntry[]; testHosts: string[] }>("GET", `/bots/${bot.id}/security`).then((r) => { setData(r); setHosts(r.testHosts.join("\n")); }, (e) => setError(errText(e)));
  }, [bot.id]);
  const saveHosts = async () => {
    setError(null); setSaved(false);
    try { const r = await api<{ testHosts: string[] }>("PUT", `/bots/${bot.id}/security/test-hosts`, { hosts }); setHosts(r.testHosts.join("\n")); setSaved(true); } catch (e) { setError(errText(e)); }
  };
  if (!data) return error ? <ErrorNote>{error}</ErrorNote> : <Loading />;
  return (
    <div className="settings-pane">
      <h3 className="pane-heading">{t("security.netJournal")}</h3>
      <p className="muted small">{t("security.netJournalHint", { name: bot.name })}</p>
      {data.hosts.length === 0 ? <p className="muted small">{t("security.netEmpty")}</p> : (
        <ul className="list net-journal">
          {data.hosts.map((h) => (
            <li key={h.host} className="list-row">
              <div className="list-row-text">
                <span className="list-row-title">
                  <span className="mono truncate">{h.host}</span>
                  {h.fresh && <span className="chip state-working">{t("security.new")}</span>}
                  {h.tainted && <span className="chip state-warn" title={t("security.afterOutsideHint")}>{t("security.afterOutside")}</span>}
                </span>
                <span className="list-row-sub">{t(`security.via.${h.via}` as never)} · {t("security.seen", { n: String(h.count), first: relTime(h.firstAt), last: relTime(h.lastAt) })}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <h3 className="pane-heading">{t("security.testHosts")}</h3>
      <div className="field">
        <label className="field-label" htmlFor={`test-hosts-${bot.id}`}>{t("security.testHostsLabel")}</label>
        <textarea id={`test-hosts-${bot.id}`} className="input mono" rows={3} value={hosts} onChange={(e) => setHosts(e.target.value)} placeholder={"mon-site.fr\nstaging.mon-site.fr"} />
        <p className="field-hint">{t("security.testHostsHint")}</p>
        <div className="row-end">{saved && <span className="muted small" role="status">{t("common.saved")}</span>}<button type="button" className="btn btn-small" onClick={() => void saveHosts()}>{t("common.save")}</button></div>
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </div>
  );
}

/** Bot settings → Email → « Destinataires autorisés » (L42). */
export function BotRecipientsBlock({ bot }: { bot: Bot }) {
  const t = useT();
  const [owner, setOwner] = useState("");
  const [list, setList] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { void api<{ owner: string; recipients: string[] }>("GET", `/bots/${bot.id}/email/recipients`).then((r) => { setOwner(r.owner); setList(r.recipients.join("\n")); }, (e) => setError(errText(e))); }, [bot.id]);
  const save = async () => {
    setError(null); setSaved(false);
    try { const r = await api<{ owner: string; recipients: string[] }>("PUT", `/bots/${bot.id}/email/recipients`, { recipients: list ?? "" }); setList(r.recipients.join("\n")); setSaved(true); } catch (e) { setError(errText(e)); }
  };
  if (list === null) return error ? <ErrorNote>{error}</ErrorNote> : null;
  return (
    <div className="field">
      <label className="field-label" htmlFor={`recipients-${bot.id}`}>{t("security.recipients")}</label>
      <p className="field-hint">{t("security.recipientsOwner", { email: owner })}</p>
      <textarea id={`recipients-${bot.id}`} className="input mono" rows={3} value={list} onChange={(e) => setList(e.target.value)} placeholder={"camille@client.fr\n@partenaire.fr"} />
      <p className="field-hint">{t("security.recipientsHint")}</p>
      <div className="row-end">{saved && <span className="muted small" role="status">{t("common.saved")}</span>}<button type="button" className="btn btn-small" onClick={() => void save()}>{t("common.save")}</button></div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </div>
  );
}

interface VaultUse { botId: string | null; botName: string; tool: string; host: string; ok: boolean; at: number }

/** Vault → an item being edited → which bots may use it, "ask every time", and its usage history (L41). */
export function VaultAccessBlock({ item }: { item: VaultItem }) {
  const t = useT();
  const bots = useStore((s) => s.bots);
  const mine = Object.values(bots).filter((b) => b.kind === "agent" && !b.access);
  const [access, setAccess] = useState<{ bots: string[]; askEveryTime: boolean } | null>(null);
  const [history, setHistory] = useState<VaultUse[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api<{ access: { bots: string[]; askEveryTime: boolean }; history: VaultUse[] }>("GET", `/vault/${item.id}/access`).then((r) => { setAccess(r.access); setHistory(r.history); }, (e) => setError(errText(e))); }, [item.id]);
  const save = async (patch: { bots?: string[]; askEveryTime?: boolean }) => {
    setError(null);
    try { const r = await api<{ access: { bots: string[]; askEveryTime: boolean }; history: VaultUse[] }>("PUT", `/vault/${item.id}/access`, patch); setAccess(r.access); setHistory(r.history); } catch (e) { setError(errText(e)); }
  };
  if (!access) return error ? <ErrorNote>{error}</ErrorNote> : null;
  const toggleBot = (id: string, on: boolean) => void save({ bots: on ? [...access.bots, id] : access.bots.filter((b) => b !== id) });
  return (
    <div className="vault-access">
      <p className="field-label">{t("security.vaultBots")}</p>
      <p className="field-hint">{t(access.bots.length ? "security.vaultBotsSome" : "security.vaultBotsAll")}</p>
      <div className="chip-row">
        {mine.map((b) => (
          <label key={b.id} className="check-chip">
            <input type="checkbox" checked={access.bots.includes(b.id)} onChange={(e) => toggleBot(b.id, e.target.checked)} /> {b.name}
          </label>
        ))}
      </div>
      <div className="action-row">
        <div><p className="action-title">{t("security.askEvery")}</p><p className="muted small">{t("security.askEveryHint")}</p></div>
        <Toggle checked={access.askEveryTime} label={t("security.askEvery")} onChange={(next) => void save({ askEveryTime: next })} />
      </div>
      <p className="field-label">{t("security.vaultHistory")}</p>
      {history.length === 0 ? <p className="muted small">{t("security.vaultHistoryEmpty")}</p> : (
        <ul className="list vault-history">
          {history.slice(0, 20).map((h, i) => (
            <li key={i} className="list-row-sub">
              <Icon name={h.ok ? "check" : "close"} size={12} /> {h.botName || "—"} · <span className="mono">{h.tool}</span>{h.host ? ` · ${h.host}` : ""} · {relTime(h.at)}
            </li>
          ))}
        </ul>
      )}
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </div>
  );
}
