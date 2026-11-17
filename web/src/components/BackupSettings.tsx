/**
 * Settings → Account → "Sauvegarde automatique" (server: server/src/autobackup.ts), for the server's owner only (the
 * server answers 403 to anyone else and nothing shows). Three steps on one screen, usable from a phone:
 *  1. the backup key: an age key pair made here with WebCrypto (lib/agekey.ts); the owner downloads/copies the PRIVATE
 *     key and confirms it is saved; only the public key goes to the server;
 *  2. the S3-compatible storage (presets for OVHcloud, Hetzner, Scaleway), tested with "Tester la connexion";
 *  3. when (daily hour, time zone) and how many to keep (daily + weekly).
 * Then the status: last result, size, duration, next run, history, and the backups in the bucket.
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api, errText } from "../api";
import { useT, type Key } from "../i18n";
import { canMakeAgeKey, makeAgeKey, type AgeKeyPair } from "../lib/agekey";
import { dateTime, duration, fileSize } from "../lib/format";
import { Icon } from "./Icon";
import { CopyButton, ErrorNote } from "./ui";
import "./BackupSettings.css";

type Provider = "ovh" | "hetzner" | "scaleway" | "other";
interface Run { id: string; trigger: "schedule" | "manual"; startedAt: number; finishedAt: number | null; ok: boolean | null; name: string | null; bytes: number | null; files: number | null; durationMs: number | null; error: string | null }
interface View {
  configured: boolean; enabled: boolean; provider: Provider; endpoint: string; region: string; bucket: string; pathStyle: boolean; prefix: string;
  recipient: string; accessKeyHint: string; hasSecret: boolean; hour: number; timezone: string; keepDaily: number; keepWeekly: number;
  failures: number; nextRun: number | null; running: { startedAt: number; trigger: string; stage: string; bytes: number } | null;
  last: Run | null; lastOk: Run | null; history: Run[];
}
interface Remote { name: string; size: number; at: number }

/**
 * Official endpoints (checked against each provider's documentation):
 *  - OVHcloud Object Storage: https://s3.<region>.io.cloud.ovh.net — https://docs.ovhcloud.com/fr/guides/storage-and-backup/object-storage/s3-location
 *  - Hetzner Object Storage: https://<location>.your-objectstorage.com — https://docs.hetzner.com/storage/object-storage/overview
 *  - Scaleway Object Storage: https://s3.<region>.scw.cloud — https://www.scaleway.com/en/docs/object-storage/concepts/
 * All three document virtual-hosted addressing (bucket.endpoint), the default here.
 */
const PROVIDERS: Record<Exclude<Provider, "other">, { label: string; regions: { id: string; label: string }[]; endpoint: (r: string) => string; docs: { label: Key; url: string }[] }> = {
  ovh: {
    label: "OVHcloud Object Storage",
    regions: [["gra", "Gravelines"], ["rbx", "Roubaix"], ["sbg", "Strasbourg"], ["eu-west-par", "Paris"], ["de", "Francfort"], ["uk", "Londres"], ["waw", "Varsovie"], ["eu-south-mil", "Milan"], ["bhs", "Beauharnois"], ["ca-east-tor", "Toronto"], ["sgp", "Singapour"], ["ap-southeast-syd", "Sydney"], ["ap-south-mum", "Mumbai"]].map(([id, label]) => ({ id, label })),
    endpoint: (r) => `https://s3.${r}.io.cloud.ovh.net`,
    docs: [
      { label: "backup.docStart", url: "https://docs.ovhcloud.com/fr/guides/storage-and-backup/object-storage/s3-getting-started-with-object-storage" },
      { label: "backup.docEndpoints", url: "https://docs.ovhcloud.com/fr/guides/storage-and-backup/object-storage/s3-location" },
    ],
  },
  hetzner: {
    label: "Hetzner Object Storage",
    regions: [["fsn1", "Falkenstein"], ["nbg1", "Nuremberg"], ["hel1", "Helsinki"]].map(([id, label]) => ({ id, label })),
    endpoint: (r) => `https://${r}.your-objectstorage.com`,
    docs: [
      { label: "backup.docBucket", url: "https://docs.hetzner.com/storage/object-storage/getting-started/creating-a-bucket" },
      { label: "backup.docKeys", url: "https://docs.hetzner.com/storage/object-storage/getting-started/generating-s3-keys" },
      { label: "backup.docEndpoints", url: "https://docs.hetzner.com/storage/object-storage/overview" },
    ],
  },
  scaleway: {
    label: "Scaleway Object Storage",
    regions: [["fr-par", "Paris"], ["nl-ams", "Amsterdam"], ["pl-waw", "Varsovie"], ["it-mil", "Milan"]].map(([id, label]) => ({ id, label })),
    endpoint: (r) => `https://s3.${r}.scw.cloud`,
    docs: [
      { label: "backup.docBucket", url: "https://www.scaleway.com/fr/docs/object-storage/how-to/create-a-bucket/" },
      { label: "backup.docKeys", url: "https://www.scaleway.com/en/docs/iam/how-to/create-api-keys/" },
      { label: "backup.docEndpoints", url: "https://www.scaleway.com/en/docs/object-storage/concepts/" },
    ],
  },
};
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };
const emptyForm = () => ({ provider: "ovh" as Provider, region: "gra", endpoint: PROVIDERS.ovh.endpoint("gra"), bucket: "", accessKey: "", secretKey: "", prefix: "sklubot/", pathStyle: false, hour: "3", timezone: browserZone(), keepDaily: "7", keepWeekly: "4", enabled: true });

export function BackupSettings() {
  const t = useT();
  const uid = useId();
  const [view, setView] = useState<View | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [recipient, setRecipient] = useState("");
  const [newKey, setNewKey] = useState<AgeKeyPair | null>(null);
  const [keySaved, setKeySaved] = useState(false);
  const [canKey, setCanKey] = useState<boolean | null>(null);
  const [pasteKey, setPasteKey] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "test" | "run" | "remove" | "list">("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState<Remote[] | null>(null);
  const poll = useRef<number | undefined>(undefined);

  const fill = useCallback((v: View) => {
    setView(v);
    if (!v.configured) return;
    setRecipient(v.recipient);
    setForm({ provider: v.provider, region: v.region, endpoint: v.endpoint, bucket: v.bucket, accessKey: "", secretKey: "", prefix: v.prefix, pathStyle: v.pathStyle, hour: String(v.hour), timezone: v.timezone, keepDaily: String(v.keepDaily), keepWeekly: String(v.keepWeekly), enabled: v.enabled });
  }, []);
  const refresh = useCallback(async () => { try { const v = await api<View>("GET", "/settings/backup"); setView(v); return v; } catch { return null; } }, []);
  useEffect(() => { api<View>("GET", "/settings/backup").then(fill, () => setView(null)); void canMakeAgeKey().then(setCanKey); }, [fill]);
  // While a backup runs, follow it.
  useEffect(() => {
    window.clearInterval(poll.current);
    if (view?.running) poll.current = window.setInterval(() => { void refresh(); }, 3000);
    return () => window.clearInterval(poll.current);
  }, [view?.running, refresh]);
  if (!view) return null;

  const set = <K extends keyof ReturnType<typeof emptyForm>>(k: K, v: ReturnType<typeof emptyForm>[K]) => { setForm((f) => ({ ...f, [k]: v })); setNote(null); };
  const choose = (p: Provider) => {
    if (p === "other") { setForm((f) => ({ ...f, provider: p, pathStyle: f.pathStyle })); return; }
    const region = PROVIDERS[p].regions[0].id;
    setForm((f) => ({ ...f, provider: p, region, endpoint: PROVIDERS[p].endpoint(region), pathStyle: false }));
  };
  const chooseRegion = (r: string) => setForm((f) => ({ ...f, region: r, endpoint: f.provider === "other" ? f.endpoint : PROVIDERS[f.provider].endpoint(r) }));
  const payload = () => ({ provider: form.provider, endpoint: form.endpoint.trim(), region: form.region.trim(), bucket: form.bucket.trim(), accessKey: form.accessKey.trim() || undefined, secretKey: form.secretKey.trim() || undefined, prefix: form.prefix.trim(), pathStyle: form.pathStyle, recipient: recipient.trim(), hour: Number(form.hour), timezone: form.timezone, keepDaily: Number(form.keepDaily), keepWeekly: Number(form.keepWeekly), enabled: form.enabled });

  const makeKey = async () => {
    setError(null);
    try { const k = await makeAgeKey(); setNewKey(k); setKeySaved(false); } catch (err) { setError(errText(err)); }
  };
  const download = (k: AgeKeyPair) => {
    const url = URL.createObjectURL(new Blob([k.file], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.download = `sklubot-cle-de-sauvegarde-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const confirmKey = () => { if (newKey) { setRecipient(newKey.recipient); setNewKey(null); setNote(t("backup.keyReady")); } };

  const act = async (kind: typeof busy, fn: () => Promise<void>) => {
    setBusy(kind); setError(null); setNote(null);
    try { await fn(); } catch (err) { setError(errText(err)); }
    setBusy("");
  };
  const save = (e: FormEvent) => { e.preventDefault(); void act("save", async () => { fill(await api<View>("PUT", "/settings/backup", payload())); setNote(t("backup.saved")); }); };
  const test = () => act("test", async () => { await api("POST", "/settings/backup/test", payload()); setNote(t("backup.testOk")); });
  const runNow = () => act("run", async () => { const r = await api<{ view: View }>("POST", "/settings/backup/run"); setView(r.view); setNote(t("backup.started")); });
  const remove = () => act("remove", async () => { if (!window.confirm(t("backup.removeConfirm"))) return; const v = await api<View>("DELETE", "/settings/backup"); setView(v); setRecipient(""); setForm(emptyForm()); setRemote(null); });
  const list = () => act("list", async () => { setRemote((await api<{ backups: Remote[] }>("GET", "/settings/backup/remote")).backups); });

  const preset = form.provider === "other" ? null : PROVIDERS[form.provider];
  const last = view.last;
  const canSave = !!recipient && !!form.bucket.trim() && !!form.endpoint.trim() && (view.configured || (!!form.accessKey.trim() && !!form.secretKey.trim()));
  const stage = view.running ? t(`backup.stage.${view.running.stage}` as Key) : "";
  const hours = Array.from({ length: 24 }, (_x, h) => h);

  return (
    <>
      <h3 className="pane-heading">{t("backup.title")}</h3>
      <div className="google-settings backup-settings">
        <p className="muted small">{t("backup.intro")}</p>
        <p className={`google-status ${view.configured && view.enabled ? "is-on" : ""}`} role="status">
          <span className="google-dot" aria-hidden="true" /> {t(!view.configured ? "backup.statusOff" : view.enabled ? "backup.statusOn" : "backup.statusPaused")}
        </p>
        <div className="callout is-warn backup-homes"><Icon name="info" size={15} /><span>{t("backup.homesNote")}</span></div>

        {view.configured && (
          <div className="backup-status" aria-live="polite">
            {view.running ? (
              <p className="backup-line"><span className="backup-spinner" aria-hidden="true" /> {t("backup.running", { stage, size: fileSize(view.running.bytes) })}</p>
            ) : last ? (
              <p className={`backup-line ${last.ok ? "is-ok" : "is-bad"}`}>
                <Icon name={last.ok ? "check" : "alert"} size={14} />
                {last.ok ? t("backup.lastOk", { when: dateTime(last.startedAt), size: fileSize(last.bytes ?? 0), took: duration(last.durationMs ?? 0) }) : t("backup.lastFailed", { when: dateTime(last.startedAt), error: last.error ?? "" })}
              </p>
            ) : <p className="backup-line muted">{t("backup.never")}</p>}
            {!last?.ok && view.lastOk && <p className="muted small">{t("backup.lastGood", { when: dateTime(view.lastOk.startedAt) })}</p>}
            {view.failures >= 2 && <p className="small warn-text">{t("backup.failures", { n: view.failures })}</p>}
            {view.nextRun && <p className="muted small">{t("backup.next", { when: dateTime(view.nextRun, view.timezone) })}</p>}
            <div className="google-actions backup-actions">
              <button type="button" className="btn btn-primary btn-small" onClick={() => void runNow()} disabled={!!busy || !!view.running}><Icon name="upload" size={14} /> {t("backup.runNow")}</button>
              <button type="button" className="btn btn-small" onClick={() => void list()} disabled={!!busy}>{t(busy === "list" ? "backup.listing" : "backup.list")}</button>
            </div>
            {remote && (
              remote.length ? (
                <ul className="backup-remote">
                  {remote.map((r) => <li key={r.name}><span className="backup-remote-name">{r.name}</span><span className="muted small">{r.at ? dateTime(r.at) : ""} · {fileSize(r.size)}</span></li>)}
                </ul>
              ) : <p className="muted small">{t("backup.listEmpty")}</p>
            )}
            {view.history.length > 1 && (
              <details className="google-guide">
                <summary>{t("backup.history")}</summary>
                <ul className="backup-history">
                  {view.history.map((h) => (
                    <li key={h.id} className={h.ok ? "is-ok" : h.ok === false ? "is-bad" : ""}>
                      <span>{dateTime(h.startedAt)} · {t(h.trigger === "manual" ? "backup.byHand" : "backup.scheduled")}</span>
                      <span className="muted small">{h.ok === null ? t("backup.inProgress") : h.ok ? `${fileSize(h.bytes ?? 0)} · ${duration(h.durationMs ?? 0)}` : h.error}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <form className="google-form" onSubmit={save}>
          {/* ── 1. The key ── */}
          <p className="backup-step"><span className="backup-step-n">1</span> {t("backup.step1")}</p>
          {recipient && !newKey ? (
            <div className="backup-key">
              <p className="small backup-key-label"><Icon name="key" size={14} /> <span>{t("backup.keySet")}</span></p>
              <code className="backup-pub">{recipient}</code>
              <button type="button" className="btn btn-small" onClick={() => { if (!view.configured || window.confirm(t("backup.changeKeyConfirm"))) { setRecipient(""); setNewKey(null); } }}>{t("backup.changeKey")}</button>
            </div>
          ) : newKey ? (
            <div className="backup-key is-new">
              <p className="small"><strong>{t("backup.saveKeyTitle")}</strong> {t("backup.saveKeyText")}</p>
              <code className="backup-secret">{newKey.identity}</code>
              <div className="google-actions backup-key-actions">
                <button type="button" className="btn btn-small" onClick={() => download(newKey)}><Icon name="download" size={14} /> {t("backup.download")}</button>
                <CopyButton text={newKey.file} label={t("backup.copy")} />
              </div>
              <label className="check-row backup-check"><input type="checkbox" checked={keySaved} onChange={(e) => setKeySaved(e.target.checked)} /> <span>{t("backup.keySavedCheck")}</span></label>
              <div className="google-actions">
                <button type="button" className="btn btn-small" onClick={() => setNewKey(null)}>{t("common.cancel")}</button>
                <button type="button" className="btn btn-primary btn-small" disabled={!keySaved} onClick={confirmKey}>{t("backup.useKey")}</button>
              </div>
            </div>
          ) : (
            <div className="backup-key">
              <p className="muted small">{t("backup.keyWhy")}</p>
              {canKey !== false && <button type="button" className="btn btn-primary btn-small" onClick={() => void makeKey()} disabled={canKey === null}><Icon name="key" size={14} /> {t("backup.makeKey")}</button>}
              {canKey === false && <p className="small warn-text">{t("backup.noWebCrypto")}</p>}
              <button type="button" className="btn btn-ghost btn-small backup-paste" onClick={() => setPasteKey((x) => !x)}>{t("backup.havePublicKey")}</button>
              {pasteKey && (
                <div className="field">
                  <label className="field-label" htmlFor={`${uid}k`}>{t("backup.publicKey")}</label>
                  <input id={`${uid}k`} className="input" placeholder="age1…" spellCheck={false} autoComplete="off" onChange={(e) => { const v = e.target.value.trim(); if (/^age1[0-9a-z]{58}$/.test(v)) setRecipient(v); }} />
                  <p className="field-hint">{t("backup.publicKeyHint")}</p>
                </div>
              )}
            </div>
          )}

          {/* ── 2. The storage ── */}
          <p className="backup-step"><span className="backup-step-n">2</span> {t("backup.step2")}</p>
          <div className="form-cols is-even">
            <div className="field">
              <label className="field-label" htmlFor={`${uid}p`}>{t("backup.provider")}</label>
              <select id={`${uid}p`} className="input" value={form.provider} onChange={(e) => choose(e.target.value as Provider)}>
                <option value="ovh">OVHcloud</option>
                <option value="hetzner">Hetzner</option>
                <option value="scaleway">Scaleway</option>
                <option value="other">{t("backup.otherS3")}</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${uid}r`}>{t("backup.region")}</label>
              {preset ? (
                <select id={`${uid}r`} className="input" value={form.region} onChange={(e) => chooseRegion(e.target.value)}>
                  {preset.regions.map((r) => <option key={r.id} value={r.id}>{r.label} ({r.id})</option>)}
                </select>
              ) : <input id={`${uid}r`} className="input" value={form.region} onChange={(e) => set("region", e.target.value)} spellCheck={false} autoComplete="off" placeholder="us-east-1" />}
            </div>
          </div>
          {preset && (
            <details className="google-guide" open={!view.configured}>
              <summary>{t(`backup.guide.${form.provider}.title` as Key)}</summary>
              <ol>
                {([1, 2, 3, 4] as const).map((n) => <li key={n}>{t(`backup.guide.${form.provider}.${n}` as Key)}</li>)}
              </ol>
              <p className="muted small recovery-docs">
                {t("smtp.docs")}{" "}
                {preset.docs.map((d, i) => <span key={d.url}>{i > 0 && " · "}<a href={d.url} target="_blank" rel="noreferrer">{t(d.label)}</a></span>)}
              </p>
            </details>
          )}
          <div className="field">
            <label className="field-label" htmlFor={`${uid}e`}>{t("backup.endpoint")}</label>
            <input id={`${uid}e`} className="input" value={form.endpoint} onChange={(e) => set("endpoint", e.target.value)} spellCheck={false} autoComplete="off" inputMode="url" placeholder="https://s3.gra.io.cloud.ovh.net" readOnly={!!preset} />
          </div>
          <div className="form-cols is-even">
            <div className="field">
              <label className="field-label" htmlFor={`${uid}b`}>{t("backup.bucket")}</label>
              <input id={`${uid}b`} className="input" value={form.bucket} onChange={(e) => set("bucket", e.target.value.toLowerCase())} spellCheck={false} autoComplete="off" autoCapitalize="none" placeholder="sklubot-sauvegardes" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${uid}f`}>{t("backup.prefix")}</label>
              <input id={`${uid}f`} className="input" value={form.prefix} onChange={(e) => set("prefix", e.target.value)} spellCheck={false} autoComplete="off" autoCapitalize="none" placeholder="sklubot/" />
            </div>
          </div>
          <div className="form-cols is-even">
            <div className="field">
              <label className="field-label" htmlFor={`${uid}a`}>{t("backup.accessKey")}</label>
              <input id={`${uid}a`} className="input" value={form.accessKey} onChange={(e) => set("accessKey", e.target.value)} spellCheck={false} autoComplete="off" autoCapitalize="none" placeholder={view.accessKeyHint ? t("backup.keptHint", { hint: view.accessKeyHint }) : ""} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${uid}s`}>{t("backup.secretKey")}</label>
              <input id={`${uid}s`} className="input" type="password" value={form.secretKey} onChange={(e) => set("secretKey", e.target.value)} spellCheck={false} autoComplete="new-password" placeholder={view.hasSecret ? t("smtp.passwordKept") : ""} />
            </div>
          </div>
          <p className="field-hint">{t("backup.keysHint")}</p>
          {form.provider === "other" && (
            <label className="check-row backup-check"><input type="checkbox" checked={form.pathStyle} onChange={(e) => set("pathStyle", e.target.checked)} /> <span>{t("backup.pathStyle")}</span></label>
          )}

          {/* ── 3. When, and how many ── */}
          <p className="backup-step"><span className="backup-step-n">3</span> {t("backup.step3")}</p>
          <div className="form-cols is-even">
            <div className="field">
              <label className="field-label" htmlFor={`${uid}h`}>{t("backup.hour")}</label>
              <select id={`${uid}h`} className="input" value={form.hour} onChange={(e) => set("hour", e.target.value)}>
                {hours.map((h) => <option key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
              <p className="field-hint">{t("backup.zone", { zone: form.timezone })}</p>
            </div>
            <div className="field">
              <span className="field-label">{t("backup.keep")}</span>
              <div className="backup-keep">
                <label><input className="input" inputMode="numeric" value={form.keepDaily} onChange={(e) => set("keepDaily", e.target.value.replace(/\D/g, "").slice(0, 2))} aria-label={t("backup.keepDaily")} /> {t("backup.daily")}</label>
                <label><input className="input" inputMode="numeric" value={form.keepWeekly} onChange={(e) => set("keepWeekly", e.target.value.replace(/\D/g, "").slice(0, 2))} aria-label={t("backup.keepWeekly")} /> {t("backup.weekly")}</label>
              </div>
            </div>
          </div>
          {view.configured && <label className="check-row backup-check"><input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} /> <span>{t("backup.enabled")}</span></label>}

          <ErrorNote>{error}</ErrorNote>
          {note && <p className="muted small" role="status">{note}</p>}
          <div className="google-actions backup-actions">
            {view.configured && <button type="button" className="btn btn-small" onClick={() => void remove()} disabled={!!busy}>{t("backup.remove")}</button>}
            <button type="button" className="btn btn-small" onClick={() => void test()} disabled={!!busy || !form.bucket.trim() || !form.endpoint.trim() || (!view.configured && (!form.accessKey.trim() || !form.secretKey.trim()))}>{t(busy === "test" ? "backup.testing" : "backup.test")}</button>
            <button type="submit" className="btn btn-primary btn-small" disabled={!!busy || !canSave}>{t(busy === "save" ? "common.saving" : "backup.save")}</button>
          </div>
          {!recipient && <p className="field-hint">{t("backup.needKey")}</p>}
        </form>

        <details className="google-guide">
          <summary>{t("backup.restoreTitle")}</summary>
          <p className="small">{t("backup.restore1")}</p>
          <p className="small">{t("backup.restore2")}</p>
          <code className="backup-cmd">node server/dist/backupcheck.js restore-from-s3 --identity cle.txt --out /root/restauration</code>
          <p className="muted small">{t("backup.restore3")}</p>
        </details>
      </div>
    </>
  );
}
