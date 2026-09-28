// The views spike's list screen (apps/bare-example/.views-spike/list.*):
// a todo list written in Lucent with SwiftUI and with Compose, keyed items
// with their own state and actions, bound fields, transitions and the
// toolkit's environment. Its generated Swift and Kotlin compile with the
// real compilers, as the app builds them.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  android,
  androidGlueErrors,
  build,
  diagnostics,
  ios,
  kotlinErrors,
  swiftErrors,
} from "./toolkit-build.ts";

const spike = path.join(import.meta.dirname, "../../../../apps/bare-example/.views-spike");

const files = (platform: "ios" | "android") =>
  Object.fromEntries(
    ["list.lucent.ts", `list.${platform}.lucent.tsx`].map((f) => [
      f,
      fs.readFileSync(path.join(spike, f), "utf8"),
    ]),
  );

describe("the views spike's list screen", () => {
  it.skipIf(!ios)(
    "writes its SwiftUI body, which type-checks",
    () => {
      const built = build(files("ios"), "ios");

      expect(diagnostics(built.result)).toEqual([]);
      expect(swiftErrors(built)).toBe("");
    },
    300_000,
  );

  it.skipIf(!android)(
    "writes its Compose body, which compiles",
    () => {
      const built = build(files("android"), "android");

      expect(diagnostics(built.result)).toEqual([]);
      expect(kotlinErrors(built)).toBe("");
      expect(androidGlueErrors(built)).toBe("");
    },
    600_000,
  );
});
