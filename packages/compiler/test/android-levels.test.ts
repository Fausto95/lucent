/**
 * The app's Android levels, as its Gradle build reports them with the
 * classpath: its minSdk decides which APIs need a check, its compileSdk
 * which platform is bound.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { forgetLoadedSdks, nativeArtifacts } from "@lucent-lang/bindgen";
import { fakeAndroidSdk, javac } from "../../bindgen/test/java-fixtures.ts";
import { android } from "./android-harness.ts";

const BUZZER = (level: number) => ({
  "dev/example/buzz/Buzzer.java": `package dev.example.buzz;
public class Buzzer {
  public Buzzer() {}
  public int level() { return ${level}; }
  public void pulse() {}
}
`,
});

/** An SDK with platforms 34 and 36 (pulse() since 28); the app's classpath file, with `levels`. */
function project(levels: { minSdk?: number; compileSdk?: number }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-levels-"));
  const sdk = path.join(root, "sdk");
  for (const level of [34, 36]) {
    fakeAndroidSdk(sdk, `android-${level}`, BUZZER(level));
    fs.mkdirSync(path.join(sdk, `platforms/android-${level}/data`), { recursive: true });
    fs.writeFileSync(
      path.join(sdk, `platforms/android-${level}/data/api-versions.xml`),
      `<api version="3">\n<class name="dev/example/buzz/Buzzer" since="1">\n<method name="pulse()V" since="28"/>\n</class>\n</api>\n`,
    );
  }
  const classpath = path.join(root, ".lucent/android-classpath.json");
  fs.mkdirSync(path.dirname(classpath), { recursive: true });
  fs.writeFileSync(classpath, JSON.stringify({ aars: [], jars: [], ...levels }));
  forgetLoadedSdks();
  return {
    android: { sdkRoots: [sdk], classpath },
    cacheDir: path.join(root, "cache"),
  };
}

const USE = `import { Buzzer } from "lucent:android/dev.example.buzz";
export async function run(): Promise<string> {
  const b = new Buzzer();
  b.pulse();
  return \`\${b.level()}\`;
}
`;

const messages = (r: { diagnostics: { code: string; message: string }[] }) =>
  r.diagnostics.map((d) => [d.code, d.message]);

describe.skipIf(!javac)("the app's Android levels", () => {
  it("checks APIs against the app's minSdk, React Native's 24 without one", () => {
    expect(messages(android(USE, project({})).r)).toEqual([
      [
        "LUCENT3007",
        'Buzzer.pulse needs API 28 (apps run from API 24): use it under if (available("android", 28)) or Build_VERSION.SDK_INT >= 28',
      ],
    ]);
    expect(messages(android(USE, project({ minSdk: 26 })).r)).toEqual([
      [
        "LUCENT3007",
        'Buzzer.pulse needs API 28 (apps run from API 26): use it under if (available("android", 28)) or Build_VERSION.SDK_INT >= 28',
      ],
    ]);
    expect(messages(android(USE, project({ minSdk: 28 })).r)).toEqual([]);
  });

  it("binds the platform the app compiles against, not the newest installed", () => {
    const platform = (levels: { compileSdk?: number }) => {
      const found = nativeArtifacts("android", project(levels));
      if ("missing" in found) throw new Error(found.missing);
      return found.find((a) => a.kind === "sdk")?.id;
    };

    expect(platform({})).toBe("android-sdk:36");
    expect(platform({ compileSdk: 34 })).toBe("android-sdk:34");
    // Not installed: the newest.
    expect(platform({ compileSdk: 35 })).toBe("android-sdk:36");
  });
});
