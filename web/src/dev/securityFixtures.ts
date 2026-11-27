/** Lot 1 security in the dev gallery (GallerySecurity.tsx): what server/src/securityroutes.ts answers. */
import { GALLERY_BOT_ID, NOW, type FixtureOptions } from "./fixtures";

const H = 3600_000;
export const securitySettingsFixture = (empty: boolean) => ({ settings: { floorSecondFactor: !empty, netAlerts: !empty }, twoFactor: !empty, passkey: !empty });
export const browserFixture = (empty: boolean) => ({ browser: empty ? { installed: null, latest: null, behind: null, state: "unknown" } : { installed: "129.0.6668.58", latest: "131.0.6778.85", behind: 2, state: "warn", sandbox: { image: true, profile: true, oldComputers: 2, unsandboxed: 0, state: "warn" } } });
export function botSecurityFixture(o: FixtureOptions, empty: boolean) {
  if (empty) return { hosts: [], testHosts: [] };
  const long = o.long ? "un-tres-long-sous-domaine-de-test-pour-voir-le-retour-a-la-ligne.boutique-exemple-de-demonstration.fr" : "boutique.example";
  return {
    hosts: [
      { host: "evil.example", via: "click", firstAt: NOW - 0.2 * H, lastAt: NOW - 0.2 * H, count: 1, tainted: true, fresh: true },
      { host: long, via: "page", firstAt: NOW - 3 * H, lastAt: NOW - 1 * H, count: 7, tainted: false, fresh: true },
      { host: "api.stripe.com", via: "secret", firstAt: NOW - 90 * H, lastAt: NOW - 5 * H, count: 42, tainted: false, fresh: false },
      { host: "news.example", via: "fetch", firstAt: NOW - 200 * H, lastAt: NOW - 20 * H, count: 3, tainted: false, fresh: false },
    ],
    testHosts: ["mon-site.fr", "staging.mon-site.fr"],
  };
}
export const recipientsFixture = (empty: boolean) => ({ owner: "lea@example.com", recipients: empty ? [] : ["camille@client.fr", "@partenaire.fr"] });
export const vaultAccessFixture = (empty: boolean) => ({
  access: { bots: empty ? [] : [GALLERY_BOT_ID], askEveryTime: !empty },
  history: empty ? [] : [
    { botId: GALLERY_BOT_ID, botName: "Juno", tool: "secret_use", host: "api.stripe.com", ok: true, at: NOW - 2 * H },
    { botId: "bot_other", botName: "Compta", tool: "secret_use", host: "api.stripe.com", ok: false, at: NOW - 30 * H },
  ],
});

/** L44 passkeys and new-device sign-ins (Passkeys.tsx): what server/src/passkeys.ts and newdevice.ts answer. */
export const passkeysFixture = (o: FixtureOptions, empty: boolean) => ({
  available: true, max: 20, needsPassword: true,
  passkeys: empty ? [] : [
    { id: "pk_phone", name: o.lang === "fr" ? "Mon téléphone" : "My phone", createdAt: NOW - 40 * 24 * H, lastUsedAt: NOW - 2 * H, synced: true },
    { id: "pk_key", name: o.long ? (o.lang === "fr" ? "Clé de sécurité du bureau rangée dans le tiroir de gauche avec les badges" : "Office security key kept in the left drawer with the badges") : "YubiKey", createdAt: NOW - 3 * 24 * H, lastUsedAt: null, synced: false },
  ],
});
export const signInsFixture = (o: FixtureOptions, empty: boolean) => {
  const fr = o.lang === "fr";
  return { signIns: empty ? [] : [
    { id: "sia_1", at: NOW - 0.5 * H, family: fr ? "Firefox sur Linux" : "Firefox on Linux", via: fr ? "mot de passe" : "password", active: true, denied: false, current: false, notified: true },
    { id: "sia_2", at: NOW - 26 * H, family: fr ? "Safari sur iOS" : "Safari on iOS", via: fr ? "clé d'accès" : "passkey", active: true, denied: false, current: true, notified: true },
    { id: "sia_3", at: NOW - 80 * H, family: fr ? "Chrome sur Windows" : "Chrome on Windows", via: "Google", active: false, denied: true, current: false, notified: true },
  ] };
};
