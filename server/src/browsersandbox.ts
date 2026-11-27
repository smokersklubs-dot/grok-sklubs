import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * L48 — Chromium's own sandbox in the bots' computers.
 *
 * The desktop image (docker/desktop/Dockerfile) runs the browser as the user "browser" and carries the label
 * `sklubot.browser-sandbox=1`. Chromium's sandbox there is the user-namespace one (Debian's chromium has no setuid
 * helper, and the computers keep no-new-privileges), and Docker's default seccomp profile refuses user namespaces
 * ("No usable sandbox!", tried on Docker 29.9). So a computer made from such an image is created with
 * `--security-opt seccomp=docker/desktop/seccomp-chromium.json` (docs.docker.com/engine/security/seccomp/: "pass
 * --security-opt seccomp=/path/to/seccomp/profile.json"): Docker's default profile plus three narrow rules, explained
 * in the file itself — clone with user/PID/network namespaces only, unshare of a user namespace only, chroot (still
 * subject to the kernel's capability check). No capability is added, no-new-privileges stays.
 *
 * An image without the label (built before this change) gets neither: its root browser keeps --no-sandbox, and the
 * server's owner is told to rebuild it (browserfreshness.ts). The computer's spec label (linux.ts) carries `sb:<hash of
 * the profile>` once the image is ready, so computers made from the older image are made again by themselves when not
 * in use, home volume kept, like after any change of how computers are made.
 */
export const SANDBOX_LABEL = "sklubot.browser-sandbox";
/** The shipped profile (repo: docker/desktop; server image: /app/docker/desktop, Dockerfile.production). */
export const SECCOMP_PROFILE_PATH = fileURLToPath(new URL("../../docker/desktop/seccomp-chromium.json", import.meta.url));
/** Where open-browser.sh writes whether the running browser got its sandbox ("on", or "off <reason>"). */
export const SANDBOX_STATE_FILE = "/tmp/sklubot-browser-sandbox";

let profile: { path: string; hash: string } | null | undefined;
/** The profile, read once; null when the file is missing or not JSON (an older server image): no seccomp option then. */
export function seccompProfile(path = SECCOMP_PROFILE_PATH): { path: string; hash: string } | null {
  if (profile !== undefined && path === SECCOMP_PROFILE_PATH) return profile;
  let out: { path: string; hash: string } | null = null;
  try {
    const compact = JSON.stringify(JSON.parse(readFileSync(path, "utf8")));
    out = { path, hash: createHash("sha256").update(compact).digest("hex").slice(0, 12) };
  } catch { out = null; }
  if (path === SECCOMP_PROFILE_PATH) profile = out;
  return out;
}

type Run = (args: string[], opts?: { timeoutMs?: number }) => Promise<{ code: number | null; stdout: Buffer }>;
let imageReady = false;
let checkedAt = 0;
/** Whether the desktop image carries the label; checked at most once a minute. A failed check keeps the last answer. */
export async function refreshImageSandbox(run: Run, image: string, maxAgeMs = 60_000): Promise<boolean> {
  if (Date.now() - checkedAt < maxAgeMs) return imageReady;
  const r = await run(["image", "inspect", image, "--format", `{{index .Config.Labels "${SANDBOX_LABEL}"}}`], { timeoutMs: 8000 }).catch(() => null);
  if (r && r.code === 0) { imageReady = r.stdout.toString("utf8").trim() === "1"; checkedAt = Date.now(); }
  else checkedAt = Date.now() - Math.max(0, maxAgeMs - 10_000); // Docker unreachable: asked again in 10 s, not at every call
  return imageReady;
}
/** Tests: forget the cached answers. */
export const resetBrowserSandbox = (ready?: boolean) => { imageReady = !!ready; checkedAt = ready === undefined ? 0 : Date.now(); profile = undefined; };
export const imageHasSandbox = () => imageReady;

/** The docker run options that let the browser's sandbox start (none for an older image or without the profile). */
export function sandboxRunArgs(): string[] {
  const p = seccompProfile();
  return imageReady && p ? ["--security-opt", `seccomp=${p.path}`] : [];
}
/** What the spec label adds: computers made otherwise are made again when idle. */
export function sandboxSpec(): string {
  const p = seccompProfile();
  return imageReady && p ? `;sb:${p.hash}` : "";
}

/** Reads open-browser.sh's state line: true (sandboxed), false (started without it), null (no browser started yet, or an old image). */
export function parseSandboxState(text: string): { on: boolean | null; reason: string } {
  const t = text.trim();
  if (t === "on") return { on: true, reason: "" };
  if (t.startsWith("off")) return { on: false, reason: t.slice(3).trim().slice(0, 120) };
  return { on: null, reason: "" };
}
