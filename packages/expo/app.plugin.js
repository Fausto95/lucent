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
  const cli = require.resolve("@lucent-lang/cli/bin/lucent.cjs");
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

function withLucent(config) {
  const { withDangerousMod } = require("expo/config-plugins");
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
