import { validNativeTargets } from "./native-contracts.ts";
import type { LibraryModule } from "./libraries.ts";
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): boolean => Array.isArray(value) && value.every((v) => typeof v === "string");
const identifier = (value: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
const propType = (value: unknown, depth = 0): boolean => {
  if (!record(value) || depth > 8) return false;
  if (["string", "bool"].includes(String(value.kind))) return true;
  if (value.kind === "float") return value.bits === 64;
  if (value.kind === "event")
    return (
      record(value.payload) &&
      (value.payload.kind === "void" ||
        (["string", "bool", "float"].includes(String(value.payload.kind)) && propType(value.payload, depth + 1)))
    );
  return value.kind === "optional" && propType(value.value, depth + 1);
};
/** Validate metadata without executing native code or depending on a host. */
export function validateLibrary(library: LibraryModule): string[] {
  const errors: string[] = [];
  if (!record(library) || typeof library.source !== "string") return ["Library source must be a string."];
  if (library.schemaVersion !== undefined && library.schemaVersion !== 1)
    errors.push("Unsupported native manifest schema version.");
  const executors = new Set(["caller", "main", "worker", "serial"]);
  const ids = new Set<string>();
  if (library.bindings !== undefined && !record(library.bindings)) return [...errors, "Bindings must be a map."];
  for (const [name, binding] of Object.entries(library.bindings ?? {})) {
    if (!record(binding)) {
      errors.push(`Invalid native binding ${name}.`);
      continue;
    }
    if (binding.overload !== undefined && (typeof binding.overload !== "string" || !identifier(binding.overload)))
      errors.push(`Invalid overload group ${name}.`);
    const contract = binding.contract;
    if (contract === undefined) continue;
    if (
      !record(contract) ||
      typeof contract.symbolId !== "string" ||
      !contract.symbolId ||
      ids.has(contract.symbolId)
    ) {
      errors.push(`Invalid or duplicate native symbol identity ${name}.`);
      continue;
    }
    ids.add(contract.symbolId);
    if (contract.executor !== undefined && !executors.has(String(contract.executor)))
      errors.push(`Invalid executor in ${name}.`);
    if (contract.result !== undefined && !["value", "owned", "borrowed", "external"].includes(contract.result))
      errors.push(`Invalid return ownership in ${name}.`);
    if (contract.cancellation !== undefined && !["none", "cooperative"].includes(contract.cancellation))
      errors.push(`Invalid cancellation in ${name}.`);
    if (contract.availability !== undefined && !validNativeTargets(contract.availability))
      errors.push(`Invalid availability in ${name}.`);
    if (contract.resourceRequiresOpen !== undefined && typeof contract.resourceRequiresOpen !== "boolean")
      errors.push(`Invalid resourceRequiresOpen in ${name}.`);
    if (contract.blocking !== undefined && typeof contract.blocking !== "boolean")
      errors.push(`Invalid blocking in ${name}.`);
    if (contract.parameters !== undefined && !record(contract.parameters)) {
      errors.push(`Invalid parameter contracts in ${name}.`);
      continue;
    }
    for (const [parameter, value] of Object.entries(contract.parameters ?? {})) {
      if (!record(value) || !["value", "borrowed", "retained"].includes(value.ownership)) {
        errors.push(`Invalid ownership of ${parameter}.`);
        continue;
      }
      const callback = value.callback;
      const backpressurePolicies = new Set(["latest", "dropOldest", "dropNewest", "block"]);
      if (
        callback !== undefined &&
        (!record(callback) ||
          !["call", "subscription"].includes(callback.retention) ||
          !executors.has(callback.executor) ||
          !["propagate", "notify"].includes(callback.errors) ||
          (callback.remove !== undefined && typeof callback.remove !== "string") ||
          (callback.backpressure !== undefined && !backpressurePolicies.has(String(callback.backpressure))))
      )
        errors.push(`Invalid callback contract ${parameter}.`);
    }
  }
  if (library.views !== undefined) {
    if (!record(library.views)) return ["Native views must be a map."];
    for (const [name, view] of Object.entries(library.views)) {
      if (
        !identifier(name) ||
        !record(view) ||
        !record(view.props) ||
        !["views", "text", "none"].includes(view.children)
      ) {
        errors.push(`Invalid native view ${name}.`);
        continue;
      }
      if (Object.entries(view.props).some(([key, type]) => !identifier(key) || !propType(type)))
        errors.push(`Invalid native view prop in ${name}.`);
      if (view.required !== undefined && (!strings(view.required) || view.required.some((p) => !(p in view.props))))
        errors.push(`Invalid required props in ${name}.`);
      for (const language of ["swift", "kotlin"] as const) {
        const value = view[language];
        if (
          !record(value) ||
          typeof value.template !== "string" ||
          (value.imports !== undefined && !strings(value.imports)) ||
          (value.defaults !== undefined &&
            (!record(value.defaults) || Object.values(value.defaults).some((v) => typeof v !== "string")))
        )
          errors.push(`Invalid ${language} view template in ${name}.`);
      }
    }
  }
  if (library.enums !== undefined) {
    if (!record(library.enums)) return [...errors, "Native enums must be a map."];
    for (const [name, enumeration] of Object.entries(library.enums)) {
      if (!identifier(name) || !record(enumeration) || !strings(enumeration.cases) || !enumeration.cases.length) {
        errors.push(`Invalid native enum ${name}.`);
        continue;
      }
      const cases = enumeration.cases as string[];
      if (new Set(cases).size !== cases.length) errors.push(`Duplicate case in native enum ${name}.`);
      for (const language of ["swift", "kotlin"] as const) {
        const target = enumeration[language];
        if (
          !record(target) ||
          typeof target.type !== "string" ||
          !target.type.trim() ||
          !record(target.values) ||
          (target.imports !== undefined && !strings(target.imports))
        ) {
          errors.push(`Invalid ${language} binding for native enum ${name}.`);
          continue;
        }
        const values = target.values;
        if (
          Object.keys(values).length !== cases.length ||
          cases.some((c) => typeof values[c] !== "string" || !String(values[c]).trim())
        )
          errors.push(`Native enum ${name} needs one ${language} value per case.`);
      }
    }
  }
  if (library.references !== undefined) {
    if (!record(library.references)) return [...errors, "Native references must be a map."];
    for (const [name, reference] of Object.entries(library.references)) {
      if (!identifier(name) || !record(reference) || (!reference.swift && !reference.kotlin)) {
        errors.push(`Invalid native reference ${name}.`);
        continue;
      }
      if (reference.nativeOnly !== undefined && typeof reference.nativeOnly !== "boolean")
        errors.push(`Invalid nativeOnly flag for ${name}.`);
      const contract = reference.contract;
      if (
        contract !== undefined &&
        (!record(contract) ||
          !["owned", "external"].includes(String(contract.ownership)) ||
          !executors.has(String(contract.executor)) ||
          (contract.transferable !== undefined && typeof contract.transferable !== "boolean") ||
          (contract.close !== undefined && (typeof contract.close !== "string" || !identifier(contract.close))))
      )
        errors.push(`Invalid native object contract ${name}.`);
      for (const key of ["swiftImports", "kotlinImports"] as const)
        if (reference[key] !== undefined && !strings(reference[key])) errors.push(`Invalid ${key} for ${name}.`);
      for (const language of ["swift", "kotlin"] as const)
        if (
          reference[language] !== undefined &&
          (typeof reference[language] !== "string" || !reference[language]?.trim())
        )
          errors.push(`Invalid ${language} reference ${name}.`);
      const protocol = reference.protocol;
      if (protocol !== undefined) {
        if (!record(protocol) || !Array.isArray(protocol.methods) || !protocol.methods.length)
          errors.push(`Invalid protocol metadata for ${name}.`);
        else
          for (const method of protocol.methods) {
            if (
              !record(method) ||
              typeof method.name !== "string" ||
              !identifier(method.name) ||
              !Array.isArray(method.parameters) ||
              typeof method.result !== "string" ||
              !method.parameters.every(
                (p) => record(p) && typeof p.name === "string" && identifier(p.name) && typeof p.type === "string",
              )
            )
              errors.push(`Invalid protocol method in ${name}.`);
          }
      }
    }
  }
  if (library.native !== undefined) {
    if (!record(library.native)) return [...errors, "Native package must be an object."];
    if (library.native.capabilities !== undefined && !strings(library.native.capabilities))
      errors.push("Invalid native package capabilities.");
    for (const [language, extension] of [
      ["swift", "swift"],
      ["kotlin", "kt"],
    ] as const) {
      const sources = library.native[language];
      if (sources === undefined) continue;
      if (
        !record(sources) ||
        Object.entries(sources).some(
          ([name, source]) =>
            !new RegExp(`^[A-Za-z_][A-Za-z0-9_]*\\.${extension}$`).test(name) || typeof source !== "string",
        )
      )
        errors.push(`Invalid ${language} package sources.`);
    }
    const dependencies = library.native.dependencies;
    if (
      dependencies !== undefined &&
      (!record(dependencies) ||
        (dependencies.android !== undefined && !strings(dependencies.android)) ||
        (dependencies.pods !== undefined &&
          (!record(dependencies.pods) || Object.values(dependencies.pods).some((v) => typeof v !== "string"))))
    )
      errors.push("Invalid native package dependencies.");
  }
  return errors;
}
