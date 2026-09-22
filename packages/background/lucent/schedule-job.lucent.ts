import { NativeResource } from "@lucent-lang/core/resources";
import { BackgroundJobHandle } from "@lucent-lang/background";

/**
 * Durable vs in-process:
 * - durable=true: OS-scheduled; payload must be serializable with payloadVersion.
 * - durable=false: in-process only; may not survive JS runtime teardown.
 *
 * This Lucent example registers both via declare-native constructors and closes
 * the owned handles. Entry-point `run` bodies remain host/device work.
 */
export async function scheduleSyncJob(): Promise<void> {
  const slot = new NativeResource();
  const durable = new BackgroundJobHandle("sync-records", 1, "{\"accountId\":\"a1\"}", true);
  const inProcess = new BackgroundJobHandle("warmup-cache", 1, "{\"key\":\"k\"}", false);
  await durable.close();
  await inProcess.close();
  await slot.close();
}
