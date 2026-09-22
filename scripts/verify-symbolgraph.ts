/** Extract an actual Swift compiler graph, then compile and execute its generated bindings. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractSwiftSymbolGraph, generateBindingLibrary } from "../packages/sdk/src/index.ts";
import { compile } from "../packages/compiler/src/index.ts";
import { generateSwift, swiftRuntime } from "../packages/backend-swift/src/index.ts";
const dir = mkdtempSync(join(tmpdir(), "lucent-symbolgraph-"));
const graphDir = join(dir, "graphs");
mkdirSync(graphDir);
const sdk = `public func magnitude(_ value: Double) -> Double { value < 0 ? -value : value }
public func magnitude(_ value: Int32) -> Int32 { value < 0 ? -value : value }
public func greeting(name: String) -> String { "Hello " + name }
public protocol Listener { func changed(_ value: Double) }
public func unsupported<T>(_ value: T) -> T { value }
`;
writeFileSync(join(dir, "Probe.swift"), sdk);
const run = (tool: string, args: string[]) =>
  execFileSync(tool, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const target = JSON.parse(run("swiftc", ["-print-target-info"])).target.triple as string;
const sdkPath = run("xcrun", ["--sdk", "macosx", "--show-sdk-path"]).trim();
run("swiftc", [
  "-emit-module",
  "-emit-library",
  "-module-name",
  "Probe",
  join(dir, "Probe.swift"),
  "-emit-module-path",
  join(dir, "Probe.swiftmodule"),
  "-o",
  join(dir, "libProbe.dylib"),
  "-module-cache-path",
  join(dir, "cache"),
]);
run("xcrun", [
  "swift-symbolgraph-extract",
  "-module-name",
  "Probe",
  "-I",
  dir,
  "-target",
  target,
  "-sdk",
  sdkPath,
  "-module-cache-path",
  join(dir, "cache"),
  "-output-dir",
  graphDir,
  "-minimum-access-level",
  "public",
]);
const schema = extractSwiftSymbolGraph(readFileSync(join(graphDir, "Probe.symbols.json"), "utf8"));
if (schema.functions.length !== 3 || schema.coverage?.filter((c) => c.status === "skipped").length !== 3)
  throw new Error("Unexpected real SDK coverage");
const { library } = generateBindingLibrary(schema);
const result = compile(
  `import {magnitude, greeting} from "@probe/sdk";
import {Platform} from "@lucent-lang/platform";
import type {int32} from "@lucent-lang/types";
export function decimal():number {if(Platform.OS === "ios") return magnitude(-3.5); return 0;}
export function integer(value:int32):int32 {if(Platform.OS === "ios") return magnitude(value); return 0;}
export function hello():string {if(Platform.OS === "ios") return greeting("Lucent"); return "";}`,
  { fileName: "probe.lucent.ts", libraries: { "@probe/sdk": library } },
);
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
writeFileSync(
  join(dir, "main.swift"),
  `typealias ArrayBuffer = [UInt8]\n${swiftRuntime({ length: "return Double(buffer.count)", get: "return Double(buffer[Int(index)])" })}\n${generateSwift(result.module).code}\nprecondition(try! decimal() == 3.5)\nprecondition(try! integer(value: -17) == 17)\nprecondition(try! hello() == "Hello Lucent")\nprint("swift: compiler symbol graph overloads, labels and coverage passed")\n`,
);
run("swiftc", [
  "-module-cache-path",
  join(dir, "cache"),
  "-I",
  dir,
  "-L",
  dir,
  "-lProbe",
  "-Xlinker",
  "-rpath",
  "-Xlinker",
  dir,
  join(dir, "main.swift"),
  "-o",
  join(dir, "test"),
]);
process.stdout.write(run(join(dir, "test"), []));
