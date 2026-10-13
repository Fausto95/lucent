/**
 * Lucent's React Native C++ against each React Native release Lucent
 * supports, on any machine: the generated Fabric sources, the Android view
 * host and the TurboModule, compiled against the headers
 * scripts/react-native-headers.ts assembled (none assembled: skipped).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, runtimeDir } from "../../src/index.ts";
import { fakeAndroid } from "../fake-android.ts";
import { writeFabricSources } from "./fabric-host.ts";
import {
  type AssembledRelease,
  assembledReleases,
  compileErrors,
  hostToolchains,
  type Toolchain,
} from "./react-native-headers.ts";

const rn = path.join(runtimeDir(), "cpp/rn");
const TURBO_MODULE = ["LucentModule.cpp", "LucentViewInstances.cpp", "LucentViewRequests.cpp"].map(
  (f) => path.join(rn, f),
);

/** The flags the Android build compiles Lucent's code with (CMakeLists.txt). */
const lucentAndroid = (toolchain: Toolchain): Toolchain => ({
  command: toolchain.command,
  args: [
    ...toolchain.args,
    "-Wno-unused-variable",
    `-I${path.join(runtimeDir(), "native/android/include")}`,
  ],
});

const releases = assembledReleases();
const withJni = releases.filter((r) => r.jni);

/** What each release's compiler says of the files, by release: empty when all compile. */
function errorsByRelease(
  among: AssembledRelease[],
  toolchain: (release: AssembledRelease) => Toolchain,
  extra: string[],
): Record<string, string> {
  const { dir, files } = writeFabricSources();
  const errors = Object.fromEntries(
    among
      .map((r) => [r.version, compileErrors(toolchain(r), dir, [...files, ...extra])] as const)
      .filter(([, e]) => e),
  );

  fs.rmSync(dir, { recursive: true, force: true });
  return errors;
}

/** The Android classes a component needs, standing in for android.jar. */
const ANDROID_VIEWS = {
  "android/content/Context.java": `package android.content;
public abstract class Context {}
`,
  "android/view/View.java": `package android.view;
public class View { public View(android.content.Context c) {} }
`,
  "android/view/ViewGroup.java": `package android.view;
public abstract class ViewGroup extends View { public ViewGroup(android.content.Context c) { super(c); } }
`,
  "android/widget/TextView.java": `package android.widget;
public class TextView extends android.view.View {
  public TextView(android.content.Context c) { super(c); }
  public void setText(CharSequence s) {}
}
`,
};

/** A component taking instances of a class another module exports: alone, nullable and in an array. */
const PLAYERS = {
  "player.lucent.ts": `export class Player {
  readonly title: string;

  constructor(title: string) {
    this.title = title;
  }
}
`,
  "view.lucent.ts": `import type { TextView } from "lucent:android/android.widget";
import type { Player } from "./player.lucent";

export declare function PlayerView(props: { player: Player; next?: Player | null; queue: Player[] }): TextView;
`,
  "view.android.lucent.tsx": `import { appContext } from "lucent:android";
import { TextView } from "lucent:android/android.widget";
import { effect } from "lucent:ui";
import type { Player } from "./player.lucent";

export function PlayerView(props: { player: Player; next?: Player | null; queue: Player[] }): TextView {
  const text = new TextView(appContext());

  effect(() => {
    text.setText(props.player.title + String(props.queue.length) + (props.next?.title ?? ""));
  });

  return text;
}
`,
};

/** PLAYERS compiled for Android against stand-ins: its directory and generated sources, or undefined without a JDK. */
function playersForAndroid(): { dir: string; files: string[] } | undefined {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-players-"));
  const android = fakeAndroid(dir, ANDROID_VIEWS);

  if (!android) return undefined;

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
  for (const [name, text] of Object.entries(PLAYERS)) fs.writeFileSync(path.join(dir, name), text);

  const result = compile(
    Object.keys(PLAYERS).map((f) => path.join(dir, f)),
    { platforms: ["android"], sdk: { android: { jars: android.bind } } },
  );

  if (result.diagnostics.length)
    throw new Error(result.diagnostics.map((d) => d.message).join("\n"));

  const out = path.join(dir, "out");
  for (const [f, text] of result.files) {
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.writeFileSync(path.join(out, f), text);
  }

  const files = [...result.files.keys()]
    .filter((f) => f.endsWith(".cpp") && !f.endsWith("lucent_identity.cpp"))
    .map((f) => path.join(out, f));

  return { dir: path.join(out, "android"), files };
}

describe("Lucent's React Native C++ against each assembled release", () => {
  it.skipIf(!releases.length)(
    `compiles as iOS builds it: the generated Fabric sources and the TurboModule (${releases.map((r) => r.version).join(", ")})`,
    () => {
      expect(errorsByRelease(releases, (r) => hostToolchains(r).cxx, TURBO_MODULE)).toEqual({});
    },
    900_000,
  );

  it.skipIf(!withJni.length)(
    `compiles as Android builds it, with the Android view host (${withJni.map((r) => r.version).join(", ")})`,
    () => {
      const host = path.join(rn, "LucentViewsAndroid.cpp");

      expect(
        errorsByRelease(withJni, (r) => lucentAndroid(hostToolchains(r).android!), [
          ...TURBO_MODULE,
          host,
        ]),
      ).toEqual({});
    },
    900_000,
  );

  it.skipIf(!withJni.length)(
    `compiles a component taking instances, with its mount and host, as Android builds it (${withJni.map((r) => r.version).join(", ")})`,
    () => {
      const players = playersForAndroid();

      if (!players) return;

      const errors = Object.fromEntries(
        withJni
          .map(
            (r) =>
              [
                r.version,
                compileErrors(
                  lucentAndroid(hostToolchains(r).android!),
                  players.dir,
                  players.files,
                ),
              ] as const,
          )
          .filter(([, e]) => e),
      );

      expect(errors).toEqual({});
    },
    900_000,
  );
});
