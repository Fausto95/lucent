import type { IRConst, IRFunction, IRModule, NativeType } from "@lucent-lang/compiler";
import { moduleIdentifier } from "./names.ts";
/** React owns the children of a host view, so a component with a child slot stays Lucent-only. */
export function hasChildSlot(module: IRModule, fn: IRFunction): boolean {
  const type = fn.params[0]?.type;
  if (type?.kind !== "struct") return false;
  return module.structs.find((s) => s.name === type.name)?.fields.some((f) => f.type.kind === "view") ?? false;
}

export const exportedViews = (module: IRModule): IRFunction[] =>
  module.functions.filter((f) => f.exported && f.returnType.kind === "view" && !hasChildSlot(module, f));
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

/** Owned resource fields created once via the linked create callee. */
export function resourceFields(
  fn: IRFunction,
  language: "swift" | "kotlin",
  typeName: (type: NativeType) => string,
  namespace: string,
): string {
  return (fn.resources ?? [])
    .map((slot) => {
      const type = typeName(slot.type);
      const init =
        language === "swift" ? `try! ${namespace}.${slot.initCallee}()` : `${namespace}.${slot.initCallee}()`;
      return language === "swift"
        ? `lazy var lucentResource_${slot.name}: ${type} = { ${init} }()`
        : `private val lucentResource_${slot.name}: ${type} by lazy { ${init} }`;
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

/** Resource getter arguments passed into the generated view function. */
export function resourceArguments(fn: IRFunction, language: "swift" | "kotlin"): string {
  return (fn.resources ?? [])
    .map((slot) =>
      language === "swift"
        ? `lucentGet_${slot.name}: { [weak self] in self!.lucentResource_${slot.name} }`
        : `lucentGet_${slot.name} = { lucentResource_${slot.name} }`,
    )
    .join(", ");
}

/** Close owned resources when the host identity is torn down. */
export function resourceDispose(fn: IRFunction, language: "swift" | "kotlin"): string {
  const slots = fn.resources ?? [];
  if (!slots.length) return "";
  if (language === "swift") {
    const closes = slots
      .map(
        (slot) =>
          `let lucentClose_${slot.name} = lucentResource_${slot.name}\n    Task { try? await lucentClose_${slot.name}.${slot.close}() }`,
      )
      .join("\n    ");
    return `deinit {\n    ${closes}\n  }`;
  }
  const closes = slots
    .map((slot) => `kotlinx.coroutines.runBlocking { lucentResource_${slot.name}.${slot.close}() }`)
    .join("\n    ");
  return `override fun onDetachedFromWindow() {\n    super.onDetachedFromWindow()\n    ${closes}\n  }`;
}

export function viewCallWithState(props: string, state: string, resources = ""): string {
  return [props, state, resources].filter(Boolean).join(", ");
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
