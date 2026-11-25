import { readFileSync } from "node:fs"; import { tr } from "./i18n.js";
import { mkdir, open, readdir, stat, statfs, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { publishStagedFile } from "./stagedfile.js";
import { COMPOSITE_SOURCE_TYPE, labelAiVideoFile } from "./aivideo.js";
import { MAX_UPLOAD_BYTES } from "./uploadlimits.js";
import { studioCanvasSource } from "./studiocanvassource.js";
import {
  drainExports,
  enqueueExport,
  exportStatus,
  findExport,
  latestExport,
  ownedExport,
} from "./studioqueue.js";
import { computerKind, workspaceOf } from "./computer.js";
import { config, LOCAL_TTS_URL } from "./config.js";
import { linuxExec } from "./linux.js";
import { pageVersions } from "./pagefiles.js";
import { bots, pages, type BotRecord, type UserRecord } from "./store.js";
import { piperTts } from "./voice/piper.js";
import type { BuiltinTool } from "./agent/tools.js";
import { storyFor, type StudioStory } from "./videostudio.js";
import type { Hono } from "hono";

const namePattern = /^artifact-video-[a-f0-9-]{36}$/;
const template = (name: string) =>
  readFileSync(new URL("../templates/moneyprinter/" + name, import.meta.url), "utf8");
const staging = path.join(config.dataDir, "studio-encoding");
/** A message in the reader's language (French in INLINE_FR, other languages in server/src/lang). */
const message = (locale: string, english: string, vars: Record<string, string> = {}) => tr(locale, english, vars);
export function startStudioExports() {
  // A stopped process may leave a partial export outside the bot library.
  const sweep = async () => {
    for (const name of await readdir(staging).catch(() => [])) {
      if (!/^[a-f0-9-]{36}$/.test(name)) continue;
      const file = path.join(staging, name);
      const info = await stat(file).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 86400000) await unlink(file).catch(() => {});
    }
  };
  void sweep();
  setInterval(() => void sweep(), 6 * 3600_000).unref();
  drainExports(encode);
  setInterval(() => drainExports(encode), 15_000).unref();
}

async function encode(
  bot: BotRecord,
  story: StudioStory,
  voice: boolean,
  locale: string,
  language: string,
  stillOwned: () => boolean,
) {
  const voices: (string | null)[] = [];
  for (const scene of story.scenes) {
    if (scene.speech || !voice || !scene.text) {
      voices.push(null);
      continue;
    }
    if (config.voiceTtsProvider !== "piper" || config.voiceTtsUrl !== LOCAL_TTS_URL)
      throw Error(
        message(locale, "Local narration is unavailable. The timeline can be exported without narration."),
      );
    const wav = await piperTts(
      { url: LOCAL_TTS_URL, trusted: true },
      {
        text: scene.text,
        voiceId: language === "fr" ? "fr_FR-siwis-medium" : "en_GB-vctk-medium",
        rate: 1,
      },
      AbortSignal.timeout(45000),
    ).catch(() => {
      throw Error(
        message(locale, "The local voice could not respond. Retry or export without narration."),
      );
    });
    voices.push(wav.toString("base64"));
  }
  const javascript = studioCanvasSource();
  const input = JSON.stringify({
    bot: bot.id,
    story,
    voices,
    javascript,
    "frames.py": template("frames.py"),
    "video_project.py": template("video_project.py"),
  });
  const seconds = Math.max(story.scenes.reduce((sum, shot) => sum + shot.seconds, 0),
    ...(story.clips ?? []).map(c => c.start + (c.outPoint - c.inPoint)));
  await mkdir(staging, {recursive:true, mode:0o700});
  const staged = path.join(staging, randomUUID());
  const file = await open(staged, "wx+", 0o600);
  try {
    let untilDiskCheck = 0;
    const rendered = await linuxExec(
      bot.id,
      bot.userId,
      workspaceOf(bot.id),
      ["python3", "-I", "-B", "-c", template("render.py")],
      Math.max(900, Math.ceil(seconds * 15)),
      { input, binary: true, maxBytes: MAX_UPLOAD_BYTES, output: async chunk => {
        if (untilDiskCheck < chunk.length) {
          const disk = await statfs(staging);
          if (disk.bavail * disk.bsize < 256_000_000) throw Error("STUDIO_STORAGE_FULL");
          untilDiskCheck = 8_000_000;
        }
        await file.writeFile(chunk);
        untilDiskCheck -= chunk.length;
      } },
    );
    const {size} = await file.stat();
    const header = Buffer.alloc(8);
    await file.read(header, 0, header.length, 0);
    if (
      rendered.code !== 0 ||
      size < 32 ||
      size > MAX_UPLOAD_BYTES ||
      header.toString("ascii", 4, 8) !== "ftyp"
    ) {
      if (/VIDEO_TOO_LARGE/.test(rendered.stderr))
        throw Error(message(locale, "The MP4 exceeds 1 GB. Shorten the timeline."));
      if (/STUDIO_STORAGE_FULL|ENOSPC/.test(rendered.stderr))
        throw Error(message(locale, "The server needs more storage to save the MP4."));
      const long = /VOICE_TOO_LONG:(\d+)/.exec(rendered.stderr);
      if (long)
        throw Error(
          message(locale, "Give shot {n} more time for its narration.", { n: long[1] }),
        );
      console.warn(
        "[studio-mp4]",
        bot.id,
        "renderer exit",
        rendered.code,
        rendered.stderr.split("\n").filter(Boolean).at(-1)?.slice(0, 180),
      );
      throw Error(
        message(locale, "MP4 rendering failed. Check the timeline media and retry."),
      );
    }
    // L30: a montage marked « Généré par IA » also carries the IPTC marker in its metadata (aivideo.ts).
    const labelled = story.aiLabel ? await labelAiVideoFile(file, size, COMPOSITE_SOURCE_TYPE) : size;
    await file.sync();
    if (!stillOwned()) throw Error("Render interrupted.");
    return publishStagedFile(bot.id, "exports", staged, story.title + ".mp4", labelled);
  } finally {
    try { await file.close(); } finally { await unlink(staged); }
  }
}

function start(
  bot: BotRecord,
  user: UserRecord,
  name: string,
  version: unknown,
  voice: boolean,
  thread?: number,
  language = user.locale,
) {
  const say = (english: string) => message(user.locale, english);
  if (computerKind() !== "linux")
    throw Error(
      say("MP4 rendering requires a Linux bot desktop."),
    );
  const path = "artifacts/" + name + ".html";
  const page = namePattern.test(name) && pages.forPath(bot.id, path, config.publicUrl);
  if (!page || page.userId !== user.id || page.visibility !== "private")
    throw Error(say("Timeline not found."));
  const id = version === undefined ? pageVersions.list(bot.id, path)[0]?.id : version;
  if (typeof id !== "number" || !Number.isSafeInteger(id))
    throw Error(say("Version not found."));
  const source = pageVersions.get(bot.id, path, id)?.files.find((f) => f.file === "studio.json")?.content;
  const story = source && storyFor(bot.id, JSON.parse(source));
  if (!story) throw Error(say("Version or media not found."));
  const job = enqueueExport(bot, name, id, thread ?? 0, voice, language, user.locale, story);
  drainExports(encode);
  return job;
}

export function registerStudioMp4(api: Hono<any>, threadParent: (bot: BotRecord, thread: unknown) => number) {
  api.post("/bots/:id/studio-mp4", async (c) => {
    const user = c.get("user"),
      bot = bots.owned(user.id, c.req.param("id") ?? "");
    if (!bot || bot.hidden || bot.kind !== "agent") return c.notFound();
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.name !== "string" || typeof body.version !== "number")
      return c.json({ error: "Invalid project" }, 400);
    const thread = threadParent(bot, body.thread);
    try {
      return c.json(
        start(
          bot,
          user,
          body.name,
          body.version,
          body.narration === true,
          thread,
          body.language === "en" || body.language === "fr" ? body.language : user.locale,
        ),
        202,
      );
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Invalid project" }, 400);
    }
  });
  api.get("/bots/:id/studio-mp4", (c) => {
    const user = c.get("user"),
      bot = bots.owned(user.id, c.req.param("id") ?? "");
    if (!bot || bot.hidden || bot.kind !== "agent") return c.notFound();
    const name = c.req.query("name") ?? "",
      version = Number(c.req.query("version")),
      thread = threadParent(bot, Number(c.req.query("thread") || 0));
    const job =
      c.req.query("narration") === undefined
        ? latestExport(bot, name, version, thread)
        : findExport(bot, name, version, thread, c.req.query("narration") === "true", user.locale);
    return c.json({ job: job ? exportStatus(job) : null }, 200, { "cache-control": "no-store" });
  });
  api.get("/bots/:id/studio-mp4/:job", (c) => {
    const bot = bots.owned(c.get("user").id, c.req.param("id") ?? ""),
      job = bot && !bot.hidden && ownedExport(bot, c.req.param("job") ?? "");
    return job ? c.json(job, 200, { "cache-control": "no-store" }) : c.notFound();
  });
}

export const studioMp4Tool: BuiltinTool = {
  spec: {
    name: "video_studio_render",
    description:
      "Render a saved private studio timeline to an actual H.264 MP4 using MoneyPrinterTurbo on the bot desktop. Sends the verified video in the current chat when ready. Use after video_studio_create for a requested finished Reel, Short or MP4. Set narration to true for a spoken script. The supplied soundtrack is mixed underneath.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The artifact-video- name returned by the studio." },
        version: { type: "integer", description: "Saved revision, defaults to latest." },
        narration: { type: "boolean", description: "Read the scene captions aloud." },
        narration_language: {
          type: "string",
          enum: ["fr", "en"],
          description: "Language of the spoken script. Defaults to the account language.",
        },
      },
      required: ["name"],
    },
  },
  group: "computer",
  activity: "filming",
  label: "Export MP4",
  run: async (a, c) => {
    if (c.origin && c.origin !== "user")
      return { content: "Render a video in response to a user's request.", isError: true };
    try {
      const job = start(
        c.bot,
        c.user,
        String(a.name),
        a.version,
        a.narration === true,
        c.thread,
        a.narration_language === "fr" || a.narration_language === "en" ? a.narration_language : c.user.locale,
      );
      return {
        content:
          job.state === "ready"
            ? "The verified MP4 is already in this chat."
            : "Rendering is underway. The finished MP4, or an error, will be delivered automatically in this conversation.",
      };
    } catch (e) {
      return { content: e instanceof Error ? e.message : "Render unavailable.", isError: true };
    }
  },
};
