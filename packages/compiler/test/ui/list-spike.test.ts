// The views spike's list and toggle screens (apps/bare-example/.views-spike):
// one-file components written in Lucent with SwiftUI and with Compose. The
// list: keyed items, each a helper view, with their own state and actions,
// bound fields, transitions and the toolkit's environment; the toggle:
// animations, a native timer and the composition's lifecycle. Their
// generated Swift and Kotlin compile with the real compilers, as the app
// builds them.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  androidGlueErrors,
  build,
  composeCompiles,
  diagnostics,
  ios,
  kotlinErrors,
  swiftErrors,
} from "./toolkit-build.ts";

const spike = path.join(import.meta.dirname, "../../../../apps/bare-example/.views-spike");

// One file for both platforms: each platform's program compiles its own code.
const files = (name: string) => ({
  [name]: fs.readFileSync(path.join(spike, name), "utf8"),
});

describe.each(["list.lucent.tsx", "toggle.lucent.tsx"])("the views spike's %s", (name) => {
  it.skipIf(!ios)(
    "writes its SwiftUI body, which type-checks",
    () => {
      const built = build(files(name), "ios");

      expect(diagnostics(built.result)).toEqual([]);
      expect(swiftErrors(built)).toBe("");
    },
    300_000,
  );

  it.skipIf(!composeCompiles())(
    "writes its Compose body, which compiles",
    () => {
      const built = build(files(name), "android");

      expect(diagnostics(built.result)).toEqual([]);
      expect(kotlinErrors(built)).toBe("");
      expect(androidGlueErrors(built)).toBe("");
    },
    600_000,
  );
});
