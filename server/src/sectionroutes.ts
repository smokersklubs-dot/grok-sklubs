import type { Hono } from "hono";
import { setPause } from "./agent/pause.js";
import { emit } from "./bus.js";
import { body, fail } from "./routeinput.js";
import { sections, type UserRecord } from "./store.js";

function projectInstructions(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 4000) return fail(400, "Use up to 4000 characters for the project instructions.");
  return value.trim();
}

export function registerSectionRoutes(api: Hono<{ Variables: { user: UserRecord } }>) {
  api.get("/sections", (c) => c.json({ sections: sections.list(c.get("user").id) }));
  api.post("/sections", async (c) => {
    const user = c.get("user");
    const b = await body(c);
    const name = String(b.name ?? "").trim();
    if (!name) fail(400, "Give the section a name.");
    if (sections.list(user.id).length >= 30) fail(409, "You already have 30 sections.");
    const section = sections.create(user.id, name, projectInstructions(b.instructions));
    emit(user.id, { type: "sections" });
    return c.json({ section });
  });
  api.patch("/sections/:id", async (c) => {
    const user = c.get("user");
    const cur = sections.owned(user.id, c.req.param("id")) ?? fail(404, "That section does not exist.");
    const b = await body(c);
    if (b.name !== undefined && !String(b.name).trim()) fail(400, "Give the section a name.");
    const pos = b.position === undefined || b.position === null ? undefined : Number(b.position);
    sections.update(cur.id, { name: b.name === undefined ? undefined : String(b.name), position: pos !== undefined && Number.isFinite(pos) ? pos : undefined, instructions: projectInstructions(b.instructions) });
    emit(user.id, { type: "sections" });
    return c.json({ section: sections.owned(user.id, cur.id) });
  });
  api.delete("/sections/:id", (c) => {
    const user = c.get("user");
    const cur = sections.owned(user.id, c.req.param("id")) ?? fail(404, "That section does not exist.");
    // A paused section is resumed first: its bots go back to the team list free, with their waiting work.
    if (cur.paused) setPause(user, "section", cur.id, false, cur.name);
    sections.remove(user.id, cur.id);
    emit(user.id, { type: "sections" });
    emit(user.id, { type: "roster" });
    return c.json({ ok: true });
  });
}
