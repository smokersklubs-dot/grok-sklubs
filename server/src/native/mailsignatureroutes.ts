import type { Hono } from "hono";
import { tr } from "../i18n.js";
import { fail } from "../routeinput.js";
import { audit, type UserRecord } from "../store.js";
import { accounts } from "./accounts.js";
import { MAX_SIGNATURE, setSignature, signatureOf } from "./mailextras.js";

type E = { Variables: { user: UserRecord } };

/** L83 — the owner's signature of one of their mail accounts (Gmail, Outlook): GET, PUT { text } ("" removes it). */
export function registerMailSignatureRoutes(api: Hono<E>) {
  const mailAccount = (userId: string, id: string, locale: UserRecord["locale"]) => {
    const acc = accounts.owned(userId, id);
    if (!acc || (acc.app !== "gmail" && acc.app !== "outlook")) return fail(404, tr(locale, "That account does not exist."));
    return acc;
  };
  api.get("/native/accounts/:id/signature", (c) => {
    const user = c.get("user");
    const acc = mailAccount(user.id, c.req.param("id"), user.locale);
    return c.json({ text: signatureOf(acc.id), max: MAX_SIGNATURE });
  });
  api.put("/native/accounts/:id/signature", async (c) => {
    const user = c.get("user");
    const acc = mailAccount(user.id, c.req.param("id"), user.locale);
    const b = (await c.req.json().catch(() => ({}))) as { text?: unknown };
    let text: string;
    try { text = setSignature(user.id, acc.id, b.text); } catch { return fail(400, tr(user.locale, "A signature has {n} characters at most.", { n: MAX_SIGNATURE })); }
    audit(user.id, "apps", text ? `${acc.name}: signature saved` : `${acc.name}: signature removed`);
    return c.json({ text, max: MAX_SIGNATURE });
  });
}
