import type { IRModule, NativeEnumBinding } from "@lucent-lang/compiler";

/** The Swift name of the generated bridge between an SDK enum and its Lucent case strings. */
export const swiftEnumBridge = (name: string): string => `LucentEnum_${name}`;

/** Case expression for a Lucent enum literal, resolved at compile time. */
export function swiftEnumValue(binding: NativeEnumBinding, kase: string): string {
  const value = binding.swift.values[kase];
  if (value === undefined) throw new Error(`Swift enum binding is missing the case ${kase}`);
  return value;
}

/**
 * `toLucent` and `fromLucent` for every enum a module uses. Native code keeps the SDK
 * value; JavaScript only ever sees the case name, and an unrecognised one is a typed error
 * rather than a guess. The SDK type must be `Equatable`, which Swift enums and option sets are.
 */
export function swiftEnums(enums: Readonly<Record<string, NativeEnumBinding>>): string[] {
  return Object.entries(enums).map(([name, binding]) => {
    const type = binding.swift.type;
    const pairs = binding.cases.map((kase) => `(${JSON.stringify(kase)}, ${swiftEnumValue(binding, kase)})`);
    return [
      `enum ${swiftEnumBridge(name)} {`,
      `  static let cases: [(String, ${type})] = [${pairs.join(", ")}]`,
      `  static func toLucent(_ value: ${type}) throws -> String {`,
      "    for (name, item) in cases where item == value { return name }",
      `    throw LucentError(code: "INVALID_ENUM_CASE", message: "Unsupported ${name} value")`,
      "  }",
      `  static func fromLucent(_ value: String) throws -> ${type} {`,
      "    for (name, item) in cases where name == value { return item }",
      `    throw LucentError(code: "INVALID_ENUM_CASE", message: "Unknown ${name} case", metadata: ["value": value])`,
      "  }",
      "}",
    ].join("\n");
  });
}

export const swiftEnumImports = (module: IRModule): string[] =>
  Object.values(module.enums ?? {}).flatMap((e) => (e.swift.imports ?? []).map((i) => i));
