import type { IRModule, NativeEnumBinding } from "@lucent-lang/compiler";

/** The Kotlin name of the generated bridge between an SDK enum and its Lucent case strings. */
export const kotlinEnumBridge = (name: string): string => `LucentEnum_${name}`;

/** Case expression for a Lucent enum literal, resolved at compile time. */
export function kotlinEnumValue(binding: NativeEnumBinding, kase: string): string {
  const value = binding.kotlin.values[kase];
  if (value === undefined) throw new Error(`Kotlin enum binding is missing the case ${kase}`);
  return value;
}

/**
 * `toLucent` and `fromLucent` for every enum a module uses. Native code keeps the SDK
 * value; JavaScript only ever sees the case name, and an unrecognised one is a typed error
 * rather than a guess.
 */
export function kotlinEnums(enums: Readonly<Record<string, NativeEnumBinding>>): string[] {
  return Object.entries(enums).map(([name, binding]) => {
    const type = binding.kotlin.type;
    const pairs = binding.cases.map((kase) => `${JSON.stringify(kase)} to ${kotlinEnumValue(binding, kase)}`);
    return [
      `object ${kotlinEnumBridge(name)} {`,
      `  val cases: List<Pair<String, ${type}>> = listOf(${pairs.join(", ")})`,
      `  fun toLucent(value: ${type}): String =`,
      "    cases.firstOrNull { it.second == value }?.first",
      `      ?: throw LucentError("INVALID_ENUM_CASE", "Unsupported ${name} value")`,
      `  fun fromLucent(value: String): ${type} =`,
      "    cases.firstOrNull { it.first == value }?.second",
      `      ?: throw LucentError("INVALID_ENUM_CASE", "Unknown ${name} case", mapOf("value" to value))`,
      "}",
    ].join("\n");
  });
}

export const kotlinEnumImports = (module: IRModule): string[] =>
  Object.values(module.enums ?? {}).flatMap((e) => (e.kotlin.imports ?? []).map((i) => i));
