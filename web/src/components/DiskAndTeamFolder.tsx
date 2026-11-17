import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { fileSize, relTime } from "../lib/format";
import { useStore } from "../store";
import type { Card, FileEntry, TeamFolderState } from "../types";
import { Icon } from "./Icon";
import { Empty, IconButton, Loading, Toggle } from "./ui";

/* ---------- Wave 8: the disk of a bot's computer is nearly full ---------- */

type DiskCard = Extract<Card, { type: "disk" }>;

/** Shows the path as the bot sees it ("~/files/…" for the library). */
const shortPath = (p: string) => p.replace(/^\/root\//, "~/");

export function DiskCardView({ card, botId, seq }: { card: DiskCard; botId: string; seq: number }) {
  const t = useT();
  const own = useStore((s) => !s.bots[botId]?.access);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = card.items.filter((i) => picked.includes(i.path)).reduce((n, i) => n + i.bytes, 0);
  const send = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setError(null);
    try { await api("POST", `/bots/${enc(botId)}/cards/${seq}/disk`, body); setConfirming(false); } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  const pending = card.status === "pending" && own;
  return (
    <div className="card disk-card">
      <div className="card-head">
        <span className="logo-tile is-disk" aria-hidden="true"><Icon name="alert" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{t("disk.title", { pct: card.usedPct })}</p>
          <p className="card-sub">{t("disk.sub", { free: fileSize(card.freeBytes), total: fileSize(card.totalBytes) })}</p>
        </div>
      </div>
      {card.status === "pending" && (
        card.items.length ? (
          <>
            <p className="card-note">{t("disk.pick")}</p>
            <ul className="disk-list">
              {card.items.map((i) => (
                <li key={i.path}>
                  <label className="check-row">
                    <input type="checkbox" disabled={!pending || busy !== null} checked={picked.includes(i.path)}
                      onChange={(e) => { setConfirming(false); setPicked((p) => (e.target.checked ? [...p, i.path] : p.filter((x) => x !== i.path))); }} />
                    <code className="truncate">{shortPath(i.path)}</code>
                    <span className="spacer" />
                    <span className="muted small">{fileSize(i.bytes)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : <p className="card-note">{t("disk.nothing")}</p>
      )}
      {card.status === "pending" && <p className="card-note"><Icon name="shield" size={13} /> {t("disk.safety")}</p>}
      {pending && (
        <div className="card-actions">
          <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void send("dismiss", { action: "dismiss" })}>{t("common.dismiss")}</button>
          <span className="spacer" />
          {confirming ? (
            <button type="button" className="btn btn-danger" disabled={busy !== null || !picked.length} onClick={() => void send("delete", { action: "delete", paths: picked, confirm: true })}>
              {t(busy === "delete" ? "common.deleting" : "disk.confirm", { n: picked.length, size: fileSize(total) })}
            </button>
          ) : (
            <button type="button" className="btn" disabled={busy !== null || !picked.length} onClick={() => setConfirming(true)}>
              {t("disk.delete", { n: picked.length, size: fileSize(total) })}
            </button>
          )}
        </div>
      )}
      {card.status === "cleaned" && (
        <p className="card-outcome is-allowed"><Icon name="check" size={14} /> {t("disk.cleaned", { n: card.deleted?.length ?? 0, size: fileSize(card.freedBytes ?? 0), free: fileSize(card.freeBytes) })}</p>
      )}
      {card.status === "dismissed" && <p className="card-outcome is-denied"><Icon name="close" size={14} /> {t("disk.dismissed")}</p>}
      {error && <p className="card-error" role="alert">{error}</p>}
    </div>
  );
}

/* ---------- Wave 8: the account's team folder, in a bot's library view ---------- */

export function TeamFolderSection() {
  const t = useT();
  const [team, setTeam] = useState<TeamFolderState | null>(null);
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let dead = false;
    api<{ team: TeamFolderState }>("GET", "/team-folder").then((r) => { if (!dead) setTeam(r.team); }).catch(() => { if (!dead) setTeam(null); });
    return () => { dead = true; };
  }, [tick]);
  useEffect(() => {
    if (!team?.enabled) { setEntries(null); return; }
    let dead = false;
    api<{ entries: FileEntry[] }>("GET", `/team-folder/files?path=${enc(path)}`)
      .then((r) => { if (!dead) setEntries([...r.entries].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))); })
      .catch((e: unknown) => { if (!dead) setError(errText(e)); });
    return () => { dead = true; };
  }, [team?.enabled, path, tick]);

  if (!team?.available) return null;
  const toggle = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try { setTeam((await api<{ team: TeamFolderState }>("PUT", "/team-folder", { enabled: on })).team); setPath(""); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const parts = path ? path.split("/") : [];
  const join = (name: string) => (path ? `${path}/${name}` : name);
  return (
    <section className="section team-folder">
      <div className="action-row">
        <div>
          <p className="action-title"><Icon name="users" size={14} /> {t("teamFolder.title")}</p>
          <p className="muted small">{t("teamFolder.intro")}</p>
        </div>
        <Toggle checked={team.enabled} disabled={busy} label={t("teamFolder.title")} onChange={(v) => void toggle(v)} />
      </div>
      <p className="muted small"><Icon name="info" size={12} /> {t("teamFolder.restart")}</p>
      {team.waiting.length > 0 && <p className="card-note small">{t("teamFolder.waiting", { names: team.waiting.join(", ") })}</p>}
      {team.enabled && <p className="muted small"><Icon name="shield" size={12} /> {t("teamFolder.outside")}</p>}
      {error && <p className="card-error" role="alert">{error}</p>}
      {team.enabled && (
        <>
          <div className="section-head">
            <nav className="crumbs" aria-label={t("library.path")}>
              <button type="button" className="link" onClick={() => setPath("")} aria-current={parts.length === 0 ? "page" : undefined}>{team.path}</button>
              {parts.map((p, i) => (
                <span key={i} className="crumb">
                  <Icon name="chevronRight" size={12} />
                  <button type="button" className="link" onClick={() => setPath(parts.slice(0, i + 1).join("/"))}>{p}</button>
                </span>
              ))}
            </nav>
            <IconButton icon="refresh" size={15} label={t("library.refresh")} onClick={() => setTick((n) => n + 1)} />
          </div>
          {!entries && !error && <Loading />}
          {entries && entries.length === 0 && <Empty icon="folder">{t("teamFolder.empty")}</Empty>}
          {entries && entries.length > 0 && (
            <ul className="list">
              {entries.map((f) => (
                <li key={f.name} className="file-row">
                  <button type="button" className="list-row list-row-btn"
                    onClick={() => (f.dir ? setPath(join(f.name)) : window.location.assign(`/api/team-folder/files/download?path=${enc(join(f.name))}`))}
                    title={f.dir ? t("library.open", { name: f.name }) : t("attach.downloadName", { name: f.name })}>
                    <Icon name={f.dir ? "folder" : "file"} size={18} />
                    <span className="list-row-text">
                      <span className="list-row-title truncate">{f.name}</span>
                      <span className="list-row-sub">{f.dir ? t("library.folder") : fileSize(f.size)} · {relTime(f.modifiedAt)}</span>
                    </span>
                    {!f.dir && <Icon name="download" size={15} className="file-dl" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
