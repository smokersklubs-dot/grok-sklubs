/**
 * L77 « Relecture entre bots »: what a finished peer review returns (wire type, also used by the web screen).
 * The grid follows open-code-review's comment categories (alibaba/open-code-review, Apache-2.0), narrowed to the four
 * questions the owner asked for: a bug, a risk (security, data loss), a load problem (performance, cost) and a missing
 * test. `other` keeps anything else the reviewer found worth saying.
 */
export type ReviewCategory = "bug" | "risk" | "load" | "test" | "other";
export type ReviewSeverity = "critical" | "high" | "medium" | "low";

/** One problem, anchored to lines of the file when the quoted code was found (line 0: place not found, said honestly). */
export interface ReviewFinding {
  path: string;
  /** First and last line in the new version of the file (`side: "old"`: in the old one, for removed code); 0 = not located. */
  line: number;
  endLine: number;
  side: "new" | "old";
  category: ReviewCategory;
  severity: ReviewSeverity;
  text: string;
}

/** Every file of the change ends « relu » or « sauté » with its reason (open-code-review's mandatory coverage). */
export interface ReviewCoverage {
  path: string;
  status: "reviewed" | "skipped";
  /** Why it was skipped: binary, secret, generated (lock file, build output, minified, vendored), too-big, budget, unavailable, reviewer. */
  reason?: "binary" | "secret" | "generated" | "too-big" | "budget" | "unavailable" | "reviewer" | "deleted";
}

export interface PeerReviewResult {
  reviewer: string;
  verdict: "approved" | "changes" | "inconclusive";
  reason: string;
  partial: boolean;
  at: number;
  /** Absent on reviews made before L77. */
  findings?: ReviewFinding[];
  coverage?: ReviewCoverage[];
  /** How many findings the fact-checking pass removed as proven wrong. */
  dropped?: number;
  /** The user's request of that turn was given to the reviewer. */
  goal?: boolean;
  /** Lots the change was split into (1 for a small change). */
  batches?: number;
  /** Read-only look-ups the reviewer made (read a whole file, search the snapshot). */
  lookups?: number;
}
