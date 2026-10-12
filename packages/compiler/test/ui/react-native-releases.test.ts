/**
 * Lucent's React Native C++ against each React Native release Lucent
 * supports, on any machine: the generated Fabric sources, the Android view
 * host and the TurboModule, compiled against the headers
 * scripts/react-native-headers.ts assembled (none assembled: skipped).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runtimeDir } from "../../src/index.ts";
import { writeFabricSources } from "./fabric-host.ts";
import {
  type AssembledRelease,
  assembledReleases,
  compileErrors,
  hostToolchains,
  type Toolchain,
} from "./react-native-headers.ts";

const rn = path.join(runtimeDir(), "cpp/rn");
const TURBO_MODULE = ["LucentModule.cpp", "LucentViewRequests.cpp"].map((f) => path.join(rn, f));

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
});
