import type { Context, Hono } from "hono";
import { engineLogin, engineModelsFor, engineStatus } from "./agent/engine.js";
import { disconnectPersonal, personalActive, personalEnabled, verifyPersonal } from "./personalplan.js";
import { startPersonalLogin, personalLoginState } from "./personalsignin.js";
import { computerKind } from "./computer.js";
import { config } from "./config.js";
import { engineBlock, subscriptionEnginesFor } from "./hosted.js";
import type { Engine, EngineStatus, Locale } from "./shared.js";
import { audit, bots, type BotRecord, type UserRecord } from "./store.js";

/**
 * « Connecter mon compte ChatGPT / Claude » (onboarding, Settings → Mes comptes IA): one click to use one's own
 * subscription. The sign-in itself is the existing one (agent/engine.ts engineLogin): `codex login` /
 * `claude auth login --claudeai` in a terminal on the bot's Linux screen, whose page opens in the bot's browser, where the
 * person types their password on the provider's own page — never here. The web app then shows that screen live and polls
 * the status. Behind the session; only the caller's own bots (anything else is a 404).
 *   GET  /connect-subscription                      can this account sign in here, and which bots it could use
 *   POST /connect-subscription/start                { engine, botId? } wakes the bot's computer and opens the sign-in
 *   GET  /connect-subscription/status?bot=&engine=  { signedIn, account }
 *   POST /connect-subscription/use                  { engine, botId } the bot thinks with that subscription (default model)
 */
type Why = "engines" | "suspended" | "computer";
const FR: Record<string, string> = {
  "That bot does not exist.": "Ce bot n'existe pas.",
  "Create a bot first.": "Crée d'abord un bot.",
  "Use a private desktop for personal sign-in.": "Choisis un bot disposant de son propre bureau pour autoriser ton abonnement.",
  "The personal authorization expired or was declined. Try again.": "L’autorisation personnelle a expiré ou a été refusée. Relance la connexion.",
  "Finish signing in on this bot's desktop first.": "Termine la connexion sur le bureau de ce bot.",
  "Choose an available model for this subscription.": "Choisis un modèle disponible avec cet abonnement.",
  "Could not verify the subscription. Try again.": "La vérification de l’abonnement a échoué. Réessaie.",
  "Signing in with a subscription needs Linux computers for the bots, which this server does not have.": "La connexion avec un abonnement demande des ordinateurs Linux pour les bots, que ce serveur n'a pas.",
  "Subscriptions are not available on this service for your plan.": "Les abonnements ne sont pas disponibles sur ce service avec ton offre.",
  "Your account is suspended.": "Ton compte est suspendu.",
  "The sign-in window could not open on the bot's computer: {detail}": "La fenêtre de connexion n'a pas pu s'ouvrir sur l'ordinateur du bot : {detail}",
};
const say = (loc: Locale | undefined, en: string, vars: Record<string, string> = {}) => (loc === "fr" ? FR[en] ?? en : en).replace(/\{(\w+)\}/g, (_m, k) => vars[k] ?? "");
const WHY_TEXT: Record<Why, string> = {
  engines: "Subscriptions are not available on this service for your plan.",
  suspended: "Your account is suspended.",
  computer: "Signing in with a subscription needs Linux computers for the bots, which this server does not have.",
};

/** The engine calls, replaceable in tests (they run without Linux computers). */
let deps: { login: (bot: BotRecord, engine: Engine) => Promise<void>; status: (bot: BotRecord) => Promise<EngineStatus[]>; models: (userId: string, botId: string) => Promise<{ ref: string }[]>; linux: () => boolean } = {
  login: engineLogin, status: engineStatus, models: engineModelsFor, linux: () => computerKind() === "linux",
};
export const setConnectDeps = (d: Partial<typeof deps>) => { deps = { ...deps, ...d }; };

/** Why this account cannot sign in with a subscription here, or null. */
export function connectBlock(userId: string): Why | null {
  const b = engineBlock(userId, false);
  if (b === "suspended") return "suspended";
  if (b || !subscriptionEnginesFor(userId)) return "engines";
  if (!deps.linux()) return "computer";
  return null;
}
/** The model a bot gets when it switches to the subscription: Claude Code's first configured model, Codex's "default". */
export const defaultEngineRef = (engine: Engine) => (engine === "codex" ? "codex:default" : `claude-code:${config.claudeCodeModels[0] ?? "sonnet"}`);
const engineOf = (v: unknown): Engine => (v === "codex" ? "codex" : "claude-code");

export function registerSubscriptionConnectRoutes(api: Hono<any>) {
  const user = (c: Context) => c.get("user") as UserRecord;
  const err = (c: Context, status: 400 | 403 | 404 | 409 | 502, en: string, extra: Record<string, unknown> = {}, vars: Record<string, string> = {}) => c.json({ error: say(user(c).locale, en, vars), ...extra }, status);
  const json = async (c: Context): Promise<Record<string, unknown>> => { const b = await c.req.json().catch(() => ({})); return b && typeof b === "object" && !Array.isArray(b) ? b : {}; };
  const agents = (userId: string) => bots.list(userId).filter((b) => b.kind === "agent");
  /** The caller's own agent bot: the one asked for, else the main one. */
  const pick = (userId: string, id: unknown): BotRecord | null => {
    const own = typeof id === "string" && id ? bots.owned(userId, id) : bots.primary(userId) ?? agents(userId)[0] ?? null;
    return own && own.kind === "agent" ? own : null;
  };

  api.get("/connect-subscription", (c) => {
    const u = user(c);
    const why = connectBlock(u.id);
    const list = agents(u.id);
    return c.json({ allowed: !why, why, whyText: why ? say(u.locale, WHY_TEXT[why]) : null, personalChatGPT: personalEnabled(u.id), personalConnected: personalActive(u.id), bots: list.map((b) => ({ id: b.id, name: b.name, primary: b.primary, model: b.model })), mainBotId: bots.primary(u.id)?.id ?? list[0]?.id ?? null });
  });
  api.post("/connect-subscription/start", async (c) => {
    const u = user(c);
    const b = await json(c);
    const engine = engineOf(b.engine);
    const why = connectBlock(u.id);
    if (why) return err(c, why === "computer" ? 409 : 403, WHY_TEXT[why], { code: why });
    const bot = pick(u.id, b.botId);
    if (!bot) return err(c, 404, b.botId ? "That bot does not exist." : "Create a bot first.");
    if (b.personal === true && engine === "codex" && personalEnabled(u.id)) {
      try { return c.json({ botId: startPersonalLogin(bot), engine, defaultRef: defaultEngineRef(engine) }); }
      catch { return err(c, 409, "Use a private desktop for personal sign-in."); }
    }
    try { await deps.login(bot, engine); }
    catch (e) { return err(c, 502, "The sign-in window could not open on the bot's computer: {detail}", {}, { detail: String((e as Error)?.message ?? e).slice(0, 200) }); }
    audit(u.id, "account", `${bot.name}: sign-in to ${engine === "codex" ? "ChatGPT" : "Claude"} started on its computer`, bot.id);
    return c.json({ botId: bot.id, engine, defaultRef: defaultEngineRef(engine) });
  });
  api.get("/connect-subscription/status", async (c) => {
    const u = user(c);
    const bot = pick(u.id, c.req.query("bot") || "");
    if (!bot) return err(c, 404, "That bot does not exist.");
    const why = connectBlock(u.id);
    if (why) return err(c, why === "computer" ? 409 : 403, WHY_TEXT[why], { code: why });
    const engine = engineOf(c.req.query("engine"));
    try {
      if (engine === "codex" && personalEnabled(u.id) && (c.req.query("personal") === "1" || personalActive(u.id))) {
        if (personalLoginState(u.id)?.error && c.req.query("poll") === "1") return err(c, 409, "The personal authorization expired or was declined. Try again.");
        const signedIn = await verifyPersonal(u.id);
        return c.json({ signedIn, account: signedIn ? "ChatGPT" : null, personal: true });
      }
      const s = (await deps.status(bot)).find((x) => x.engine === engine);
      return c.json({ signedIn: !!s?.signedIn, account: s?.account ?? null });
    } catch { return err(c, 502, "Could not verify the subscription. Try again."); }
  });
  api.post("/connect-subscription/use", async (c) => {
    const u = user(c);
    const b = await json(c);
    const engine = engineOf(b.engine);
    const why = connectBlock(u.id);
    if (why) return err(c, why === "computer" ? 409 : 403, WHY_TEXT[why], { code: why });
    const bot = pick(u.id, b.botId);
    if (!bot) return err(c, 404, "That bot does not exist.");
    const requested = b.model;
    if (requested !== undefined && (typeof requested !== "string" || !requested.startsWith(engine + ":") || !(await deps.models(u.id, bot.id)).some((m) => m.ref === requested))) {
      return err(c, 400, "Choose an available model for this subscription.");
    }
    try {
      const connected = engine === "codex" && personalActive(u.id) ? await verifyPersonal(u.id) : (await deps.status(bot)).find((s) => s.engine === engine)?.signedIn;
      if (!connected) return err(c, 409, "Finish signing in on this bot's desktop first.", { code: "sign_in_required" });
    } catch { return err(c, 502, "Could not verify the subscription. Try again."); }
    const ref = typeof requested === "string" ? requested : bot.model.startsWith(engine + ":") ? bot.model : defaultEngineRef(engine);
    bots.patch(bot.id, { model: ref });
    bots.announce(bot);
    audit(u.id, "account", `${bot.name}: now thinks with ${engine === "codex" ? "ChatGPT" : "Claude"} (${ref})`, bot.id);
    return c.json({ botId: bot.id, model: ref });
  });
  api.delete("/connect-subscription/personal", async (c) => {
    if (!personalEnabled(user(c).id)) return err(c, 404, "That bot does not exist.");
    if (personalLoginState(user(c).id) && !personalLoginState(user(c).id)?.error) return err(c, 409, "Could not verify the subscription. Try again.");
    try { await disconnectPersonal(user(c).id); return c.json({ ok: true }); }
    catch { return err(c, 502, "Could not verify the subscription. Try again."); }
  });
}
