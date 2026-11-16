/**
 * "Rester connecté en arrière-plan" (complet build only): modules/sklubot-live holds the live channel in a foreground
 * service and notifies at once, app closed or not, without a push service. Absent from the store build (excluded from
 * autolinking): everything here is then a no-op and the ~15 min background check stays the only way.
 * https://docs.expo.dev/modules/module-api/ (requireOptionalNativeModule)
 */
import { requireOptionalNativeModule } from "expo";
import { create } from "zustand";

interface LiveNative {
  enable(origin: string, session: string, onBoot: boolean): void;
  disable(): void;
  setOnBoot(on: boolean): void;
  updateSession(origin: string, session: string): void;
  resume(): void;
  setAppInFront(front: boolean): void;
  clearBot(botId: string): void;
  status(): { enabled: boolean; onBoot: boolean };
}

const native = requireOptionalNativeModule<LiveNative>("SklubotLive");
export const liveAvailable = !!native;

function read(): { enabled: boolean; onBoot: boolean } {
  try { return native ? native.status() : { enabled: false, onBoot: false }; } catch { return { enabled: false, onBoot: false }; }
}

export const useLive = create<{ enabled: boolean; onBoot: boolean }>(() => read());

/** Who notifies: with the background connection on, the service does while the app is not in front (never both). */
export function jsShouldNotify(appActive: boolean, liveOn: boolean): boolean {
  return appActive || !liveOn;
}

export function liveEnable(origin: string, session: string, onBoot: boolean) {
  if (!native) return;
  try { native.enable(origin, session, onBoot); } catch { /* the switch shows the state read back */ }
  useLive.setState(read());
}

export function liveDisable() {
  if (!native) return;
  try { native.disable(); } catch { /* already off */ }
  useLive.setState(read());
}

export function liveSetOnBoot(on: boolean) {
  if (!native) return;
  try { native.setOnBoot(on); } catch { /* ignore */ }
  useLive.setState(read());
}

export function liveSession(origin: string | null, session: string | null) {
  if (!native || !origin) return;
  try { if (session) native.updateSession(origin, session); else native.disable(); } catch { /* ignore */ }
  useLive.setState(read());
}

export function liveResume() { try { native?.resume(); } catch { /* not allowed now */ } useLive.setState(read()); }
export function liveInFront(front: boolean) { try { native?.setAppInFront(front); } catch { /* ignore */ } }
export function liveClearBot(botId: string) { try { native?.clearBot(botId); } catch { /* ignore */ } }
