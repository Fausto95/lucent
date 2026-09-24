#!/usr/bin/env node
"use strict";
// Runs the bundled CLI, both when installed and in this repository, where
// `pnpm build` (or the watching `dev` task) keeps dist/ current.
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const dist = path.join(__dirname, "../dist/cli.js");
if (!fs.existsSync(dist)) {
  process.stderr.write("lucent: dist/cli.js is missing; run `pnpm build` in the repository first\n");
  process.exit(1);
}
import(pathToFileURL(dist).href);
