import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "../src/index.ts";

const CAMERA: LibraryModule = {
  schemaVersion: 1,
  source: `export type Position = "front" | "back";
export declare function setPosition(position:Position):void;
export declare function currentPosition():Position;`,
  enums: {
    Position: {
      cases: ["front", "back"],
      swift: {
        type: "AVCaptureDevice.Position",
        values: { front: ".front", back: ".back" },
        imports: ["AVFoundation"],
      },
      kotlin: { type: "Int", values: { front: "0", back: "1" } },
    },
  },
  bindings: {
    setPosition: { swift: ["_ = position"], kotlin: ["val unused = position"] },
    currentPosition: { swift: ["return .back"], kotlin: ["return 1"] },
  },
};

const compileWith = (source: string) =>
  compile(source, { fileName: "camera.lucent.ts", libraries: { "@lucent-lang/example-camera": CAMERA } });

test("a case literal adopts its enum parameter type", () => {
  const result = compileWith(
    'import {setPosition} from "@lucent-lang/example-camera"; export function use():void{setPosition("back");}',
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module?.enums?.Position?.cases).toEqual(["front", "back"]);
});

test("an unknown case names the valid ones", () => {
  const result = compileWith(
    'import {setPosition} from "@lucent-lang/example-camera"; export function use():void{setPosition("sideways");}',
  );
  expect(result.diagnostics[0]?.code).toBe("LC1011");
  expect(result.diagnostics[0]?.help).toContain('"front", "back"');
});

test("enum values compare against case literals", () => {
  const result = compileWith(
    'import {currentPosition} from "@lucent-lang/example-camera"; export function isBack():boolean{return currentPosition() === "back";}',
  );
  expect(result.diagnostics).toEqual([]);
});

test("a plain string is not an enum", () => {
  const result = compileWith(
    'import {setPosition} from "@lucent-lang/example-camera"; export function use(value:string):void{setPosition(value);}',
  );
  expect(result.diagnostics[0]?.code).toBe("LC1011");
});

test("enums stay out of records, containers and events", () => {
  const record = compileWith(
    'import {currentPosition} from "@lucent-lang/example-camera"; import type {Position} from "@lucent-lang/example-camera"; export type Shot = {where:Position}; export function f():Shot{return {where:currentPosition()};}',
  );
  expect(record.diagnostics.some((d) => d.message.includes("Native enums are parameter"))).toBe(true);
  const container = compileWith(
    'import type {Position} from "@lucent-lang/example-camera"; export function f(list:Position[]):number{return list.length;}',
  );
  expect(container.diagnostics.some((d) => d.message.includes("cross the boundary directly"))).toBe(true);
});

test("the declared union must match the manifest cases", () => {
  const result = compile(
    'import {setPosition} from "@lucent-lang/example-camera"; export function f():void{setPosition("front");}',
    {
      fileName: "camera.lucent.ts",
      libraries: {
        "@lucent-lang/example-camera": {
          ...CAMERA,
          source: `export type Position = "front" | "left";\nexport declare function setPosition(position:Position):void;\nexport declare function currentPosition():Position;`,
        },
      },
    },
  );
  expect(result.diagnostics[0]?.code).toBe("LC1006");
});

test("a manifest enum needs one native value per case on both targets", () => {
  const result = compile("export function f():number{return 1;}", {
    fileName: "camera.lucent.ts",
    libraries: {
      "@lucent-lang/example-camera": {
        ...CAMERA,
        enums: {
          Position: {
            cases: ["front", "back"],
            swift: CAMERA.enums!.Position!.swift,
            kotlin: { type: "Int", values: { front: "0" } },
          },
        },
      },
    },
  });
  expect(result.diagnostics[0]?.message).toContain("one kotlin value per case");
});
