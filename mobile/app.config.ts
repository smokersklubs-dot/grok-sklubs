/**
 * Two Android builds from the same code (https://docs.expo.dev/workflow/configuration/):
 * - "complet" (default, installed from a file): includes the phone relay (modules/sklubot-relay) and is
 *   fr.sklubot.app.complet, so it can sit next to the store app and never collides with its Play signing;
 * - "store" (SKLUBOT_VARIANT=store): fr.sklubot.app, without the relay (excluded from autolinking: no accessibility
 *   service, no special-use foreground service).
 * Regenerate the native project for a variant with: SKLUBOT_VARIANT=<variant> npx expo prebuild -p android --clean
 */
import type { ConfigContext, ExpoConfig } from "expo/config";

const variant = process.env.SKLUBOT_VARIANT === "store" ? "store" : "complet";
const store = variant === "store";
/**
 * Store submission (docs/BOUTIQUES.md). The owner's account values come from the environment, never from this file:
 * - SKLUBOT_IOS_BUNDLE_ID / SKLUBOT_ANDROID_PACKAGE: the identifiers registered with Apple / Google (default fr.sklubot.app;
 *   the "complet" Android build adds ".complet");
 * - SKLUBOT_EAS_PROJECT_ID (shown by `eas init`; on Expo's build servers EAS_BUILD_PROJECT_ID is set by Expo:
 *   https://docs.expo.dev/eas/environment-variables/usage/#built-in-environment-variables) and SKLUBOT_EXPO_OWNER (the Expo
 *   account, app config `owner`: https://docs.expo.dev/versions/latest/config/app/#owner);
 * - SKLUBOT_APPLE_TEAM_ID: app config `ios.appleTeamId`, needed by the Live Activity target below.
 */
const IOS_BUNDLE_ID = process.env.SKLUBOT_IOS_BUNDLE_ID?.trim() || "fr.sklubot.app";
const ANDROID_PACKAGE = process.env.SKLUBOT_ANDROID_PACKAGE?.trim() || "fr.sklubot.app";
const EAS_PROJECT_ID = process.env.SKLUBOT_EAS_PROJECT_ID?.trim() || process.env.EAS_BUILD_PROJECT_ID?.trim() || "";
/**
 * L177 iPhone Live Activity (a bot's running task on the Lock Screen / Dynamic Island): OFF by default. With
 * SKLUBOT_LIVE_ACTIVITY=1 (and `npx expo install @bacons/apple-targets@5.0.0`, MIT, https://github.com/EvanBacon/expo-apple-targets)
 * the build adds the widget target in targets/sklubot-live, `NSSupportsLiveActivities`
 * (https://developer.apple.com/documentation/bundleresources/information-property-list/nssupportsliveactivities) and the
 * Push Notifications entitlement ActivityKit push tokens need (`aps-environment`:
 * https://developer.apple.com/documentation/bundleresources/entitlements/aps-environment; "production" when the build
 * profile sets SKLUBOT_APS_ENV=production, see eas.json). Untested on a device: see docs/BOUTIQUES.md.
 */
const LIVE_ACTIVITY = process.env.SKLUBOT_LIVE_ACTIVITY === "1";
const APS_ENV = process.env.SKLUBOT_APS_ENV === "production" ? "production" : "development";
if (LIVE_ACTIVITY) {
  try { require.resolve("@bacons/apple-targets/app.plugin"); }
  catch { throw new Error("SKLUBOT_LIVE_ACTIVITY=1 demande le module @bacons/apple-targets : lance « npx expo install @bacons/apple-targets@5.0.0 » dans mobile/ (docs/BOUTIQUES.md)."); }
}
const VERSION = "1.1.0";
const VERSION_CODE = 2;
/** Launcher badge permissions that expo-notifications' badge library declares; the app sets no badge count. */
const BADGE_PERMISSIONS = [
  "com.sec.android.provider.badge.permission.READ", "com.sec.android.provider.badge.permission.WRITE",
  "com.htc.launcher.permission.READ_SETTINGS", "com.htc.launcher.permission.UPDATE_SHORTCUT",
  "com.sonyericsson.home.permission.BROADCAST_BADGE", "com.sonymobile.home.permission.PROVIDER_INSERT_BADGE",
  "com.anddoes.launcher.permission.UPDATE_COUNT", "com.majeur.launcher.permission.UPDATE_BADGE",
  "com.huawei.android.launcher.permission.CHANGE_BADGE", "com.huawei.android.launcher.permission.READ_SETTINGS",
  "com.huawei.android.launcher.permission.WRITE_SETTINGS", "android.permission.READ_APP_BADGE",
  "com.oppo.launcher.permission.READ_SETTINGS", "com.oppo.launcher.permission.WRITE_SETTINGS",
  "me.everything.badger.permission.BADGE_COUNT_READ", "me.everything.badger.permission.BADGE_COUNT_WRITE",
];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  ...(process.env.SKLUBOT_EXPO_OWNER?.trim() ? { owner: process.env.SKLUBOT_EXPO_OWNER.trim() } : {}),
  name: store ? "Sklubot" : "Sklubot Complet",
  slug: "sklubot",
  version: VERSION,
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "sklubot",
  userInterfaceStyle: "automatic",
  backgroundColor: "#f4f2ee",
  ios: {
    bundleIdentifier: IOS_BUNDLE_ID,
    buildNumber: String(VERSION_CODE),
    // Phone-only layout: on an iPad the app runs in iPhone mode, so App Store Connect asks no iPad screenshots
    // (https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications: the 13" iPad
    // set is "Required if app runs on iPad"). Turn it back on together with real iPad screenshots.
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
    ...(process.env.SKLUBOT_APPLE_TEAM_ID?.trim() ? { appleTeamId: process.env.SKLUBOT_APPLE_TEAM_ID.trim() } : {}),
    ...(LIVE_ACTIVITY ? { infoPlist: { NSSupportsLiveActivities: true }, entitlements: { "aps-environment": APS_ENV } } : {}),
    // L160: the app's privacy manifest (written to PrivacyInfo.xcprivacy at prebuild; https://docs.expo.dev/guides/apple-privacy/).
    // One source, store/privacy-manifest.json, also copied to store/PrivacyInfo.xcprivacy; `npm run store:check` keeps them
    // equal and checks every required-reason API declared by the installed libraries is covered.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    privacyManifests: require("./store/privacy-manifest.json"),
  },
  android: {
    package: store ? ANDROID_PACKAGE : `${ANDROID_PACKAGE}.complet`,
    versionCode: VERSION_CODE,
    adaptiveIcon: {
      backgroundColor: "#e2552d",
      foregroundImage: "./assets/android-icon-foreground.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    // Only what the app uses; the store build adds nothing else (checked with aapt2, see README).
    blockedPermissions: [
      "android.permission.SYSTEM_ALERT_WINDOW", "android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE",
      // No push service yet (local notifications only), no biometric unlock, no launcher badge counters.
      "com.google.android.c2dm.permission.RECEIVE", "android.permission.USE_BIOMETRIC", "android.permission.USE_FINGERPRINT",
      ...BADGE_PERMISSIONS,
    ],
    predictiveBackGestureEnabled: false,
    allowBackup: false,
  },
  plugins: [
    "expo-secure-store",
    "expo-sharing",
    "expo-localization",
    "expo-web-browser",
    ["expo-splash-screen", { image: "./assets/splash-icon.png", imageWidth: 120, backgroundColor: "#f4f2ee", dark: { image: "./assets/splash-icon.png", backgroundColor: "#131416" } }],
    "expo-image",
    // The microphone is for voice calls with a bot (modules/sklubot-voice), asked at the first call; not for videos.
    ["expo-image-picker", { microphonePermission: "Sklubot utilise le micro seulement pendant un appel vocal avec un bot.",photosPermission: "Sklubot accède à tes photos seulement quand tu en joins une à un message.", cameraPermission: "Sklubot utilise l’appareil photo seulement quand tu prends une photo pour un bot." }],
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: "#e2552d", enableRemoteNotifications: false }],
    "expo-background-task",
    ["expo-build-properties", { android: { buildArchs: ["arm64-v8a", "armeabi-v7a", "x86_64"], // R8 removed WorkManager's Room constructor (crash at start): no minification, as in android/.
      enableMinifyInReleaseBuilds: false, enableShrinkResourcesInReleaseBuilds: false } }],
    "./plugins/withDevCleartext",
    "./plugins/withReleaseSigning",
    ["./plugins/withRelayVariant", { variant }],
    ...(LIVE_ACTIVITY ? ["@bacons/apple-targets"] : []),
  ],
  extra: { variant, liveActivity: LIVE_ACTIVITY, ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}) },
});
