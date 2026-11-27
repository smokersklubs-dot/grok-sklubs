/**
 * L175 « Livrer par demande d'intégration » (workboardpr.ts) — the routes, behind the session like every /api route. The
 * card is looked up with the caller's id BEFORE anything is checked: another account's card reads as missing (404).
 *
 *  GET    /board/github-accounts                 { accounts: [{ id, name }] }  the caller's GitHub Code accounts
 *  PUT    /board/tasks/:id/delivery { repo, folder, connectorId, base?, branch?, identityName?, identityEmail? } → { delivery }
 *  DELETE /board/tasks/:id/delivery              back to a local delivery
 *  POST   /board/tasks/:id/delivery/approve      the owner's go-ahead before the first push to that repository
 *  POST   /board/tasks/:id/delivery/decline      nothing is pushed; the task stops with that reason
 *  POST   /board/tasks/:id/delivery/retry        after a refusal or a closed pull request
 */
import type { Context, Hono } from "hono";
import type { UserRecord } from "./store.js";
import { approveDelivery, clearDelivery, declineDelivery, DeliveryError, deps, retryDelivery, setDelivery } from "./workboardpr.js";
import { dt } from "./workboardpri18n.js";

type Env = { Variables: { user: UserRecord } };

function guard(c: Context<Env>, fn: () => Response | Promise<Response>) {
  return Promise.resolve().then(fn).catch((e) => {
    if (e instanceof DeliveryError) return c.json({ error: dt(c.get("user").locale, e.message, e.vars) }, e.status);
    throw e;
  });
}

export function registerBoardDeliveryRoutes(api: Hono<Env>) {
  const uid = (c: Context<Env>) => c.get("user").id;
  const id = (c: Context<Env>) => c.req.param("id") ?? "";
  api.get("/board/github-accounts", (c) => guard(c, async () => c.json({ accounts: (await deps.accounts(uid(c))).map((a) => ({ id: a.id, name: a.name })) })));
  api.put("/board/tasks/:id/delivery", (c) => guard(c, async () => c.json({ delivery: await setDelivery(uid(c), id(c), ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>) })));
  api.delete("/board/tasks/:id/delivery", (c) => guard(c, () => { clearDelivery(uid(c), id(c)); return c.json({ ok: true }); }));
  api.post("/board/tasks/:id/delivery/approve", (c) => guard(c, async () => c.json({ delivery: await approveDelivery(uid(c), id(c)) })));
  api.post("/board/tasks/:id/delivery/decline", (c) => guard(c, () => c.json({ delivery: declineDelivery(uid(c), id(c)) })));
  api.post("/board/tasks/:id/delivery/retry", (c) => guard(c, async () => c.json({ delivery: await retryDelivery(uid(c), id(c)) })));
}
