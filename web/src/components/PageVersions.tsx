import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import type { SharedPage } from "../types";
import { Icon } from "./Icon";
import { ConfirmButton, ErrorNote, Loading } from "./ui";
import "./PagePreview.css";

/* Settings → Pages: a page's history (every publish, edit and restore, server/src/pagefiles.ts), a version previewed in
   the same sandbox, a version put back, and a new address (the old link stops working). */

interface Version { id: number; n: number; note: string; createdAt: number; bytes: number; files: number; current: boolean }

function noteText(t: ReturnType<typeof useT>, note: string): string {
  if (note === "published") return t("pages.note.published");
  if (note === "published again") return t("pages.note.republished");
  if (note === "edited") return t("pages.note.edited");
  const f = /^edited (.+)$/.exec(note);
  if (f) return t("pages.note.editedFile", { file: f[1] });
  const r = /^restored version (\d+)$/.exec(note);
  if (r) return t("pages.note.restored", { n: r[1] });
  return note;
}
const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

export function PageVersions({ page, defaultOpen = false }: { page: SharedPage; defaultOpen?: boolean }) {
  const t = useT();
  const showToast = useStore((s) => s.showToast);
  const [open, setOpen] = useState(defaultOpen);
  const [list, setList] = useState<Version[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const enc = encodeURIComponent(page.token);
  useEffect(() => {
    if (!open) return;
    let dead = false;
    api<{ versions: Version[] }>("GET", `/pages/${enc}/versions`).then((r) => !dead && setList(r.versions ?? []), (e: unknown) => !dead && (setError(errText(e)), setList([])));
    return () => { dead = true; };
  }, [open, enc, tick]);
  const restore = async (v: Version) => {
    setError(null);
    try { await api("POST", `/pages/${enc}/versions/${v.id}/restore`); showToast(t("pages.restored", { n: v.n })); setTick((x) => x + 1); } catch (e) { setError(errText(e)); }
  };
  const rotate = async () => {
    setError(null);
    try { await api("POST", `/pages/${enc}/rotate`); showToast(t("pages.rotated")); } catch (e) { setError(errText(e)); }
  };
  return (
    <div className="page-versions">
      <div className="page-versions-bar">
        <button type="button" className="btn btn-small" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Icon name="history" size={13} /> {t("pages.versions")}
        </button>
        <ConfirmButton className="btn btn-small" label={t("pages.rotate")} confirmLabel={t("pages.rotateConfirm")} busyLabel="…" onConfirm={rotate} />
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {open && !list && <Loading />}
      {open && list && (
        <ol className="page-versions-list" aria-label={t("pages.versionsTitle", { title: page.title })}>
          {list.map((v) => (
            <li key={v.id} className="page-version">
              <span className="page-version-text">
                <strong>{t("pages.versionN", { n: v.n })}</strong>{v.current && <span className="chip">{t("pages.current")}</span>}
                <span className="muted small">{noteText(t, v.note)} · {when(v.createdAt)}{v.files ? ` · ${t("pages.files" as Key, { n: v.files })}` : ""}</span>
              </span>
              <a className="btn btn-small" href={`/api/pages/${enc}/versions/${v.id}/view`} target="_blank" rel="noopener noreferrer"><Icon name="eye" size={13} /> {t("pages.viewVersion")}</a>
              {!v.current && <ConfirmButton className="btn btn-small" label={t("pages.restore")} confirmLabel={t("pages.restoreConfirm")} busyLabel="…" onConfirm={() => restore(v)} />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
