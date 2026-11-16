/**
 * The phone relay ("Contrôle du téléphone"), only in the "complet" build: a local Expo module
 * (modules/sklubot-relay) wraps the native relay. The store build does not link it, so the module is absent and
 * everything here is a no-op. https://docs.expo.dev/modules/module-api/ (requireOptionalNativeModule)
 */
import { requireOptionalNativeModule } from "expo";

interface RelayNative {
  setServer(origin: string): void;
  openRelay(): void;
  status(): { enabled: boolean; accessibility: boolean; locked: boolean; state: string };
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
