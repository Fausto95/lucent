/**
 * Compiles the Kotlin library in kotlin/ into android/orbit.jar, the file
 * lucent.json ships: for Kotlin 2.2 (the example apps' Kotlin), against the
 * kotlinx-coroutines kotlinc comes with. Needs kotlinc on the PATH.
 *
 *   node examples/lucent-orbit/build-jar.ts [out.jar]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const kotlinc = fs.realpathSync(
  execFileSync("sh", ["-c", "command -v kotlinc"], { encoding: "utf8" }).trim(),
);
const lib = [
  path.join(path.dirname(kotlinc), "../lib"),
  path.join(path.dirname(kotlinc), "../libexec/lib"),
].find((d) => fs.existsSync(path.join(d, "kotlinx-coroutines-core-jvm.jar")));
if (!lib) throw new Error("kotlinc's lib directory has no kotlinx-coroutines-core-jvm.jar");

const sources = fs
  .readdirSync(path.join(here, "kotlin"), { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".kt"))
  .sort()
  .map((f) => path.join(here, "kotlin", f));

execFileSync(
  "kotlinc",
  [
    "-jvm-target",
    "11",
    "-language-version",
    "2.2",
    "-api-version",
    "2.2",
    "-Werror",
    "-cp",
    path.join(lib, "kotlinx-coroutines-core-jvm.jar"),
    ...sources,
    "-d",
    process.argv[2] ?? path.join(here, "android/orbit.jar"),
  ],
  { stdio: "inherit" },
);
