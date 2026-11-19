export interface StudioClip {
  id: string;
  kind: "visual" | "audio";
  name: string;
  path: string;
  start: number;
  inPoint: number;
  outPoint: number;
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
  volume?: number;
}

export const MAX_PROJECT_SECONDS = 300;
export const MAX_SHOTS = 60;
export const MAX_CLIPS = 48;
const visual = /^uploads\/[^/\\]{1,180}\.(?:png|jpe?g|webp|gif|mp4|webm|mov)$/i;
const audio = /^(?:uploads|audio)\/[^/\\]{1,180}\.(?:mp3|wav|m4a|aac|ogg|flac|opus)$/i;
const between = (n: unknown, low: number, high: number): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= low && n <= high;

export function validClips(input: unknown): input is StudioClip[] | undefined {
  if (input === undefined) return true;
  if (!Array.isArray(input) || input.length > MAX_CLIPS) return false;
  const ids = new Set<string>();
  for (const c of input) {
    if (!c || typeof c.id !== "string" || !/^[\w-]{1,64}$/.test(c.id) || ids.has(c.id) ||
        typeof c.name !== "string" || !c.name.trim() || c.name.length > 100 ||
        !["visual", "audio"].includes(c.kind) || typeof c.path !== "string" ||
        !(c.kind === "visual" ? visual : audio).test(c.path) ||
        !between(c.start, 0, MAX_PROJECT_SECONDS) || !between(c.inPoint, 0, 86400) ||
        !between(c.outPoint, 0, 86400) || c.outPoint - c.inPoint < 0.039999 ||
        c.start + (c.outPoint - c.inPoint) > MAX_PROJECT_SECONDS + 0.000001 ||
        !between(c.x ?? 0.5, 0, 1) || !between(c.y ?? 0.5, 0, 1) ||
        !between(c.scale ?? 0.5, 0.02, 1) || !between(c.opacity ?? 1, 0, 1) ||
        !between(c.volume ?? 1, 0, 1)) return false;
    ids.add(c.id);
  }
  return true;
}
