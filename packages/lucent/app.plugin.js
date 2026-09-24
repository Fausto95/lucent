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
  // No Gradle during prebuild: android/ is half-written, and a Gradle run would cache it so
  // (autolinking with the template's package). The Gradle task this plugin applies resolves
  // the classpath and builds Android when the app is built.
  const r = spawnSync(process.execPath, [cli, "build", "--root", projectRoot], { stdio: "inherit", env: { ...process.env, LUCENT_NO_GRADLE: "1" } });
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

/** The line that applies Lucent's Gradle task (gradle/lucent.gradle) in android/app/build.gradle. */
const GRADLE_LINE = `apply from: new File(new File(["node", "--print", "require.resolve('@lucent-lang/lucent/package.json')"].execute(null, rootDir).text.trim()).parentFile, "gradle/lucent.gradle")`;

/**
 * android/app/build.gradle with the Gradle task applied after React
 * Native's plugin (or the last `apply plugin`, or at the top), or
 * undefined when it is applied already.
 */
function applyGradleTask(text) {
  if (text.includes("gradle/lucent.gradle")) return undefined;
  const lines = text.split("\n");
  const react = lines.findIndex((l) => /^apply plugin: ["']com\.facebook\.react["']/.test(l));
  const lastApply = lines.reduce((at, l, i) => (/^apply plugin:/.test(l) ? i : at), -1);
  const after = react >= 0 ? react : lastApply;
  lines.splice(after + 1, 0, GRADLE_LINE);
  return lines.join("\n");
}

/** Info.plist entries Lucent packages need (their lucent.json), as the last build recorded them. */
function packagesInfoPlist(projectRoot) {
  const manifest = path.join(projectRoot, ".lucent", "native", "manifest.json");
  if (!fs.existsSync(manifest)) return {};
  return JSON.parse(fs.readFileSync(manifest, "utf8")).infoPlist || {};
}

function withLucent(config) {
  const { withAppBuildGradle, withDangerousMod, withInfoPlist } = require("expo/config-plugins");
  // Gradle builds run lucent build first, like `lucent init` sets up in bare apps.
  config = withAppBuildGradle(config, (c) => {
    if (c.modResults.language === "groovy") c.modResults.contents = applyGradleTask(c.modResults.contents) ?? c.modResults.contents;
    return c;
  });
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
module.exports.GRADLE_LINE = GRADLE_LINE;
module.exports.applyGradleTask = applyGradleTask;
