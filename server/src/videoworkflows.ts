import { readFileSync } from "node:fs";
import { computerKind, workspaceOf } from "./computer.js";
import { linuxExec } from "./linux.js";
import type { BuiltinTool } from "./agent/tools.js";
import { animationSources, describeAnimationSource, readAnimationGuide } from "./animationreferences.js";

export const videoWorkflows = [
  { id: "moneyprinter", repo: "harry0703/MoneyPrinterTurbo", rev: "92e0f9a55b91e353565015aab74b7c50cc28f148", entry: "README-en.md", use: "Shorts from a subject or keywords. Use the saved Studio timeline and video_studio_render for a local MP4 with captions and optional voice. Full upstream pipeline and CLI available for advanced jobs." },
  { id: "vox", repo: "CK42BB/vox-explainer-skill", rev: "7003225dc3ed1dee9e2ef8b91b05b82c04691aa9", entry: "SKILL.md", use: "Editorial collage explainer. The original pipeline uses paid Atlas Cloud services." },
  { id: "paint-mv", repo: "lintsinghua/paint-mv-skills", rev: "ca8f5f75f186d590e687542b106aa73ceff9133c", entry: "skills/paint-mv/SKILL.md", use: "Watercolour music video from a song and timed lyrics, with browser animation and ffmpeg." },
  { id: "hand-drawn", repo: "hi-nikola/hand-drawn-explainer-video-nikola", rev: "3ee5d1c01fe8d34f5162c4aace418753f85bd0d9", entry: "SKILL.md", use: "Illustrated whiteboard explainer from narration and subtitles. Check LICENSE-MEDIA.md for example media." },
  { id: "anything2explainer", repo: "Vincentwei1021/anything2explainer", rev: "19c9b147817ac78b9b0a946359a5e3c00aa77170", entry: "SKILL.md", use: "Technical explainer with Remotion. PolyForm Noncommercial. For a commercial project use another workflow unless the user has a commercial licence." },
  { id: "bang-motion", repo: "bangtutorial/bang-motion", rev: "c1aa65e921c970d858705fcb4a53a8294d1a4131", entry: "SKILL.md", use: "Brand motion graphics, kinetic typography and browser-based promos. Standalone HTML, optional MP4 export." },
  { id: "remotion", repo: "haidrrrry/claude-remotion-skill", rev: "1dcbe5e3fc6cf970bd10d3cc05f0a8a5d19d0383", entry: "remotion-motion-graphics/SKILL.md", use: "Refine motion design with a render, frame inspection and correction loop." },
  { id: "shotcraft", repo: "Vincentwei1021/video-shotcraft", rev: "55eb60d155d703b0267a46a0507f6e268a053ad1", entry: "SKILL.md", use: "Animate real product screenshots into a demo with storyboard, local assets and Remotion." },
] as const;

const checkout = readFileSync(new URL("../templates/video-workflow.py", import.meta.url), "utf8");
export const videoWorkflowTool: BuiltinTool = {
  spec: {
    name: "video_workflow",
    description: "List native Studio animation techniques and specialist video workflows. A technique id returns its Studio usage. On request, add source_page: 1 to read the original guide from the pinned revision. A specialist workflow id prepares its pinned sources on this bot's Linux desktop.",
    inputSchema: { type: "object", properties: {
      id: { type: "string", enum: [...animationSources.map(s => s.id), ...videoWorkflows.map(w => w.id)] },
      source_page: { type: "integer", minimum: 1, description: "Page of a native technique's upstream guide. Omit to show the summary." },
    } },
  },
  activity: "filming", label: "Video workflows", group: "computer", outside: true,
  run: async (a, c) => {
    if (a.source_page !== undefined) {
      try {
        return { content: await readAnimationGuide(a.id, a.source_page) };
      } catch (error) {
        return { content: error instanceof Error ? error.message : "Could not read this guide.", isError: true };
      }
    }
    if (!a.id) return {
      content: [
        "Studio animation techniques · apply per scene in the video Studio",
        ...animationSources.map(s => `${s.id}: ${s.use}`),
        "",
        "Specialist workflows · prepare upstream sources on the bot's Linux desktop",
        ...videoWorkflows.map(w => `${w.id}: ${w.use} https://github.com/${w.repo}`),
      ].join("\n"),
    };
    const source = animationSources.find(s => s.id === a.id);
    if (source) return { content: describeAnimationSource(source) };
    const w = videoWorkflows.find(w => w.id === a.id);
    if (!w || computerKind() !== "linux") return { content: "Choose a listed video workflow on a Linux bot desktop.", isError: true };
    const r = await linuxExec(c.bot.id, c.user.id, workspaceOf(c.bot.id), ["python3", "-c", checkout, c.bot.id, w.repo, w.rev, w.entry], 180, { signal: c.signal, maxBytes: 4096 });
    if (r.code !== 0) return { content: `Could not prepare ${w.repo}. ${r.stderr.slice(-800)}`, isError: true };
    return { content: `${w.use}\nRead ${r.stdout.trim()}. Upstream source: https://github.com/${w.repo}/tree/${w.rev}. Preserve the source and its notices. Check tool prerequisites and ask before using a paid service.` };
  },
};
