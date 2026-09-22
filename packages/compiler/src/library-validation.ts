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
  if (library.references !== undefined) {
    if (!record(library.references)) return [...errors, "Native references must be a map."];
    for (const [name, reference] of Object.entries(library.references)) {
      if (!identifier(name) || !record(reference) || (!reference.swift && !reference.kotlin)) {
        errors.push(`Invalid native reference ${name}.`);
        continue;
      }
      for (const key of ["swiftImports", "kotlinImports"] as const)
        if (reference[key] !== undefined && !strings(reference[key])) errors.push(`Invalid ${key} for ${name}.`);
      for (const language of ["swift", "kotlin"] as const)
        if (
          reference[language] !== undefined &&
          (typeof reference[language] !== "string" || !reference[language]?.trim())
        )
          errors.push(`Invalid ${language} reference ${name}.`);
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
