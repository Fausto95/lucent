"use strict";
// The app's react-native.config.js entry for Lucent's native package, as
// `lucent init` writes it:
//
//   dependencies: {
//     "lucent": require("@lucent-lang/lucent/autolink")(__dirname),
//   },
//
// React Native's autolinking (pod install, Gradle's settings) reads that
// config. .lucent/ is generated and ignored by git, so on a fresh clone,
// CI or EAS the package is missing, and autolinking would skip it without
// a word: the app builds without Lucent and fails when a module loads.
// This runs `lucent build` first when the package is missing, or older
// than a module or package.json, then gives autolinking its root.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/** Directories the CLI's module search skips (compiler's findLucentFiles). */
const SKIP = new Set(["node_modules", "ios", "android"]);
const LUCENT = /\.lucent\.tsx?$/;

/** The newest mtime of the app's modules and package.json, past `since`, or undefined. */
function newerThan(root, since) {
  const pkg = path.join(root, "package.json");
  if (fs.existsSync(pkg) && fs.statSync(pkg).mtimeMs > since) return pkg;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const found = walk(full);
        if (found) return found;
      } else if (LUCENT.test(e.name) && fs.statSync(full).mtimeMs > since) return full;
    }
    return undefined;
  };
  return walk(root);
}

/**
 * Why the native package at `out` needs a build: missing, or older than a
 * file of the app's; undefined when it is current. A Lucent package's
 * change is left to the next build (Metro's watcher, the Gradle task).
 */
function staleness(root, out) {
  const manifest = path.join(out, "manifest.json");
  if (!fs.existsSync(path.join(out, "react-native.config.js")) || !fs.existsSync(manifest))
    return `${path.relative(root, out)} is missing`;
  const newer = newerThan(root, fs.statSync(manifest).mtimeMs);
  return newer ? `${path.relative(root, newer)} changed since the last build` : undefined;
}

/**
 * The dependency entry for the native package of the app at `root`
 * (react-native.config.js's __dirname), built first when it must be.
 * LUCENT_AUTOLINK_BUILD=0 never builds here.
 */
function lucentDependency(root, options = {}) {
  const out = path.join(root, ".lucent", "native");
  const why = process.env.LUCENT_AUTOLINK_BUILD === "0" ? undefined : staleness(root, out);

  if (why) {
    process.stderr.write(`lucent: ${why}: running lucent build before autolinking\n`);
    const r = spawnSync(
      process.execPath,
      [path.join(__dirname, "../bin/lucent.cjs"), "build", "--root", root],
      {
        // stdout is autolinking's: `react-native config` prints the config there, as JSON.
        stdio: ["ignore", 2, 2],
        // Gradle may be the one reading this config: Android's dependencies wait for its
        // lucentBuild task, which runs after autolinking.
        env: { ...process.env, LUCENT_NO_GRADLE: "1", NO_COLOR: process.env.NO_COLOR ?? "1" },
        ...options.spawn,
      },
    );
    // A build whose check failed still writes the package it links (what pod install and
    // Gradle read), and reports its errors above; without the package, nothing would link.
    if (!fs.existsSync(path.join(out, "react-native.config.js")))
      throw new Error(
        `lucent build did not write ${path.relative(root, out)} (exit code ${r.status}): fix the errors above, then run pod install or the Android build again`,
      );
  }

  return { root: out };
}

module.exports = lucentDependency;
module.exports.staleness = staleness;
