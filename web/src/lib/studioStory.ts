export type Style = "editorial" | "draw" | "diagram" | "type" | "capture";
export interface SpeechTake { speaker: string; text: string; voice: string; path: string }
export interface Scene {
  speech?: SpeechTake;
  text: string;
  seconds: number;
  style: Style;
  media: string;
}
export interface Story {
  title: string;
  scenes: Scene[];
  aspect: "wide" | "vertical" | "square";
  audio: string;
  offset: number;
  muted: boolean;
}
export type Visual = HTMLImageElement | HTMLVideoElement;
export const duration = (s: Story) => s.scenes.reduce((n, c) => n + c.seconds, 0);
export const validUpload = (s: unknown): s is string => typeof s === "string" && /^uploads\/[^/\\]{1,180}$/.test(s);
export function validStory(s: Story): boolean {
  return (
    !!s &&
    typeof s.title === "string" &&
    ["wide", "vertical", "square"].includes(s.aspect) &&
    Array.isArray(s.scenes) &&
    s.scenes.length > 0 &&
    s.scenes.length <= 24 &&
    s.scenes.every(
      (c) =>
        c &&
        typeof c.text === "string" &&
        c.text.length <= 300 &&
        Number.isFinite(c.seconds) &&
        c.seconds >= 0.5 &&
        c.seconds <= 60 &&
        ["editorial", "draw", "diagram", "type", "capture"].includes(c.style) &&
        (c.media === "" || validUpload(c.media)) &&
        (c.speech === undefined || (!!c.speech && typeof c.speech.speaker === "string" && !!c.speech.speaker.trim() && c.speech.speaker.length <= 64 &&
          typeof c.speech.text === "string" && c.speech.text.length <= 300 && typeof c.speech.voice === "string" && c.speech.voice.length <= 120 &&
          typeof c.speech.path === "string" && /^(?:audio|uploads)\/[^/\\]{1,180}\.(wav|mp3|m4a|aac|ogg|flac|opus)$/i.test(c.speech.path))),
    ) &&
    duration(s) <= 120 &&
    (s.audio === "" || validUpload(s.audio) || (typeof s.audio === "string" && /^audio\/[^/\\]{1,180}\.(wav|mp3|m4a|aac|ogg|flac|opus)$/i.test(s.audio))) &&
    Number.isFinite(s.offset) &&
    s.offset >= 0 &&
    s.offset <= 120
  );
}
export const mediaUrl = (bot: string, file: string) =>
  "/api/bots/" + encodeURIComponent(bot) + "/files/view?path=" + encodeURIComponent(file);
export function locate(s: Story, time: number) {
  let start = 0;
  for (let i = 0; i < s.scenes.length; i++) {
    const scene = s.scenes[i];
    if (time < start + scene.seconds || i === s.scenes.length - 1)
      return { scene, index: i, start, local: Math.max(0, time - start) };
    start += scene.seconds;
  }
  throw new Error("Empty timeline");
}
export const styles: Style[] = ["editorial", "capture", "draw", "diagram", "type"];
export function scenesFrom(text: string, clips: string[], title: string): Scene[] {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const timed = lines.map((l) => /^\[(\d{1,2}):(\d\d(?:\.\d{1,3})?)\]\s*(.*)$/.exec(l));
  if (timed.some(Boolean) && !timed.every(Boolean))
    throw new Error("Chaque ligne synchronisée doit commencer par [mm:ss.xx].");
  if (timed.length && timed.every(Boolean)) {
    const cues = timed.map((m) => ({ at: +m![1] * 60 + +m![2], text: m![3] }));
    const scenes: Scene[] = [];
    if (cues[0].at > 0) scenes.push({ text: "", seconds: cues[0].at, media: clips[0] ?? "", style: "editorial" });
    for (const [i, c] of cues.entries())
      scenes.push({
        text: c.text,
        seconds: Number(((cues[i + 1]?.at ?? c.at + 3) - c.at).toFixed(3)),
        style: styles[i % styles.length],
        media: clips.length ? clips[i % clips.length] : "",
      });
    return scenes;
  }
  const count = Math.max(1, lines.length, clips.length);
  return Array.from({ length: count }, (_, i) => ({
    text: lines[i] ?? (lines.length ? "" : title),
    seconds: 4,
    style: clips.length ? "capture" : styles[i % styles.length],
    media: clips.length ? clips[i % clips.length] : "",
  }));
}
const tones: Record<Style, [string, string, string]> = {
  editorial: ["#f3e9d7", "#211e26", "#e5583d"],
  draw: ["#faf4df", "#292735", "#7463ce"],
  diagram: ["#171e30", "#edf5ff", "#71d9c0"],
  type: ["#4d37a4", "#ffffff", "#edc45e"],
  capture: ["#17191e", "#f9fafb", "#bcabfa"],
};
export function drawFrame(canvas: HTMLCanvasElement, story: Story, assets: Map<string, Visual>, time: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { scene, local, index } = locate(story, time),
    w = canvas.width,
    h = canvas.height;
  const [bg, fg, accent] = tones[scene.style],
    p = Math.min(1, local / scene.seconds),
    pad = Math.round(w * 0.065);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const image = assets.get(scene.media);
  if (image) {
    const iw = image instanceof HTMLVideoElement ? image.videoWidth : image.naturalWidth,
      ih = image instanceof HTMLVideoElement ? image.videoHeight : image.naturalHeight;
    if (iw > 0 && ih > 0) {
      const scale = Math.min((w - pad) / iw, (scene.text ? h * 0.7 : h * 0.92) / ih) * (1 + 0.035 * p),
        dw = iw * scale,
        dh = ih * scale;
      ctx.drawImage(image, (w - dw) / 2, (h * (scene.text ? 0.73 : 1) - dh) / 2, dw, dh);
    }
  } else {
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(3, w * 0.008);
    ctx.lineCap = "round";
    const y = h * 0.32;
    if (scene.style === "diagram") {
      for (let i = 0; i < 3; i++) {
        const x = w * (0.2 + i * 0.28);
        ctx.beginPath();
        ctx.arc(x, y, w * 0.046, 0, Math.PI * 2);
        ctx.stroke();
        if (i < 2) {
          ctx.beginPath();
          ctx.moveTo(x + w * 0.05, y);
          ctx.lineTo(x + w * 0.05 + w * 0.17 * Math.min(1, p * 2), y);
          ctx.stroke();
        }
      }
    } else if (scene.style === "draw") {
      ctx.beginPath();
      for (let i = 0; i <= Math.max(2, p * 100); i++) {
        const x = pad + ((w - 2 * pad) * i) / 100,
          y2 = y + Math.sin(i * 0.1) * h * 0.1;
        i ? ctx.lineTo(x, y2) : ctx.moveTo(x, y2);
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = accent;
      ctx.save();
      ctx.translate(w * 0.75, y);
      ctx.rotate((scene.style === "type" ? -0.36 : 0.18) + p * 0.28);
      ctx.fillRect(-w * 0.14, -h * 0.13, w * 0.28, h * 0.26);
      ctx.restore();
    }
  }
  const font = Math.floor(Math.min(w * 0.07, h * 0.098));
  ctx.fillStyle = fg;
  ctx.font = "700 " + font + "px system-ui, sans-serif";
  ctx.textBaseline = "top";
  const words = scene.text.split(/\s+/),
    lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (line && ctx.measureText(next).width > w - 2 * pad) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 3);
  if (lines.length > 3) shown[2] += "…";
  const yText = h - shown.length * (font * 1.12) - h * 0.09;
  ctx.globalAlpha = Math.min(1, 0.4 + local * 3);
  shown.forEach((s, i) => ctx.fillText(s, pad, yText + i * font * 1.12, w - pad * 2));
  ctx.globalAlpha = 1;
  ctx.fillStyle = accent;
  ctx.fillRect(pad, h * 0.95, ((w - 2 * pad) * (index + p)) / story.scenes.length, Math.max(2, h * 0.005));
}
