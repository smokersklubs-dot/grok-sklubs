import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useT, type Key } from "../i18n";
import { relTime } from "../lib/format";
import { ErrorNote, Loading } from "./ui";
import "./JournalWhy.css";

/**
 * L137 « Pourquoi ? » on a line of the detailed journal (server agent/turnknow.ts): what allowed the action, the
 * owner's last words before it, and what the bot knew at that moment (its notes, the parts of its instructions).
 */
interface Why {
  entry: { decision: string; quote: string; reason: string; botName: string };
  userWords: { text: string; at: number } | null;
  knew: { at: number; parts: { title: string; chars: number }[]; notes: string[] } | null;
}

export function WhyButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const t = useT();
  return <button type="button" className="btn btn-ghost btn-small journal-why-btn" aria-expanded={open} onClick={onToggle}>{t("journal.why")}</button>;
}

export function JournalWhy({ id }: { id: number }) {
  const t = useT();
  const [w, setW] = useState<Why | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    api<Why>("GET", `/journal/${id}/why`).then((r) => !dead && setW(r), (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [id]);
  return (
    <div className="journal-why" role="row">
      <div role="cell">
        <ErrorNote>{error}</ErrorNote>
        {!w && !error && <Loading />}
        {w && (
          <>
            <p><strong>{t("journal.why.allowed")}</strong> {t(`journal.d.${w.entry.decision}` as Key)}{w.entry.quote ? ` — « ${w.entry.quote} »` : w.entry.reason ? ` — ${w.entry.reason}` : ""}</p>
            <p><strong>{t("journal.why.words")}</strong> {w.userWords ? <>« {w.userWords.text} » <span className="muted">({relTime(w.userWords.at)})</span></> : <span className="muted">{t("journal.why.noWords")}</span>}</p>
            {w.knew ? (
              <details>
                <summary>{t("journal.why.knew", { name: w.entry.botName, n: w.knew.notes.length, parts: w.knew.parts.length })}</summary>
                {w.knew.notes.length > 0 ? <ul className="journal-why-notes">{w.knew.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : <p className="muted small">{t("journal.why.noNotes")}</p>}
                <p className="muted small">{t("journal.why.parts")} {w.knew.parts.map((p) => p.title).join(" · ")}</p>
              </details>
            ) : <p className="muted small">{t("journal.why.noSnapshot")}</p>}
          </>
        )}
      </div>
    </div>
  );
}
