import { useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { ErrorNote, Loading, Modal } from "./ui";
import "./Comfort7.css";

interface DiffLine { op: "same" | "add" | "del" | "fold"; text: string; a?: number; b?: number; count?: number }
interface Diff { lines: DiffLine[]; added: number; removed: number; truncated: boolean }

/** L157 « Comparer »: what changed between a version and the current page (or two versions), line by line. */
export function PageDiffButton({ token, from, n }: { token: string; from: number; n: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ html: Diff; files: (Diff & { name: string })[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const show = () => {
    setOpen(true); setError(null);
    api<{ html: Diff; files: (Diff & { name: string })[] }>("GET", `/pages/${encodeURIComponent(token)}/diff?from=${from}&to=current`).then(setData, (e) => setError(errText(e)));
  };
  return (
    <>
      <button type="button" className="btn btn-small" onClick={show}><Icon name="history" size={13} /> {t("c7.page.compare")}</button>
      {open && (
        <Modal title={t("c7.page.diffTitle", { n })} onClose={() => setOpen(false)} size="xl">
          <div className="modal-body">
            <ErrorNote>{error}</ErrorNote>
            {!data && !error && <Loading />}
            {data && <>
              <DiffView name="index.html" d={data.html} />
              {data.files.map((f) => <DiffView key={f.name} name={f.name} d={f} />)}
            </>}
          </div>
        </Modal>
      )}
    </>
  );
}

function DiffView({ name, d }: { name: string; d: Diff }) {
  const t = useT();
  return (
    <section className="diff" aria-label={name}>
      <p className="diff-head small"><strong>{name}</strong> <span className="diff-add">+{d.added}</span> <span className="diff-del">−{d.removed}</span>{d.truncated && <span className="muted"> · {t("c7.page.diffCut")}</span>}</p>
      {d.added + d.removed === 0 ? <p className="muted small">{t("c7.page.same")}</p> : (
        <pre className="diff-body">{d.lines.map((l, i) => l.op === "fold"
          ? <span key={i} className="diff-fold">{t("c7.page.fold", { n: l.count ?? 0 })}{"\n"}</span>
          : <span key={i} className={`diff-${l.op}`}><span className="diff-sign" aria-label={l.op === "add" ? t("c7.page.added") : l.op === "del" ? t("c7.page.removed") : undefined}>{l.op === "add" ? "+" : l.op === "del" ? "−" : " "}</span>{l.text}{"\n"}</span>)}</pre>
      )}
    </section>
  );
}

/** L157: one HTML file that opens offline, an A4 sheet to save as PDF, a picture of the whole page or of one element. */
export function PageExports({ token, title }: { token: string; title: string }) {
  const t = useT();
  const [capturing, setCapturing] = useState(false);
  const [selector, setSelector] = useState("");
  const [dark, setDark] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enc = encodeURIComponent(token);
  const capture = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/pages/${enc}/capture`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ selector, dark, width: 1280 }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `${title.replace(/[^\w-]+/g, "-").slice(0, 60) || "page"}.png`; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      useStore.getState().showToast(t("c7.page.captured"));
      setCapturing(false);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="page-exports">
      <a className="btn btn-small" href={`/api/pages/${enc}/standalone`} download><Icon name="download" size={13} /> {t("c7.page.standalone")}</a>
      <a className="btn btn-small" href={`/api/pages/${enc}/a4`} target="_blank" rel="noopener noreferrer"><Icon name="file" size={13} /> {t("c7.page.a4")}</a>
      <button type="button" className="btn btn-small" aria-expanded={capturing} onClick={() => setCapturing((v) => !v)}><Icon name="image" size={13} /> {t("c7.page.capture")}</button>
      {capturing && (
        <div className="page-capture">
          <label className="small">{t("c7.page.selector")}<input className="input" value={selector} maxLength={200} placeholder={t("c7.page.selectorPh")} onChange={(e) => setSelector(e.target.value)} /></label>
          <label className="small toggle-line"><input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> {t("c7.page.dark")}</label>
          <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={() => void capture()}>{busy ? "…" : t(selector.trim() ? "c7.page.captureEl" : "c7.page.captureFull")}</button>
        </div>
      )}
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </div>
  );
}
