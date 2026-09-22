/**
 * Component resource slots and effects for `.lucent.tsx` views.
 *
 * ```ts
 * import { CameraSession } from "@lucent-lang/camera";
 *
 * function Camera(): NativeView {
 *   const session = resource(() => new CameraSession())
 *   effect(async () => {
 *     session.start()
 *     return async () => { session.stop() }
 *   }, [session])
 *   return <Text>ready</Text>
 * }
 * ```
 *
 * `resource()` creates an owned value once per host identity and closes it on
 * unmount (including after failed or cancelled initialization). `effect()` runs
 * setup on mount and cleanup on unmount; the async form cancels/joins via
 * TaskScope before restart or teardown. See `@lucent-lang/core/resources` for
 * the OPEN → CLOSING → CLOSED lease machine and `resourceScope` / `scope.own`.
 */
export type { NativeResource, ResourceScope } from "./resources";
