import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const swiftFixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/swift");

/** A Swift fixture module's source file. */
export const swiftSource = (name: string) => path.join(swiftFixtures, name, `${name}.swift`);

/**
 * Compiles a Swift fixture module into a directory that `-I` finds it in:
 * once per test run and source (published by rename), shared by the tests
 * and processes that ask for it.
 */
export function swiftModule(name: string): string {
  const sdk = spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"], {
    encoding: "utf8",
  }).stdout.trim();
  const key = crypto
    .createHash("sha256")
    .update(sdk)
    .update(fs.readFileSync(swiftSource(name)))
    .digest("hex")
    .slice(0, 12);
  const dir = path.join(os.tmpdir(), `lucent-swift-${name}-${key}`);

  if (fs.existsSync(dir)) return dir;

  const work = fs.mkdtempSync(`${dir}.`);
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
      path.join(work, `${name}.swiftmodule`),
      swiftSource(name),
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`swiftc ${name}: ${r.stderr}`);

  try {
    fs.renameSync(work, dir);
  } catch {
    // Another process published it first.
    fs.rmSync(work, { recursive: true, force: true });
  }
  return dir;
}
