import { useState, useEffect } from "react";
import { t as tr } from "../i18n";
import { api, errText } from "../api";
import { useStore } from "../store";
import type { PeerReviewState } from "../types";
import { ErrorNote } from "./ui";
import { PeerReviewFindings } from "./PeerReviewFindings";
import { ReviewPlus, useCandidates } from "./PeerReviewPlus"; // L77 rest
export function PeerReview({ bot, seq, saved }: { bot: string; seq: number; saved: boolean }) {
  const bots = useStore((s) => s.bots),
    fr = useStore((s) => s.locale === "fr");
  const others = Object.values(bots).filter((b) => b.id !== bot && b.kind === "agent" && !b.access);
  const [more, setMore] = useState(false);
  const candidates = useCandidates(saved || more ? bot : ""), other = new Set(candidates.filter((c) => c.otherProvider).map((c) => c.id));
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
              ? tr("apiCard.approved")
              : review.verdict === "changes"
                ? tr("review.changesRequested")
                : tr("review.inconclusive")}
          </strong>
          <br />
          {review.reason}
          {review.partial && <small> · {tr("review.partialDiff")}</small>}
        </p>
      )}
      {review && <PeerReviewFindings review={review} fr={fr} />}
      {id && (
        <div className="studio-actions">
          <label>
            {tr("review.reviewer")}{" "}
            <select disabled={busy} value={id} onChange={(e) => setChoice(e.target.value)}>
              {others.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}{other.has(b.id) ? tr("review.otherProviderSuffix") : ""}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-small" disabled={busy} onClick={() => void request()}>
            {busy
              ? tr("review.reviewing")
              : tr("review.reviewChanges")}
          </button>
        </div>
      )}
      {saved || more ? <ReviewPlus bot={bot} seq={seq} fr={fr} changes={review?.verdict === "changes"} candidates={candidates} />
        : others.length >= 2 && <button className="btn btn-ghost btn-small" onClick={() => setMore(true)}>{tr("review.reviewSeveral")}</button>}
      <ErrorNote>{error || status.error}</ErrorNote>
    </div>
  );
}
