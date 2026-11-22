import type { Context, Hono } from "hono";
import { RateWindow } from "./hardening.js";
import type { UserRecord } from "./store.js";
import { TeamMdError } from "./teammd.js";
import { commitTeamMd, exportTeamMd, previewTeamMd } from "./teammdimport.js";
import { TEAM_MD_MAX_BYTES } from "./teammdtypes.js";

/**
 * « Équipe Sklubot (.md) » (teammd.ts, teammdimport.ts, docs/FORMAT-EQUIPE.md), registered after the session check.
 * Everything acts on the signed-in account's own bots only; errors go through routes.ts onError (TeamMdError is a
 * GrokImportError, plan limits are PlanLimitError).
 *   POST /team-md/preview   { text, filename } | { url }   reads the file; creates nothing
 *   POST /team-md/commit    TeamMdCommitInput             creates (or updates) what the owner kept
 *   POST /team-md/export    { sectionId } | { botIds }    the caller's own bots as a .md file (text in the answer)
 */
const fetches = new RateWindow(20, 3_600_000);
const calls = new RateWindow(60, 60_000);

export function registerTeamMdRoutes(api: Hono<any>) {
  const read = async (c: Context): Promise<Record<string, any>> => {
    const user = c.get("user") as UserRecord;
    if (calls.over(user.id)) throw new TeamMdError("throttled", "Too many tries. Wait a little and try again.", {}, 400);
    // The text travels as JSON: room for 512 KB of escaped Markdown, no more.
    if (Number(c.req.header("content-length") ?? 0) > TEAM_MD_MAX_BYTES * 3) throw new TeamMdError("too_large", "That file is too large (512 KB at most).", {}, 413);
    const parsed = await c.req.json().catch(() => ({}));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  };
  api.post("/team-md/preview", async (c) => {
    const user = c.get("user") as UserRecord;
    const b = await read(c);
    // An address is fetched by the server: a few per account and per hour.
    if (typeof b.url === "string" && b.url.trim() && fetches.over(user.id)) throw new TeamMdError("throttled", "Too many tries. Wait a little and try again.");
    return c.json(await previewTeamMd(user, { text: b.text, url: b.url, filename: b.filename }));
  });
  api.post("/team-md/commit", async (c) => c.json({ report: commitTeamMd(c.get("user") as UserRecord, await read(c)) }));
  api.post("/team-md/export", async (c) => {
    const b = await read(c);
    return c.json(exportTeamMd(c.get("user") as UserRecord, { sectionId: b.sectionId, botIds: b.botIds, includeApps: b.includeApps, name: b.name, description: b.description }));
  });
}
