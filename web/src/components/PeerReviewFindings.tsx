import type { PeerReviewResult, ReviewCoverage, ReviewFinding } from "../types";
import { t as tr, type Key } from "../i18n";
import "./PeerReview.css";

/** L77: what the reviewer found, where (file and lines), and which files it read or skipped (and why). */
const CATEGORY: Record<ReviewFinding["category"], Key> = {
  bug: "review.cat.bug",
  risk: "review.cat.risk",
  load: "review.cat.load",
  test: "review.cat.test",
  other: "review.cat.other",
};
const SEVERITY: Record<ReviewFinding["severity"], Key> = {
  critical: "review.sev.critical",
  high: "review.sev.high",
  medium: "review.sev.medium",
  low: "review.sev.low",
};
const REASON: Record<NonNullable<ReviewCoverage["reason"]>, Key> = {
  binary: "review.reason.binary",
  secret: "review.reason.secret",
  generated: "review.reason.generated",
  "too-big": "review.reason.too_big",
  budget: "review.reason.budget",
  unavailable: "review.reason.unavailable",
  reviewer: "review.reason.reviewer",
  deleted: "review.reason.deleted",
};

export function PeerReviewFindings({ review, fr }: { review: PeerReviewResult; fr: boolean }) {
  const findings = review.findings ?? [];
  const coverage = review.coverage ?? [];
  const reviewed = coverage.filter((c) => c.status === "reviewed").length;
  const skipped = coverage.filter((c) => c.status === "skipped");
  return (
    <>
      {findings.length > 0 && (
        <ul className="peer-findings" aria-label={tr("review.findings")}>
          {findings.map((f, k) => (
            <li key={k} data-severity={f.severity}>
              <span>
                <strong>{tr(CATEGORY[f.category])}</strong> · {tr(SEVERITY[f.severity])}
              </span>
              <span className="peer-where">
                {f.path}
                {f.line > 0
                  ? `:${f.line}${f.endLine > f.line ? "–" + f.endLine : ""}${f.side === "old" ? tr("review.oldVersionSuffix") : ""}`
                  : tr("review.lineNotFoundSuffix")}
              </span>
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
      )}
      {coverage.length > 0 && (
        <details className="peer-coverage">
          <summary>
            {tr("review.reviewedFileSReviewed", { reviewed, skipped: skipped.length })}
            {review.batches && review.batches > 1 ? tr("review.batchesSuffix", { n: review.batches }) : ""}
            {review.dropped ? tr("review.droppedSuffix", { n: review.dropped }) : ""}
          </summary>
          <ul>
            {coverage.map((c) => (
              <li key={c.path}>
                {c.path} — {c.status === "reviewed" ? (tr("review.reviewed")) : tr("review.skippedWhy", { why: tr(REASON[c.reason ?? "unavailable"]) })}
              </li>
            ))}
          </ul>
          {review.goal && <p>{tr("review.reviewerWasGivenOriginal")}</p>}
        </details>
      )}
    </>
  );
}
