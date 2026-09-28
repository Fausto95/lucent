import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const swiftFixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/swift");

/** A Swift fixture module's source file. */
export const swiftSource = (name: string) => path.join(swiftFixtures, name, `${name}.swift`);

/** Compiles a Swift fixture module into a directory that `-I` finds it in. */
export function swiftModule(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lucent-swift-${name}-`));
  const sdk = spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"], {
    encoding: "utf8",
  }).stdout.trim();
  const r = spawnSync(
    "xcrun",
    [
      "swiftc",
      "-emit-module",
      "-parse-as-library",
      "-module-name",
      name,
      "-target",
      "arm64-apple-ios15.1-simulator",
      "-sdk",
      sdk,
      "-emit-module-path",
      path.join(dir, `${name}.swiftmodule`),
      swiftSource(name),
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`swiftc ${name}: ${r.stderr}`);
  return dir;
}
