const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const { withLucent } = require("@lucent-lang/lucent/metro");
const path = require("path");

const root = path.resolve(__dirname, "../..");

/** @type {import('@react-native/metro-config').MetroConfig} */
const config = {
  watchFolders: [root],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, "node_modules"), path.resolve(root, "node_modules")],
  },
};

module.exports = withLucent(mergeConfig(getDefaultConfig(__dirname), config));
