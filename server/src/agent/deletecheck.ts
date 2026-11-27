/*
 * Portions adapted from Fei2411/DS-Bot (https://github.com/Fei2411/DS-Bot, commit d104d9ca18d69a35460f14e15dff4d553181433a),
 * ds-bot/src/host/browser/session.js (clickWithOptions: the "delete" check, pendingDelete / clearPendingDelete),
 * Copyright 2026 Fei2411 and the DS Bot contributors, Apache License 2.0. Modified for Sklubot: TypeScript, run in bind.ts
 * before the click is judged (so the check costs no approval card); the element is identified by its DevTools node,
 * document and tab (the helper refuses a committing click on any other node: screen-elements.ts check_node) instead of
 * a data attribute set in the page; pixel clicks are matched by the point, the words, the site and the form; a check
 * lapses after 5 minutes.
 *
 * DS-Bot item 10 (docs/audits/AUDIT-DS-BOT.md #104) — two-step delete in the browser. A click on a control whose words
 * delete something (bind.ts committingKind → "delete": supprimer, effacer, delete, remove…) is first refused, nothing
 * clicked: the bot is told what would be deleted, on which site, and to check it is the right item. Only a second call
 * with confirm: true, on the very same element (or the same point, words, site and form), goes on — and then through the
 * usual judgment (the user's words, the reviewer or an approval card) and the committing-click gate, unchanged. Any other
 * click in between, or 5 minutes, clears the check.
 */
import { resolveRef } from "./elements.js";
import type { SeenTarget } from "./bind.js";

interface Pending { key: string; label: string; host: string; form: string; at: number }
const pending = new Map<string, Pending>();
export const DELETE_CHECK_MS = 5 * 60_000;

/** What identifies the element (element_click: its node in that document and tab) or the point (screen_click). */
function keyOf(botId: string, name: string, input: Record<string, unknown>): string | null {
  if (name === "element_click") {
    const found = resolveRef(botId, input.ref);
    if ("error" in found) return null;
    const r = found.req as { node?: unknown; loader?: unknown; target?: unknown };
    return `el:${String(r.target ?? "")}:${String(r.loader ?? "")}:${String(r.node ?? "")}`;
  }
  return `xy:${Math.round(Number(input.x))}:${Math.round(Number(input.y))}`;
}

/**
 * Called by bindCall once `seen_target` is read. A delete control: either this is the confirmation of the pending check
 * (`seen_delete: "confirmed"`, the click is judged as usual), or it becomes the check (`seen_delete: "check"`, the target
 * moves to `seen_check`, so nothing commits and the tool answers without clicking). Any other click clears the check.
 */
export function stageDelete(botId: string, name: string, input: Record<string, unknown>, seen: SeenTarget | null, isDelete: boolean, now = Date.now()) {
  if (!seen || !isDelete) { pending.delete(botId); return; }
  const key = keyOf(botId, name, input);
  const p = pending.get(botId);
  if (input.confirm === true && key && p && p.key === key && p.label === seen.label && p.host === seen.host && p.form === seen.form && now - p.at <= DELETE_CHECK_MS) {
    pending.delete(botId);
    input.seen_delete = "confirmed";
    return;
  }
  if (key) pending.set(botId, { key, label: seen.label, host: seen.host, form: seen.form, at: now });
  else pending.delete(botId);
  input.seen_delete = "check";
  input.seen_check = seen;
  delete input.seen_target;
}

/** The tool's answer for a check (no click done); null when the call is not a check. */
export function deleteCheckAnswer(input: Record<string, unknown>): { content: string; summary: string } | null {
  if (input.seen_delete !== "check") return null;
  const seen = input.seen_check as SeenTarget | undefined;
  const label = seen?.label || "?", host = seen?.host || "?";
  const again = input.confirm === true ? " (your confirm: true did not match: the item changed, the page moved, or the check lapsed)" : "";
  return {
    content: `This would delete “${label}” on ${host}. Nothing was deleted yet${again}. Check it is the right item — take a screenshot or element_snapshot if you are not sure — then call the same click again on that same element with confirm: true. The user may still be asked to approve it.`,
    summary: "delete: check first",
  };
}

export const clearDeleteCheck = (botId: string) => { pending.delete(botId); };
