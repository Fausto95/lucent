import { expect, test } from "vite-plus/test";
import { compile, validateLibrary } from "@lucent-lang/compiler";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LOCATION_LIBRARY } from "../src/library.ts";

const libraries = { "@lucent-lang/location": LOCATION_LIBRARY };
const here = dirname(fileURLToPath(import.meta.url));
const lucent = (name: string) => readFileSync(join(here, "..", "lucent", name), "utf8");

test("LOCATION_LIBRARY passes validation including keep-latest updates", () => {
  expect(validateLibrary(LOCATION_LIBRARY)).toEqual([]);
  const updates = LOCATION_LIBRARY.bindings!.LocationProvider__method_updates!;
  expect(updates.contract!.parameters!.callback!.callback).toEqual({
    retention: "subscription",
    executor: "worker",
    errors: "notify",
    backpressure: "latest",
  });
  expect(LOCATION_LIBRARY.enums!.LocationPermission!.cases).toEqual(["unknown", "granted", "denied", "restricted"]);
});

test("compiles provider updates with permission union", () => {
  const result = compile(lucent("provider-updates.lucent.ts"), {
    fileName: "provider-updates.lucent.ts",
    libraries,
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
  expect(Object.values(result.module!.nativePackages ?? {}).flatMap((p) => Object.keys(p.swift ?? {}))).toEqual(
    expect.arrayContaining(["Location.swift", "Resource.swift"]),
  );
});

test("rejects Position borrow escape from updates callback", () => {
  const result = compile(
    `import {LocationProvider,Position} from '@lucent-lang/location';
export function leak(provider:LocationProvider):Position{
  let escaped:Position=null as unknown as Position;
  provider.updates((position:Position):number=>{escaped=position;return 0;});
  return escaped;
}`,
    { fileName: "position-escape.lucent.ts", libraries },
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.length).toBeGreaterThan(0);
});

test("rejects use after close", () => {
  const result = compile(
    `import {LocationProvider} from '@lucent-lang/location';
export async function bad(provider:LocationProvider):Promise<number>{
  await provider.close();
  return provider.updates((p):number=>p.latitude);
}`,
    { fileName: "use-after-close.lucent.ts", libraries },
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.message.includes("closed"))).toBe(true);
});
