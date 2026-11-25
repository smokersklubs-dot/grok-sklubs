import { useEffect, useId, useState } from "react";
import { api, errText } from "../api";
import { useT, type Key } from "../i18n";
import type { Bot } from "../types";
import { ErrorNote } from "./ui";
import "./OpenAccess.css";

/* L169 — Bot settings → Sécurité → « Sortie Internet » (server: botroute.ts, botrouteroutes.ts): direct, a proxy of the
 * owner's (its login is sent once and never shown again), the owner's home connection through the Relais or Tailscale,
 * a « Tester » button, and Web Bot Auth (signed visits, off by default, never through the home exit unless ticked). */

type Route = "direct" | "proxy" | "relay" | "tailscale";
export interface EgressView {
  route: Route; proxy: { address: string; hasLogin: boolean } | null; deviceId: string | null;
  sign: boolean; signHome: boolean; canSign: boolean; directoryUrl: string; keyId: string | null;
  tailscale: boolean; browser: "yes" | "relay" | "direct" | "network_mode" | "not_linux";
  devices: Array<{ id: string; name: string; online: boolean; capable: boolean }>;
}
interface TestResult { ok: boolean; ip?: string; ms: number; error?: string }

export function BotEgressBlock({ bot, initial }: { bot: Bot; initial?: EgressView }) {
  const t = useT();
  const uid = useId();
  const [e, setE] = useState<EgressView | null>(initial ?? null);
  const [route, setRoute] = useState<Route>(initial?.route ?? "direct");
  const [address, setAddress] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [device, setDevice] = useState(initial?.deviceId ?? "");
  const [test, setTest] = useState<TestResult | "running" | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const take = (v: EgressView) => { setE(v); setRoute(v.route); setDevice(v.deviceId ?? v.devices[0]?.id ?? ""); };
  useEffect(() => { if (!initial) void api<{ egress: EgressView }>("GET", `/bots/${bot.id}/egress`).then((r) => r?.egress && take(r.egress), (err) => setError(errText(err))); }, [bot.id]);
  const put = async (body: Record<string, unknown>) => {
    setError(null); setSaved(false); setTest(null);
    try { const r = await api<{ egress: EgressView }>("PUT", `/bots/${bot.id}/egress`, body); take(r.egress); setSaved(true); setPassword(""); return true; } catch (err) { setError(errText(err)); if (e) setRoute(e.route); return false; }
  };
  const forget = async () => {
    setError(null); setSaved(false);
    try { const r = await api<{ egress: EgressView }>("DELETE", `/bots/${bot.id}/egress/proxy`); take(r.egress); setAddress(""); setUser(""); setPassword(""); } catch (err) { setError(errText(err)); }
  };
  const runTest = async () => {
    setError(null); setTest("running");
    try { const r = await api<{ test: TestResult }>("POST", `/bots/${bot.id}/egress/test`); setTest(r.test); } catch (err) { setTest(null); setError(errText(err)); }
  };
  if (!e) return error ? <ErrorNote>{error}</ErrorNote> : null;
  const routes: Route[] = ["direct", "proxy", "relay", ...(e.tailscale ? (["tailscale"] as Route[]) : [])];
  const choose = (r: Route) => {
    setRoute(r); setSaved(false); setTest(null);
    if (r === "direct" || r === "tailscale") void put({ route: r });
    if (r === "proxy" && e.proxy) void put({ route: r });
    if (r === "relay" && e.devices.length === 1) void put({ route: r, deviceId: e.devices[0].id });
  };
  const saveProxy = () => void put({ route: "proxy", ...(address.trim() ? { proxy: address.trim() } : {}), ...(user.trim() ? { username: user.trim(), password } : {}) });
  const home = route === "relay" || route === "tailscale";
  const dev = e.devices.find((d) => d.id === device);
  return (
    <>
      <h3 className="pane-heading">{t("netexit.title")}</h3>
      <p className="muted small">{t("netexit.hint", { name: bot.name })}</p>
      <div className="seg-tabs open-net-modes" role="radiogroup" aria-label={t("netexit.title")}>
        {routes.map((r) => (
          <button key={r} type="button" role="radio" aria-checked={route === r} className={`seg-tab ${route === r ? "is-active" : ""}`} onClick={() => choose(r)}>{t(`netexit.route.${r}` as Key)}</button>
        ))}
      </div>

      {route === "proxy" && (
        <div className="field">
          {e.proxy && <p className="small">{t("netexit.current", { address: e.proxy.address })}{e.proxy.hasLogin ? ` · ${t("netexit.hasLogin")}` : ""}</p>}
          <label className="field-label" htmlFor={`${uid}a`}>{t("netexit.address")}</label>
          <input id={`${uid}a`} className="input mono" value={address} onChange={(ev) => setAddress(ev.target.value)} placeholder="socks5://proxy.example.com:1080" autoComplete="off" spellCheck={false} />
          <p className="field-hint">{t("netexit.addressHint")}</p>
          <label className="field-label" htmlFor={`${uid}u`}>{t("netexit.user")}</label>
          <input id={`${uid}u`} className="input" value={user} onChange={(ev) => setUser(ev.target.value)} autoComplete="off" spellCheck={false} />
          <label className="field-label" htmlFor={`${uid}p`}>{t("netexit.password")}</label>
          <input id={`${uid}p`} className="input" type="password" placeholder={e.proxy?.hasLogin ? t("netexit.passwordSaved") : ""} value={password} onChange={(ev) => setPassword(ev.target.value)} autoComplete="new-password" />
          <div className="row-end">
            {saved && <span className="muted small" role="status">{t("common.saved")}</span>}
            {e.proxy && <button type="button" className="btn btn-small btn-ghost" onClick={() => void forget()}>{t("netexit.forget")}</button>}
            <button type="button" className="btn btn-small" disabled={!address.trim() && !e.proxy} onClick={saveProxy}>{t("common.save")}</button>
          </div>
        </div>
      )}

      {route === "relay" && (
        <div className="field">
          {e.devices.length === 0 ? <p className="small">{t("netexit.relayNone")}</p> : (
            <>
              <label className="field-label" htmlFor={`${uid}d`}>{t("netexit.relayDevice")}</label>
              <div className="open-row">
                <select id={`${uid}d`} className="input" value={device} onChange={(ev) => setDevice(ev.target.value)}>
                  {e.devices.map((d) => <option key={d.id} value={d.id}>{d.name}{d.online ? "" : ` (${t("netexit.offline")})`}</option>)}
                </select>
                <button type="button" className="btn btn-small" onClick={() => void put({ route: "relay", deviceId: device })}>{t("common.save")}</button>
              </div>
              {dev && !dev.capable && dev.online && <p className="field-hint">{t("netexit.relayOld")}</p>}
              {saved && <p className="muted small" role="status">{t("common.saved")}</p>}
            </>
          )}
        </div>
      )}
      {route === "tailscale" && <p className="small">{t("netexit.tailscaleHint")}</p>}
      {home && <p className="callout is-warn small open-warn">{t("netexit.homeWarn")}</p>}
      {route !== "direct" && <p className="field-hint">{t(`netexit.browser.${e.browser === "yes" ? "yes" : e.browser}` as Key)}</p>}
      {route !== "direct" && (
        <div className="row-end">
          {test && test !== "running" && <span className={`small ${test.ok ? "" : "warn-text"}`} role="status">{test.ok ? (test.ip ? t("netexit.testOk", { ip: test.ip, ms: test.ms }) : t("netexit.testOkNoIp", { ms: test.ms })) : test.error}</span>}
          <button type="button" className="btn btn-small" disabled={test === "running"} onClick={() => void runTest()}>{test === "running" ? t("netexit.testing") : t("netexit.test")}</button>
        </div>
      )}

      <div className="field">
        <label className="check-row small">
          <input type="checkbox" checked={e.sign} disabled={!e.canSign && !e.sign} onChange={(ev) => void put({ sign: ev.target.checked })} />
          <span>{t("netexit.sign")}</span>
        </label>
        <p className="field-hint">{e.canSign ? t("netexit.signHint") : t("netexit.signNo")}</p>
        {e.sign && home && (
          <label className="check-row small">
            <input type="checkbox" checked={e.signHome} onChange={(ev) => void put({ signHome: ev.target.checked })} />
            <span>{t("netexit.signHome")}</span>
          </label>
        )}
        {e.sign && home && <p className="field-hint">{t("netexit.signHomeHint")}</p>}
        {e.sign && <p className="field-hint mono open-dir">{t("netexit.signDir", { url: e.directoryUrl })}</p>}
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </>
  );
}
