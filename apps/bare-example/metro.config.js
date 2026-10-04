const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const { withLucent } = require("@lucent-lang/lucent/metro");
const path = require("path");

const root = path.resolve(__dirname, "../..");

/** @type {import('@react-native/metro-config').MetroConfig} */
const config = {
  watchFolders: [root],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, "node_modules"), path.resolve(root, "node_modules")],
    // One react-native, the app's: the workspace's other app pins another release, so a
    // package hoisted to the root (FlatList's @react-native/virtualized-lists) gets a copy
    // of its own, and two copies of the renderer's registries break the views it makes.
    resolveRequest: (context, moduleName, platform) =>
      context.resolveRequest(
        moduleName === "react-native" || moduleName.startsWith("react-native/")
          ? { ...context, originModulePath: path.join(__dirname, "package.json") }
          : context,
        moduleName,
        platform,
      ),
  },
};

module.exports = withLucent(mergeConfig(getDefaultConfig(__dirname), config));
