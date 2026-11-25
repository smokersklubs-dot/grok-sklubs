/**
 * L177 — the widget extension that draws the Live Activity of a bot's running task (Lock Screen and Dynamic Island).
 * Read by @bacons/apple-targets (MIT, https://github.com/EvanBacon/expo-apple-targets, version 5.0.0), added to the
 * build only with SKLUBOT_LIVE_ACTIVITY=1 (app.config.ts). Properties from that package's README ("Target config").
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: "widget",
  name: "SklubotLive",
  displayName: "Sklubot",
  // Appended to the app's bundle identifier: <bundle id>.live
  bundleIdentifier: ".live",
  deploymentTarget: "16.4",
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"],
  colors: {
    $accent: "#e2552d",
    $widgetBackground: { color: "#f4f2ee", darkColor: "#131416" },
  },
};
