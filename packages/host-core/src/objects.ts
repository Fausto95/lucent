const declarationParams = (fn: IRFunction, skip = 0) =>
  fn.params
    .slice(skip)
    .map((p) => `${p.name}: ${jsType(p.type)}`)
    .join(", ");
import type { IRModule, IRFunction, NativeType } from "@lucent-lang/compiler";
import { convert, jsType, type ConversionPolicy } from "./conversion.ts";
import { runtimeKind } from "@lucent-lang/compiler";
function argumentGuard(value: string, type: NativeType): string {
  return type.kind === "optional"
    ? `(${value} == null || ${argumentGuard(value, type.value)})`
    : `typeof ${value} === ${JSON.stringify(runtimeKind(type))}`;
}
export function isReference(type: NativeType, module: IRModule): boolean {
  return type.kind === "struct" && !!module.structs.find((s) => s.name === type.name)?.reference;
}
export function classDeclarations(module: IRModule): string[] {
  return module.structs
    .filter((s) => s.reference)
    .map((s) => {
      const operations = module.functions.filter((f) => f.classOp?.className === s.name && f.exported);

      const ctors = operations.filter((f) => f.classOp!.kind === "constructor");
      return `export declare class ${s.name} {\n${ctors.map((c) => `  constructor(${declarationParams(c)});`).join("\n")}\n  dispose(): void;\n${s.fields
        .filter((f) => !s.reference?.privateFields?.includes(f.name))
        .map(
          (f) =>
            `  ${operations.some((op) => op.classOp?.kind === "set" && op.classOp.member === f.name) ? "" : "readonly "}${f.name}: ${jsType(f.type)};`,
        )
        .join("\n")}\n${operations
        .filter((f) => f.classOp!.kind === "method")
        .map(
          (f) =>
            `  ${f.classOp!.member}(${declarationParams(f, 1)}): ${f.async ? `Promise<${jsType(f.returnType)}>` : jsType(f.returnType)};`,
        )
        .join("\n")}\n}${s.reference!.exported ? `\nexport { ${s.name} as ${s.reference!.publicName} };` : ""}`;
    });
}
export function classProxies(module: IRModule, nullAsUndefined: boolean): string {
  const policy: ConversionPolicy = { structs: new Map(module.structs.map((s) => [s.name, s])), nullAsUndefined };
  return module.structs
    .filter((s) => s.reference)
    .map((s) => {
      const operations = module.functions.filter((f) => f.classOp?.className === s.name && f.exported);
      const wrapper = (fn: (typeof operations)[number]) => {
        const hasReceiver = fn.classOp!.kind !== "constructor";
        const params = fn.params.map((p) => p.name);
        const args = fn.params.map((p, i) => (hasReceiver && i === 0 ? p.name : convert(p.name, p.type, "in", policy)));
        const result = fn.classOp!.kind === "constructor" ? "result" : convert("result", fn.returnType, "out", policy);
        return `${fn.async ? "async " : ""}(${params.join(", ")}) => { const result = ${fn.async ? "await " : ""}lucentCall(() => native.${fn.name}(${args.join(", ")})); return ${result}; }`;
      };
      const ctors = operations.filter((f) => f.classOp!.kind === "constructor");
      const create =
        ctors.length === 1
          ? wrapper(ctors[0]!)
          : `(...args) => {\n${ctors
              .map((c) => {
                const guards = [
                  `args.length === ${c.params.length}`,
                  ...c.params.map((p, i) => argumentGuard(`args[${i}]`, p.type)),
                ].join(" && ");
                const call = c.params.map((p, i) => convert(`args[${i}]`, p.type, "in", policy)).join(", ");
                return `      if (${guards}) return lucentCall(() => native.${c.name}(${call}));`;
              })
              .join(
                "\n",
              )}\n      throw new TypeError(${JSON.stringify(`No ${s.reference!.publicName} constructor matches these arguments`)});\n    }`;
      const asyncMethods = operations
        .filter((f) => f.classOp!.kind === "method" && f.async)
        .map((f) => f.classOp!.member);
      const group = (kind: string) => {
        const members = new Map<string, IRFunction[]>();
        for (const fn of operations.filter((f) => f.classOp!.kind === kind)) {
          const name = fn.classOp!.member;
          members.set(name, [...(members.get(name) ?? []), fn]);
        }
        return [...members]
          .map(([name, candidates]) => {
            if (candidates.length === 1) return `${JSON.stringify(name)}: ${wrapper(candidates[0]!)}`;
            const cases = candidates
              .map((fn) => {
                const params = fn.params.slice(1);
                const guards = [
                  `args.length === ${params.length}`,
                  ...params.map((p, i) => argumentGuard(`args[${i}]`, p.type)),
                ].join(" && ");
                return `if (${guards}) return (${wrapper(fn)})(receiver, ...args);`;
              })
              .join("\n");
            return `${JSON.stringify(name)}: (receiver, ...args) => {\n${cases}\nthrow new TypeError(${JSON.stringify(`No ${s.reference!.publicName}.${name} overload matches these arguments`)});\n}`;
          })
          .join(", ");
      };
      return `const ${s.name} = defineNativeClass(${JSON.stringify(s.name)}, { name: ${JSON.stringify(s.reference!.publicName)}, create: ${create}, release: (handle) => native.lucentRelease(handle), methods: {${group("method")}}, ${asyncMethods.length ? `asyncMethods: ${JSON.stringify(asyncMethods)}, ` : ""}getters: {${group("get")}}, setters: {${group("set")}} });${s.reference!.exported ? `\nexport { ${s.name} as ${s.reference!.publicName} };` : ""}`;
    })
    .join("\n");
}
