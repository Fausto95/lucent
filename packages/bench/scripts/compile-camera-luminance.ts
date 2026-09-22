/**
 * Macro harness: time compile() of camera luminance orchestration.
 * Prints elapsed ms only — not a performance claim or budget result.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@lucent-lang/compiler";
import { CAMERA_LIBRARY } from "../../camera/src/library.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const luminance = readFileSync(join(root, "packages/camera/lucent/luminance.lucent.ts"), "utf8");
const iterations = Number(process.argv[2] ?? 30);

const source = `import {CameraSession,Frame} from '@lucent-lang/camera';
import {luminance} from './luminance.lucent';
@NativeOnly export function attach(session:CameraSession):number{
  return session.frames((frame:Frame):number=>luminance(frame));
}`;

const libraries = { "@lucent-lang/camera": CAMERA_LIBRARY };
const options = {
  fileName: "attach.lucent.ts",
  sources: { "luminance.lucent.ts": luminance },
  libraries,
};

const started = performance.now();
for (let i = 0; i < iterations; i++) {
  const result = compile(source, options);
  if (result.diagnostics.length || !result.module) {
    console.error("compile failed", result.diagnostics);
    process.exit(1);
  }
}
const ms = performance.now() - started;
console.log(`compile camera luminance × ${iterations}: ${ms.toFixed(2)} ms`);
