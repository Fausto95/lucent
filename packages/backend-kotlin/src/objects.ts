import type { IRStruct } from "@lucent-lang/compiler";
import { kotlinType } from "./types.ts";
export function kotlinClass(s: IRStruct): string {
  return `class ${s.name}(${s.fields.map((f) => `var ${f.name}: ${kotlinType(f.type)}`).join(", ")})\n`;
}
export const kotlinObjectRuntime = `object LucentObjectRegistry {
  private val lock = Any()
  private var next = 0.0
  private val objects = mutableMapOf<Double, Any>()
  private val identities = java.util.IdentityHashMap<Any, Double>()
  fun <T> withLock(body: () -> T): T = synchronized(lock) { body() }
  fun hold(value: Any): Double = withLock {
    identities[value] ?: run { next += 1; objects[next] = value; identities[value] = next; next }
  }
  fun <T: Any> get(handle: Double, type: Class<T>): T = withLock {
    val value = objects[handle]
    if (!type.isInstance(value)) throw LucentError("DISPOSED_OBJECT", "Invalid or released native object")
    type.cast(value)!!
  }
  fun release(handle: Double) { withLock { objects.remove(handle)?.let { identities.remove(it) }; Unit } }
}
`;
