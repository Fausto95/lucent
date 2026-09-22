import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "@lucent-lang/compiler";
import { expoHost } from "../src/index.ts";

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
  return { module: result.module!, files: expoHost.emitPackage([result.module!], { packageName: "lucent" }) };
};

test("emits one enum bridge per target", () => {
  const { files } = build();
  const swift = files.get("ios/LucentEnums.swift")!;
  expect(swift).toContain("import AVFoundation");
  expect(swift).toContain("enum LucentEnum_Position");
  expect(swift).toContain('("front", .front), ("back", .back)');
  const kotlin = files.get("android/src/main/java/expo/modules/lucent/LucentEnums.kt")!;
  expect(kotlin).toContain("object LucentEnum_Position");
  expect(kotlin).toContain('"back" to 1');
});

test("converts enum arguments and results at the JavaScript boundary", () => {
  const { files } = build();
  const swift = files.get("ios/LucentCameraModule.swift")!;
  expect(swift).toContain("func __bridge_score(position: String)");
  expect(swift).toContain("try LucentEnum_Position.fromLucent(position)");
  expect(swift).toContain("try LucentEnum_Position.toLucent(result)");
  const kotlin = files.get("android/src/main/java/expo/modules/lucent/LucentCameraModule.kt")!;
  expect(kotlin).toContain("LucentEnum_Position.fromLucent(position)");
  expect(kotlin).toContain("LucentEnum_Position.toLucent(result)");
});

test("declares the case union to TypeScript", () => {
  const { module } = build();
  const { dts } = expoHost.emitProxy(module);
  expect(dts).toContain('score(position: "front" | "back"): number');
  expect(dts).toContain('chosen(): "front" | "back"');
});
