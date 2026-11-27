import type { Hono } from "hono";
import { approvals, type UserRecord } from "../store.js";
import { conversationGrants } from "./conversationgrants.js";
import { decideApproval } from "./loop.js";

/**
 * « Autoriser pour cette conversation » (conversationgrants.ts), the owner's side. Behind the session like every /api
 * route, and always scoped to the caller's own account: someone else's grant is a 404, like an id that does not exist.
 *
 *  GET    /conversation-grants            the caller's active grants (Settings → Permissions)
 *  DELETE /conversation-grants/:grantId   "Retirer": the grant ends now
 *
 * The answer itself comes through POST /approvals/:approvalId { decision: "conversation" } (routes.ts), which calls
 * decideForConversation below — for the account's owner only (a workspace admin's answer stays "once").
 */
type Env = { Variables: { user: UserRecord } };

export function registerConversationGrantRoutes(api: Hono<Env>) {
  api.get("/conversation-grants", (c) => c.json({ grants: conversationGrants.list(c.get("user").id) }));
  api.delete("/conversation-grants/:grantId", (c) => {
    if (!conversationGrants.revoke(c.get("user").id, c.req.param("grantId"))) return c.json({ error: "That permission no longer exists." }, 404);
    return c.json({ ok: true });
  });
}

/**
 * The owner pressed "Autoriser pour cette conversation" on a card. It is first a yes for the action on the card
 * (decideApproval, as "once"); then, if the server had offered it on that card, the grant for the rest of the
 * conversation. A card that never offered it (a payment, a deletion, a routine's card…) just counts as once.
 */
export function decideForConversation(userId: string, approvalId: string): boolean {
  const before = approvals.byId(approvalId);
  if (!before || before.userId !== userId) return false;
  const wasPending = before.status === "pending";
  if (!decideApproval(userId, approvalId, "allow")) return false;
  // Only when this very answer allowed it (not a card that lapsed, or one answered earlier).
  if (wasPending && approvals.byId(approvalId)?.status === "allowed") conversationGrants.fromApproval(before);
  return true;
}
