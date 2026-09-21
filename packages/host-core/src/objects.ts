const declarationParams = (fn: IRFunction, skip = 0) =>
  fn.params
    .slice(skip)
    .map((p) => `${p.name}: ${jsType(p.type)}`)
    .join(", ");
import type { IRModule, IRFunction, NativeType } from "@lucent-lang/compiler";
import { convert, jsType, type ConversionPolicy } from "./conversion.ts";
export function isReference(type: NativeType, module: IRModule): boolean {
  return type.kind === "struct" && !!module.structs.find((s) => s.name === type.name)?.reference;
}
export function classDeclarations(module: IRModule): string[] {
  return module.structs
    .filter((s) => s.reference)
    .map((s) => {
      const operations = module.functions.filter((f) => f.classOp?.className === s.name);

      const ctor = operations.find((f) => f.classOp!.kind === "constructor")!;
      return `export declare class ${s.name} {\n  constructor(${declarationParams(ctor)});\n  dispose(): void;\n${s.fields
        .filter((f) => !s.reference?.privateFields?.includes(f.name))
        .map((f) => `  ${f.name}: ${jsType(f.type)};`)
        .join("\n")}\n${operations
        .filter((f) => f.classOp!.kind === "method")
        .map((f) => `  ${f.classOp!.member}(${declarationParams(f, 1)}): ${jsType(f.returnType)};`)
        .join("\n")}\n}${s.reference!.exported ? `\nexport { ${s.name} as ${s.reference!.publicName} };` : ""}`;
    });
}
export function classProxies(module: IRModule, nullAsUndefined: boolean): string {
  const policy: ConversionPolicy = { structs: new Map(module.structs.map((s) => [s.name, s])), nullAsUndefined };
  return module.structs
    .filter((s) => s.reference)
    .map((s) => {
      const operations = module.functions.filter((f) => f.classOp?.className === s.name);
      const wrapper = (fn: (typeof operations)[number]) => {
        const hasReceiver = fn.classOp!.kind !== "constructor";
        const params = fn.params.map((p) => p.name);
        const args = fn.params.map((p, i) => (hasReceiver && i === 0 ? p.name : convert(p.name, p.type, "in", policy)));
        const result = fn.classOp!.kind === "constructor" ? "result" : convert("result", fn.returnType, "out", policy);
        return `(${params.join(", ")}) => { const result = lucentCall(() => native.${fn.name}(${args.join(", ")})); return ${result}; }`;
      };
      const ctor = operations.find((f) => f.classOp!.kind === "constructor")!;
      const group = (kind: string) =>
        operations
          .filter((f) => f.classOp!.kind === kind)
          .map((f) => `${JSON.stringify(f.classOp!.member)}: ${wrapper(f)}`)
          .join(", ");
      return `const ${s.name} = defineNativeClass(${JSON.stringify(s.name)}, { name: ${JSON.stringify(s.reference!.publicName)}, create: ${wrapper(ctor)}, release: (handle) => native.lucentRelease(handle), methods: {${group("method")}}, getters: {${group("get")}}, setters: {${group("set")}} });${s.reference!.exported ? `\nexport { ${s.name} as ${s.reference!.publicName} };` : ""}`;
    })
    .join("\n");
}
