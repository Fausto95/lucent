import type { NativeType, IRModule } from "@lucent-lang/compiler";
import { nativeKotlin } from "./native.ts";
export function kotlinEventValue(value: string, type: NativeType, module: IRModule): string {
  if (type.kind === "struct")
    return `mapOf(${module.structs
      .find((s) => s.name === type.name)!
      .fields.map((f) => `${JSON.stringify(f.name)} to ${kotlinEventValue(`${value}.${f.name}`, f.type, module)}`)
      .join(", ")})`;
  if (type.kind === "optional") return `${value}?.let { ${kotlinEventValue("it", type.value, module)} }`;
  if (type.kind === "array") return `${value}.map { ${kotlinEventValue("it", type.element, module)} }`;
  if (type.kind === "map") return `${value}.mapValues { ${kotlinEventValue("it.value", type.value, module)} }`;
  if (type.kind === "void") return "null";
  return value;
}
export const kotlinEventRuntime = nativeKotlin("LucentEvents.kt");
