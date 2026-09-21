/**
 * Compiles every fixture's generated Swift and Kotlin with the real toolchains,
 * against a stub runtime where `ArrayBuffer` is a plain byte array.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@lucent-lang/compiler";
import { generateSwift, swiftRuntime } from "@lucent-lang/backend-swift";
import { generateKotlin, kotlinRuntime } from "@lucent-lang/backend-kotlin";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const run = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { exitCode: r.status ?? 1, stderr: r.stderr ?? "" };
};
const fixtures = join(root, "fixtures");
const names = readdirSync(fixtures)
  .filter((f) => f.endsWith(".lucent.ts"))
  .map((f) => f.replace(/\.lucent\.ts$/, ""));
const work = mkdtempSync(join(tmpdir(), "lucent-verify-"));

const SWIFT_RUNTIME =
  "typealias ArrayBuffer = [UInt8]\n\n" +
  swiftRuntime({ length: "return Double(buffer.count)", get: "return Double(buffer[Int(index)])" });
const KOTLIN_RUNTIME = (pkg: string) =>
  kotlinRuntime(
    {
      imports: [],
      length: "return buffer.size.toDouble()",
      get: "return (buffer[index.toInt()].toInt() and 0xff).toDouble()",
    },
    pkg,
  ).replace(`package ${pkg}\n\n`, `package ${pkg}\n\ntypealias ArrayBuffer = ByteArray\n\n`);

let failed = false;
const kotlinFiles: string[] = [];
writeFileSync(join(work, "Runtime.swift"), SWIFT_RUNTIME);

for (const name of names) {
  const source = readFileSync(join(fixtures, `${name}.lucent.ts`), "utf8");
  const result = compile(source, { fileName: `${name}.lucent.ts` });
  if (!result.module) {
    console.log(`✗ ${name}: compile failed`);
    failed = true;
    continue;
  }
  const swiftFile = join(work, `${name}.swift`);
  writeFileSync(swiftFile, generateSwift(result.module).code);
  const swift = run("swiftc", ["-typecheck", "-parse-as-library", join(work, "Runtime.swift"), swiftFile]);
  if (swift.exitCode === 0) console.log(`✓ swift   ${name}`);
  else {
    failed = true;
    console.log(`✗ swift   ${name}\n${swift.stderr}`);
  }
  const pkg = `fixtures.f_${name.replace(/-/g, "_")}`;
  const kotlinFile = join(work, `${name}.kt`);
  writeFileSync(kotlinFile, `package ${pkg}\n\n` + generateKotlin(result.module).code);
  const runtimeFile = join(work, `${name}.Runtime.kt`);
  writeFileSync(runtimeFile, KOTLIN_RUNTIME(pkg));
  kotlinFiles.push(kotlinFile, runtimeFile);
}

const kotlin = run("kotlinc", ["-nowarn", "-d", join(work, "out"), ...kotlinFiles]);
if (kotlin.exitCode === 0) console.log(`✓ kotlin  ${names.length} fixtures`);
else {
  failed = true;
  console.log(`✗ kotlin\n${kotlin.stderr}`);
}
console.log(`(sources in ${work})`);
process.exit(failed ? 1 : 0);
