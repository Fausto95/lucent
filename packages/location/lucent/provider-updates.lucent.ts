import { NativeResource } from "@lucent-lang/core/resources";
import { LocationProvider, requestPermission } from "@lucent-lang/location";

/** Subscribe and deliver one fix without spanning an `await` (LUCENT1018). */
function subscribeAndDeliver(provider: LocationProvider): void {
  provider.updates((position): number => position.latitude);
  provider.deliverFake(37.77, -122.42, 10, 1);
}

/** Request permission, subscribe to updates, deliver one fake fix, then close. */
export async function runProviderUpdates(): Promise<void> {
  const slot = new NativeResource();
  const permission = requestPermission();
  if (permission !== "granted") {
    await slot.close();
    return;
  }
  const provider = new LocationProvider();
  subscribeAndDeliver(provider);
  await provider.close();
  await slot.close();
}
