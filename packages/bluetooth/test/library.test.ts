import { expect, test } from "vite-plus/test";
import { compile, validateLibrary } from "@lucent-lang/compiler";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BLUETOOTH_LIBRARY, NOTIFICATION_BUFFER_CAPACITY } from "../src/library.ts";

const libraries = { "@lucent-lang/bluetooth": BLUETOOTH_LIBRARY };
const here = dirname(fileURLToPath(import.meta.url));
const lucent = (name: string) => readFileSync(join(here, "..", "lucent", name), "utf8");

test("BLUETOOTH_LIBRARY passes validation including buffer(n) notifications policy", () => {
  expect(validateLibrary(BLUETOOTH_LIBRARY)).toEqual([]);
  expect(NOTIFICATION_BUFFER_CAPACITY).toBe(32);
  const notifications = BLUETOOTH_LIBRARY.bindings!.BluetoothConnection__method_notifications!;
  expect(notifications.contract!.parameters!.callback!.callback).toEqual({
    retention: "subscription",
    executor: "worker",
    errors: "notify",
    backpressure: "block",
  });
});

test("compiles scan → connect → close orchestration", () => {
  const result = compile(lucent("scan-connect.lucent.ts"), {
    fileName: "scan-connect.lucent.ts",
    libraries,
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
  expect(Object.values(result.module!.nativePackages ?? {}).flatMap((p) => Object.keys(p.swift ?? {}))).toEqual(
    expect.arrayContaining(["Bluetooth.swift", "Resource.swift"]),
  );
});

test("compiles read/write/notifications against Uint8Array payloads", () => {
  const result = compile(
    `import {BluetoothScanner,BluetoothConnection} from '@lucent-lang/bluetooth';
@NativeOnly export async function roundtrip(scanner:BluetoothScanner):Promise<number>{
  scanner.start();
  const connection=await scanner.connect("fake-1");
  const payload=await connection.read("c1");
  await connection.write("c1",payload);
  const attached=connection.notifications("c1",(bytes:Uint8Array):number=>bytes.length);
  await connection.close();
  await scanner.close();
  return attached;
}`,
    { fileName: "roundtrip.lucent.ts", libraries },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
});

test("rejects borrow escape of a borrowed characteristic read", () => {
  const result = compile(
    `import {BluetoothConnection} from '@lucent-lang/bluetooth';
export async function leak(connection:BluetoothConnection):Promise<Uint8Array>{
  return await connection.borrowRead("c1");
}`,
    { fileName: "borrow-escape.lucent.ts", libraries },
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.length).toBeGreaterThan(0);
});

test("rejects use after close", () => {
  const result = compile(
    `import {BluetoothScanner} from '@lucent-lang/bluetooth';
export async function bad(scanner:BluetoothScanner):Promise<void>{
  await scanner.close();
  scanner.start();
}`,
    { fileName: "use-after-close.lucent.ts", libraries },
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.message.includes("closed"))).toBe(true);
});
