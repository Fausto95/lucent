import type { NativeType } from "@lucent-lang/compiler";
const PRIMITIVES: Readonly<Record<string, string>> = {
  view: "Unit",
  void: "Unit",
  bool: "Boolean",
  string: "String",
  bytes: "ArrayBuffer",
};

const INTS: Readonly<Record<string, string>> = { "8": "Byte", "16": "Short", "32": "Int", "64": "Long" };

export function kotlinType(t: NativeType): string {
  switch (t.kind) {
    case "event":
      return `(${t.payload.kind === "void" ? "" : kotlinType(t.payload)}) -> Unit`;
    case "float":
      return t.bits === 64 ? "Double" : "Float";
    case "int":
      return `${t.signed ? "" : "U"}${INTS[String(t.bits)]}`;
    case "array":
      return `MutableList<${kotlinType(t.element)}>`;
    case "map":
      return `Map<String, ${kotlinType(t.value)}>`;
    case "optional":
      return `${kotlinType(t.value)}?`;
    case "struct":
      return t.name;
    case "promise":
      return kotlinType(t.value);
    default:
      return PRIMITIVES[t.kind]!;
  }
}
