"use strict";
// lucent:core's JavaScript implementation, for tests that run Lucent modules
// as plain TypeScript: point Jest's moduleNameMapper or Vitest's alias for
// `lucent:core` here. Installed packages ship it as lib/core.cjs (copied by
// scripts/build.mts); in this repository it is the compiler's source, as
// bin/lucent.cjs runs the CLI's.
const fs = require("node:fs");
const path = require("node:path");

const inRepository = fs.existsSync(path.join(__dirname, "../src"));
module.exports = require(inRepository ? "../../compiler/lib/core.cjs" : "../lib/core.cjs");
