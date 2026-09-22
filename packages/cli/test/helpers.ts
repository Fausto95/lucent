import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExecResult, IO } from "../src/io.ts";

export interface FakeIO extends IO {
  out(): string;
  err(): string;
}

/** Streams collected into strings; tools answered from a lookup table instead of spawned. */
export function fakeIO(
  cwd: string,
  options: { env?: Record<string, string>; isTTY?: boolean; tools?: Record<string, string> } = {},
): FakeIO {
  const out: string[] = [];
  const err: string[] = [];
  const tools = options.tools ?? {};
  return {
    cwd,
    env: options.env ?? {},
    isTTY: options.isTTY ?? false,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => err.push(chunk) },
    exec: (cmd: string): ExecResult =>
      cmd in tools ? { status: 0, output: tools[cmd]! } : { status: null, output: "" },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

/** A temp project with the given files; keys are root-relative paths. */
export function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "lucent-cli-"));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

export const MATH = "export function add(a: number, b: number): number { return a + b; }\n";
export const TEXT = 'export function shout(s: string): string { return s + "!"; }\n';
export const BAD = "export function f(x: any): number { return 1; }\n";
export const CLOCK =
  'import { now } from "@lucent-lang/platform/clock";\nexport function timestamp(): number { return now(); }\n';

/** An Expo app that is fully wired for Lucent. */
export function wiredExpoProject(extra: Record<string, string> = {}): string {
  return project({
    "package.json": JSON.stringify({
      name: "app",
      dependencies: { expo: "~58.0.0", "@lucent-lang/runtime": "*" },
      devDependencies: { "@lucent-lang/types": "*", "@lucent-lang/metro": "*", "@lucent-lang/expo": "*" },
    }),
    "app.json": JSON.stringify({ expo: { name: "app", plugins: [["@lucent-lang/expo", { host: "expo" }]] } }),
    "metro.config.js":
      'const { withLucent } = require("@lucent-lang/metro");\nmodule.exports = withLucent({}, { host: "expo" });\n',
    "lucent.config.json": JSON.stringify({ capabilities: [] }),
    "src/native/math.lucent.ts": MATH,
    "src/native/text.lucent.ts": TEXT,
    ...extra,
  });
}
