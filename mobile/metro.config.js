const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Only the portable chat helpers are needed by the native runtime.
config.watchFolders = [...config.watchFolders, path.resolve(__dirname, "../server/src/clientshared")];
module.exports = config;
