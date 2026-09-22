import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "@lucent-lang/compiler";
import { nitroHost } from "../src/index.ts";

const CAMERA: LibraryModule = {
  schemaVersion: 1,
  source: `export type Position = "front" | "back";
export declare function levelOf(position:Position):number;
export declare function best():Position;`,
  enums: {
    Position: {
      cases: ["front", "back"],
      swift: { type: "SamplePosition", values: { front: ".front", back: ".back" }, imports: ["AVFoundation"] },
      kotlin: { type: "Int", values: { front: "0", back: "1" } },
    },
  },
  bindings: {
    levelOf: { swift: ["return 1"], kotlin: ["return 1.0"] },
    best: { swift: ["return .back"], kotlin: ["return 1"] },
  },
};

const build = () => {
  const result = compile(
    `import {levelOf, best} from "@lucent-lang/example-camera";
import type {Position} from "@lucent-lang/example-camera";
export function score(position:Position):number{return levelOf(position);}
export function chosen():Position{return best();}`,
    { fileName: "camera.lucent.ts", libraries: { "@lucent-lang/example-camera": CAMERA } },
  );
  expect(result.diagnostics).toEqual([]);
  return { module: result.module!, files: nitroHost.emitPackage([result.module!], { packageName: "lucent" }) };
};

test("emits one enum bridge per target", () => {
  const { files } = build();
  expect(files.get("ios/LucentEnums.swift")).toContain("enum LucentEnum_Position");
  expect(files.get("android/src/main/java/com/margelo/nitro/lucent/LucentEnums.kt")).toContain(
    "object LucentEnum_Position",
  );
});

test("a case name crosses the nitrogen boundary as a string", () => {
  const { files } = build();
  expect(files.get("src/specs/Camera.nitro.ts")).toContain("score(position: string): number");
  expect(files.get("ios/HybridCamera.swift")).toContain("try LucentEnum_Position.fromLucent(position)");
  expect(files.get("ios/HybridCamera.swift")).toContain("try LucentEnum_Position.toLucent(result)");
  expect(files.get("android/src/main/java/com/margelo/nitro/lucent/HybridCamera.kt")).toContain(
    "LucentEnum_Position.fromLucent(position)",
  );
});

test("declares the case union to TypeScript", () => {
  const { module } = build();
  expect(nitroHost.emitProxy(module).dts).toContain('chosen(): "front" | "back"');
});
