/** Reports which tools the Lucent toolchain can find on this machine. */
import { spawnSync } from "node:child_process";

const checks: { name: string; cmd: string[]; required: boolean }[] = [
  { name: "node", cmd: ["node", "--version"], required: true },
  { name: "swiftc", cmd: ["swiftc", "--version"], required: true },
  { name: "kotlinc", cmd: ["kotlinc", "-version"], required: true },
  { name: "xcodebuild", cmd: ["xcodebuild", "-version"], required: false },
  { name: "java", cmd: ["java", "-version"], required: false },
  { name: "adb", cmd: ["adb", "--version"], required: false },
];

const agent = process.env.npm_config_user_agent ?? "";
console.log(
  `${agent.includes("pnpm") ? "✓" : "-"} ${"pnpm".padEnd(11)} ${agent.split(" ")[0] ?? "run this through pnpm"}`,
);

let failed = false;
for (const check of checks) {
  const result = spawnSync(check.cmd[0]!, check.cmd.slice(1), { encoding: "utf8" });
  const text = ((result.stdout ?? "") + (result.stderr ?? "")).trim().split("\n")[0] ?? "";
  const ok = result.status === 0;
  if (!ok && check.required) failed = true;
  console.log(`${ok ? "✓" : check.required ? "✗" : "-"} ${check.name.padEnd(11)} ${ok ? text : "not found"}`);
}
process.exit(failed ? 1 : 0);
