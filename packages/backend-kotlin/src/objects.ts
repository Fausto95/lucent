import type { IRStruct } from "@lucent-lang/compiler";
import { kotlinType } from "./types.ts";
import { nativeKotlin } from "./native.ts";
export function kotlinClass(s: IRStruct, includeImports = true): string {
  const native = s.reference?.native;
  if (native)
    return native.kotlin
      ? [
          ...(includeImports ? (native.kotlinImports ?? []) : []).map((i) => `import ${i}`),
          `typealias ${s.name} = ${native.kotlin}`,
          "",
        ].join("\n")
      : `class ${s.name}\n`;

  return `class ${s.name}(${s.fields.map((f) => `var ${f.name}: ${kotlinType(f.type)}`).join(", ")})\n`;
}
export const kotlinObjectRuntime = nativeKotlin("LucentObjects.kt");
