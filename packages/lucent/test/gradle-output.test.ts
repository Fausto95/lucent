import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { gradleFailure } from "../src/cli/gradle-output.ts";

/** Gradle's stderr for a failed `gradlew -q`, captured from real runs. */
const fixture = (name: string) =>
  fs.readFileSync(path.join(import.meta.dirname, "fixtures/gradle", `${name}.txt`), "utf8");

describe("what lucent shows of a failed Gradle run", () => {
  it("shows why dependency resolution failed, not Gradle's footer", () => {
    expect(gradleFailure(fixture("resolution"))).toBe(
      `Execution failed for task ':app:lucentClasspath'.
> Could not resolve all files for configuration ':app:debugRuntimeClasspath'.
   > Could not resolve androidx.core:core-nonexistent:9.9.9.
     Required by:
         project ':app'
      > No cached version of androidx.core:core-nonexistent:9.9.9 available for offline mode.
   > Could not resolve com.example.missing:lib:1.0.0.
     Required by:
         project ':app'
      > No cached version of com.example.missing:lib:1.0.0 available for offline mode.`,
    );
  });

  it("shows the compiler's errors of a failed compilation", () => {
    const shown = gradleFailure(fixture("compile"));

    expect(shown).toMatch(/^Execution failed for task ':app:compileDebugJavaWithJavac'\./);
    expect(shown).toContain("error: incompatible types: String cannot be converted to int");
    expect(shown).toContain("error: cannot find symbol");
    expect(shown).not.toContain("* Try:");
    expect(shown).not.toContain("BUILD FAILED");
  });

  it("shows each failure when the build had several", () => {
    const shown = gradleFailure(fixture("two-failures"));

    expect(shown).toContain("Execution failed for task ':app:lucentClasspath'.");
    expect(shown).toContain(
      "No cached version of com.example.missing:lib:1.0.0 available for offline mode.",
    );
    expect(shown).toContain("Execution failed for task ':other'.\n> other failed");
    expect(shown).not.toContain("* Try:");
    expect(shown).not.toContain("=====");
  });

  it("keeps a long cause short, saying how many lines it left out", () => {
    const causes = Array.from(
      { length: 40 },
      (_, i) => `   > Could not resolve com.example:lib${i}:1.0.`,
    );
    const output = `FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':app:lucentClasspath'.
${causes.join("\n")}

* Try:
> Run with --stacktrace option to get the stack trace.

BUILD FAILED in 1s
`;
    const shown = gradleFailure(output);

    expect(shown.split("\n").length).toBeLessThanOrEqual(21);
    expect(shown).toMatch(/^Execution failed for task ':app:lucentClasspath'\.\n/);
    expect(shown).toContain(causes[0]);
    expect(shown).not.toContain(causes[39]);
    expect(shown).toMatch(/\n… \d+ more lines$/);
  });

  it("shows the end of the output when Gradle printed no cause", () => {
    const output = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");

    expect(gradleFailure(`${output}\n`)).toBe(
      Array.from({ length: 8 }, (_, i) => `line ${i + 12}`).join("\n"),
    );
  });
});
