import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "@lucent-lang/compiler";
import { runLucent } from "./run-to-exit.ts";
import { runJar, runJavac } from "../../bindgen/test/jvm-tools.ts";

const javac = spawnSync("javac", ["-version"]).status === 0;
const android = sdkAvailable("android");
const ios = process.platform === "darwin" && sdkAvailable("ios");

/** The app has code for both platforms: locking it needs both SDKs. */
const locks = javac && android && ios;

/**
 * Versions of a tracking library no Lucent source names. 2 drops track,
 * returns a long from level, deprecates flush, adds a setSize(int) that
 * takes the name setSize from setSize(long), drops unused and adds added.
 * 1.1 only adds a method: compatible, but another artifact.
 */
const TRACKER: Record<string, string> = {
  "1": `package dev.orbit.tracking;
public class Tracker {
  public Tracker() {}
  public String name() { return ""; }
  public void track(String event) {}
  public int level() { return 0; }
  public void flush() {}
  public void setSize(long size) {}
  public void unused() {}
}
`,
  "1.1": `package dev.orbit.tracking;
public class Tracker {
  public Tracker() {}
  public String name() { return ""; }
  public void track(String event) {}
  public int level() { return 0; }
  public void flush() {}
  public void setSize(long size) {}
  public void unused() {}
  public void extra() {}
}
`,
  "2": `package dev.orbit.tracking;
public class Tracker {
  public Tracker() {}
  public String name() { return ""; }
  public long level() { return 0; }
  @Deprecated public void flush() {}
  public void setSize(int size) {}
  public void setSize(long size) {}
  public void added() {}
}
`,
};

const USE = `import { Tracker } from "lucent:android/dev.orbit.tracking";
export async function run(): Promise<string> {
  const t = new Tracker();
  t.track("open");
  t.flush();
  t.setSize(1n);
  return \`\${t.name()} \${t.level()}\`;
}
`;

interface App {
  root: string;
  cache: string;
  /** Puts version `v` of the library on the app's classpath. */
  use(v: string): void;
  lucent(
    args: string[],
    env?: Record<string, string>,
  ): { status: number | null; out: string; stdout: string };
}

function app(): App {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-lock-"));
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-lock-cache-"));

  const jars = Object.fromEntries(
    Object.entries(TRACKER).map(([v, source]) => {
      const dir = path.join(root, "libs", v);
      fs.mkdirSync(path.join(dir, "src/dev/orbit/tracking"), { recursive: true });
      fs.writeFileSync(path.join(dir, "src/dev/orbit/tracking/Tracker.java"), source);

      runJavac([
        "--release",
        "11",
        "-d",
        path.join(dir, "classes"),
        path.join(dir, "src/dev/orbit/tracking/Tracker.java"),
      ]);
      runJar(["cf", path.join(dir, "orbit.jar"), "-C", path.join(dir, "classes"), "."]);

      return [v, path.join(dir, "orbit.jar")];
    }),
  );

  fs.mkdirSync(path.join(root, ".lucent"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "o.lucent.ts"),
    "export declare function run(): Promise<string>;\n",
  );
  fs.writeFileSync(path.join(root, "o.android.lucent.ts"), USE);
  fs.writeFileSync(
    path.join(root, "o.ios.lucent.ts"),
    'export async function run(): Promise<string> {\n  return "";\n}\n',
  );

  const use = (v: string) =>
    fs.writeFileSync(
      path.join(root, ".lucent/android-classpath.json"),
      JSON.stringify({ jars: [jars[v]], aars: [] }),
    );
  use("1");

  const lucent = (args: string[], env: Record<string, string> = {}) => {
    const r = runLucent([...args, "--root", root], {
      env: { ...process.env, NO_COLOR: "1", LUCENT_CACHE_DIR: cache, ...env },
    });
    return { status: r.status, out: r.stdout + r.stderr, stdout: r.stdout };
  };

  return { root, cache, use, lucent };
}

const readJson = (file: string) =>
  JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;

async function validate(name: string, value: unknown): Promise<string[]> {
  const { default: Ajv } = (await import("ajv")) as unknown as {
    default: new (o: object) => {
      compile(
        s: object,
      ): ((v: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] };
    };
  };
  const schema = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname, `../schemas/${name}.schema.json`), "utf8"),
  ) as object;
  const check = new Ajv({ allErrors: true }).compile(schema);

  return check(value) ? [] : (check.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

interface Lock {
  targets: string[];
  modules: Record<string, { artifacts: string[]; schema?: string }>;
  symbols: { module: string; owner?: string; name: string; kind: string; roles?: string[] }[];
}

describe.skipIf(!javac || !android)("the SDK lock", () => {
  it.skipIf(!locks)(
    "records the SDK identities and symbols the code uses, without machine paths",
    async () => {
      const a = app();

      const r = a.lucent(["sdk", "lock"]);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/lucent-sdk\.lock\.json/);

      const text = fs.readFileSync(path.join(a.root, "lucent-sdk.lock.json"), "utf8");
      const lock = JSON.parse(text) as Lock;
      expect(await validate("sdk-lock", lock)).toEqual([]);

      expect(lock.targets).toContain("android");
      expect(lock.modules["android/dev.orbit.tracking"]!.artifacts).toEqual([
        expect.stringMatching(/^android-sdk:[\w.]+#\w+$/),
        expect.stringMatching(/^jar:orbit\.jar#\w+$/),
      ]);
      expect(lock.symbols).toContainEqual(
        expect.objectContaining({
          owner: "Tracker",
          name: "track",
          kind: "method",
          roles: ["call"],
        }),
      );
      expect(lock.symbols).toContainEqual(
        expect.objectContaining({ owner: "Tracker", kind: "constructor", roles: ["new"] }),
      );
      expect(text).not.toContain(a.root);
      expect(text).not.toContain(a.cache);
      expect(text).not.toContain(os.homedir());

      // A check reads the same symbols, and records them for other tools.
      expect(a.lucent(["check"]).status).toBe(0);
      const usage = readJson(path.join(a.root, ".lucent/sdk-usage.json")) as unknown as Lock;
      expect(usage.symbols).toEqual(lock.symbols);
    },
  );

  it.skipIf(!locks)(
    "lets a frozen check through only on the SDKs and symbols it records",
    () => {
      const a = app();
      expect(a.lucent(["sdk", "lock"]).status).toBe(0);
      expect(a.lucent(["check", "--frozen"]).status).toBe(0);

      // Compatible, but not the artifact the lock records.
      a.use("1.1");
      const other = a.lucent(["check", "--frozen"]);
      expect(other.status).toBe(1);
      expect(other.out).toMatch(
        /lucent:android\/dev\.orbit\.tracking: jar:orbit\.jar#\w+ → jar:orbit\.jar#\w+/,
      );
      expect(other.out).toMatch(/lucent sdk diff/);
      expect(a.lucent(["check"]).status).toBe(0);

      // Recorded again: frozen passes.
      expect(a.lucent(["sdk", "lock"]).status).toBe(0);
      expect(a.lucent(["check", "--frozen"]).status).toBe(0);

      // A use the lock does not record.
      fs.writeFileSync(
        path.join(a.root, "o.android.lucent.ts"),
        USE.replace("t.flush();", "t.flush();\n  t.unused();"),
      );
      const unlocked = a.lucent(["check", "--frozen"]);
      expect(unlocked.status).toBe(1);
      expect(unlocked.out).toMatch(/not in lucent-sdk\.lock\.json.*Tracker\.unused/);
    },
    180_000,
  );

  it("says a frozen check needs a lock it can read", () => {
    const a = app();

    const r = a.lucent(["check", "--frozen"]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/--frozen needs lucent-sdk\.lock\.json: run lucent sdk lock/);

    fs.writeFileSync(
      path.join(a.root, "lucent-sdk.lock.json"),
      JSON.stringify({ format: 1, targets: ["windows"], modules: {}, symbols: [] }),
    );
    const bogus = a.lucent(["check", "--frozen"]);
    expect(bogus.status).toBe(1);
    expect(bogus.out).toMatch(/lucent-sdk\.lock\.json: unknown target windows/);
  });

  it.skipIf(!locks)(
    "does not lock a project whose platform has no SDK, unless --platforms leaves it out",
    () => {
      const a = app();
      const missing = { LUCENT_ANDROID_JARS: path.join(a.root, "no-android.jar") };

      const r = a.lucent(["sdk", "lock"], missing);
      expect(r.status).toBe(1);
      expect(r.out).toMatch(/android: .*not found.*--platforms/s);
      expect(fs.existsSync(path.join(a.root, "lucent-sdk.lock.json"))).toBe(false);

      expect(a.lucent(["sdk", "lock", "--platforms", "ios"], missing).status === 0).toBe(ios);
    },
  );

  it.skipIf(!locks)(
    "fails a frozen build that would leave a locked target to the Gradle build",
    () => {
      const a = app();
      expect(a.lucent(["sdk", "lock"]).status).toBe(0);

      // expo prebuild: no classpath yet, and Gradle not to be run now.
      fs.rmSync(path.join(a.root, ".lucent/android-classpath.json"));
      fs.mkdirSync(path.join(a.root, "android"));
      fs.writeFileSync(path.join(a.root, "android/gradlew"), "#!/bin/sh\nexit 1\n", {
        mode: 0o755,
      });

      const r = a.lucent(["build", "--frozen"], { LUCENT_NO_GRADLE: "1" });
      expect(r.status).toBe(1);
      expect(r.out).toMatch(/the SDK lock requires android, which this build skips/);
    },
  );

  it.skipIf(!locks)(
    "fails a frozen check whose required target has no SDK, where a plain check skips it",
    () => {
      const a = app();
      expect(a.lucent(["sdk", "lock"]).status).toBe(0);

      const missing = { LUCENT_ANDROID_JARS: path.join(a.root, "no-android.jar") };
      const plain = a.lucent(["check"], missing);
      expect(plain.out).not.toMatch(/SDK lock/);
      // Untyped Android modules let the shared code check where iOS builds.
      expect(plain.status === 0, plain.out).toBe(ios);

      const frozen = a.lucent(["check", "--frozen"], missing);
      expect(frozen.status).toBe(1);
      expect(frozen.out).toMatch(/the SDK lock requires android, whose SDK is unavailable/);
    },
  );
});

describe.skipIf(!locks)("lucent sdk diff", () => {
  it("shows what a new SDK changes for the symbols the code uses, before rebuilding", async () => {
    const a = app();
    expect(a.lucent(["sdk", "lock"]).status).toBe(0);
    expect(a.lucent(["sdk", "diff"]).status).toBe(0);

    a.use("2");
    const r = a.lucent(["sdk", "diff"]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/android +lucent:android\/dev\.orbit\.tracking/);
    expect(r.out).toMatch(/artifacts +jar:orbit\.jar#\w+ → jar:orbit\.jar#\w+/);
    expect(r.out).toMatch(/removed +Tracker\.track +\(string\?\) => void/);
    expect(r.out).toMatch(/changed +Tracker\.level +signature: \(\) => int → \(\) => long/);
    expect(r.out).toMatch(/changed +Tracker\.flush +deprecated/);
    expect(r.out).toMatch(/changed +Tracker\.setSize +TypeScript name: setSize → setSize_long/);
    // Unaffected symbols keep their names, and are not listed.
    expect(r.out).not.toMatch(/Tracker\.name/);
    expect(r.out).toMatch(/4 of \d+ used symbols changed: 1 removed, 3 changed/);
    // Nothing the app does not use.
    expect(r.out).not.toMatch(/unused|added/);

    const json = JSON.parse(a.lucent(["sdk", "diff", "--json"]).stdout) as {
      ok: boolean;
      used: { change: string; display: string }[];
    };
    expect(await validate("sdk-diff", json)).toEqual([]);
    expect(json.ok).toBe(false);
    expect(
      json.used
        .filter((u) => u.change !== "unchanged")
        .map((u) => u.display)
        .sort(),
    ).toEqual(["Tracker.flush", "Tracker.level", "Tracker.setSize", "Tracker.track"]);
  });

  it("with --all, also lists the other members of the modules the code uses", () => {
    const a = app();
    expect(a.lucent(["sdk", "lock"]).status).toBe(0);

    a.use("2");
    const r = a.lucent(["sdk", "diff", "--all"]);
    expect(r.out).toMatch(/removed +Tracker\.unused/);
    expect(r.out).toMatch(/added +Tracker\.added/);
    // setSize(int) is new; setSize(long), which the code calls, changed name.
    expect(r.out).toMatch(/added +Tracker\.setSize +\(int\) => void/);
  });

  it("says when a target the lock records has no SDK", () => {
    const a = app();
    expect(a.lucent(["sdk", "lock"]).status).toBe(0);

    const r = a.lucent(["sdk", "diff"], {
      LUCENT_ANDROID_JARS: path.join(a.root, "no-android.jar"),
    });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/android: .*not found/);
  });
});

describe.skipIf(!javac || !android)("lucent sdk coverage stages", () => {
  it("counts the members the last build generated, and those evidence says ran", () => {
    const a = app();
    expect(a.lucent(["check"]).status).toBe(0);

    type Report = {
      module: string;
      stages: Record<string, number | null>;
      members?: { key?: string; display: string; stage: string }[];
    };
    const coverage = (...args: string[]) =>
      JSON.parse(a.lucent(["sdk", "coverage", "--json", ...args]).stdout) as Report[];

    const [plain] = coverage();
    expect(plain!.module).toBe("dev.orbit.tracking");
    expect(plain!.members).toBeUndefined();
    // Constructor, track, flush, setSize, name, level.
    expect(plain!.stages).toMatchObject({ representable: 7, generated: 6, exercised: null });

    const [detailed] = coverage("--members");
    const name = detailed!.members!.find((m) => m.display === "Tracker.name")!;
    expect(name.stage).toBe("generated");
    expect(detailed!.members!.find((m) => m.display === "Tracker.unused")!.stage).toBe(
      "representable",
    );

    const evidence = path.join(a.root, "exercised.json");
    fs.writeFileSync(evidence, JSON.stringify([name.key]));
    const [exercised] = coverage("--exercised", evidence);
    expect(exercised!.stages).toMatchObject({ generated: 6, exercised: 1 });

    // An unreadable report: no evidence, and a warning; a check, however
    // up to date its sources, writes it again.
    fs.writeFileSync(path.join(a.root, ".lucent/sdk-usage.json"), "{");
    const unread = a.lucent(["sdk", "coverage"]);
    expect(unread.status).toBe(0);
    expect(unread.out).toMatch(/sdk-usage\.json is not valid JSON/);
    expect(unread.out).toMatch(/dev\.orbit\.tracking +\d+ +7 +\d+ \([\d.]+%\) +- +-/);
    expect(a.lucent(["check"]).status).toBe(0);

    const table = a.lucent(["sdk", "coverage"]);
    expect(table.out).toMatch(
      /module +discovered +representable +unrepresentable +generated +exercised/,
    );
    expect(table.out).toMatch(/dev\.orbit\.tracking +\d+ +7 +\d+ \([\d.]+%\) +6 +-/);
  });
});

describe.skipIf(!javac)("the exported schemas", () => {
  it("let a machine without the SDK check the platform's code", () => {
    const a = app();
    const jar = JSON.parse(
      fs.readFileSync(path.join(a.root, ".lucent/android-classpath.json"), "utf8"),
    ).jars[0] as string;
    // The machine with the SDK: the platform is the library's jar alone.
    const sdk = { LUCENT_ANDROID_JARS: jar };

    const locked = a.lucent(["sdk", "lock", "--platforms", "android", "--schemas"], sdk);
    expect(locked.status, locked.out).toBe(0);
    expect(locked.out).toMatch(/lucent-sdk\.schemas\/ +\d+ schemas?/);
    const set = path.join(a.root, "lucent-sdk.schemas/android");
    expect(fs.readdirSync(set)).toContain("dev.orbit.tracking.json");
    const text = fs.readFileSync(path.join(set, "dev.orbit.tracking.json"), "utf8");
    expect(text).not.toContain(a.root);
    expect(text).not.toContain(os.homedir());

    // A teammate without it: no jars, no classpath, another cache.
    fs.rmSync(path.join(a.root, ".lucent"), { recursive: true, force: true });
    const without = {
      LUCENT_ANDROID_JARS: "",
      ANDROID_HOME: path.join(a.root, "no-sdk"),
      ANDROID_SDK_ROOT: "",
      LUCENT_CACHE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "lucent-lock-cache-")),
    };
    const checked = a.lucent(["check"], without);
    expect(checked.status, checked.out).toBe(0);

    // The set types the code: a use it does not declare fails as it would with the SDK.
    fs.writeFileSync(
      path.join(a.root, "o.android.lucent.ts"),
      USE.replace("t.flush();", "t.flushAll();"),
    );
    const wrong = a.lucent(["check"], without);
    expect(wrong.status).not.toBe(0);
    expect(wrong.out).toMatch(/flushAll/);
  });
});
