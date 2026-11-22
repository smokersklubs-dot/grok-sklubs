import { config } from "./config.js";
import { computerKind } from "./computer.js";
import { docker } from "./linux.js";
import { guardedFetch } from "./net.js";

/**
 * L48 — is the bots' browser (Chromium in the desktop image, docker/desktop) behind on security releases?
 *
 * Two numbers, each read at most once a day:
 *  - the installed version: `chromium --version` run once in a throw-away container of the desktop image, with no
 *    network (`docker run --rm --network none --entrypoint chromium <image> --version`);
 *  - the current stable version for Linux, from Google's Chrome VersionHistory API
 *    (GET https://versionhistory.googleapis.com/v1/chrome/platforms/linux/channels/stable/versions — documented at
 *    https://developer.chrome.com/docs/web-platform/versionhistory/reference; newest first, `version` "131.0.6778.85").
 * A new major version comes about every four weeks and each one carries security fixes, so "N versions behind" is
 * shown to the server's owner (Settings → Security) as "N rounds of security fixes missing"; 2 or more is a warning,
 * with what to do: rebuild the image (`npm run computer:build`), which installs the distribution's current Chromium.
 *
 * Sandbox, verified for this item: the desktop browser runs as root with `--no-sandbox` (docker/desktop/open-browser.sh)
 * inside a container with every capability dropped and no-new-privileges (linux.ts), which is the isolation it relies
 * on. Chromium's own sandbox cannot run as root, and its setuid helper cannot work under no-new-privileges; running it
 * as a separate user with a seccomp profile that allows user namespaces is a change of the image, not made here
 * (docs/SECURITE.md, « Navigateur des bots »).
 */
export interface Freshness { installed: string | null; latest: string | null; behind: number | null; state: "ok" | "warn" | "unknown"; checkedAt: number }

const DAY = 24 * 3600_000;
export const WARN_BEHIND = 2;
let cache: Freshness | null = null;

export const majorOf = (v: string | null | undefined): number | null => { const m = /(\d+)\.\d+\.\d+/.exec(String(v ?? "")); return m ? Number(m[1]) : null; };

export function judgeFreshness(installed: string | null, latest: string | null, at = Date.now()): Freshness {
  const a = majorOf(installed), b = majorOf(latest);
  if (a === null || b === null) return { installed, latest, behind: null, state: "unknown", checkedAt: at };
  const behind = Math.max(0, b - a);
  return { installed, latest, behind, state: behind >= WARN_BEHIND ? "warn" : "ok", checkedAt: at };
}

/** Replaceable in tests (no Docker, no network there). */
export const freshnessSources = {
  async installed(): Promise<string | null> {
    if (computerKind() !== "linux") return null;
    const r = await docker(["run", "--rm", "--network", "none", "--entrypoint", "chromium", config.desktopImage, "--version"], { timeoutMs: 60_000 }).catch(() => null);
    return r && r.code === 0 ? (/(\d+\.\d+\.\d+\.\d+)/.exec(r.stdout.toString("utf8"))?.[1] ?? null) : null;
  },
  async latest(): Promise<string | null> {
    const res = await guardedFetch("https://versionhistory.googleapis.com/v1/chrome/platforms/linux/channels/stable/versions", { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!res?.ok) return null;
    const j = (await res.json().catch(() => null)) as { versions?: { version?: string }[] } | null;
    return j?.versions?.[0]?.version ?? null;
  },
};

export async function browserFreshness(force = false): Promise<Freshness> {
  if (cache && !force && Date.now() - cache.checkedAt < DAY) return cache;
  const [installed, latest] = await Promise.all([freshnessSources.installed().catch(() => null), freshnessSources.latest().catch(() => null)]);
  cache = judgeFreshness(installed, latest);
  return cache;
}
export const resetFreshness = () => { cache = null; };
