/**
 * Whether a call's stored summary is a human sentence worth showing. Older rows may hold an internal side answer (the
 * memory pass's {"facts": []}, or other JSON) that leaked there before the server checked it (server/src/calls.ts
 * callSummaryText): those are hidden, never shown raw.
 */
export function isHumanSummary(summary: unknown): boolean {
  if (typeof summary !== "string") return false;
  const s = summary.trim();
  if (!s || /^[[{<`]/.test(s) || /[{}]/.test(s) || /"\w+"\s*:/.test(s)) return false;
  try {
    const j: unknown = JSON.parse(s);
    if (j !== null && typeof j === "object") return false;
  } catch { /* not JSON: a sentence */ }
  return /\p{L}{2,}/u.test(s);
}
