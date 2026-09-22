import { NativeResource } from "@lucent-lang/core/resources";
import { BluetoothScanner } from "@lucent-lang/bluetooth";

/** Scan → connect → close orchestration with explicit resource ownership. */
export async function runScanConnect(): Promise<void> {
  const slot = new NativeResource();
  const scanner = new BluetoothScanner();
  scanner.start();
  const connection = await scanner.connect("fake-1");
  scanner.stop();
  await connection.close();
  await scanner.close();
  await slot.close();
}
