import type { Hono } from "hono";
import { bots } from "./store.js";
import { q } from "./db.js";
import { computerKind } from "./computer.js";
import { freeComputerPlan } from "./hosted.js";
import { defaultModelRef, resolveModel } from "./llm/index.js";
import { engineOf, isEngineRef } from "./agent/engine.js";
import { subLimitFor } from "./agent/sublimit.js";
import { sharedView } from "./sharedcomputers.js";
import { connectBlock } from "./subscriptionconnect.js";

/** Opening a conversation must not wake another computer or consume a model turn. */
export function registerWorkContext(api: Hono<any>) {
  api.get("/bots/:id/work-context", c => {
    const owner = c.get("user").id;
    const bot = bots.owned(owner, c.req.param("id") ?? "");
    if (!bot || bot.hidden || bot.kind !== "agent") return c.notFound();
    const ref = bot.model || defaultModelRef();
    const engine = isEngineRef(ref) ? engineOf(ref) : null;
    let label = ref, state = "unchecked";
    if (engine && connectBlock(owner)) state = "unavailable";
    if (!engine) {
      try {
        const { provider, model } = resolveModel(ref, owner);
        label = provider.label + " · " + model;
        state = provider.id === "demo" ? "demo" : "configured";
      } catch { state = "unavailable"; }
    }
    const limited = subLimitFor(bot);
    const rate = engine && q.get("SELECT 1 FROM bot_failures WHERE bot_id=? AND provider=? AND class='rate_limited' AND status IN ('auto','waiting','retrying') LIMIT 1", bot.id, engine);
    const kind = computerKind();
    const target = kind !== "linux" ? kind : freeComputerPlan(owner) ? "pool" : bot.computerMode;
    const shared = target === "shared" ? sharedView(owner).find(d => d.busyWith === bot.id)?.name : undefined;
    return c.json({ label, engine, state, target, shared, limited: Boolean(limited || rate), until: limited?.until ?? null }, 200, {"cache-control":"no-store"});
  });
}
