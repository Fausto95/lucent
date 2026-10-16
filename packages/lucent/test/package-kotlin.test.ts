/**
 * Building an app whose Lucent package calls its own Kotlin and Java
 * (decision 0132): lucent build binds lucent:android/<package> from the
 * package's android.nativeSources, compiled on the build machine, and
 * reports sources that don't compile with the compiler's errors.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { fakeAndroid } from "../../compiler/test/fake-android.ts";
import { runLucent } from "./run-to-exit.ts";

const fixture = path.resolve(import.meta.dirname, "../../compiler/test/fixtures/greeter");
const kotlinc = spawnSync("sh", ["-c", "command -v kotlinc"]).status === 0;
const fake = fakeAndroid(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-package-kotlin-")), {});

/** An app depending on lucent-greeter, whose module calls the package's Lucent code. */
function app(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-package-kotlin-app-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "app", dependencies: { "lucent-greeter": "1.0.0" } }),
  );
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(
    path.join(root, "src/hello.lucent.ts"),
    'import { greetings } from "lucent-greeter/src/greet.lucent";\nexport function hello(): string {\n  return greetings("ada");\n}\n',
  );
  fs.cpSync(fixture, path.join(root, "node_modules/lucent-greeter"), { recursive: true });
  return root;
}

const build = (root: string) =>
  runLucent(["build", "--platforms", "android", "--root", root], {
    env: {
      ...process.env,
      NO_COLOR: "1",
      LUCENT_ANDROID_JARS: fake!.bind.join(path.delimiter),
      LUCENT_CACHE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "lucent-package-kotlin-cache-")),
    },
  });

/** The generated files under `dir` that mention `text`. */
function mentioning(dir: string, text: string): string[] {
  return (fs.readdirSync(dir, { recursive: true, encoding: "utf8" }) as string[])
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .filter((f) => fs.readFileSync(path.join(dir, f), "utf8").includes(text));
}

describe.skipIf(!fake || !kotlinc)("an app whose package calls its own Kotlin", () => {
  it("binds the package's Kotlin and Java for its Android code", () => {
    const root = app();
    const r = build(root);
    expect(r.stdout + r.stderr).not.toMatch(/error|✗/i);
    expect(r.status).toBe(0);

    const generated = path.join(root, ".lucent/native");
    expect(mentioning(generated, "dev/example/greet/Greeter").length).toBeGreaterThan(0);
    expect(mentioning(generated, "dev/example/greet/java/Polite").length).toBeGreaterThan(0);
  }, 300_000);

  it("reports sources that don't compile, with the compiler's errors", () => {
    const root = app();
    fs.writeFileSync(
      path.join(root, "node_modules/lucent-greeter/android/dev/example/greet/Broken.kt"),
      'package dev.example.greet\n\nfun broken(): Int = "text"\n',
    );
    const r = build(root);
    // As one line: the report wraps what it says to the terminal's width.
    const out = (r.stdout + r.stderr).replace(/\s+/g, " ");
    expect(out).toContain(
      "lucent:android/dev.example.greet is declared by the Lucent packages' Kotlin and Java (android.nativeSources), which don't compile here: kotlinc: ",
    );
    expect(out).toMatch(/Broken\.kt:3:\d+: error: return type mismatch/);
    expect(r.status).not.toBe(0);
  }, 300_000);
});
