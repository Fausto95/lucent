/**
 * The rules the Android host of Compose content follows (when a
 * composition starts and ends, which owners it takes), proven on the JVM
 * without Android: CompositionRules.kt compiled with a check of each rule.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { kotlinToolchain } from "../../bindgen/test/kotlin-toolchain.ts";
import { runKotlinc } from "../../bindgen/test/kotlin-compiler.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const rules = path.join(
  here,
  "../native/android/src/compose/java/dev/lucent/compose/CompositionRules.kt",
);
const kotlin = kotlinToolchain();

describe.skipIf(!kotlin)("the Android host of Compose content", () => {
  it("starts a composition at the first attach and ends it with the mount, taking the nearest owners", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-compose-rules-"));
    const jar = path.join(dir, "rules.jar");

    try {
      const compiled = runKotlinc(kotlin!, [
        "-jvm-target",
        "11",
        "-Werror",
        rules,
        path.join(here, "compose/CompositionRulesCheck.kt"),
        "-d",
        jar,
      ]);

      expect(compiled.stderr).toBe("");
      expect(compiled.status).toBe(0);

      const run = spawnSync(
        kotlin!.java,
        [
          "-cp",
          [jar, path.join(kotlin!.lib, "kotlin-stdlib.jar")].join(path.delimiter),
          "dev.lucent.compose.CompositionRulesCheckKt",
        ],
        { encoding: "utf8" },
      );

      expect(run.stderr).toBe("");
      expect(run.stdout.trim()).toBe("ok");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});
