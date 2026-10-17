"use strict";
const path = require("node:path");

/**
 * Where the native package is: the one LUCENT_OUT names (relative to the
 * project, as `lucent build --out` is), else the project's .lucent/native.
 * Metro bundles from it, autolinking links it and the Expo plugin reads
 * it; the CLI's nativeOut (src/cli/native-out.ts) writes it there.
 */
function nativePackage(projectRoot) {
  return path.resolve(projectRoot, process.env.LUCENT_OUT || path.join(".lucent", "native"));
}

module.exports = { nativePackage };
