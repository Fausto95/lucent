#!/usr/bin/env node
"use strict";
// Runs the TypeScript CLI through tsx (the compiler ships as TypeScript).
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const main = path.join(__dirname, "../src/main.ts");
const tsx = require.resolve("tsx/cli");
const r = spawnSync(process.execPath, [tsx, main, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status === null ? 1 : r.status);
