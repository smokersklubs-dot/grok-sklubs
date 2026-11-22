import { useState, useEffect } from "react";
import { api, errText } from "../api";
import { useStore } from "../store";
import type { PeerReviewState } from "../types";
import { ErrorNote } from "./ui";
import { PeerReviewFindings } from "./PeerReviewFindings";
export function PeerReview({ bot, seq, saved }: { bot: string; seq: number; saved: boolean }) {
  const bots = useStore((s) => s.bots),
    fr = useStore((s) => s.locale === "fr");
  const others = Object.values(bots).filter((b) => b.id !== bot && b.kind === "agent" && !b.access);
  const [choice, setChoice] = useState(""),
    [requesting, setBusy] = useState(false),
    [error, setError] = useState("");
  const base = "/bots/" + bot + "/cards/" + seq + "/files/review";
  const [status, setStatus] = useState<PeerReviewState>({ state: "none" });
  const review = status.review,
    working = status.state === "working",
    busy = requesting || working;
  useEffect(() => {
    if (!saved && !working) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const r = await api<PeerReviewState>("GET", base, undefined, abort.signal);
        if (!abort.signal.aborted) {
          setStatus(r);
          setError("");
          if (r.state === "working") timer = setTimeout(refresh, 2500);
        }
      } catch (e) {
        if (!abort.signal.aborted) {
          setError(errText(e));
          timer = setTimeout(refresh, 6000);
        }
      }
    }
    void refresh();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [base, saved, working]);
  const id = choice || others[0]?.id;
  if (!id && !review) return null;
  async function request() {
    setBusy(true);
    setError("");
    try {
      setStatus(await api<PeerReviewState>("POST", base, { reviewer: id }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="peer-review">
      {review && (
        <p role="status">
          <strong>
            {review.reviewer} ·{" "}
            {review.verdict === "approved"
              ? fr
                ? "Approuvé"
                : "Approved"
              : review.verdict === "changes"
                ? fr
                  ? "Corrections demandées"
                  : "Changes requested"
                : fr
                  ? "À vérifier"
                  : "Inconclusive"}
          </strong>
          <br />
          {review.reason}
          {review.partial && <small> · {fr ? "Diff partiel" : "Partial diff"}</small>}
        </p>
      )}
      {review && <PeerReviewFindings review={review} fr={fr} />}
      {id && (
        <div className="studio-actions">
          <label>
            {fr ? "Relecteur" : "Reviewer"}{" "}
            <select disabled={busy} value={id} onChange={(e) => setChoice(e.target.value)}>
              {others.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-small" disabled={busy} onClick={() => void request()}>
            {busy
              ? fr
                ? "Relecture en cours…"
                : "Reviewing…"
              : fr
                ? "Faire relire les modifications"
                : "Review changes"}
          </button>
        </div>
      )}
      <ErrorNote>{error || status.error}</ErrorNote>
    </div>
  );
}
