import type { Context, Hono } from "hono";
import { audit, bots, clip, type BotRecord, type UserRecord } from "../store.js";
import type { BotVoiceChoice } from "../shared.js";
import { botVoices } from "./botvoice.js";
import { FishError, fishVoice, fishVoices, validVoiceId } from "./fish.js";
import { kokoroVoices, validKokoroVoice } from "./kokoro.js";
import { fishKey, kokoroEndpoint, ttsFor, voiceSettings, voiceStatus } from "./providers.js";

/**
 * Routes of the voice per bot and of the voice pickers (Fish Audio's library, the self-hosted Kokoro's voices). All
 * behind the session like every /api route. The Fish Audio key is the CALLER's own (sealed in their settings, never sent
 * back); a bot's voice is set by its owner only (a workspace member could otherwise spend the owner's key through the
 * preview). No route takes an id of someone else's thing other than /bots/:id, which is the caller's own bot or a 404.
 *
 *  GET  /voice/fish/voices?q=&language=&page=&self=1&licensed=1  → { items: FishVoice[], total, hasMore, page }
 *  GET  /voice/fish/voice?id=                                    → { voice: FishVoice } (checks a pasted id)
 *  GET  /voice/kokoro/voices                                     → { voices: KokoroVoice[] }
 *  GET  /bots/:id/voice/choice                                   → { choice: BotVoiceChoice | null, account, fish, kokoro }
 *  PUT  /bots/:id/voice/choice { provider, voiceId, name?, author?, language? } | { voiceId: null }
 *  POST /bots/:id/voice/preview { provider, voiceId, text? }     → audio/wav (a short sample in the bot's language)
 */

type Env = { Variables: { user: UserRecord } };
const err = (c: Context, status: 400 | 404 | 409 | 502, error: string, code?: string) => c.json({ error, ...(code ? { code } : {}) }, status);
const json = async (c: Context): Promise<Record<string, any>> => { const b = await c.req.json().catch(() => ({})); return b && typeof b === "object" ? b : {}; };
const ownAgent = (c: Context<Env>): BotRecord | null => { const b = bots.owned(c.get("user").id, c.req.param("id") ?? ""); return b && b.kind === "agent" ? b : null; };
const NOT_FOUND = "That bot does not exist.";
const fishProblem = (c: Context, e: unknown) => (e instanceof FishError ? err(c, e.status === 400 || e.status === 404 ? e.status : 502, e.message, "fish") : err(c, 502, `Fish Audio: ${clip((e as Error).message, 200)}`, "fish"));

/** The sample read by "Listen", in the bot's language (the first two letters of a BCP-47 tag). */
const SAMPLES: Record<string, string> = {
  fr: "Bonjour, je suis {name}. Voici ma voix : est-ce qu'elle te plaît ?",
  en: "Hello, I'm {name}. This is my voice: do you like it?",
  es: "Hola, soy {name}. Esta es mi voz: ¿te gusta?",
  de: "Hallo, ich bin {name}. Das ist meine Stimme: gefällt sie dir?",
  it: "Ciao, sono {name}. Questa è la mia voce: ti piace?",
  pt: "Olá, eu sou {name}. Esta é a minha voz: você gosta?",
  ja: "こんにちは、{name}です。これが私の声です。",
  zh: "你好，我是{name}。这是我的声音，你喜欢吗？",
  hi: "नमस्ते, मैं {name} हूँ। यह मेरी आवाज़ है।",
};
export const sampleText = (lang: string, name: string) => (SAMPLES[lang.slice(0, 2).toLowerCase()] ?? SAMPLES.en).replace("{name}", name.slice(0, 40));

export function registerVoiceRoutes(api: Hono<Env>) {
  api.get("/voice/fish/voices", async (c) => {
    const key = fishKey(c.get("user").id);
    if (!key) return err(c, 409, "Add your Fish Audio API key in Settings → Voice first.", "no_key");
    try {
      return c.json(await fishVoices(key, c.get("user").id, {
        q: c.req.query("q") ?? "", language: c.req.query("language") ?? "", page: Number(c.req.query("page") ?? 1),
        self: c.req.query("self") === "1", licensed: c.req.query("licensed") === "1",
      }));
    } catch (e) { return fishProblem(c, e); }
  });

  api.get("/voice/fish/voice", async (c) => {
    const key = fishKey(c.get("user").id);
    if (!key) return err(c, 409, "Add your Fish Audio API key in Settings → Voice first.", "no_key");
    const id = (c.req.query("id") ?? "").trim();
    if (!validVoiceId(id)) return err(c, 400, "This is not a Fish Audio voice id.");
    try { return c.json({ voice: await fishVoice(key, id) }); } catch (e) { return fishProblem(c, e); }
  });

  api.get("/voice/kokoro/voices", async (c) => {
    const e = kokoroEndpoint(c.get("user").id);
    if (!e) return err(c, 409, "Kokoro is not set up on this server (see docs/INSTALLATION-VPS.md, profile kokoro).", "no_kokoro");
    try { return c.json({ voices: await kokoroVoices(e) }); } catch (x) { return err(c, 502, `Kokoro: ${clip((x as Error).message, 200)}`, "kokoro"); }
  });

  api.get("/bots/:id/voice/choice", (c) => {
    const bot = ownAgent(c);
    if (!bot) return err(c, 404, NOT_FOUND);
    const userId = c.get("user").id;
    const s = voiceSettings(userId);
    return c.json({
      choice: botVoices.get(bot.id),
      account: { provider: s.tts.provider, voice: s.tts.voice },
      fish: { hasKey: !!fishKey(userId) },
      kokoro: { available: !!kokoroEndpoint(userId) },
      status: voiceStatus(userId, bot.id),
    });
  });

  api.put("/bots/:id/voice/choice", async (c) => {
    const bot = ownAgent(c);
    if (!bot) return err(c, 404, NOT_FOUND);
    const b = await json(c);
    let choice: BotVoiceChoice | null;
    if (b.voiceId === null || b.voiceId === "") choice = botVoices.set(bot.id, null);
    else {
      const provider = b.provider === "kokoro" ? "kokoro" : "fish";
      const voiceId = typeof b.voiceId === "string" ? b.voiceId.trim() : "";
      if (provider === "fish" ? !validVoiceId(voiceId) : !validKokoroVoice(voiceId)) return err(c, 400, provider === "fish" ? "This is not a Fish Audio voice id." : "This is not a Kokoro voice.");
      choice = botVoices.set(bot.id, { provider, voiceId, name: b.name, author: b.author, language: b.language });
    }
    audit(c.get("user").id, "account", choice ? `Voice of the bot set: ${choice.provider} ${choice.name || choice.voiceId}` : "Voice of the bot reset to the account's", bot.id);
    return c.json({ choice, status: voiceStatus(c.get("user").id, bot.id) });
  });

  api.post("/bots/:id/voice/preview", async (c) => {
    const bot = ownAgent(c);
    if (!bot) return err(c, 404, NOT_FOUND);
    const user = c.get("user");
    const b = await json(c);
    const provider = b.provider === "kokoro" ? "kokoro" : "fish";
    const voiceId = typeof b.voiceId === "string" ? b.voiceId.trim() : "";
    if (voiceId && (provider === "fish" ? !validVoiceId(voiceId) : !validKokoroVoice(voiceId))) return err(c, 400, "This is not a voice id.");
    if (provider === "fish" && !fishKey(user.id)) return err(c, 409, "Add your Fish Audio API key in Settings → Voice first.", "no_key");
    if (provider === "kokoro" && !kokoroEndpoint(user.id)) return err(c, 409, "Kokoro is not set up on this server.", "no_kokoro");
    const lang = (typeof b.language === "string" && b.language) || (bot.voice.lang !== "auto" ? bot.voice.lang : "") || user.locale;
    const text = typeof b.text === "string" && b.text.trim() ? b.text.trim().slice(0, 200) : sampleText(lang, bot.name);
    const tts = voiceId ? ttsFor(user.id, { botId: bot.id, voiceId, provider }) : ttsFor(user.id, { botId: bot.id });
    if (!tts) return err(c, 409, "No speech service is configured.");
    try {
      const wav = await tts(text);
      return new Response(new Uint8Array(wav), { headers: { "content-type": "audio/wav", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    } catch (e) { return e instanceof FishError ? fishProblem(c, e) : err(c, 502, clip((e as Error).message, 200)); }
  });
}
