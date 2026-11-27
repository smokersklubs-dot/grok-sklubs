import { useEffect, useMemo, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { Gloss } from "./Gloss";
import { Loading } from "./ui";
import "./Comfort7.css";

/** Server officepreview.ts OfficePreview. */
interface Sheet { name: string; rows: string[][]; totalRows: number; truncated: boolean }
interface Preview { kind: "xlsx" | "docx" | "pptx"; macros: boolean; sheets?: Sheet[]; blocks?: { type: "heading" | "paragraph" | "table"; level?: number; text?: string; rows?: string[][] }[]; slides?: { n: number; title: string; lines: string[] }[] }

export const OFFICE_FILE = /\.(xlsx|xlsm|docx|docm|pptx|pptm)$/i;
const colName = (i: number) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/** A whole sheet: column letters, row numbers, sticky header; a cap of 5000 rows is said, never hidden. */
export function SheetTable({ rows, label, numbered = true }: { rows: string[][]; label: string; numbered?: boolean }) {
  const width = useMemo(() => rows.reduce((m, r) => Math.max(m, r.length), 0), [rows]);
  return (
    <div className="sheet-wrap" tabIndex={0} role="region" aria-label={label}>
      <table className="sheet">
        <thead><tr>{numbered && <th className="sheet-n" aria-hidden="true" />}{Array.from({ length: width }, (_, i) => <th key={i} scope="col">{colName(i)}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{numbered && <th scope="row" className="sheet-n">{i + 1}</th>}{Array.from({ length: width }, (_, j) => <td key={j}>{r[j] ?? ""}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** Word, Excel and PowerPoint, converted on the server into data (no macro, no embedded object is ever opened). */
export function OfficeView({ botId, path, name }: { botId: string; path: string; name: string }) {
  const t = useT();
  const [p, setP] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(0);
  useEffect(() => {
    let dead = false;
    setP(null); setError(null); setSheet(0);
    api<Preview>("GET", `/bots/${enc(botId)}/files/office-preview?path=${enc(path)}`).then((r) => !dead && setP(r), (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [botId, path]);
  if (error) return <p className="muted small" role="alert">{error}</p>;
  if (!p) return <Loading />;
  return (
    <div className="office-view">
      {p.macros && <p className="office-note small" role="note"><Gloss term="macro" /> · {t("c7.office.macros")}</p>}
      {p.sheets && (
        <>
          {p.sheets.length > 1 && (
            <div className="seg office-tabs" role="tablist" aria-label={t("c7.office.sheets")}>
              {p.sheets.map((s, i) => <button key={i} type="button" role="tab" aria-selected={sheet === i} className={`seg-btn${sheet === i ? " is-on" : ""}`} onClick={() => setSheet(i)}>{s.name}</button>)}
            </div>
          )}
          {p.sheets[sheet] && <>
            <SheetTable rows={p.sheets[sheet].rows} label={`${name} — ${p.sheets[sheet].name}`} />
            <p className="muted small">{p.sheets[sheet].truncated ? t("c7.office.truncated", { shown: p.sheets[sheet].rows.length, total: p.sheets[sheet].totalRows }) : t("c7.office.rows", { n: p.sheets[sheet].totalRows })}</p>
          </>}
        </>
      )}
      {p.blocks && (
        <article className="doc-view">
          {p.blocks.length === 0 && <p className="muted">{t("c7.office.emptyDoc")}</p>}
          {p.blocks.map((b, i) => b.type === "heading" ? <p key={i} className={`doc-h doc-h${b.level}`} role="heading" aria-level={Math.min(6, (b.level ?? 1) + 2)}>{b.text}</p>
            : b.type === "table" ? <SheetTable key={i} rows={b.rows ?? []} label={t("c7.office.table", { n: i + 1 })} numbered={false} />
            : <p key={i} className="doc-p">{b.text}</p>)}
        </article>
      )}
      {p.slides && (
        <ol className="slides-view">
          {p.slides.map((s) => (
            <li key={s.n} className="slide-card">
              <span className="slide-n small muted">{t("c7.office.slide", { n: s.n })}</span>
              <strong className="slide-title">{s.title || "—"}</strong>
              {s.lines.length > 0 && <ul>{s.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
