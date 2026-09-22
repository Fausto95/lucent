import type { IRConst, IRFunction, IRModule, NativeType } from "@lucent-lang/compiler";
import { moduleIdentifier } from "./names.ts";
export const exportedViews = (module: IRModule): IRFunction[] =>
  module.functions.filter((f) => f.exported && f.returnType.kind === "view");
export const viewName = (module: IRModule, fn: IRFunction): string =>
  `Lucent${moduleIdentifier(module.name)}${fn.name}View`;
export const viewNamespace = (module: IRModule): string => `Lucent${moduleIdentifier(module.name)}Views`;
export function stateLiteral(value: IRConst, language: "swift" | "kotlin"): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return language === "kotlin" && Number.isInteger(value) ? `${value}.0` : String(value);
  return language === "swift" ? "nil" : "null";
}

/** Instance fields for view state. Empty when the view has no `state()` declarations. */
export function stateFields(
  fn: IRFunction,
  language: "swift" | "kotlin",
  typeName: (type: NativeType) => string,
): string {
  return (fn.state ?? [])
    .map((slot) => {
      const initial = stateLiteral(slot.value, language);
      const type = typeName(slot.type);
      return language === "swift"
        ? `var lucentState_${slot.name}: ${type} = ${initial}`
        : `var lucentState_${slot.name}: ${type} by mutableStateOf(${initial})`;
    })
    .join("\n");
}

/** Getter and setter arguments. `refresh` is the Swift method that rebuilds the hosted tree. */
export function stateArguments(fn: IRFunction, language: "swift" | "kotlin", refresh: string): string {
  return (fn.state ?? [])
    .map((slot) => {
      const fallback = stateLiteral(slot.value, language);
      return language === "swift"
        ? `lucentGet_${slot.name}: { [weak self] in self?.lucentState_${slot.name} ?? ${fallback} }, lucentSet_${slot.name}: { [weak self] value in self?.lucentState_${slot.name} = value; self?.${refresh}() }`
        : `lucentGet_${slot.name} = { lucentState_${slot.name} }, lucentSet_${slot.name} = { lucentState_${slot.name} = it }`;
    })
    .join(", ");
}

export function viewCallWithState(props: string, state: string): string {
  return [props, state].filter(Boolean).join(", ");
}

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
