"use strict";
const path = require("node:path");

/**
 * The native package Metro bundles from: the project's .lucent/native, or
 * the one LUCENT_OUT names (as `lucent build --out`, relative to the project).
 */
function nativePackage(projectRoot) {
  return path.resolve(projectRoot, process.env.LUCENT_OUT || path.join(".lucent", "native"));
}

module.exports = { nativePackage };
