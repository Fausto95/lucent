#!/usr/bin/env node
import { run } from "./cli.ts";
import { processIO } from "./io.ts";

run(process.argv.slice(2), processIO()).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
