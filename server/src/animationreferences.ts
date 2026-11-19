import { createHash } from "node:crypto";
import type { StudioTechnique } from "./studiotechniques.js";

interface AnimationSource {
  id: StudioTechnique;
  repo: string;
  rev: string;
  blob: string;
  entry: string;
  license: "MIT" | "Apache-2.0";
  use: string;
  upstream: string;
}

/** Public references, pinned independently of the Studio's native renderer. */
export const animationSources = [
  {
    id: "retro-collage",
    repo: "LunaAI519/motion-skill",
    rev: "947825034fd38cd3e607ffdd981e86c760152966",
    blob: "af118d2d8f99695d781e7ccdd4aabcd6c9d3b1d0",
    entry: "SKILL.md",
    license: "MIT",
    use: "Compose a retro collage from overlapping cutouts.",
    upstream: "The upstream guide uses external image and video generation services.",
  },
  {
    id: "drawn-stroke",
    repo: "ToBeWin/HandDraw-Skill",
    rev: "d9f137b6072afdb3e3480ca6e47cb1a0362504bb",
    blob: "b32c2633cf8eb2e27ae29defbb02b0d6d56896d8",
    entry: "SKILL.md",
    license: "MIT",
    use: "Reveal a drawing in stroke order.",
    upstream: "The upstream engine describes a hand-drawn scene in JSON and renders with SVG and Remotion.",
  },
  {
    id: "math-geometry",
    repo: "awesome-skills/manim-skill",
    rev: "f8479fa475aace157f12a161519e4bb497a35fbf",
    blob: "e6477de463d8961b4ed5a4a610d2720c5d40c53e",
    entry: "SKILL.md",
    license: "MIT",
    use: "Build a geometric explanation one construction step at a time.",
    upstream: "The upstream guide targets Manim Community Edition and Python.",
  },
  {
    id: "procedural-illustration",
    repo: "cloveric/claude-drawing-skill",
    rev: "6af36dc717b63d6ddafb54d2eaa120cacd99ab4d",
    blob: "a5a5c1bd05df8c22d0c61be9e1d699d999e5da4b",
    entry: "SKILL.md",
    license: "MIT",
    use: "Construct an illustration from layered marks.",
    upstream: "The upstream drawing toolkit uses NumPy and Pillow.",
  },
  {
    id: "motion-timing",
    repo: "LottieFiles/motion-design-skill",
    rev: "d77a9fc8cb371cab1ba5420df5bfd232cd14c9bb",
    blob: "4246c64986636d6ed2ab8ed4a571eaa77b455502",
    entry: "skills/motion-design/SKILL.md",
    license: "MIT",
    use: "Guide attention with anticipation, easing and staggered movement.",
    upstream: "The upstream guide explains motion timing and choreography.",
  },
  {
    id: "canvas-animation",
    repo: "iart-ai/javascript-animation-skills",
    rev: "060f7467a6e5ae5b57c90c9cb1b3508c13b88e49",
    blob: "9187ecaf0f295f2225a342d30b1903e42050dde8",
    entry: "skills/javascript-animation/SKILL.md",
    license: "MIT",
    use: "Animate a composition by drawing each frame on a canvas.",
    upstream: "The upstream guide covers JavaScript rendering and audio/video synchronization.",
  },
  {
    id: "expressive-character",
    repo: "JohnHeibel/ClaudeAnimationBase",
    rev: "0ac8bf2b31942376cb6b8c4074715595d512acd2",
    blob: "055bf10bb1d1e86963e4429665130ddbd1026b3e",
    entry: "ANIMATION_GUIDE.md",
    license: "MIT",
    use: "Stage a character performance using clear poses.",
    upstream: "The upstream animation guide discusses acting for drawn characters. Use an original character in the Studio.",
  },
  {
    id: "moving-paint",
    repo: "alchaincyf/huashu-art-motion",
    rev: "a97c45018d46e950d56d61981138e08f4e092909",
    blob: "9d92824e46017564c70373cbd6d9e5c7b46bbcc2",
    entry: "SKILL.md",
    license: "MIT",
    use: "Bring a painted composition into motion.",
    upstream: "The upstream guide combines art direction, generated brushwork and narrated scene planning.",
  },
  {
    id: "doodle-timelapse",
    repo: "alexgreensh/anidoodle",
    rev: "4ae27d2c281fcfd01bce87ab13dc5ad4df81a795",
    blob: "1442e9aef0ad2b911c206a1052434450a0a6bc6c",
    entry: "skills/anidoodle/SKILL.md",
    license: "Apache-2.0",
    use: "Reveal a doodle as a time-lapse drawing.",
    upstream: "The upstream project composes repeatable illustrations, loops and films from code.",
  },
] as const satisfies readonly AnimationSource[];

export function animationSourceUrl(source: AnimationSource, path = source.entry): string {
  return `https://github.com/${source.repo}/blob/${source.rev}/${path}`;
}

export function describeAnimationSource(source: AnimationSource): string {
  const lines = [
    `Studio technique: ${source.id}. ${source.use}`,
    `For a requested video, set technique to "${source.id}" on the chosen scene in video_studio_create or video_studio_update. Preview the scene in the Studio.`,
    `Upstream reference: ${source.repo}. ${source.upstream}`,
    `Guide: ${animationSourceUrl(source)}`,
    `Repository license (${source.license}): ${animationSourceUrl(source, "LICENSE")}`,
  ];
  lines.push("To read the upstream guide here, request this id with source_page: 1.");
  if (source.id === "canvas-animation") {
    lines.push(`Companion soundtrack guide: ${animationSourceUrl(source, "skills/soundtrack/SKILL.md")}`);
  }
  if (source.license === "Apache-2.0") lines.push(`Upstream notices: ${animationSourceUrl(source, "NOTICE")}`);
  return lines.join("\n");
}

const sourceSizeLimit = 1024 * 1024;
const pageLength = 4000;
async function fetchGuide(source: AnimationSource, request: typeof fetch): Promise<string[]> {
  const url = `https://raw.githubusercontent.com/${source.repo}/${source.rev}/${source.entry}`;
  const response = await request(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok || !response.body) throw new Error("GitHub could not return this guide.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > sourceSizeLimit) {
        await reader.cancel();
        throw new Error("This guide exceeds the source size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  const gitHash = createHash("sha1").update(`blob ${length}\0`).update(bytes).digest("hex");
  if (gitHash !== source.blob) throw new Error("The guide differs from the verified Git revision.");
  const chars = Array.from(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const pages: string[] = [];
  for (let i = 0; i < chars.length; i += pageLength) pages.push(chars.slice(i, i + pageLength).join(""));
  return pages;
}

/** Only the nine pinned entries can populate the cache. Failed reads can be retried. */
export function createAnimationGuideReader(catalog: readonly AnimationSource[], request: typeof fetch) {
  const guides = new Map<string, Promise<string[]>>();
  return async (id: string, page: number): Promise<string> => {
    const source = catalog.find(s => s.id === id);
    if (!source || !Number.isSafeInteger(page) || page < 1) throw new Error("Choose a Studio technique and a page starting at 1.");
    let pending = guides.get(source.id);
    if (!pending) {
      pending = fetchGuide(source, request).catch(error => { guides.delete(source.id); throw error; });
      guides.set(source.id, pending);
    }
    const pages = await pending;
    if (page > pages.length) throw new Error(`Choose a page between 1 and ${pages.length}.`);
    const license = animationSourceUrl(source, "LICENSE");
    const notice = source.license === "Apache-2.0" ? ` · ${animationSourceUrl(source, "NOTICE")}` : "";
    const more = page < pages.length ? ` · next source_page: ${page + 1}` : "";
    return `${source.repo} / ${source.entry} · ${page}/${pages.length}${more}\n${animationSourceUrl(source)}\n${source.license}: ${license}${notice}\n\n${pages[page - 1]}`;
  };
}

export const readAnimationGuide = createAnimationGuideReader(animationSources, fetch);
