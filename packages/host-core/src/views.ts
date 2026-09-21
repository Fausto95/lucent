import type { NativeType } from "@lucent-lang/compiler";
import type { IRFunction, IRModule } from "@lucent-lang/compiler";
import { moduleIdentifier } from "./names.ts";
export const exportedViews = (module: IRModule): IRFunction[] =>
  module.functions.filter((f) => f.exported && f.returnType.kind === "view");
export const viewName = (module: IRModule, fn: IRFunction): string =>
  `Lucent${moduleIdentifier(module.name)}${fn.name}View`;
export const viewNamespace = (module: IRModule): string => `Lucent${moduleIdentifier(module.name)}Views`;
export function viewProps(module: IRModule, fn: IRFunction) {
  const type = fn.params[0]?.type;
  return type?.kind === "struct" ? module.structs.find((s) => s.name === type.name)!.fields : [];
}
export function withoutViews(module: IRModule): IRModule {
  const functions = module.functions.filter((f) => f.returnType.kind !== "view");
  const names = new Set<string>();
  const visit = (type: NativeType): void => {
    if (type.kind === "struct" && !names.has(type.name)) {
      names.add(type.name);
      module.structs.find((s) => s.name === type.name)?.fields.forEach((f) => visit(f.type));
    } else if (type.kind === "array") visit(type.element);
    else if (type.kind === "optional" || type.kind === "promise" || type.kind === "map") visit(type.value);
  };
  functions.forEach((f) => {
    f.params.forEach((p) => visit(p.type));
    visit(f.returnType);
    f.locals.forEach((l) => visit(l.type));
  });
  // Preserve declarations from ordinary modules; view-only props never enter a function bridge.
  return {
    ...module,
    functions,
    structs: module.functions.some((f) => f.returnType.kind === "view")
      ? module.structs.filter((s) => names.has(s.name))
      : module.structs,
  };
}
/** Keep the Fabric registration identical to Nitrogen's createHostComponentJs output. */
export function viewConfig(module: IRModule, fn: IRFunction): string {
  return JSON.stringify({
    uiViewClassName: viewName(module, fn),
    supportsRawText: false,
    bubblingEventTypes: {},
    directEventTypes: {},
    validAttributes: Object.fromEntries([...viewProps(module, fn).map((p) => [p.name, true]), ["hybridRef", true]]),
  });
}
