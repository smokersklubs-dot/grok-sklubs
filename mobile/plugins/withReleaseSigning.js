/**
 * Release signing from mobile/keystore.properties (git-ignored, never committed), as in android/:
 *   storeFile=/absolute/path/sklubot-release.jks
 *   storePassword=…   keyAlias=sklubot   keyPassword=…
 * Without the file the release build falls back to Expo's default (debug key), fine for local tests only.
 * https://developer.android.com/studio/publish/app-signing#secure-shared-keystore
 */
const { withAppBuildGradle } = require("expo/config-plugins");

const MARK = "// sklubot-release-signing";
const LOAD = `${MARK}
def sklubotKeystoreFile = rootProject.file("../keystore.properties")
def sklubotKeystore = new Properties()
if (sklubotKeystoreFile.exists()) sklubotKeystoreFile.withInputStream { sklubotKeystore.load(it) }
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes(MARK)) return cfg;
    g = g.replace(/^android\s*\{/m, `${LOAD}\nandroid {`);
    g = g.replace(/signingConfigs\s*\{/, `signingConfigs {
        release {
            if (sklubotKeystoreFile.exists()) {
                storeFile file(sklubotKeystore["storeFile"])
                storePassword sklubotKeystore["storePassword"]
                keyAlias sklubotKeystore["keyAlias"]
                keyPassword sklubotKeystore["keyPassword"]
                enableV1Signing true
                enableV2Signing true
                enableV3Signing true
            }
        }`);
    // In buildTypes.release, use our key when it is configured.
    g = g.replace(/(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/, "$1signingConfig sklubotKeystoreFile.exists() ? signingConfigs.release : signingConfigs.debug");
    cfg.modResults.contents = g;
    return cfg;
  });
};
