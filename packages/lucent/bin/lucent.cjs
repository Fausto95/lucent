#!/usr/bin/env node
"use strict";
// Installed packages (which ship dist, not src) run the compiled CLI; in this
// repository it runs the TypeScript sources through tsx.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const dist = path.join(__dirname, "../dist/cli.js");
const main = path.join(__dirname, "../src/cli/main.ts");
if (!fs.existsSync(main)) {
  import(require("node:url").pathToFileURL(dist).href);
} else {
  const tsx = require.resolve("tsx/cli");
  const r = spawnSync(process.execPath, [tsx, main, ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(r.status === null ? 1 : r.status);
}
