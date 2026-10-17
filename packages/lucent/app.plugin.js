"use strict";
// Expo config plugin. During `expo prebuild` it runs `lucent build` (so the
// native package exists before `pod install` / Gradle) and makes sure the app's
// react-native.config.js links it.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { nativePackage } = require("./metro/native-package.cjs");
const {
  readExtensionTargets,
  withExtensionPods,
  withExtensionTargets,
  writeExtensionFiles,
} = require("./ios-extensions.js");

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
  // LUCENT_PREBUILD: iOS waits for the packages' pods prebuild's pod install installs, which the
  // Podfile's Lucent hook (withPodHook) binds.
  const r = spawnSync(process.execPath, [cli, ...buildArgs(projectRoot, prebuildPlatforms())], {
    stdio: "inherit",
    env: { ...process.env, LUCENT_NO_GRADLE: "1", LUCENT_PREBUILD: "1" },
  });
  if (r.status !== 0)
    throw new Error("lucent build failed; fix the errors above and run prebuild again");
  linkNativePackage(projectRoot);
}

/** The entry earlier versions wrote: the root alone, never built (src/cli/init/patch.ts). */
const PLAIN_ENTRY =
  /(["']?)lucent(?:-native)?\1\s*:\s*\{\s*root:\s*require\(["']path["']\)\.join\(__dirname,\s*["']\.lucent["'],\s*["']native["']\)\s*,?\s*\}/;

/** Makes the app's react-native.config.js link the native package lucent build writes. */
function linkNativePackage(projectRoot) {
  const rnConfig = path.join(projectRoot, "react-native.config.js");
  // Built first when missing or stale (autolink/index.cjs): EAS and CI clone without .lucent/.
  const entry = `"lucent": require("@lucent-lang/lucent/autolink")(__dirname)`;
  const text = fs.existsSync(rnConfig) ? fs.readFileSync(rnConfig, "utf8") : undefined;
  if (text === undefined) {
    fs.writeFileSync(rnConfig, `module.exports = {\n  dependencies: {\n    ${entry},\n  },\n};\n`);
  } else if (PLAIN_ENTRY.test(text)) {
    // Earlier versions linked the root alone, which a fresh clone lacks.
    fs.writeFileSync(rnConfig, text.replace(PLAIN_ENTRY, entry));
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

/** `group:artifact` of a `group:artifact:version`: what a build file names whatever version it has. */
const artifactOf = (coordinate) => coordinate.split(":").slice(0, 2).join(":");

/**
 * The project's build.gradle with each artifact Lucent packages' Gradle
 * plugins need on its buildscript classpath, as `classpath("…")`. One it
 * names already, at any version, stays as the app has it. Undefined when
 * nothing changes, and when it has no `buildscript { dependencies { … } }`.
 */
function withGradleClasspaths(text, artifacts) {
  const missing = artifacts.filter((a) => !text.includes(artifactOf(a)));
  if (!missing.length) return undefined;
  const block = /buildscript\s*\{[\s\S]*?\bdependencies\s*\{[^\n]*\n/.exec(text);
  if (!block) return undefined;
  const at = block.index + block[0].length;
  const lines = missing.map((a) => `        classpath(${JSON.stringify(a)})\n`).join("");
  return text.slice(0, at) + lines + text.slice(at);
}

/** Whether a build file applies the Gradle plugin `id`, in either way it can. */
const appliesPlugin = (text, id) => {
  const quoted = `["']${id.replace(/[.]/g, "\\.")}["']`;
  return new RegExp(`apply\\s*\\(?\\s*plugin\\s*[:=]\\s*${quoted}|\\bid\\s*\\(?\\s*${quoted}`).test(
    text,
  );
};

/**
 * The app's build.gradle applying each Gradle plugin Lucent packages need,
 * at its end (Google services reads what the rest set up). Undefined when
 * it applies them all.
 */
function withGradlePlugins(text, ids, language = "groovy") {
  const missing = ids.filter((id) => !appliesPlugin(text, id));
  if (!missing.length) return undefined;
  const line = (id) =>
    language === "kt"
      ? `apply(plugin = ${JSON.stringify(id)})`
      : `apply plugin: ${JSON.stringify(id)}`;
  return `${text.replace(/\n*$/, "\n")}${missing.map(line).join("\n")}\n`;
}

/** The Podfile line that loads Lucent's CocoaPods hook (cocoapods/lucent.rb), as Expo's own lines find a package. */
const POD_HOOK_REQUIRE = `require File.join(File.dirname(\`node --print "require.resolve('@lucent-lang/lucent/package.json')"\`), "cocoapods/lucent")`;

/**
 * The Podfile with Lucent's CocoaPods hook: required after the Podfile's
 * own requires, and called first in its post_install (one is added when
 * it has none). Once pod install has installed the packages' pods, the
 * hook builds Lucent's modules again, binding them. Undefined when the
 * Podfile has it already.
 */
function withPodHook(text) {
  if (text.includes('"cocoapods/lucent"')) return undefined;

  const lines = text.split("\n");
  const lastRequire = lines.reduce((at, l, i) => (/^require(_relative)?\b/.test(l) ? i : at), -1);
  lines.splice(lastRequire + 1, 0, POD_HOOK_REQUIRE);

  const hook = lines.findIndex((l) => /^\s*post_install do \|\w+\|\s*$/.test(l));
  if (hook >= 0) {
    const [, indent, name] = /^(\s*)post_install do \|(\w+)\|/.exec(lines[hook]);
    lines.splice(hook + 1, 0, `${indent}  lucent_post_install(${name})`);
  } else {
    const end = lines.at(-1) === "" ? lines.length - 1 : lines.length;
    lines.splice(
      end,
      0,
      "",
      "post_install do |installer|",
      "  lucent_post_install(installer)",
      "end",
    );
  }

  return lines.join("\n");
}

/** What Lucent packages need (their lucent.json), as the last build resolved it. */
function resolvedNative(projectRoot) {
  const file = path.join(nativePackage(projectRoot), "resolved.json");
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

/**
 * The app's AndroidManifest.xml (as Expo's mods parse it) with the main
 * Activity's attributes Lucent packages need: picture in picture, and the
 * configChanges values it lacks. The app's own launchMode stands; a
 * package that needs another is warned about (`warn`).
 */
function withMainActivity(manifest, needs, warn = () => {}) {
  if (!needs) return manifest;
  const activities = manifest.manifest?.application?.[0]?.activity ?? [];
  const launcher = (a) =>
    (a["intent-filter"] ?? []).some((f) =>
      (f.category ?? []).some((c) => c.$?.["android:name"] === "android.intent.category.LAUNCHER"),
    );
  const main = activities.find(launcher);
  if (!main) return manifest;

  const attributes = (main.$ ??= {});
  if (needs.supportsPictureInPicture) attributes["android:supportsPictureInPicture"] = "true";

  const handled = (attributes["android:configChanges"] ?? "").split("|").filter(Boolean);
  const added = Object.keys(needs.configChanges ?? {}).filter((v) => !handled.includes(v));
  if (added.length) attributes["android:configChanges"] = [...handled, ...added].join("|");

  const mode = needs.launchMode?.value;
  if (mode && !attributes["android:launchMode"]) attributes["android:launchMode"] = mode;
  else if (mode && attributes["android:launchMode"] !== mode)
    warn(
      `${needs.launchMode.from.join(" and ")} need android:launchMode="${mode}" on the main Activity, which says ${attributes["android:launchMode"]}: the app's stands`,
    );

  return manifest;
}

function withLucent(config) {
  const {
    WarningAggregator,
    withAndroidManifest,
    withAppBuildGradle,
    withDangerousMod,
    withEntitlementsPlist,
    withInfoPlist,
    withPodfile,
    withProjectBuildGradle,
    withXcodeProject,
  } = require("expo/config-plugins");
  // Gradle builds run lucent build first, like `lucent init` sets up in bare apps; the app's
  // build applies the Gradle plugins packages need.
  config = withAppBuildGradle(config, (c) => {
    if (!c.modRequest.introspect) buildOnce(c.modRequest.projectRoot);
    const { android } = resolvedNative(c.modRequest.projectRoot);
    const withTask =
      applyGradleTask(c.modResults.contents, c.modResults.language) ?? c.modResults.contents;
    c.modResults.contents =
      withGradlePlugins(
        withTask,
        Object.keys(android?.gradlePlugins ?? {}),
        c.modResults.language,
      ) ?? withTask;
    return c;
  });
  // The artifacts those plugins are in, on the project's buildscript classpath.
  if (withProjectBuildGradle)
    config = withProjectBuildGradle(config, (c) => {
      if (!c.modRequest.introspect) buildOnce(c.modRequest.projectRoot);
      const { android } = resolvedNative(c.modRequest.projectRoot);
      const artifacts = Object.values(android?.gradlePlugins ?? {}).map((p) => p.value);
      c.modResults.contents =
        withGradleClasspaths(c.modResults.contents, artifacts) ?? c.modResults.contents;
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
  config = withAndroidManifest(config, (c) => {
    if (!c.modRequest.introspect) buildOnce(c.modRequest.projectRoot);
    const { android } = resolvedNative(c.modRequest.projectRoot);
    c.modResults = withMainActivity(c.modResults, android?.mainActivity, (text) =>
      WarningAggregator.addWarningAndroid("lucent", text),
    );
    return c;
  });
  // The app extensions' targets (decision 0124), from what the build records: the Xcode
  // project's, their files, and the Podfile's.
  config = withXcodeProject(config, (c) => {
    if (c.modRequest.introspect) return c;
    buildOnce(c.modRequest.projectRoot);
    const manifest = readExtensionTargets(c.modRequest.projectRoot);
    if (manifest) {
      withExtensionTargets(c.modResults, manifest, {
        bundleIdentifier: c.ios?.bundleIdentifier,
        version: c.version,
        buildNumber: c.ios?.buildNumber,
      });
      writeExtensionFiles(c.modRequest.platformProjectRoot, manifest);
    }
    return c;
  });
  const extensionPods = (projectRoot, iosDir, contents) => {
    const manifest = readExtensionTargets(projectRoot);
    if (!manifest) return contents;
    const podPath = path.relative(iosDir, path.join(projectRoot, manifest.nativePackage));
    return withExtensionPods(contents, manifest, podPath.split(path.sep).join("/")) ?? contents;
  };
  // pod install builds again once the packages' pods are installed (cocoapods/lucent.rb).
  if (withPodfile)
    config = withPodfile(config, (c) => {
      const hooked = withPodHook(c.modResults.contents) ?? c.modResults.contents;
      c.modResults.contents = c.modRequest.introspect
        ? hooked
        : extensionPods(c.modRequest.projectRoot, c.modRequest.platformProjectRoot, hooked);
      return c;
    });
  else
    config = withDangerousMod(config, [
      "ios",
      async (c) => {
        const podfile = path.join(c.modRequest.platformProjectRoot, "Podfile");
        if (!fs.existsSync(podfile)) return c;
        const before = fs.readFileSync(podfile, "utf8");
        const hooked = withPodHook(before) ?? before;
        const text = c.modRequest.introspect
          ? hooked
          : extensionPods(c.modRequest.projectRoot, c.modRequest.platformProjectRoot, hooked);
        if (text !== before) fs.writeFileSync(podfile, text);
        return c;
      },
    ]);
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
module.exports.withMainActivity = withMainActivity;
module.exports.withPodHook = withPodHook;
module.exports.withGradleClasspaths = withGradleClasspaths;
module.exports.withGradlePlugins = withGradlePlugins;
module.exports.appliesPlugin = appliesPlugin;
module.exports.iosExtensions = require("./ios-extensions.js");
