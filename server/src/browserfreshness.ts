import { config } from "./config.js";
import { computerKind } from "./computer.js";
import { docker } from "./linux.js";
import { parseSandboxState, refreshImageSandbox, seccompProfile, SANDBOX_LABEL, SANDBOX_STATE_FILE } from "./browsersandbox.js";
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
 * Sandbox (L48, browsersandbox.ts): the browser runs as the user "browser" with Chromium's own sandbox, in computers
 * created with Sklubot's seccomp profile. The owner also sees when that is not the case yet: an image built before
 * (rebuild it), a server without the profile file, computers still made from the older image (made again by themselves
 * when idle), or running browsers that had to start without their sandbox (open-browser.sh's state file).
 */
export interface SandboxStatus {
  /** The desktop image runs its browser sandboxed (its label); null: no Linux computers or Docker did not answer. */
  image: boolean | null;
  /** The seccomp profile file is there (docker/desktop/seccomp-chromium.json). */
  profile: boolean;
  /** Computers made from an image without the sandbox (they keep their root browser until made again). */
  oldComputers: number;
  /** Running browsers that started without their sandbox (the host refused user namespaces…). */
  unsandboxed: number;
  state: "ok" | "warn" | "unknown";
}
export interface Freshness { installed: string | null; latest: string | null; behind: number | null; state: "ok" | "warn" | "unknown"; checkedAt: number; sandbox?: SandboxStatus }

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

export function judgeSandbox(s: Omit<SandboxStatus, "state">): SandboxStatus {
  if (s.image === null) return { ...s, state: "unknown" };
  const ok = s.image && s.profile && s.oldComputers === 0 && s.unsandboxed === 0;
  return { ...s, state: ok ? "ok" : "warn" };
}

/** The sandbox's state on this server (Docker calls only; at most 20 running computers are asked). */
export const sandboxSource = {
  async status(): Promise<SandboxStatus> {
    const profile = seccompProfile() !== null;
    if (computerKind() !== "linux") return judgeSandbox({ image: null, profile, oldComputers: 0, unsandboxed: 0 });
    const ping = await docker(["image", "inspect", config.desktopImage, "--format", "{{.Id}}"], { timeoutMs: 8000 }).catch(() => null);
    if (!ping || ping.code !== 0) return judgeSandbox({ image: null, profile, oldComputers: 0, unsandboxed: 0 });
    const image = await refreshImageSandbox(docker, config.desktopImage, 0);
    const ps = await docker(["ps", "-a", "--filter", "label=sklubot=desktop", "--format", `{{.Names}}\t{{.Label "${SANDBOX_LABEL}"}}\t{{.State}}`], { timeoutMs: 10_000 });
    let oldComputers = 0, unsandboxed = 0;
    const running: string[] = [];
    for (const line of ps.stdout.toString("utf8").split("\n")) {
      const [name, label, st] = line.split("\t");
      if (!name) continue;
      if ((label ?? "").trim() !== "1") oldComputers++;
      else if ((st ?? "").trim() === "running") running.push(name);
    }
    for (const name of running.slice(0, 20)) {
      const r = await docker(["exec", name, "cat", SANDBOX_STATE_FILE], { timeoutMs: 5000 }).catch(() => null);
      if (r && r.code === 0 && parseSandboxState(r.stdout.toString("utf8")).on === false) unsandboxed++;
    }
    return judgeSandbox({ image, profile, oldComputers, unsandboxed });
  },
};

export async function browserFreshness(force = false): Promise<Freshness> {
  if (cache && !force && Date.now() - cache.checkedAt < DAY) {
    // The sandbox changes with a rebuild or a new computer: asked again every 10 minutes.
    if (!sandboxCache || Date.now() - sandboxCache.at > 600_000) sandboxCache = { at: Date.now(), s: await sandboxSource.status().catch(() => null) };
    return { ...cache, ...(sandboxCache.s ? { sandbox: sandboxCache.s } : {}) };
  }
  const [installed, latest, sandbox] = await Promise.all([freshnessSources.installed().catch(() => null), freshnessSources.latest().catch(() => null), sandboxSource.status().catch(() => null)]);
  cache = judgeFreshness(installed, latest);
  sandboxCache = { at: Date.now(), s: sandbox };
  return { ...cache, ...(sandbox ? { sandbox } : {}) };
}
let sandboxCache: { at: number; s: SandboxStatus | null } | null = null;
export const resetFreshness = () => { cache = null; sandboxCache = null; };
