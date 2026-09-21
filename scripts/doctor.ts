#!/usr/bin/env bun
/** Reports which tools the Lucent toolchain can find on this machine. */
import { $ } from "bun";

const checks: { name: string; cmd: string[]; required: boolean }[] = [
  { name: "bun", cmd: ["bun", "--version"], required: true },
  { name: "node", cmd: ["node", "--version"], required: true },
  { name: "swiftc", cmd: ["swiftc", "--version"], required: true },
  { name: "kotlinc", cmd: ["kotlinc", "-version"], required: true },
  { name: "xcodebuild", cmd: ["xcodebuild", "-version"], required: false },
  { name: "java", cmd: ["java", "-version"], required: false },
  { name: "adb", cmd: ["adb", "--version"], required: false },
];

let failed = false;
for (const check of checks) {
  const result = await $`${check.cmd}`.quiet().nothrow();
  const text = (result.stdout.toString() + result.stderr.toString()).trim().split("\n")[0] ?? "";
  const ok = result.exitCode === 0;
  if (!ok && check.required) failed = true;
  console.log(`${ok ? "✓" : check.required ? "✗" : "-"} ${check.name.padEnd(11)} ${ok ? text : "not found"}`);
}
process.exit(failed ? 1 : 0);
