import type { IRStruct } from "@lucent-lang/compiler";
import { swiftType } from "./types.ts";
import { nativeSwift } from "./native.ts";
export function swiftClass(s: IRStruct): string {
  const native = s.reference?.native;
  if (native)
    return native.swift
      ? [...(native.swiftImports ?? []).map((i) => `import ${i}`), `typealias ${s.name} = ${native.swift}`, ""].join(
          "\n",
        )
      : `final class ${s.name} {}\n`;

  return `final class ${s.name} {\n${s.fields.map((f) => `  var ${f.name}: ${swiftType(f.type)}`).join("\n")}\n  init(${s.fields.map((f) => `${f.name}: ${swiftType(f.type)}`).join(", ")}) {\n${s.fields.map((f) => `    self.${f.name} = ${f.name}`).join("\n")}\n  }\n}\n`;
}
export const swiftObjectRuntime = nativeSwift("LucentObjects.swift");
