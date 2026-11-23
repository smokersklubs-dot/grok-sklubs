import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { ErrorNote } from "./ui";

/**
 * L77, the rest (server reviewplus.ts): reviewers on another provider marked, « Faire relire à plusieurs » with the
 * project's number of approvals, and « Faire corriger par l'auteur ». The review card keeps its words inline (fr/en).
 */
interface Candidate { id: string; name: string; provider: string; otherProvider: boolean }
interface Panel {
  reviews: { reviewer: string; name: string; state: "working" | "ready" | "failed"; review?: { verdict: "approved" | "changes" | "inconclusive"; reason: string }; error?: string }[];
  needed: number;
  approvals: number;
  verdict: "none" | "working" | "ready" | "changes" | "waiting";
}

/** The ids of the reviewers that run on another provider than the author. */
export function useCandidates(bot: string): Candidate[] {
  const [list, setList] = useState<Candidate[]>([]);
  useEffect(() => {
    if (!bot) return;
    const ctl = new AbortController();
    api<{ candidates: Candidate[] }>("GET", `/bots/${encodeURIComponent(bot)}/review-candidates`, undefined, ctl.signal).then((r) => !ctl.signal.aborted && setList(r.candidates), () => {});
    return () => ctl.abort();
  }, [bot]);
  return list;
}

export function ReviewPlus({ bot, seq, fr, changes, candidates }: { bot: string; seq: number; fr: boolean; changes: boolean; candidates: Candidate[] }) {
  const loc = (f: string, e: string) => (fr ? f : e);
  const base = `/bots/${encodeURIComponent(bot)}/cards/${seq}/files`;
  const [panel, setPanel] = useState<Panel | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const working = panel?.verdict === "working";
  useEffect(() => {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = () => api<Panel>("GET", `${base}/review-panel`, undefined, ctl.signal).then((p) => {
      if (ctl.signal.aborted) return;
      setPanel(p);
      if (p.reviews.some((r) => r.state === "working")) timer = setTimeout(read, 2500);
    }, () => {});
    void read();
    return () => { ctl.abort(); clearTimeout(timer); };
  }, [base, working]);
  const run = async (fn: () => Promise<void>) => { setError(""); try { await fn(); } catch (e) { setError(errText(e)); } };
  const panelChanges = panel?.verdict === "changes";
  return (
    <div className="review-plus">
      {(changes || panelChanges) && (
        <button className="btn btn-small" disabled={sent} onClick={() => void run(async () => { await api("POST", `${base}/review/fix`); setSent(true); })}>
          {sent ? loc("Envoyé à l'auteur", "Sent to the author") : loc("Faire corriger par l'auteur", "Have the author fix it")}
        </button>
      )}
      {panel && panel.reviews.length > 0 && (
        <div className="review-plus-panel" role="status">
          <strong>
            {panel.verdict === "ready" ? loc("Prête à publier", "Ready to publish") : panel.verdict === "changes" ? loc("Corrections demandées", "Changes requested") : panel.verdict === "working" ? loc("Relectures en cours…", "Reviews under way…") : loc("Pas encore assez d'accords", "Not enough approvals yet")}
            {" "}({panel.approvals}/{panel.needed})
          </strong>
          <ul>
            {panel.reviews.map((r) => (
              <li key={r.reviewer}>
                {r.name} · {r.state === "working" ? loc("relit…", "reviewing…") : r.state === "failed" ? (r.error ?? loc("échec", "failed")) : r.review?.verdict === "approved" ? loc("approuvé", "approved") : r.review?.verdict === "changes" ? loc("corrections demandées", "changes requested") : loc("à vérifier", "inconclusive")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {candidates.length >= 2 && (
        <details>
          <summary>{loc("Faire relire à plusieurs (2 ou 3 bots)", "Review by several bots (2 or 3)")}</summary>
          <fieldset className="review-plus-pick">
            {candidates.map((c) => (
              <label key={c.id} className="small">
                <input type="checkbox" checked={picked.includes(c.id)} disabled={!picked.includes(c.id) && picked.length >= 3}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} />
                {" "}{c.name}{c.otherProvider ? loc(" · autre fournisseur", " · other provider") : ""}
              </label>
            ))}
          </fieldset>
          <button className="btn btn-small" disabled={picked.length < 2 || working} onClick={() => void run(async () => setPanel(await api<Panel>("POST", `${base}/review-panel`, { reviewers: picked })))}>
            {loc("Lancer les relectures", "Start the reviews")}
          </button>
        </details>
      )}
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
