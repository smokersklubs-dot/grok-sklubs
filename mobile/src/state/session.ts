import * as SecureStore from "expo-secure-store";

/**
 * Where the server address and the session token live: the device's secure storage (Android Keystore-backed
 * encrypted preferences, iOS Keychain) — https://docs.expo.dev/versions/v58.0.0/sdk/securestore/
 * The token is stored per server origin, so changing server never sends one server's session to another.
 */
const ORIGIN_KEY = "sklubot.origin";
const tokenKey = (origin: string) => `sklubot.session.${origin.replace(/[^A-Za-z0-9._-]/g, "_")}`;

export async function loadOrigin(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(ORIGIN_KEY); } catch { return null; }
}
export async function saveOrigin(origin: string | null) {
  try {
    if (origin) await SecureStore.setItemAsync(ORIGIN_KEY, origin);
    else await SecureStore.deleteItemAsync(ORIGIN_KEY);
  } catch { /* storage unavailable: asked again next time */ }
}
export async function loadToken(origin: string): Promise<string | null> {
  try { return await SecureStore.getItemAsync(tokenKey(origin)); } catch { return null; }
}
export async function saveToken(origin: string, token: string | null) {
  try {
    if (token) await SecureStore.setItemAsync(tokenKey(origin), token);
    else await SecureStore.deleteItemAsync(tokenKey(origin));
  } catch { /* nothing else to do */ }
}
