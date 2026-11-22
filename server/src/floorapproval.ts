import { fail } from "./routeinput.js";
import { securitySettings } from "./securitysettings.js";
import { rows, type ApprovalRecord } from "./store.js";
import { checkSecondFactor, twoFactorOn } from "./twofactor.js";
import type { Card } from "./shared.js";

/**
 * L44 (option, off by default — Settings → Security): approving an action of the floor needs the approver's second factor.
 *
 * "Floor" here is what the card itself says: an action that cannot be undone (`irreversible`: a payment, a deletion, a
 * message or email sent, a publication…) or a single-use card that says why it always asks (`once` + `why`: the
 * deterministic floor — a new recipient after outside content, a command on the owner's computer after outside content —,
 * a reviewer's objection, a voice or face copy). The same rule the web app uses to show the code field on the card.
 * A refusal ("deny") never needs a code. Whoever answers (the owner, or a workspace admin allowed to approve) types the
 * code of THEIR two-factor app; without two-factor sign-in on their account they cannot approve such a card while the
 * option is on (they are told how to turn it on).
 */
export const needsFloorCode = (card: Pick<Extract<Card, { type: "approval" }>, "irreversible" | "once" | "why"> | null | undefined) => !!card && (!!card.irreversible || (!!card.once && !!card.why));

export function checkFloorApproval(ownerId: string, approverId: string, approval: ApprovalRecord | null, decision: string, code: unknown): void {
  if (!approval || decision === "deny" || !securitySettings.get(ownerId).floorSecondFactor) return;
  const row = rows.get(approval.botId, approval.generation, approval.seq);
  const card = row?.body.kind === "card" && row.body.card.type === "approval" ? row.body.card : null;
  if (!needsFloorCode(card)) return;
  if (!twoFactorOn(approverId)) fail(403, "This approval needs the code of your two-factor app (Settings → Security). Turn on two-factor sign-in first (Settings → Account).");
  if (!String(code ?? "").trim()) fail(401, "Type the code of your two-factor app to approve this action.");
  if (!checkSecondFactor(approverId, String(code))) fail(401, "That code is not right (or was already used). Type the current code of your two-factor app.");
}
