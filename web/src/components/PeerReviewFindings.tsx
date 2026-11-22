import type { PeerReviewResult, ReviewCoverage, ReviewFinding } from "../types";
import "./PeerReview.css";

/** L77: what the reviewer found, where (file and lines), and which files it read or skipped (and why). */
const CATEGORY: Record<ReviewFinding["category"], [string, string]> = {
  bug: ["Bogue", "Bug"],
  risk: ["Risque", "Risk"],
  load: ["Charge", "Load"],
  test: ["Test manquant", "Missing test"],
  other: ["Autre", "Other"],
};
const SEVERITY: Record<ReviewFinding["severity"], [string, string]> = {
  critical: ["critique", "critical"],
  high: ["important", "high"],
  medium: ["moyen", "medium"],
  low: ["mineur", "low"],
};
const REASON: Record<NonNullable<ReviewCoverage["reason"]>, [string, string]> = {
  binary: ["fichier binaire", "binary file"],
  secret: ["fichier de secrets, jamais envoyé", "secrets file, never sent"],
  generated: ["fichier généré ou verrou", "generated or lock file"],
  "too-big": ["trop gros", "too big"],
  budget: ["au-delà de la limite de relecture", "beyond the review limit"],
  unavailable: ["indisponible", "unavailable"],
  reviewer: ["le relecteur n'a pas pu le lire", "the reviewer could not read it"],
  deleted: ["supprimé", "deleted"],
};

export function PeerReviewFindings({ review, fr }: { review: PeerReviewResult; fr: boolean }) {
  const i = fr ? 0 : 1;
  const findings = review.findings ?? [];
  const coverage = review.coverage ?? [];
  const reviewed = coverage.filter((c) => c.status === "reviewed").length;
  const skipped = coverage.filter((c) => c.status === "skipped");
  return (
    <>
      {findings.length > 0 && (
        <ul className="peer-findings" aria-label={fr ? "Points relevés" : "Findings"}>
          {findings.map((f, k) => (
            <li key={k} data-severity={f.severity}>
              <span>
                <strong>{CATEGORY[f.category][i]}</strong> · {SEVERITY[f.severity][i]}
              </span>
              <span className="peer-where">
                {f.path}
                {f.line > 0
                  ? `:${f.line}${f.endLine > f.line ? "–" + f.endLine : ""}${f.side === "old" ? (fr ? " (ancienne version)" : " (old version)") : ""}`
                  : fr ? " · ligne non retrouvée" : " · line not found"}
              </span>
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
      )}
      {coverage.length > 0 && (
        <details className="peer-coverage">
          <summary>
            {fr
              ? `${reviewed} fichier(s) relu(s), ${skipped.length} sauté(s)`
              : `${reviewed} file(s) reviewed, ${skipped.length} skipped`}
            {review.batches && review.batches > 1 ? (fr ? ` · ${review.batches} lots` : ` · ${review.batches} batches`) : ""}
            {review.dropped ? (fr ? ` · ${review.dropped} point(s) écarté(s) à la vérification` : ` · ${review.dropped} finding(s) dropped by the check`) : ""}
          </summary>
          <ul>
            {coverage.map((c) => (
              <li key={c.path}>
                {c.path} — {c.status === "reviewed" ? (fr ? "relu" : "reviewed") : `${fr ? "sauté : " : "skipped: "}${REASON[c.reason ?? "unavailable"][i]}`}
              </li>
            ))}
          </ul>
          {review.goal && <p>{fr ? "Le relecteur a reçu ta demande de départ." : "The reviewer was given your original request."}</p>}
        </details>
      )}
    </>
  );
}
