import type { NativeType } from "@lucent-lang/compiler";
const PRIMITIVES: Readonly<Record<string, string>> = {
  view: "AnyView",
  void: "Void",
  bool: "Bool",
  string: "String",
  bytes: "ArrayBuffer",
};

export function swiftType(t: NativeType): string {
  switch (t.kind) {
    case "event":
      return `(${t.payload.kind === "void" ? "" : swiftType(t.payload)}) -> Void`;
    case "float":
      return t.bits === 64 ? "Double" : "Float";
    case "int":
      return `${t.signed ? "Int" : "UInt"}${t.bits}`;
    case "array":
      return `[${swiftType(t.element)}]`;
    case "map":
      return `[String: ${swiftType(t.value)}]`;
    case "optional":
      return `${swiftType(t.value)}?`;
    case "struct":
      return t.name;
    case "promise":
      return swiftType(t.value);
    default:
      return PRIMITIVES[t.kind]!;
  }
}
