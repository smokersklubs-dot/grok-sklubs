/**
 * The phone relay ("Contrôle du téléphone"), only in the "complet" build: a local Expo module
 * (modules/sklubot-relay) wraps the native relay. The store build does not link it, so the module is absent and
 * everything here is a no-op. https://docs.expo.dev/modules/module-api/ (requireOptionalNativeModule)
 */
import { requireOptionalNativeModule } from "expo";

export interface RelayStatus { enabled: boolean; accessibility: boolean; locked: boolean; state: string; paired?: boolean; accessibilityWasOn?: boolean }
interface RelayNative {
  setServer(origin: string): void;
  openRelay(): void;
  status(): RelayStatus;
  resume(): void;
  openAccessibility(): void;
  openAppInfo(): void;
}

const native = requireOptionalNativeModule<RelayNative>("SklubotRelay");

export const relayAvailable = !!native;

/** The relay connects to the same server as the app (it reads the address when the user turns it on). */
export function relaySetServer(origin: string | null) {
  try { if (native && origin) native.setServer(origin); } catch { /* the relay screen says what is missing */ }
}

/** Opens the native relay screen. Turning the relay on stays a tap of the user there. */
export function openRelay(): boolean {
  if (!native) return false;
  try { native.openRelay(); return true; } catch { return false; }
}

export function relayStatus() {
  try { return native ? native.status() : null; } catch { return null; }
}

/**
 * The phone is paired and the user left the relay on, but the accessibility service is off (some phones turn it off at an
 * app update or to save battery; stock Android 14 keeps it on across an update, checked on the emulator): worth a clear prompt. Pure: unit-tested.
 */
export function relayNeedsAccessibility(s: RelayStatus | null): boolean {
  return !!s && s.enabled && !!s.paired && !s.accessibility;
}

/** At each start of the app: the relay's connection comes back if it was left on (Android stops it at an update). */
export function relayResume() { try { native?.resume(); } catch { /* the relay screen shows the state */ } }

/** Sklubot's page in the accessibility settings (the user turns it on there). */
export function openRelayAccessibility() { try { native?.openAccessibility(); } catch { /* ignore */ } }

/** The app's info screen ("Allow restricted settings" on Android 13+ for an app installed from a file). */
export function openRelayAppInfo() { try { native?.openAppInfo(); } catch { /* ignore */ } }
