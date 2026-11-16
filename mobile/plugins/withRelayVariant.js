/**
 * The store build leaves the phone relay out: modules/sklubot-relay is excluded from Expo autolinking in
 * settings.gradle (`expoAutolinking.exclude`, read by the expo-autolinking-settings Gradle plugin — see
 * node_modules/expo-modules-autolinking/android/expo-gradle-plugin/.../ExpoAutolinkingSettingsExtension.kt and
 * https://docs.expo.dev/modules/autolinking/#exclude). Nothing of the relay (code, accessibility service,
 * foreground service, permissions) reaches the store APK/AAB. The "complet" build links it as usual.
 */
const { withSettingsGradle } = require("expo/config-plugins");

const MARK = "// sklubot-store-variant";

module.exports = function withRelayVariant(config, { variant }) {
  if (variant !== "store") return config;
  return withSettingsGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes(MARK)) return cfg;
    if (!/expoAutolinking\.useExpoModules\(\)/.test(g)) throw new Error("withRelayVariant: expoAutolinking.useExpoModules() not found in settings.gradle");
    g = g.replace(/expoAutolinking\.useExpoModules\(\)/, `${MARK}: no phone relay in the store build\nexpoAutolinking.exclude = ["sklubot-relay"]\nexpoAutolinking.useExpoModules()`);
    cfg.modResults.contents = g;
    return cfg;
  });
};
