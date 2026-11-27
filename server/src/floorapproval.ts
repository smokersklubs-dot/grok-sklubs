import { fail } from "./routeinput.js";
import { securitySettings } from "./securitysettings.js";
import { rows, type ApprovalRecord } from "./store.js";
import { checkSecondFactor, twoFactorOn } from "./twofactor.js"; import { consumeProof, hasPasskey } from "./passkeys.js";
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
 * L44 (25/11): a passkey also does (passkeys.ts): its answer, checked with user verification required — possession plus
 * PIN or biometrics, two factors on their own (W3C WebAuthn L3 §6.2.3, https://www.w3.org/TR/webauthn-3/#sctn-authenticator-uv) —
 * becomes a one-time proof "pk:…" bound to THIS approval, sent in place of the code.
 */
/** Whether this account can answer a floor card: a two-factor app or at least one passkey. */
export const hasFloorFactor = (userId: string) => twoFactorOn(userId) || hasPasskey(userId);
/** A two-factor code, or a passkey proof made for `purpose` ("floor:<approval id>", "floor-off"). Used once either way. */
export const checkFloorFactor = (userId: string, code: unknown, purpose: string): boolean =>
  String(code ?? "").startsWith("pk:") ? consumeProof(userId, purpose, code) : twoFactorOn(userId) && !!checkSecondFactor(userId, String(code ?? ""));
export const needsFloorCode = (card: Pick<Extract<Card, { type: "approval" }>, "irreversible" | "once" | "why"> | null | undefined) => !!card && (!!card.irreversible || (!!card.once && !!card.why));

export function checkFloorApproval(ownerId: string, approverId: string, approval: ApprovalRecord | null, decision: string, code: unknown): void {
  if (!approval || decision === "deny" || !securitySettings.get(ownerId).floorSecondFactor) return;
  const row = rows.get(approval.botId, approval.generation, approval.seq);
  const card = row?.body.kind === "card" && row.body.card.type === "approval" ? row.body.card : null;
  if (!needsFloorCode(card)) return;
  if (!hasFloorFactor(approverId)) fail(403, "This approval needs the code of your two-factor app or a passkey (Settings → Security). Turn on two-factor sign-in (Settings → Account) or add a passkey first.");
  if (!String(code ?? "").trim()) fail(401, "Type the code of your two-factor app (or use your passkey) to approve this action.");
  if (!checkFloorFactor(approverId, code, `floor:${approval.id}`)) fail(401, "That code is not right (or was already used). Type the current code of your two-factor app, or use your passkey again.");
}
