"use strict";
// Expo config plugin. During `expo prebuild` it runs `lucent build` (so the
// native package exists before `pod install` / Gradle) and makes sure the app's
// react-native.config.js links it.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

let built = false;

/**
 * The platforms `expo prebuild` writes: its `--platform` (`-p`) flag, or
 * both. Every mod sees only its own platform, and the first build must
 * build them all: a build of one platform removes the other's code.
 */
function prebuildPlatforms(argv = process.argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = a === "--platform" || a === "-p" ? argv[i + 1] : /^--platform=(.*)$/.exec(a)?.[1];
    if (value === "ios" || value === "android") return [value];
    if (value === "all") break;
  }
  return ["ios", "android"];
}

/**
 * `lucent build`'s arguments for prebuilding `platforms`: one platform
 * alone, or none for both, so the build compiles what this machine can
 * (Linux has no iOS SDK) and leaves Android to the Gradle build when its
 * dependencies are not resolved yet.
 */
function buildArgs(projectRoot, platforms) {
  return [
    "build",
    "--root",
    projectRoot,
    ...(platforms.length === 1 ? ["--platforms", platforms[0]] : []),
  ];
}

function buildOnce(projectRoot) {
  if (built) return;
  built = true;
  const cli = path.join(__dirname, "bin/lucent.cjs");
  // No Gradle during prebuild: android/ is half-written, and a Gradle run would cache it so
  // (autolinking with the template's package). The Gradle task this plugin applies resolves
  // the classpath and builds Android when the app is built.
  const r = spawnSync(process.execPath, [cli, ...buildArgs(projectRoot, prebuildPlatforms())], {
    stdio: "inherit",
    env: { ...process.env, LUCENT_NO_GRADLE: "1" },
  });
  if (r.status !== 0)
    throw new Error("lucent build failed; fix the errors above and run prebuild again");
  linkNativePackage(projectRoot);
}

/** Makes the app's react-native.config.js link the native package lucent build writes. */
function linkNativePackage(projectRoot) {
  const rnConfig = path.join(projectRoot, "react-native.config.js");
  const entry = `"lucent": { root: require("path").join(__dirname, ".lucent", "native") }`;
  const text = fs.existsSync(rnConfig) ? fs.readFileSync(rnConfig, "utf8") : undefined;
  if (text === undefined) {
    fs.writeFileSync(rnConfig, `module.exports = {\n  dependencies: {\n    ${entry},\n  },\n};\n`);
  } else if (text.includes('"lucent-native"')) {
    // Earlier versions named the dependency lucent-native.
    fs.writeFileSync(rnConfig, text.replace('"lucent-native"', '"lucent"'));
  } else if (!/(^|[{,\s])(["']?)lucent\2\s*:/m.test(text)) {
    throw new Error(`Add ${entry} to the "dependencies" of react-native.config.js`);
  }
}

/**
 * How android/app/build.gradle applies Lucent's Gradle task
 * (gradle/lucent.gradle), by the script's language as Expo names it: the
 * line, and where it goes among the script's lines.
 */
const GRADLE_TASK = {
  groovy: {
    line: `apply from: new File(new File(["node", "--print", "require.resolve('@lucent-lang/lucent/package.json')"].execute(null, rootDir).text.trim()).parentFile, "gradle/lucent.gradle")`,
    // After React Native's plugin, or the last `apply plugin`, or at the top.
    at(lines) {
      const react = lines.findIndex((l) => /^apply plugin: ["']com\.facebook\.react["']/.test(l));
      const lastApply = lines.reduce((at, l, i) => (l.startsWith("apply plugin:") ? i : at), -1);
      return (react >= 0 ? react : lastApply) + 1;
    },
  },
  kt: {
    line: `apply(from = File(File(providers.exec { workingDir = rootDir; commandLine("node", "--print", "require.resolve('@lucent-lang/lucent/package.json')") }.standardOutput.asText.get().trim()).parentFile, "gradle/lucent.gradle"))`,
    // At the end: Kotlin DSL allows no statement before plugins {}, and lucent.gradle hooks in lazily.
    at: (lines) => (lines.at(-1) === "" ? lines.length - 1 : lines.length),
  },
};

const GRADLE_LINES = Object.fromEntries(
  Object.entries(GRADLE_TASK).map(([language, { line }]) => [language, line]),
);

/**
 * android/app/build.gradle (`language` "groovy") or build.gradle.kts
 * ("kt") with the Gradle task applied, or undefined when it is applied
 * already.
 */
function applyGradleTask(text, language = "groovy") {
  const task = GRADLE_TASK[language];
  if (!task)
    throw new Error(
      `Lucent can't apply its Gradle task to a ${language} android/app/build.gradle: add the line of gradle/lucent.gradle's header by hand`,
    );
  if (text.includes("gradle/lucent.gradle")) return undefined;
  const lines = text.split("\n");
  lines.splice(task.at(lines), 0, task.line);
  return lines.join("\n");
}

/** What Lucent packages need (their lucent.json), as the last build resolved it. */
function resolvedNative(projectRoot) {
  const file = path.join(projectRoot, ".lucent", "native", "resolved.json");
  if (!fs.existsSync(file)) return { ios: {} };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * The app's plist entries (Info.plist, entitlements) with the packages'
 * added: a key the app sets keeps the app's value, except arrays, which
 * gain the values they lack.
 */
function withPackageEntries(app, packages) {
  const out = { ...app };

  for (const [key, { value }] of Object.entries(packages)) {
    const own = out[key];

    if (own === undefined) out[key] = value;
    else if (Array.isArray(own) && Array.isArray(value))
      out[key] = [...own, ...value.filter((v) => !own.includes(v))];
  }

  return out;
}

function withLucent(config) {
  const {
    withAppBuildGradle,
    withDangerousMod,
    withEntitlementsPlist,
    withInfoPlist,
  } = require("expo/config-plugins");
  // Gradle builds run lucent build first, like `lucent init` sets up in bare apps.
  config = withAppBuildGradle(config, (c) => {
    c.modResults.contents =
      applyGradleTask(c.modResults.contents, c.modResults.language) ?? c.modResults.contents;
    return c;
  });
  // Keys the app sets itself win.
  // `expo config --type introspect` evaluates these mods to show the config: it reads what the
  // last build resolved, and builds nothing.
  config = withInfoPlist(config, (c) => {
    if (!c.modRequest.introspect) buildOnce(c.modRequest.projectRoot);
    const { ios } = resolvedNative(c.modRequest.projectRoot);
    c.modResults = withPackageEntries(c.modResults, ios.infoPlist || {});
    return c;
  });
  config = withEntitlementsPlist(config, (c) => {
    if (!c.modRequest.introspect) buildOnce(c.modRequest.projectRoot);
    const { ios } = resolvedNative(c.modRequest.projectRoot);
    c.modResults = withPackageEntries(c.modResults, ios.entitlements || {});
    return c;
  });
  for (const platform of ["ios", "android"]) {
    config = withDangerousMod(config, [
      platform,
      async (c) => {
        if (!c.modRequest.introspect) buildOnce(c.modRequest.projectRoot);
        return c;
      },
    ]);
  }
  return config;
}

module.exports = withLucent;
module.exports.GRADLE_LINES = GRADLE_LINES;
module.exports.applyGradleTask = applyGradleTask;
module.exports.buildArgs = buildArgs;
module.exports.prebuildPlatforms = prebuildPlatforms;
module.exports.linkNativePackage = linkNativePackage;
module.exports.withPackageEntries = withPackageEntries;
