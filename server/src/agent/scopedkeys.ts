import { policies } from "../store.js";
import type { ToolUseBlock } from "../llm/index.js";
import type { Turn, Verdict } from "./loop.js";

/**
 * L43 — « Toujours » and « pour cette conversation » cover exactly what the card showed (cleanroom T59, written from
 * the behaviour only).
 *
 * Most permission keys are already narrow: one app action (`Gmail: mail_send`), one site (`web: <host>`,
 * `click: <host>`), one vault item, one command prefix in one folder on the owner's computer (mycomputer.ts). A few
 * built-in tools still asked under their bare name, so "Always" on one call allowed every later call of that tool:
 *
 *   shell_run   → `shell_run: <the exact command>` (spaces evened out). Approving `npm test` does not approve
 *                 `npm test && rm -rf ~` or `curl … | sh`.
 *   file_save   → `file_save: <the file's path>` in the bot's library.
 *
 * Applied in authorize.ts right after judge(): a card under the bare key gets the narrow key instead (so "Always" and a
 * conversation grant are saved for that exact command or file); an "always allow" or "blocked" saved on the narrow key
 * is honoured; a broad rule the owner set by hand in Settings → Permissions (the bare key) still counts, as before. When
 * the target cannot be told (empty command, no path), the card offers only "once".
 */
export const SCOPED: Record<string, (input: Record<string, unknown>) => string> = {
  shell_run: (a) => String(a.command ?? "").trim().replace(/\s+/g, " ").slice(0, 500),
  file_save: (a) => String(a.filename ?? a.path ?? "").trim().replace(/^\.?\/+/, "").slice(0, 300),
};

export const scopedKey = (name: string, input: Record<string, unknown>): string | null => {
  const scope = SCOPED[name]?.(input);
  return scope === undefined ? null : scope ? `${name}: ${scope}` : "";
};

export function scopeVerdict(turn: Pick<Turn, "user" | "builtin">, call: ToolUseBlock, verdict: Verdict): Verdict {
  if (verdict.kind !== "ask" || verdict.policyKey !== call.name || !turn.builtin.has(call.name)) return verdict;
  const key = scopedKey(call.name, call.input);
  if (key === null) return verdict;
  if (key === "") return { ...verdict, once: true };
  const p = policies.get(turn.user.id, key);
  if (p === "blocked") return { kind: "block" };
  if (p === "always_allow" && !verdict.fixed) return { kind: "allow" };
  return { ...verdict, policyKey: key };
}
