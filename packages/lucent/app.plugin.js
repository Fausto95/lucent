"use strict";
// Expo config plugin. During `expo prebuild` it runs `lucent build` (so the
// native package exists before `pod install` / Gradle) and makes sure the app's
// react-native.config.js links it.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

let built = false;

function buildOnce(projectRoot) {
  if (built) return;
  built = true;
  const cli = path.join(__dirname, "bin/lucent.cjs");
  const r = spawnSync(process.execPath, [cli, "build", "--root", projectRoot], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("lucent build failed; fix the errors above and run prebuild again");
  const rnConfig = path.join(projectRoot, "react-native.config.js");
  const entry = `"lucent": { root: require("path").join(__dirname, ".lucent", "native") }`;
  const text = fs.existsSync(rnConfig) ? fs.readFileSync(rnConfig, "utf8") : undefined;
  if (text === undefined) {
    fs.writeFileSync(rnConfig, `module.exports = {\n  dependencies: {\n    ${entry},\n  },\n};\n`);
  } else if (text.includes('"lucent-native"')) {
    // Earlier versions named the dependency lucent-native.
    fs.writeFileSync(rnConfig, text.replace('"lucent-native"', '"lucent"'));
  } else if (!/["']lucent["']\s*:/.test(text)) {
    throw new Error(`Add ${entry} to the "dependencies" of react-native.config.js`);
  }
}

/** Info.plist entries Lucent packages need (their lucent.json), as the last build recorded them. */
function packagesInfoPlist(projectRoot) {
  const manifest = path.join(projectRoot, ".lucent", "native", "manifest.json");
  if (!fs.existsSync(manifest)) return {};
  return JSON.parse(fs.readFileSync(manifest, "utf8")).infoPlist || {};
}

function withLucent(config) {
  const { withDangerousMod, withInfoPlist } = require("expo/config-plugins");
  // Keys the app sets itself win.
  config = withInfoPlist(config, (c) => {
    buildOnce(c.modRequest.projectRoot);
    for (const [key, { value }] of Object.entries(packagesInfoPlist(c.modRequest.projectRoot))) {
      if (c.modResults[key] === undefined) c.modResults[key] = value;
    }
    return c;
  });
  for (const platform of ["ios", "android"]) {
    config = withDangerousMod(config, [
      platform,
      async (c) => {
        buildOnce(c.modRequest.projectRoot);
        return c;
      },
    ]);
  }
  return config;
}

module.exports = withLucent;
