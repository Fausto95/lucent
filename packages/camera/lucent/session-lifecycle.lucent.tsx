import { Text, type NativeView } from "@lucent-lang/core/ui";
import { CameraSession } from "@lucent-lang/camera";

/**
 * Gate B session lifecycle via component `resource()` + async `effect()`.
 * The host closes the session on unmount; the effect starts/stops while mounted
 * under TaskScope cancel/join.
 */
export function SessionLifecycle(): NativeView {
  const session = resource(() => new CameraSession());
  effect(async () => {
    session.start();
    return async () => {
      session.stop();
    };
  }, [session]);
  return <Text>ready</Text>;
}
