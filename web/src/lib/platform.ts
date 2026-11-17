/**
 * The visitor's system and the public download page's address, shared by the landing page (LandingApps.tsx) and the
 * download page (DownloadPage.tsx). Only used to put the right button first: every file stays listed for everyone.
 */
export const DOWNLOAD_PATH = "/telecharger";
export const isDownloadPath = (): boolean => typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === DOWNLOAD_PATH;

export type Os = "windows" | "mac" | "linux" | "android" | "ios";

/** The visitor's system, from the browser's own description. */
export function detectOs(ua: string, platform: string, touchPoints: number): Os | null {
  if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(platform) && touchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Windows/.test(ua) || /^Win/.test(platform)) return "windows";
  if (/Macintosh|Mac OS X/.test(ua) || /^Mac/.test(platform)) return "mac";
  if (/Linux|X11|CrOS/.test(ua) || /Linux/.test(platform)) return "linux";
  return null;
}

/** The visitor's system: Client Hints when the browser has them (Chromium), else the user-agent string. */
export function visitorOs(): Os | null {
  if (typeof navigator === "undefined") return null;
  const hints = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const p = hints?.platform ?? "";
  if (/^Android$/i.test(p)) return "android";
  if (/^Windows$/i.test(p)) return "windows";
  if (/^(Linux|Chrome OS)$/i.test(p)) return "linux";
  return detectOs(navigator.userAgent, navigator.platform ?? "", navigator.maxTouchPoints ?? 0);
}
