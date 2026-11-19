import { randomUUID } from "node:crypto";
import type { BuiltinTool } from "./agent/tools.js";
import type { Hono } from "hono";
import { attachmentAt } from "./computer.js";
import { config } from "./config.js";
import { publishPage } from "./agent/pagetools.js";
import { videoWorkflows } from "./videoworkflows.js";
import { pageFiles, pageVersions } from "./pagefiles.js";
import { bots, pages } from "./store.js";

interface Scene {
  speech?: { speaker: string; text: string; voice: string; path: string };
  text: string;
  seconds: number;
  media: string;
  style: string;
}
export interface StudioStory {
  title: string;
  aspect: string;
  scenes: Scene[];
  audio: string;
  offset: number;
  muted: boolean;
}
const styles = new Set(["editorial", "type", "diagram", "draw", "capture"]);
const visual = /\.(png|jpe?g|webp|gif|mp4|webm|mov)$/i;
const sound = /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i;
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function storyFor(botId: string, input: any): StudioStory | null {
  if (!input || !Array.isArray(input.scenes) || !input.scenes.length || input.scenes.length > 24) return null;
  const title = clean(input.title, 110);
  const asset = (value: unknown, ext: RegExp, location: RegExp) =>
    typeof value === "string" &&
    value.length < 200 &&
    location.test(value) &&
    ext.test(value) &&
    !!attachmentAt(botId, value);
  const scenes: Scene[] = [];
  for (const s of input.scenes) {
    if (
      !s ||
      typeof s.text !== "string" ||
      s.text.length > 300 ||
      !Number.isFinite(s.seconds) ||
      s.seconds < 0.5 ||
      s.seconds > 60 ||
      !styles.has(s.style) ||
      (s.media !== "" && !asset(s.media, visual, /^uploads\/[^/\\]+$/))
    )
      return null;
    const take = s.speech;
    if (take !== undefined && (!take || typeof take.speaker !== "string" || !take.speaker.trim() || take.speaker.length > 64 ||
        typeof take.text !== "string" || take.text.length > 300 || typeof take.voice !== "string" || take.voice.length > 120 ||
        !asset(take.path, sound, /^(?:uploads|audio)\/[^/\\]+$/))) return null;
    scenes.push({ ...(take ? {speech: {speaker:take.speaker.trim(),text:take.text,voice:take.voice,path:take.path}} : {}), text: s.text.trim(), seconds: s.seconds, style: s.style, media: s.media });
  }
  if (
    !title ||
    !["wide", "vertical", "square"].includes(input.aspect) ||
    scenes.reduce((v, s) => v + s.seconds, 0) > 120 ||
    (input.audio !== "" && !asset(input.audio, sound, /^(?:uploads|audio)\/[^/\\]+$/)) ||
    !Number.isFinite(input.offset) ||
    input.offset < 0 ||
    input.offset > 120
  )
    return null;
  return {
    title,
    scenes,
    aspect: input.aspect,
    audio: input.audio,
    offset: input.offset,
    muted: input.muted === true,
  };
}

/** The advanced render uses the same project and pinned sources as the native timeline. */
function productionNotes(story: StudioStory): string {
  const selected = new Set<string>(["remotion"]);
  if (story.aspect === "vertical") selected.add("moneyprinter");
  if (story.audio) selected.add("paint-mv");
  for (const scene of story.scenes) {
    if (scene.media) selected.add("shotcraft");
    selected.add(
      {
        editorial: "vox",
        draw: "hand-drawn",
        diagram: "anything2explainer",
        type: "bang-motion",
        capture: "shotcraft",
      }[scene.style as "editorial" | "draw" | "diagram" | "type" | "capture"],
    );
  }
  return [
    "# Production du montage",
    "Lis studio.json et conserve les médias et les repères de cette version. Identifie les prérequis avant un rendu spécialisé. Le rendu natif du Studio reste disponible pour chaque compte.",
    ...videoWorkflows
      .filter((w) => selected.has(w.id))
      .map((w) => "- video_workflow(" + w.id + ") — " + w.use + " https://github.com/" + w.repo + "/tree/" + w.rev),
    "Pour un rendu avancé, travaille dans la bibliothèque du bot. Examine les premières, intermédiaires et dernières images puis vérifie le fichier exporté avec ffprobe.",
  ].join("\n\n");
}
function saveProject(name: string, story: StudioStory, ctx: Parameters<typeof publishPage>[1]) {
  const html =
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' +
    escape(story.title) +
    "</title><style>body{max-width:48rem;margin:6vh auto;padding:1.5rem;background:#191b23;color:#fff;font:18px/1.5 system-ui}li{padding:.7rem}small{color:#b5b5c9}</style><h1>" +
    escape(story.title) +
    "</h1><ol>" +
    story.scenes.map((s) => "<li>" + escape(s.text) + " <small>" + s.seconds + " s</small></li>").join("") +
    "</ol>";
  return publishPage(
    {
      name,
      title: story.title,
      html,
      visibility: "private",
      files: [
        { path: "studio.json", content: JSON.stringify(story) },
        { path: "production.md", content: productionNotes(story) },
      ],
    },
    ctx,
    true,
  );
}

export function registerVideoStudio(api: Hono<any>) {
  api.post("/bots/:id/video-studio", async (c) => {
    const user = c.get("user");
    const bot = bots.owned(user.id, c.req.param("id") ?? "");
    if (!bot || bot.kind !== "agent" || bot.hidden) return c.json({ error: "Bot introuvable." }, 404);
    const b = await c.req.json().catch(() => null);
    if (!b || typeof b.key !== "string" || !/^[a-f0-9-]{36}$/.test(b.key))
      return c.json({ error: "Projet invalide." }, 400);
    const name = "artifact-video-" + b.key;
    const path = "artifacts/" + name + ".html";
    const prior = pages.forPath(bot.id, path, config.publicUrl);
    const result = (p: NonNullable<typeof prior>) => ({
      token: p.token,
      title: p.title,
      botId: bot.id,
      version: pageVersions.list(bot.id, path)[0]?.id,
    });
    if (prior && b.version == null) return c.json(result(prior));
    if (b.version != null && (!prior || pageVersions.list(bot.id, path)[0]?.id !== b.version))
      return c.json({ error: "Une autre version a été enregistrée. Rouvre le montage." }, 409);
    const story = storyFor(bot.id, b.story);
    if (!story)
      return c.json(
        { error: "Vérifie les médias, les durées et les pistes. Le montage accepte 24 plans et 120 secondes." },
        400,
      );
    const published = saveProject(name, story, { bot, user });
    if (published.isError) return c.json({ error: published.content }, 400);
    return c.json(result(pages.forPath(bot.id, path, config.publicUrl)!));
  });
}

export const videoStudioTool: BuiltinTool = {
  spec: {
    name: "video_studio_create",
    description:
      "Create one private editable multitrack video artifact in the current chat only when the user asks to create a video or montage. For questions about a video, answer normally. Plan a narrative with short captions, timed lyrics if provided, real user screenshots or clips, diagrams, drawing reveals and kinetic type. Do not invent images. The user can preview, edit and export the rendered movie in the studio. For advanced source templates use video_workflow.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        aspect: { type: "string", enum: ["wide", "vertical", "square"] },
        audio: { type: "string", description: "Soundtrack from this bot's uploads/ or audio/ library, including a WAV returned by VoiceStudio generate_speech." },
        scenes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              seconds: { type: "number" },
              style: { type: "string", enum: ["editorial", "draw", "diagram", "type", "capture"] },
              speech: { type:"object", description:"A recorded line on the named speaker's own track, starting at the shot boundary.", properties:{speaker:{type:"string"}, text:{type:"string"}, voice:{type:"string"}, path:{type:"string",description:"Existing audio/ or uploads/ clip in this bot's library."}}, required:["speaker","text","voice","path"] },
              media: { type: "string", description: "Optional existing uploads/ image or clip." },
            },
            required: ["text", "seconds", "style"],
          },
        },
      },
      required: ["title", "scenes"],
    },
  },
  group: "pages",
  activity: "filming",
  label: "Studio vidéo",
  run: async (a, c) => {
    if (c.origin && c.origin !== "user")
      return { content: "Open the video studio in response to a user's creation request.", isError: true };
    const raw = Array.isArray(a.scenes) ? a.scenes.map((s) => ({ ...s, media: s?.media ?? "" })) : null;
    const story = storyFor(c.bot.id, {
      title: a.title,
      scenes: raw,
      aspect: a.aspect || "wide",
      audio: a.audio ?? "",
      offset: 0,
      muted: false,
    });
    if (!story)
      return {
        content: "Check your scenes, media paths, and durations (0.5–60 seconds per scene, up to 120 seconds total).",
        isError: true,
      };
    const name = "artifact-video-" + randomUUID();
    const out = saveProject(name, story, c);
    return out.isError
      ? out
      : {
          content:
            "The private editable montage is open in the chat. Project " +
            name +
            ". For a requested finished Reel, Short or MP4, call video_studio_render with this name. " +
            out.content,
          summary: story.title,
        };
  },
};

export const updateVideoStudio: BuiltinTool = {
  ...videoStudioTool,
  spec: {
    name: "video_studio_update",
    description:
      "Update the current user's existing private video timeline. First read studio.json using page_source. Send changed fields only; when replacing scenes include the full ordered array. Read production.md for project-specific tools when an advanced render is requested.",
    inputSchema: {
      type: "object",
      properties: {
        ...videoStudioTool.spec.inputSchema.properties,
        name: { type: "string" },
        version: { type: "integer" },
        offset: { type: "number" },
        muted: { type: "boolean" },
      },
      required: ["name", "version"],
    },
  },
  run: async (a, c) => {
    if (typeof a.name !== "string" || !/^artifact-video-[a-f0-9-]{36}$/.test(a.name))
      return { content: "Unknown video project.", isError: true };
    const path = "artifacts/" + a.name + ".html";
    const source = pageFiles.get(c.bot.id, path, "studio.json"),
      head = pageVersions.list(c.bot.id, path)[0];
    if (!source || !head) return { content: "Unknown video project.", isError: true };
    if (a.version !== head.id)
      return {
        content: "The timeline has changed. Read studio.json again. Current version: " + head.id,
        isError: true,
      };
    const original = JSON.parse(source);
    const story = storyFor(c.bot.id, {
      ...original,
      ...a,
      scenes: Array.isArray(a.scenes) ? a.scenes.map((s) => ({ ...s, media: s?.media ?? "" })) : original.scenes,
    });
    if (!story) return { content: "Invalid scenes or media.", isError: true };
    return saveProject(a.name, story, c);
  },
};
