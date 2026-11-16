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
const VERSION = "1.2.0";
const VERSION_CODE = 3;
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
  name: store ? "Sklubot" : "Sklubot Complet",
  slug: "sklubot",
  version: VERSION,
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "sklubot",
  userInterfaceStyle: "automatic",
  backgroundColor: "#f5f3ef",
  ios: {
    bundleIdentifier: "fr.sklubot.app",
    buildNumber: String(VERSION_CODE),
    supportsTablet: true,
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: store ? "fr.sklubot.app" : "fr.sklubot.app.complet",
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
    ["expo-splash-screen", { image: "./assets/splash-icon.png", imageWidth: 120, backgroundColor: "#f5f3ef", dark: { image: "./assets/splash-icon.png", backgroundColor: "#101215" } }],
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
  ],
  extra: { variant },
});
