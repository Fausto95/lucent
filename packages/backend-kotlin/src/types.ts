import type { NativeType } from "@lucent-lang/compiler";
const PRIMITIVES: Readonly<Record<string, string>> = {
  /** A child slot is content to emit, not a value; a view result is plain Unit. */
  view: "@Composable () -> Unit",
  void: "Unit",
  bool: "Boolean",
  string: "String",
  bytes: "ArrayBuffer",
};

const INTS: Readonly<Record<string, string>> = { "8": "Byte", "16": "Short", "32": "Int", "64": "Long" };

export function kotlinType(t: NativeType): string {
  switch (t.kind) {
    case "callback":
      return `(${t.params.map(kotlinType).join(", ")}) -> ${kotlinType(t.result)}`;
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
      return `${t.value.kind === "callback" || t.value.kind === "event" ? `(${kotlinType(t.value)})` : kotlinType(t.value)}?`;
    case "enum":
      return t.binding.kotlin.type;
    case "struct":
      return t.name;
    case "promise":
      return kotlinType(t.value);
    default:
      return PRIMITIVES[t.kind]!;
  }
}
