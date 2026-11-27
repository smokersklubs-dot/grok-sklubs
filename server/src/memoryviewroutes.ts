import type { Context, Hono } from "hono";
import { emit } from "./bus.js";
import { messagesAround } from "./convsearch.js";
import { memoryPrefs, summaries } from "./agent/memoryprefs.js";
import { memoryFocus, setMemoryFocus } from "./agent/memorysave.js";
import { whyEntry } from "./agent/turnknow.js";
import { addDoc, addSiteNote, listDocs, listSiteNotes, ownScope, PlaceError, removeDoc, removeSiteNote } from "./agent/memoryplaces.js";
import { promptView } from "./agent/promptview.js";
import { embedderFor } from "./agent/semantic.js";
import { looksSecret } from "./agent/sensitive.js";
import { PROFILE_LIMITS } from "./agent/tools-team.js";
import type { SemanticSetting } from "./memorytypes.js";
import { body } from "./routeinput.js";
import { audit, bots, memories, settings, type BotRecord, type UserRecord } from "./store.js";

/**
 * Memory screens (registered after the session check, from memoryroutes.ts). Only the owner of a bot reaches it; anyone
 * else gets 404 (account isolation, hosted mode included).
 *   GET|POST /site-notes, DELETE /site-notes/:id      L88 « Mémoire liée à un site »
 *   GET|POST /docbase (?kind=bot|section&id=), DELETE /docbase/:id   L88 « Base de documents par bot ou projet »
 *   GET  /journal/:id/why               L137 « Pourquoi ? »: what allowed the action and what the bot knew then
 *   GET  /bots/:id/prompt-view          L137 « Ce que reçoit ce bot » (+ memory seen, its cost, L138 context gauge)
 *   GET  /bots/:id/summary              L80/L138 « Voir le résumé »: the latest summary of the current conversation
 *   PUT  /bots/:id/memory-prefs         L88 { noLearn } « Ne rien retenir » for this bot
 *   GET  /bots/:id/around?generation=&seq=&count=   L73 « Messages autour » of a search hit
 *   POST /memories/:id/to-profile       L88 « Ajouter à ma fiche »: the note goes into the shared profile every bot reads
 *   GET|PUT /memory/semantic            L71 « Mémoire par le sens » { enabled } (off by default)
 */
export function registerMemoryViewRoutes(api: Hono<any>) {
  const user = (c: Context) => c.get("user") as UserRecord;
  const ownAgent = (c: Context): BotRecord | null => {
    const b = bots.owned(user(c).id, c.req.param("id") ?? "");
    return b && b.kind === "agent" ? b : null;
  };
  const missing = (c: Context) => c.json({ error: "That bot does not exist." }, 404);

  // L88 « Mémoire liée à un site » and « Base de documents par bot ou projet » (agent/memoryplaces.ts); only the account's own
  const placeErr = (c: Context, e: unknown) => e instanceof PlaceError ? c.json({ error: e.message }, e.status) : Promise.reject(e);
  api.get("/site-notes", (c) => c.json({ notes: listSiteNotes(user(c).id) }));
  api.post("/site-notes", async (c) => { try { const b = await body(c); return c.json({ note: addSiteNote(user(c).id, b.site, b.text) }); } catch (e) { return placeErr(c, e); } });
  api.delete("/site-notes/:id", (c) => removeSiteNote(user(c).id, c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "Cette note n'existe pas." }, 404));
  api.get("/docbase", (c) => { try { return c.json({ docs: listDocs(user(c).id, ownScope(user(c).id, c.req.query("kind"), c.req.query("id"))) }); } catch (e) { return placeErr(c, e); } });
  api.post("/docbase", async (c) => { try { const b = await body(c); return c.json({ doc: addDoc(user(c).id, ownScope(user(c).id, b.kind, b.id), b.name, b.text) }); } catch (e) { return placeErr(c, e); } });
  api.delete("/docbase/:id", (c) => removeDoc(user(c).id, c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "Ce document n'existe pas." }, 404));
  // L137 « Pourquoi ? » on a line of the detailed journal: what allowed it, the user's last words, what the bot knew (turnknow.ts)
  api.get("/journal/:id/why", (c) => { const w = whyEntry(user(c).id, Number(c.req.param("id"))); return w ? c.json(w) : c.json({ error: "Cette ligne du journal n'existe pas." }, 404); });
  api.get("/bots/:id/prompt-view", (c) => { const b = ownAgent(c); return b ? c.json(promptView(b, user(c))) : missing(c); });
  api.get("/bots/:id/summary", (c) => { const b = ownAgent(c); return b ? c.json({ summary: summaries.latest(b.id, b.generation) }) : missing(c); });
  api.put("/bots/:id/memory-prefs", async (c) => {
    const b = ownAgent(c);
    if (!b) return missing(c);
    const v = (await body(c)).noLearn;
    if (typeof v !== "boolean") return c.json({ error: "noLearn must be true or false." }, 400);
    memoryPrefs.setNoLearn(b.id, v);
    audit(user(c).id, "account", `« Ne rien retenir » ${v ? "on" : "off"} for ${b.name}`, b.id);
    return c.json({ noLearn: memoryPrefs.noLearn(b.id) });
  });
  // L67 « Retiens surtout… »: the owner's words that guide what this bot learns (agent/memorysave.ts)
  api.get("/bots/:id/memory-focus", (c) => { const b = ownAgent(c); return b ? c.json({ text: memoryFocus(b.id) }) : missing(c); });
  api.put("/bots/:id/memory-focus", async (c) => {
    const b = ownAgent(c);
    if (!b) return missing(c);
    try { const text = setMemoryFocus(b.id, (await body(c)).text); audit(user(c).id, "account", `« Retiens surtout » ${text ? "set" : "cleared"} for ${b.name}`, b.id); return c.json({ text }); } catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });
  api.get("/bots/:id/around", (c) => {
    const b = ownAgent(c);
    if (!b) return missing(c);
    const gen = Number(c.req.query("generation") ?? b.generation), seq = Number(c.req.query("seq"));
    if (!Number.isInteger(gen) || !Number.isInteger(seq)) return c.json({ error: "generation and seq must be numbers." }, 400);
    const list = messagesAround(user(c).id, b.id, gen, seq, Number(c.req.query("count") ?? 3));
    return list ? c.json({ messages: list }) : c.json({ error: "That message does not exist." }, 404);
  });
  api.post("/memories/:id/to-profile", (c) => {
    const u = user(c);
    const m = memories.owned(u.id, c.req.param("id") ?? "");
    if (!m) return c.json({ error: "That memory does not exist." }, 404);
    if (looksSecret(m.text)) return c.json({ error: "This note looks like a secret: it stays out of the shared profile." }, 400);
    const cur = settings.profile(u.id).preferences;
    const line = `- ${m.text.replace(/\s+/g, " ").trim()}`;
    if (cur.split("\n").some((l) => l.trim() === line)) return c.json({ profile: settings.profile(u.id), already: true });
    const next = cur.trim() ? `${cur.trimEnd()}\n${line}` : line;
    if (next.length > PROFILE_LIMITS.preferences) return c.json({ error: "Your profile is full: shorten its preferences first (Settings → Profile)." }, 400);
    const profile = settings.saveProfile(u.id, { preferences: next });
    audit(u.id, "account", "Shared profile updated (a note was added)");
    emit(u.id, { type: "profile" });
    return c.json({ profile });
  });
  const semanticOf = (userId: string): SemanticSetting => {
    const e = embedderFor(userId);
    return { enabled: memoryPrefs.semantic(userId), provider: e?.label ?? null, model: e?.model ?? null };
  };
  api.get("/memory/semantic", (c) => c.json(semanticOf(user(c).id)));
  api.put("/memory/semantic", async (c) => {
    const v = (await body(c)).enabled;
    if (typeof v !== "boolean") return c.json({ error: "enabled must be true or false." }, 400);
    const u = user(c);
    if (v && !embedderFor(u.id)) return c.json({ error: "None of your AI providers offers this (an OpenAI or Mistral key is needed)." }, 400);
    memoryPrefs.setSemantic(u.id, v);
    audit(u.id, "account", `« Mémoire par le sens » ${v ? "on: notes are sent to the provider to be turned into vectors" : "off"}`);
    return c.json(semanticOf(u.id));
  });
}
