import type { NativeType, IRModule } from "@lucent-lang/compiler";
import { nativeSwift } from "./native.ts";
export function swiftEventValue(value: string, type: NativeType, module: IRModule): string {
  if (type.kind === "struct")
    return `[${module.structs
      .find((s) => s.name === type.name)!
      .fields.map((f) => `${JSON.stringify(f.name)}: ${swiftEventValue(`${value}.${f.name}`, f.type, module)}`)
      .join(", ")}] as [String: Any]`;
  if (type.kind === "optional")
    return `${value}.map { ${swiftEventValue("$0", type.value, module)} as Any } ?? NSNull()`;
  if (type.kind === "array") return `${value}.map { ${swiftEventValue("$0", type.element, module)} }`;
  if (type.kind === "map") return `${value}.mapValues { ${swiftEventValue("$0", type.value, module)} }`;
  if (type.kind === "void") return "NSNull()";
  return value;
}
export const swiftEventRuntime = nativeSwift("LucentEvents.swift");
