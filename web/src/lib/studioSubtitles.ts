import type { Story } from "./studioStory";

function timestamp(seconds: number, separator: string) {
  const ms = Math.round(seconds * 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  return two(Math.floor(ms / 3_600_000)) + ":" + two(Math.floor(ms / 60_000) % 60) + ":" +
    two(Math.floor(ms / 1000) % 60) + separator + String(ms % 1000).padStart(3, "0");
}

export function studioSubtitles(story: Pick<Story, "scenes">, format: "srt" | "vtt"): string {
  const cues: string[] = [];
  const sep = format === "srt" ? "," : ".";
  let elapsed = 0;
  for (const scene of story.scenes) {
    const start = elapsed;
    elapsed += scene.seconds;
    const text = scene.text.trim().split(/\r\n|\r|\n/).filter(line => line.trim()).join("\n");
    if (!text) continue;
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    cues.push((format === "srt" ? (cues.length + 1) + "\n" : "") + timestamp(start, sep) +
      " --> " + timestamp(elapsed, sep) + "\n" + escaped);
  }
  return (format === "vtt" ? "WEBVTT\n\n" : "") + cues.join("\n\n") + "\n";
}
