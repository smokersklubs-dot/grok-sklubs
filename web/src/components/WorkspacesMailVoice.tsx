import { useEffect, useId, useState, type FormEvent } from "react";
import { RealtimeVoice } from "./RealtimeVoice"; // L167
import { VoicePlus } from "./VoicePlus"; // L154 wake word, reminder calls
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Bot, BotEmail, InboundMail, MailRelay, VoiceSettings, VoiceStatus, Workspace, WorkspaceAdmin, WorkspaceMember, WorkspaceRole } from "../types";
import { money, relTime } from "../lib/format";
import { Icon } from "./Icon";
import { ConfirmButton, CopyButton, ErrorNote, Loading, Toggle } from "./ui";
import { useVT } from "./VoicePicker";
import { BotVoicesSection } from "./BotVoices"; import { BotRecipientsBlock } from "./SecurityLot1";

/* =====================================================================================
 * Workspaces: members, roles, invitations, shared bots, usage per member, export (wave 6)
 * ===================================================================================== */

const ROLES: WorkspaceRole[] = ["owner", "admin", "member", "viewer"];
const INVITABLE: Exclude<WorkspaceRole, "owner">[] = ["admin", "member", "viewer"];

export function WorkspacesSection() {
  const t = useT();
  const me = useStore((s) => s.user);
  const [list, setList] = useState<Workspace[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const tick = useStore((s) => s.workspacesTick);
  const load = () => api<{ workspaces: Workspace[] }>("GET", "/workspaces").then((r) => { setList(r.workspaces); setOpen((o) => o ?? r.workspaces[0]?.id ?? null); }, (e) => setError(errText(e)));
  useEffect(() => { void load(); }, [tick]);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ workspace: Workspace }>("POST", "/workspaces", { name });
      setName("");
      setOpen(r.workspace.id);
      void load();
    } catch (err) { setError(errText(err)); }
  };
  const current = list?.find((w) => w.id === open) ?? null;
  return (
    <>
      <h2>{t("settings.section.workspaces")}</h2>
      <p className="muted">{t("ws.intro")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {!list ? <Loading /> : (
        <>
          {list.length > 0 && (
            <div className="ws-tabs" role="tablist">
              {list.map((w) => (
                <button key={w.id} type="button" role="tab" aria-selected={w.id === open} className={`chip ws-tab ${w.id === open ? "is-active" : ""}`} onClick={() => setOpen(w.id)}>
                  <Icon name="users" size={13} /> {w.name} <span className="muted small">· {t(`ws.role.${w.role}`)}</span>
                </button>
              ))}
            </div>
          )}
          <form className="field-inline ws-create" onSubmit={create}>
            <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t("ws.newPlaceholder")} aria-label={t("ws.newPlaceholder")} />
            <button type="submit" className="btn btn-small" disabled={!name.trim()}><Icon name="plus" size={14} /> {t("ws.create")}</button>
          </form>
          {current && me && <WorkspacePanel key={current.id} ws={current} meId={me.id} onChange={load} onGone={() => { setOpen(null); void load(); }} />}
          {list.length === 0 && <p className="muted small">{t("ws.none")}</p>}
          <p className="muted small ws-sso"><Icon name="info" size={13} /> {t("ws.sso")}</p>
        </>
      )}
    </>
  );
}

function WorkspacePanel({ ws, meId, onChange, onGone }: { ws: Workspace; meId: string; onChange: () => void; onGone: () => void }) {
  const t = useT();
  const admin = ws.role === "owner" || ws.role === "admin";
  const [data, setData] = useState<WorkspaceAdmin | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<WorkspaceRole, "owner">>("member");
  const [link, setLink] = useState<string | null>(null);
  const [seats, setSeats] = useState(String(ws.seats));
  const uid = useId();
  const tick = useStore((s) => s.workspacesTick);
  const load = () => (admin
    ? api<WorkspaceAdmin>("GET", `/workspaces/${ws.id}/admin`).then((d) => { setData(d); setMembers(d.members); }, (e) => setError(errText(e)))
    : api<{ members: WorkspaceMember[] }>("GET", `/workspaces/${ws.id}/members`).then((d) => setMembers(d.members), (e) => setError(errText(e))));
  useEffect(() => { void load(); }, [ws.id, tick]);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); void load(); onChange(); } catch (e) { setError(errText(e)); }
  };
  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ invite: { link: string } }>("POST", `/workspaces/${ws.id}/invites`, { email, role });
      setLink(r.invite.link);
      setEmail("");
      void load();
    } catch (err) { setError(errText(err)); }
  };
  const canSet = (target: WorkspaceMember) => target.userId !== meId && target.role !== "owner" && (ws.role === "owner" || (ws.role === "admin" && (target.role === "member" || target.role === "viewer")));
  const usage = new Map((data?.usage ?? []).map((u) => [u.userId, u]));
  return (
    <section className="ws-panel" aria-label={ws.name}>
      <div className="ws-head">
        <div>
          <h3 className="pane-heading">{ws.name}</h3>
          <p className="muted small">{t("ws.summary", { n: ws.memberCount, seats: ws.seats, role: t(`ws.role.${ws.role}`) })}</p>
        </div>
        <div className="row-gap">
          {admin && <a className="btn btn-small" href={`/api/workspaces/${enc(ws.id)}/export`} download><Icon name="download" size={14} /> {t("ws.export")}</a>}
          {ws.role === "owner"
            ? <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("ws.delete")} confirmLabel={t("common.confirmDelete")} onConfirm={() => act(async () => { await api("DELETE", `/workspaces/${ws.id}`); onGone(); })} />
            : <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("ws.leave")} confirmLabel={t("common.confirmAgain")} onConfirm={() => act(async () => { await api("DELETE", `/workspaces/${ws.id}/members/${meId}`); onGone(); })} />}
        </div>
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      <div className="ws-perms" aria-label={t("ws.permsAria")}>
        {ROLES.map((r) => <p key={r} className="small"><span className={`chip role-${r}`}>{t(`ws.role.${r}`)}</span> {t(`ws.perm.${r}`)}</p>)}
      </div>

      <h4 className="pane-subheading">{t("ws.members")}</h4>
      {!members ? <Loading /> : (
        <div className="table-wrap">
          <table className="table ws-members">
            <thead>
              <tr>
                <th scope="col">{t("ws.colMember")}</th><th scope="col">{t("ws.colRole")}</th>
                {admin && <><th scope="col" className="num">{t("ws.colMessages")}</th><th scope="col" className="num">{t("ws.colCost")}</th><th scope="col">{t("ws.colActive")}</th><th scope="col" /></>}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const u = usage.get(m.userId);
                return (
                  <tr key={m.userId}>
                    <th scope="row"><span className="ws-member-name">{m.name || m.email}</span><span className="muted small"> {m.email}</span></th>
                    <td>
                      {admin && canSet(m) ? (
                        <select className="input input-small" value={m.role} aria-label={t("ws.roleOf", { name: m.name })} onChange={(e) => void act(() => api("PUT", `/workspaces/${ws.id}/members/${m.userId}`, { role: e.target.value }))}>
                          {(ws.role === "owner" ? INVITABLE : (["member", "viewer"] as const)).map((r) => <option key={r} value={r}>{t(`ws.role.${r}`)}</option>)}
                        </select>
                      ) : <span className={`chip role-${m.role}`}>{t(`ws.role.${m.role}`)}</span>}
                    </td>
                    {admin && (
                      <>
                        <td className="num">{u?.messages ?? 0}</td>
                        <td className="num">{money(u?.costUsd ?? 0)}</td>
                        <td className="muted small">{u?.lastActiveAt ? relTime(u.lastActiveAt) : "—"}</td>
                        <td className="row-end">
                          {canSet(m) && (
                            <>
                              <ConfirmButton className="btn btn-small btn-ghost" label={t("ws.remove")} confirmLabel={t("common.confirmAgain")} onConfirm={() => act(() => api("DELETE", `/workspaces/${ws.id}/members/${m.userId}`))} />
                              <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("ws.purge")} confirmLabel={t("ws.purgeConfirm")} title={t("ws.purgeTitle")} onConfirm={() => act(() => api("DELETE", `/workspaces/${ws.id}/members/${m.userId}?purge=1`))} />
                            </>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {admin && (
        <>
          <h4 className="pane-subheading">{t("ws.invite")}</h4>
          <form className="field-inline ws-invite" onSubmit={invite}>
            <input id={`${uid}e`} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("ws.invitePlaceholder")} aria-label={t("ws.invitePlaceholder")} />
            <select className="input input-small" value={role} onChange={(e) => setRole(e.target.value as typeof role)} aria-label={t("ws.colRole")}>
              {(ws.role === "owner" ? INVITABLE : (["member", "viewer"] as const)).map((r) => <option key={r} value={r}>{t(`ws.role.${r}`)}</option>)}
            </select>
            <button type="submit" className="btn btn-primary btn-small" disabled={!email.includes("@")}>{t("ws.inviteBtn")}</button>
          </form>
          {link && (
            <div className="ws-link" role="status">
              <p className="small">{t("ws.linkReady")}</p>
              <div className="field-inline"><input className="input mono" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={t("ws.linkReady")} /><CopyButton text={link} /></div>
            </div>
          )}
          {data && data.invites.length > 0 && (
            <ul className="list">
              {data.invites.map((i) => (
                <li key={i.id} className="list-row">
                  <div className="list-row-text"><span className="list-row-title">{i.email} <span className={`chip role-${i.role}`}>{t(`ws.role.${i.role}`)}</span></span><span className="list-row-sub">{t("ws.expires", { when: relTime(i.expiresAt) })}</span></div>
                  <ConfirmButton className="btn btn-small btn-ghost" label={t("ws.revoke")} confirmLabel={t("common.confirmAgain")} onConfirm={() => act(() => api("DELETE", `/workspaces/${ws.id}/invites/${i.id}`))} />
                </li>
              ))}
            </ul>
          )}
          {ws.role === "owner" && (
            <div className="field-inline ws-seats">
              <label className="field-label" htmlFor={`${uid}s`}>{t("ws.seats")}</label>
              <input id={`${uid}s`} className="input input-small" type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} />
              <button type="button" className="btn btn-small" disabled={Number(seats) === ws.seats} onClick={() => void act(() => api("PATCH", `/workspaces/${ws.id}`, { seats: Number(seats) }))}>{t("common.save")}</button>
            </div>
          )}
          <h4 className="pane-subheading">{t("ws.sharedBots")}</h4>
          {!data || data.bots.length === 0 ? <p className="muted small">{t("ws.noBots")}</p> : (
            <ul className="list">
              {data.bots.map((b) => (
                <li key={b.id} className="list-row">
                  <span className="logo-tile" aria-hidden="true"><Icon name="users" size={16} /></span>
                  <div className="list-row-text">
                    <span className="list-row-title">{b.name}</span>
                    <span className="list-row-sub">{t("ws.botLine", { owner: b.ownerName, access: b.share.access === "all" ? t("share.all") : t("share.listN", { n: b.share.memberIds.length }), approvals: t(`share.approvals.${b.share.approvals}`) })}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {data && data.resources.length > 0 && (
            <>
              <h4 className="pane-subheading">{t("ws.resources")}</h4>
              <ul className="list">
                {data.resources.map((r) => (
                  <li key={`${r.kind}:${r.id}`} className="list-row">
                    <span className="logo-tile" aria-hidden="true"><Icon name={r.kind === "vault" ? "key" : "plug"} size={16} /></span>
                    <div className="list-row-text"><span className="list-row-title">{r.name}</span><span className="list-row-sub">{t("ws.sharedBy", { name: r.sharedByName })}</span></div>
                    <ConfirmButton className="btn btn-small btn-ghost" label={t("ws.unshare")} confirmLabel={t("common.confirmAgain")} onConfirm={() => act(() => api("DELETE", `/workspaces/${ws.id}/resources/${r.kind}/${r.id}`))} />
                  </li>
                ))}
              </ul>
            </>
          )}
          <h4 className="pane-subheading">{t("ws.audit")}</h4>
          {!data || data.audit.length === 0 ? <p className="muted small">{t("ws.noAudit")}</p> : (
            <ul className="list ws-audit">
              {data.audit.slice(0, 30).map((a) => (
                <li key={a.id} className="list-row small"><span className="muted">{relTime(a.at)}</span> <b>{a.actorName}</b> <span>{a.text}</span></li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/* ---------- Sharing one of your bots (bot settings) ---------- */

export function BotSharingTab({ bot }: { bot: Bot }) {
  const t = useT();
  const [list, setList] = useState<Workspace[] | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [wsId, setWsId] = useState(bot.sharing?.workspaceId ?? "");
  const [access, setAccess] = useState<"all" | "list">(bot.sharing?.access ?? "all");
  const [picked, setPicked] = useState<string[]>(bot.sharing?.memberIds ?? []);
  const [approvals, setApprovals] = useState(bot.sharing?.approvals ?? "owner");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const me = useStore((s) => s.user);
  useEffect(() => { void api<{ workspaces: Workspace[] }>("GET", "/workspaces").then((r) => { setList(r.workspaces); setWsId((w) => w || r.workspaces[0]?.id || ""); }, (e) => setError(errText(e))); }, []);
  useEffect(() => { if (wsId) void api<{ members: WorkspaceMember[] }>("GET", `/workspaces/${wsId}/members`).then((r) => setMembers(r.members), () => setMembers([])); }, [wsId]);
  const save = async () => {
    setError(null);
    setDone(false);
    try { await api("PUT", `/bots/${bot.id}/share`, { workspaceId: wsId, access, memberIds: picked, approvals }); setDone(true); } catch (e) { setError(errText(e)); }
  };
  const stop = async () => {
    setError(null);
    try { await api("DELETE", `/bots/${bot.id}/share`); setDone(false); } catch (e) { setError(errText(e)); }
  };
  if (!list) return <Loading />;
  if (!list.length) return <div className="settings-pane"><p className="muted">{t("share.noWorkspace")}</p><button type="button" className="btn btn-small" onClick={() => { useStore.getState().closeBotSettings(); useStore.getState().openAppSettings("workspaces"); }}>{t("share.createWorkspace")}</button></div>;
  return (
    <div className="settings-pane">
      <p className="muted">{t("share.intro", { name: bot.name })}</p>
      <div className="field">
        <label className="field-label">{t("share.workspace")}</label>
        <select className="input" value={wsId} onChange={(e) => setWsId(e.target.value)}>
          {list.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      <fieldset className="field">
        <legend className="field-label">{t("share.who")}</legend>
        <label className="radio-row"><input type="radio" checked={access === "all"} onChange={() => setAccess("all")} /> {t("share.all")}</label>
        <label className="radio-row"><input type="radio" checked={access === "list"} onChange={() => setAccess("list")} /> {t("share.list")}</label>
        {access === "list" && (
          <div className="share-members">
            {members.filter((m) => m.userId !== me?.id).map((m) => (
              <label key={m.userId} className="check-row">
                <input type="checkbox" checked={picked.includes(m.userId)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, m.userId] : p.filter((x) => x !== m.userId)))} />
                {m.name} <span className="muted small">{m.email} · {t(`ws.role.${m.role}`)}</span>
              </label>
            ))}
            <p className="field-hint">{t("share.adminsAlways")}</p>
          </div>
        )}
      </fieldset>
      <fieldset className="field">
        <legend className="field-label">{t("share.approvals")}</legend>
        <label className="radio-row"><input type="radio" checked={approvals === "owner"} onChange={() => setApprovals("owner")} /> {t("share.approvals.owner")}</label>
        <label className="radio-row"><input type="radio" checked={approvals === "owner_or_admins"} onChange={() => setApprovals("owner_or_admins")} /> {t("share.approvals.owner_or_admins")}</label>
      </fieldset>
      <p className="muted small"><Icon name="shield" size={13} /> {t("share.safety")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      <div className="row-end">
        {bot.sharing && <button type="button" className="btn btn-small btn-ghost" onClick={() => void stop()}>{t("share.stop")}</button>}
        <button type="button" className="btn btn-primary btn-small" disabled={!wsId} onClick={() => void save()}>{t("share.save")}</button>
        {done && <span className="muted small" role="status">{t("common.saved")}</span>}
      </div>
    </div>
  );
}

/** Shown on a bot someone shares with you: whose it is, which workspace, your role. */
export function SharedBadge({ bot }: { bot: Bot }) {
  const t = useT();
  if (!bot.access) return null;
  return (
    <span className="chip shared-badge" title={t("ws.sharedTitle", { owner: bot.access.ownerName, ws: bot.access.workspaceName })}>
      <Icon name="users" size={12} /> {bot.access.workspaceName} · {t(`ws.role.${bot.access.role}`)}
    </span>
  );
}

/* =====================================================================================
 * Voice (server-mediated calls): providers and barge-in (wave 6)
 * ===================================================================================== */

export function VoiceSection() {
  const t = useT();
  const [s, setS] = useState<VoiceSettings | null>(null);
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [sttKey, setSttKey] = useState("");
  const [ttsKey, setTtsKey] = useState("");
  const [fishKey, setFishKey] = useState("");
  const vt = useVT();
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<{ settings: VoiceSettings; status: VoiceStatus }>("GET", "/voice").then((r) => { setS(r.settings); setStatus(r.status); }, (e) => setError(errText(e))); }, []);
  if (!s) return <><h2>{t("settings.section.voice")}</h2>{error ? <ErrorNote>{error}</ErrorNote> : <Loading />}</>;
  const set = (p: Partial<VoiceSettings>) => setS({ ...s, ...p });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ settings: VoiceSettings; status: VoiceStatus }>("PUT", "/voice", { mode: s.mode, stt: { provider: s.stt.provider, url: s.stt.url, model: s.stt.model, language: s.stt.language }, tts: { provider: s.tts.provider, url: s.tts.url, model: s.tts.model, voice: s.tts.voice }, bargeIn: s.bargeIn, ...(sttKey ? { sttKey } : {}), ...(ttsKey ? { ttsKey } : {}), ...(fishKey ? { fishKey } : {}) });
      setS(r.settings); setStatus(r.status); setSttKey(""); setTtsKey(""); setFishKey("");
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const runTest = async () => {
    setTest(t("voice.testing"));
    try {
      const r = await api<{ ok: boolean; heard?: string; ttsMs?: number; sttMs?: number; error?: string }>("POST", "/voice/test");
      setTest(r.ok ? t("voice.testOk", { heard: r.heard ?? "", tts: r.ttsMs ?? 0, stt: r.sttMs ?? 0 }) : t("voice.testFail", { error: r.error ?? "" }));
    } catch (e) { setTest(t("voice.testFail", { error: errText(e) })); }
  };
  return (
    <>
      <h2>{t("settings.section.voice")}</h2>
      <p className="muted">{t("voice.intro")}</p>
      {status && (
        <div className={`voice-status is-${status.mode}`} role="status">
          <Icon name={status.mode === "server" ? "wave" : "mic"} size={16} />
          <span>{status.mode === "server" ? t("voice.statusServer", { stt: status.stt ?? "", tts: status.tts ?? "" }) : t("voice.statusBrowser", { reason: status.reason })}</span>
        </div>
      )}
      {status && <p className="muted small" role="status">{t(status.dictation ? "voice.dictationOn" : "voice.dictationOff")}</p>}
      {status && <BotVoicesSection key={`${status.mode}:${s.tts.provider}`} serverMode={status.mode === "server"} />}
      <fieldset className="field">
        <legend className="field-label">{t("voice.mode")}</legend>
        {(["auto", "server", "browser"] as const).map((m) => <label key={m} className="radio-row"><input type="radio" checked={s.mode === m} onChange={() => set({ mode: m })} /> {t(`voice.mode.${m}`)}</label>)}
      </fieldset>
      <div className="voice-grid">
        <div className="voice-card">
          <h3 className="pane-heading"><Icon name="mic" size={15} /> {t("voice.stt")}</h3>
          <select className="input" value={s.stt.provider} onChange={(e) => set({ stt: { ...s.stt, provider: e.target.value as VoiceSettings["stt"]["provider"] } })} aria-label={t("voice.stt")}>
            <option value="whisper-cpp">{t("voice.provider.whisper-cpp")}</option>
            <option value="openai">{t("voice.provider.openai-stt")}</option>
            <option value="fish">{vt("providerFishStt")}</option>
          </select>
          {s.stt.provider !== "fish" && <input className="input" value={s.stt.url} onChange={(e) => set({ stt: { ...s.stt, url: e.target.value } })} placeholder={s.stt.provider === "openai" ? "https://api.openai.com" : t("voice.urlServer")} aria-label={t("voice.url")} />}
          <div className="field-inline">
            <input className="input" value={s.stt.model} onChange={(e) => set({ stt: { ...s.stt, model: e.target.value } })} placeholder={s.stt.provider === "openai" ? "gpt-4o-mini-transcribe" : s.stt.provider === "fish" ? "transcribe-1-pro" : t("voice.modelServer")} aria-label={t("voice.model")} />
            <input className="input input-small" value={s.stt.language} onChange={(e) => set({ stt: { ...s.stt, language: e.target.value } })} placeholder="auto" aria-label={t("voice.language")} />
          </div>
          {s.stt.provider === "openai" && <input className="input" type="password" value={sttKey} onChange={(e) => setSttKey(e.target.value)} placeholder={s.stt.hasKey ? t("voice.keySaved") : t("voice.key")} autoComplete="off" aria-label={t("voice.key")} />}
          {s.stt.provider === "fish" && s.tts.provider !== "fish" && <input className="input" type="password" value={fishKey} onChange={(e) => setFishKey(e.target.value)} placeholder={s.fish?.hasKey ? vt("fishKeySaved") : vt("fishKey")} autoComplete="off" aria-label={vt("fishKey")} />}
          <p className="field-hint">{s.stt.provider === "fish" ? vt("hintFish") : t(s.stt.provider === "openai" ? "voice.hint.openai" : "voice.hint.whisper")}</p>
        </div>
        <div className="voice-card">
          <h3 className="pane-heading"><Icon name="wave" size={15} /> {t("voice.tts")}</h3>
          <select className="input" value={s.tts.provider} onChange={(e) => set({ tts: { ...s.tts, provider: e.target.value as VoiceSettings["tts"]["provider"] } })} aria-label={t("voice.tts")}>
            <option value="piper">{t("voice.provider.piper")}</option>
            <option value="openai">{t("voice.provider.openai-tts")}</option>
            <option value="fish">{vt("providerFishTts")}</option>
            <option value="kokoro">{vt("providerKokoro")}</option>
          </select>
          {s.tts.provider !== "fish" && <input className="input" value={s.tts.url} onChange={(e) => set({ tts: { ...s.tts, url: e.target.value } })} placeholder={s.tts.provider === "openai" ? "https://api.openai.com" : s.tts.provider === "kokoro" ? vt("kokoroUrlPh") : t("voice.urlServer")} aria-label={t("voice.url")} />}
          <div className="field-inline">
            <input className="input" value={s.tts.voice} onChange={(e) => set({ tts: { ...s.tts, voice: e.target.value } })} placeholder={s.tts.provider === "openai" ? "marin" : s.tts.provider === "fish" ? vt("fishVoicePh") : s.tts.provider === "kokoro" ? vt("kokoroVoicePh") : "fr_FR-siwis-medium"} aria-label={t("voice.voice")} />
            {s.tts.provider === "openai" && <input className="input" value={s.tts.model} onChange={(e) => set({ tts: { ...s.tts, model: e.target.value } })} placeholder="gpt-4o-mini-tts" aria-label={t("voice.model")} />}
            {s.tts.provider === "fish" && (
              <select className="input" value={s.tts.model || "s2.1-pro"} onChange={(e) => set({ tts: { ...s.tts, model: e.target.value } })} aria-label={vt("fishModel")}>
                <option value="s2.1-pro">s2.1-pro</option>
                <option value="s2.1-pro-free">{vt("fishModelFree")}</option>
                <option value="s2-pro">s2-pro</option>
                <option value="drama-3">drama-3</option>
              </select>
            )}
          </div>
          {s.tts.provider === "openai" && <input className="input" type="password" value={ttsKey} onChange={(e) => setTtsKey(e.target.value)} placeholder={s.tts.hasKey ? t("voice.keySaved") : t("voice.key")} autoComplete="off" aria-label={t("voice.key")} />}
          {s.tts.provider === "fish" && <input className="input" type="password" value={fishKey} onChange={(e) => setFishKey(e.target.value)} placeholder={s.fish?.hasKey ? vt("fishKeySaved") : vt("fishKey")} autoComplete="off" aria-label={vt("fishKey")} />}
          <p className="field-hint">{s.tts.provider === "fish" ? vt("hintFish") : s.tts.provider === "kokoro" ? vt("hintKokoro") : t(s.tts.provider === "openai" ? "voice.hint.openai" : "voice.hint.piper")}</p>
        </div>
      </div>
      <div className="action-row">
        <div>
          <p className="action-title">{t("voice.bargeIn")}</p>
          <p className="muted small">{t("voice.bargeInHint")}</p>
        </div>
        <Toggle checked={s.bargeIn.enabled} label={t("voice.bargeIn")} onChange={(on) => set({ bargeIn: { ...s.bargeIn, enabled: on } })} />
      </div>
      <div className="field">
        <label className="field-label">{t("voice.sensitivity", { ms: s.bargeIn.minSpeechMs })}</label>
        <input type="range" min={100} max={1000} step={50} value={s.bargeIn.minSpeechMs} onChange={(e) => set({ bargeIn: { ...s.bargeIn, minSpeechMs: Number(e.target.value) } })} aria-label={t("voice.sensitivityAria")} />
      </div>
      <RealtimeVoice />
      <VoicePlus />
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      <div className="row-end">
        <button type="button" className="btn btn-small" onClick={() => void runTest()}>{t("voice.test")}</button>
        <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void save()}>{t(busy ? "common.saving" : "common.save")}</button>
      </div>
      {test && <p className="muted small" role="status">{test}</p>}
    </>
  );
}

/* =====================================================================================
 * Email: the server's mail domain and the account's relay (wave 6)
 * ===================================================================================== */

export function MailSection() {
  const t = useT();
  const [info, setInfo] = useState<{ domain: string | null; receiving: boolean; relay: MailRelay | null } | null>(null);
  const [f, setF] = useState({ host: "", port: "587", secure: false, username: "", password: "", fromDomain: "", dkimSelector: "", dkimKey: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const load = () => api<{ domain: string | null; receiving: boolean; relay: MailRelay | null }>("GET", "/mail").then((r) => {
    setInfo(r);
    if (r.relay) setF((x) => ({ ...x, host: r.relay!.host, port: String(r.relay!.port), secure: r.relay!.secure, username: r.relay!.username, fromDomain: r.relay!.fromDomain, dkimSelector: r.relay!.dkimSelector }));
  }, (e) => setError(errText(e)));
  useEffect(() => { void load(); }, []);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    try {
      await api("PUT", "/mail/relay", { host: f.host, port: Number(f.port), secure: f.secure, username: f.username, fromDomain: f.fromDomain, dkimSelector: f.dkimSelector, ...(f.password ? { password: f.password } : {}), ...(f.dkimKey ? { dkimKey: f.dkimKey } : {}) });
      setF((x) => ({ ...x, password: "", dkimKey: "" }));
      setDone(true);
      void load();
    } catch (err) { setError(errText(err)); }
  };
  return (
    <>
      <h2>{t("settings.section.email")}</h2>
      <p className="muted">{t("mail.intro")}</p>
      {!info ? <Loading /> : (
        <>
          <div className={`voice-status is-${info.receiving ? "server" : "browser"}`} role="status">
            <Icon name="mail" size={16} />
            <span>{info.receiving ? t("mail.receiving", { domain: info.domain ?? "" }) : info.domain ? t("mail.notListening", { domain: info.domain }) : t("mail.noDomain")}</span>
          </div>
          <h3 className="pane-heading">{t("mail.relay")}</h3>
          <p className="muted small">{t("mail.relayIntro")}</p>
          <p className="muted small">{t("mail.notServerMail")}</p>
          <form className="editor" onSubmit={save} autoComplete="off">
            <div className="form-cols is-even">
              <div className="field">
                <label className="field-label" htmlFor="relay-host">{t("mail.host")}</label>
                <input id="relay-host" className="input" value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="smtp.example.com" spellCheck={false} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="relay-port">{t("mail.port")}</label>
                <input id="relay-port" className="input" inputMode="numeric" value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} placeholder="587" />
              </div>
            </div>
            <label className="check-row"><input type="checkbox" checked={f.secure} onChange={(e) => setF({ ...f, secure: e.target.checked })} /> {t("mail.secure")}</label>
            <div className="form-cols is-even">
              <div className="field">
                <label className="field-label" htmlFor="relay-user">{t("mail.username")}</label>
                <input id="relay-user" className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} spellCheck={false} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="relay-pass">{t("mail.password")}</label>
                <input id="relay-pass" className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder={info.relay?.hasPassword ? t("voice.keySaved") : ""} />
              </div>
            </div>
            <h4 className="pane-subheading">{t("mail.dkim")}</h4>
            <div className="form-cols is-even">
              <div className="field">
                <label className="field-label" htmlFor="relay-domain">{t("mail.fromDomain")}</label>
                <input id="relay-domain" className="input" value={f.fromDomain} onChange={(e) => setF({ ...f, fromDomain: e.target.value })} placeholder={info.domain ?? "bots.example.com"} spellCheck={false} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="relay-selector">{t("mail.selector")}</label>
                <input id="relay-selector" className="input" value={f.dkimSelector} onChange={(e) => setF({ ...f, dkimSelector: e.target.value })} placeholder="sklubot" spellCheck={false} />
              </div>
            </div>
            <textarea className="input mono" rows={3} value={f.dkimKey} onChange={(e) => setF({ ...f, dkimKey: e.target.value })} placeholder={info.relay?.hasDkimKey ? t("mail.dkimSaved") : t("mail.dkimKey")} aria-label={t("mail.dkimKey")} />
            <p className="field-hint">{t("mail.sealed")}</p>
            <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
            <div className="row-end">
              {info.relay && <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("mail.removeRelay")} confirmLabel={t("common.confirmDelete")} onConfirm={async () => { await api("DELETE", "/mail/relay"); setF({ host: "", port: "587", secure: false, username: "", password: "", fromDomain: "", dkimSelector: "", dkimKey: "" }); void load(); }} />}
              <button type="submit" className="btn btn-primary btn-small" disabled={!f.host.trim()}>{t("common.save")}</button>
              {done && <span className="muted small" role="status">{t("common.saved")}</span>}
            </div>
          </form>
        </>
      )}
    </>
  );
}

/** A bot's own address (bot settings → Email): address, allowed senders, auto-reply, received mail. */
export function BotEmailTab({ bot }: { bot: Bot }) {
  const t = useT();
  const [data, setData] = useState<{ email: BotEmail; mails: InboundMail[]; routine: boolean } | null>(null);
  const [local, setLocal] = useState("");
  const [allowed, setAllowed] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const tick = useStore((s) => s.mailTick[bot.id] ?? 0);
  const load = () => api<{ email: BotEmail; mails: InboundMail[]; routine: boolean }>("GET", `/bots/${bot.id}/email`).then((r) => {
    setData(r);
    setLocal((l) => l || r.email.address?.split("@")[0] || bot.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 30));
    setAllowed((a) => a || r.email.allowedSenders.join("\n"));
  }, (e) => setError(errText(e)));
  useEffect(() => { void load(); }, [bot.id, tick]);
  const save = async (patch: Record<string, unknown>) => {
    setError(null);
    setDone(false);
    try { await api("PUT", `/bots/${bot.id}/email`, patch); setDone(true); void load(); } catch (e) { setError(errText(e)); }
  };
  if (!data) return error ? <ErrorNote>{error}</ErrorNote> : <Loading />;
  const e = data.email;
  return (
    <div className="settings-pane">
      <p className="muted">{t("mail.botIntro", { name: bot.name })}</p>
      {!e.domain ? <p className="muted small"><Icon name="info" size={13} /> {t("mail.noDomain")}</p> : (
        <>
          <div className="field">
            <label className="field-label">{t("mail.address")}</label>
            <div className="field-inline">
              <input className="input" value={local} onChange={(ev) => setLocal(ev.target.value)} aria-label={t("mail.address")} />
              <span className="muted">@{e.domain}</span>
              <button type="button" className="btn btn-small btn-primary" onClick={() => void save({ localPart: local, enabled: true })}>{e.address ? t("common.save") : t("mail.create")}</button>
            </div>
            {e.address && <p className="field-hint">{t("mail.addressHint", { address: e.address })}</p>}
            {!e.receiving && <p className="field-hint">{t("mail.notReceivingHint")}</p>}
          </div>
          {e.address && (
            <>
              <div className="action-row">
                <div><p className="action-title">{t("mail.enabled")}</p><p className="muted small">{t("mail.enabledHint")}</p></div>
                <Toggle checked={e.enabled} label={t("mail.enabled")} onChange={(on) => void save({ enabled: on })} />
              </div>
              <div className="action-row">
                <div><p className="action-title">{t("mail.autoReply")}</p><p className="muted small">{t("mail.autoReplyHint")}</p></div>
                <Toggle checked={e.autoReply} label={t("mail.autoReply")} onChange={(on) => void save({ autoReply: on })} />
              </div>
              <div className="field">
                <label className="field-label">{t("mail.allowed")}</label>
                <textarea className="input mono" rows={3} value={allowed} onChange={(ev) => setAllowed(ev.target.value)} placeholder={"camille@exemple.fr\n@client.fr"} />
                <p className="field-hint">{t("mail.allowedHint")}</p>
                <div className="row-end"><button type="button" className="btn btn-small" onClick={() => void save({ allowedSenders: allowed })}>{t("common.save")}</button></div>
              </div><BotRecipientsBlock bot={bot} />
              {!data.routine && (
                <div className="action-row">
                  <div><p className="action-title">{t("mail.routine")}</p><p className="muted small">{t("mail.routineHint")}</p></div>
                  <button type="button" className="btn btn-small" onClick={() => void api("POST", `/bots/${bot.id}/email/routine`, {}).then(load, (err) => setError(errText(err)))}>{t("mail.routineAdd")}</button>
                </div>
              )}
            </>
          )}
          <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
          {done && <p className="muted small" role="status">{t("common.saved")}</p>}
          <h3 className="pane-heading">{t("mail.received")}</h3>
          {data.mails.length === 0 ? <p className="muted small">{t("mail.noneYet")}</p> : (
            <ul className="list">
              {data.mails.slice(0, 20).map((m) => (
                <li key={m.id} className="list-row">
                  <span className={`mail-status is-${m.status}`}>{t(`mail.status.${m.status}`)}</span>
                  <div className="list-row-text">
                    <span className="list-row-title">{m.subject || "—"}</span>
                    <span className="list-row-sub">{m.from} · {relTime(m.receivedAt)} · SPF {m.auth.spf} · DKIM {m.auth.dkim} · DMARC {m.auth.dmarc}{m.reason ? ` · ${m.reason}` : ""}</span>
                  </div>
                  {m.status === "held" && <button type="button" className="btn btn-small" onClick={() => void api("POST", `/bots/${bot.id}/mail/${m.id}/release`).then(load, (err) => setError(errText(err)))}>{t("mail.release")}</button>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
