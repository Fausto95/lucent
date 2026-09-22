import { expect, test } from "vite-plus/test";
import { compile, validateLibrary } from "@lucent-lang/compiler";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CAMERA_LIBRARY } from "../src/library.ts";

const libraries = { "@lucent-lang/camera": CAMERA_LIBRARY };
const here = dirname(fileURLToPath(import.meta.url));
const lucent = (name: string) => readFileSync(join(here, "..", "lucent", name), "utf8");

test("CAMERA_LIBRARY passes validation including frames backpressure", () => {
  expect(validateLibrary(CAMERA_LIBRARY)).toEqual([]);
  const frames = CAMERA_LIBRARY.bindings!.CameraSession__method_frames!;
  expect(frames.contract!.parameters!.callback!.callback).toEqual({
    retention: "subscription",
    executor: "worker",
    errors: "notify",
    backpressure: "latest",
  });
});

test("compiles session lifecycle with resource() and async effect()", () => {
  const result = compile(lucent("session-lifecycle.lucent.tsx"), {
    fileName: "session-lifecycle.lucent.tsx",
    libraries,
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
  expect(Object.values(result.module!.nativePackages ?? {}).flatMap((p) => Object.keys(p.swift ?? {}))).toEqual(
    expect.arrayContaining(["Camera.swift", "Tasks.swift"]),
  );
  const view = result.module!.functions.find((fn) => fn.state !== undefined || fn.resources !== undefined);
  expect(view?.resources?.length ?? 0).toBeGreaterThan(0);
  expect(view?.effectSlots?.[0]?.async).toBe(true);
});

test("compiles package luminance against borrowed Frame helpers", () => {
  const processor = lucent("luminance.lucent.ts");
  const result = compile(
    `import {CameraSession,Frame} from '@lucent-lang/camera';
import {luminance} from './luminance.lucent';
@NativeOnly export function attach(session:CameraSession):number{
  return session.frames((frame:Frame):number=>luminance(frame));
}`,
    {
      fileName: "attach.lucent.ts",
      sources: { "luminance.lucent.ts": processor },
      libraries,
    },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
});

test("compiles CameraPreview package NativeView stub", () => {
  const result = compile(
    `import {CameraPreview} from '@lucent-lang/camera';
import type {NativeView} from '@lucent-lang/core/ui';
export function Preview():NativeView{return <CameraPreview mirrored={true}/>;}`,
    { fileName: "preview.lucent.tsx", libraries },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
});

test("rejects retaining a borrowed frame from frames callback", () => {
  const result = compile(
    `import {CameraSession,Frame} from '@lucent-lang/camera';
export function bad(session:CameraSession):Frame{
  let leaked:Frame=null as unknown as Frame;
  session.frames((frame:Frame):number=>{leaked=frame;return 0;});
  return leaked;
}`,
    { fileName: "leak.lucent.ts", libraries },
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.length).toBeGreaterThan(0);
});
