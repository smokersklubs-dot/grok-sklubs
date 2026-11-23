import type { Context, Hono } from "hono";
import { APERTURES, CAMERA_MOVES, CAMERAS, FOCALS, LENSES } from "./camerawords.js";
import { hostedMode, isOperator } from "./hosted.js";
import { mediaJobs } from "./mediajobs.js";
import { isMediaProvider, MediaKeyError, mediaKeys } from "./mediakeys.js";
import { devices, labelOf, liveDevice } from "./relay.js";
import { body, fail } from "./routeinput.js";
import { bots, type UserRecord } from "./store.js";
import { DEFAULT_WAN2GP_PORT, WAN2GP_CATALOG } from "./wan2gp.js";
import { checkWan2gpUrl, wan2gpClient, wan2gpTarget, Wan2gpSetupError } from "./wan2gptarget.js";

/**
 * Settings → Keys → « Création (images et vidéos) » (audit Open Generative AI §5 items 6, 7, 14). Behind the session; every
 * query is by the signed-in account, a key is never sent back (only "saved").
 *   GET    /media-keys                       saved providers (no key), the account's computers, recent Wan2GP runs
 *   PUT    /media-keys/:provider             { key?, baseUrl?, model?, deviceId? }   xai | gemini | image | wan2gp
 *   DELETE /media-keys/:provider
 *   POST   /media-keys/wan2gp/check          is the owner's Wan2GP answering (MCP probe)?
 *   GET    /camera-words                     camera movement / camera / lens words for the video studio
 */
const FR: Record<string, string> = {
  "Unknown provider.": "Fournisseur inconnu.",
  "Paste the API key (no spaces).": "Colle la clé d'API (sans espace).",
  "Give the full address (https://…).": "Donne l'adresse complète (https://…).",
  "The address must not contain a user name or a password.": "L'adresse ne doit contenir ni nom d'utilisateur ni mot de passe.",
  "Choose your computer (Relais) or type the address of your Wan2GP server.": "Choisis ton ordinateur (Relais) ou tape l'adresse de ton serveur Wan2GP.",
  "That computer is not linked to your account.": "Cet ordinateur n'est pas relié à ton compte.",
  "On your computer, Wan2GP is reached at 127.0.0.1 only: give just the port, for example http://127.0.0.1:7866.": "Sur ton ordinateur, Wan2GP est joint sur 127.0.0.1 seulement : donne juste le port, par exemple http://127.0.0.1:7866.",
  "On this hosted service, Wan2GP runs on your own computer through the Sklubot Relais: choose your computer instead of an address.": "Sur ce service hébergé, Wan2GP tourne sur ton propre ordinateur via le Relais Sklubot : choisis ton ordinateur au lieu d'une adresse.",
  "This address cannot be found.": "Cette adresse est introuvable.",
  "This address is refused (link-local or cloud metadata).": "Cette adresse est refusée (lien local ou métadonnées du cloud).",
  "Only the owner of this server can use a Wan2GP address on a private network. Use a public address, or your own computer through the Sklubot Relais.": "Seul le propriétaire de ce serveur peut utiliser une adresse Wan2GP sur un réseau privé. Utilise une adresse publique, ou ton propre ordinateur via le Relais Sklubot.",
  "Wan2GP is not set up.": "Wan2GP n'est pas configuré.",
  "Your computer is not connected (open the Sklubot Relais).": "Ton ordinateur n'est pas connecté (ouvre le Relais Sklubot).",
  "Wan2GP answers: {server} {version}.": "Wan2GP répond : {server} {version}.",
  "Wan2GP does not answer: {why}": "Wan2GP ne répond pas : {why}",
};

export function registerMediaRoutes(api: Hono<any>) {
  const user = (c: Context) => c.get("user") as UserRecord;
  const say = (c: Context, en: string, vars: Record<string, string> = {}) => (user(c).locale === "fr" ? FR[en] ?? en : en).replace(/\{(\w+)\}/g, (_m, k) => vars[k] ?? "");
  const guard = async <T>(c: Context, fn: () => Promise<T> | T): Promise<T> => {
    try { return await fn(); } catch (e) {
      if (e instanceof MediaKeyError || e instanceof Wan2gpSetupError) return fail(e.status, say(c, e.message));
      throw e;
    }
  };
  const state = (c: Context) => {
    const u = user(c);
    return {
      keys: mediaKeys.list(u.id),
      computers: devices.list(u.id).map((d) => { const live = liveDevice(u.id, d.id); return { id: d.id, label: labelOf(d), online: !!live, gpu: !!live?.capabilities.includes("gpu.http") }; }),
      // A Wan2GP address on a private network: self-hosted servers, and only for the instance's owner (wan2gptarget.ts).
      urlAllowed: !hostedMode(), privateUrlAllowed: !hostedMode() && isOperator(u.id),
      models: WAN2GP_CATALOG.map((m) => ({ id: m.id, name: m.name, type: m.type, needsImage: !!m.needsImage })),
      jobs: mediaJobs.forUser(u.id).map((j) => ({ id: j.id, kind: j.kind, status: j.status, jobId: j.job_id, createdAt: j.created_at, updatedAt: j.updated_at })),
      defaultPort: DEFAULT_WAN2GP_PORT,
    };
  };

  api.get("/media-keys", (c) => c.json(state(c)));
  api.put("/media-keys/:provider", async (c) => {
    const provider = c.req.param("provider");
    if (!isMediaProvider(provider)) return fail(404, say(c, "Unknown provider."));
    const b = await body(c);
    await guard(c, async () => {
      const input: Record<string, unknown> = { key: b.key, model: b.model, baseUrl: b.baseUrl, deviceId: b.deviceId };
      if (provider === "wan2gp") {
        const deviceId = typeof b.deviceId === "string" ? b.deviceId.trim() : "";
        if (deviceId) {
          if (!devices.owned(user(c).id, deviceId)) throw new MediaKeyError(404, "That computer is not linked to your account.");
          const port = Number(b.port) || (() => { try { return Number(new URL(String(b.baseUrl ?? "")).port); } catch { return 0; } })() || DEFAULT_WAN2GP_PORT;
          if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new MediaKeyError(400, "On your computer, Wan2GP is reached at 127.0.0.1 only: give just the port, for example http://127.0.0.1:7866.");
          input.baseUrl = `http://127.0.0.1:${port}`;
        } else if (typeof b.baseUrl === "string" && b.baseUrl.trim()) input.baseUrl = await checkWan2gpUrl(b.baseUrl.trim(), user(c).id);
      }
      return mediaKeys.set(user(c).id, provider, input);
    });
    return c.json(state(c));
  });
  api.delete("/media-keys/:provider", (c) => {
    const provider = c.req.param("provider");
    if (!isMediaProvider(provider)) return fail(404, say(c, "Unknown provider."));
    mediaKeys.remove(user(c).id, provider);
    return c.json(state(c));
  });
  api.post("/media-keys/wan2gp/check", async (c) => {
    const u = user(c);
    const t = wan2gpTarget(u.id);
    if (!t) return c.json({ ok: false, message: say(c, "Wan2GP is not set up.") });
    if (t.mode === "relay" && !liveDevice(u.id, t.deviceId)) return c.json({ ok: false, message: say(c, "Your computer is not connected (open the Sklubot Relais).") });
    const bot = bots.primary(u.id);
    try {
      const info = await wan2gpClient(u.id, t, { id: bot?.id ?? "sklubot", name: bot?.name ?? "Sklubot" }).probe();
      return c.json({ ok: true, message: say(c, "Wan2GP answers: {server} {version}.", { server: info.server, version: info.version }) });
    } catch (e) { return c.json({ ok: false, message: say(c, "Wan2GP does not answer: {why}", { why: String((e as Error).message).slice(0, 200) }) }); }
  });
  api.get("/camera-words", (c) => c.json({ moves: CAMERA_MOVES, cameras: CAMERAS, lenses: LENSES, focals: Object.keys(FOCALS).map(Number), apertures: Object.keys(APERTURES) }));
}
