import { createHash } from "node:crypto";
import { safeIdentifier } from "./schema.ts";
import { nativeSymbolId, type LibraryModule } from "@lucent-lang/compiler";
export type DelegateScalar = "number" | "int32" | "boolean" | "string";
export interface DelegateMethod {
  name: string;
  parameters: { name: string; type: DelegateScalar; swiftLabel?: string }[];
  result: DelegateScalar | "void";
  /** Propagation requires a throwing Swift requirement. Fallbacks are explicit ABI policy. */
  errors:
    | { kind: "propagate"; swiftThrows: true }
    | { kind: "fallback"; value: number | boolean | string | null; reason: string };
}
export interface DelegateSchema {
  version: 1;
  name: string;
  swift: { protocol: string; imports: string[]; base?: "NSObject" };
  kotlin: { interface: string };
  methods: DelegateMethod[];
}
const types: Record<DelegateScalar | "void", { swift: string; kotlin: string }> = {
  number: { swift: "Double", kotlin: "Double" },
  int32: { swift: "Int32", kotlin: "Int" },
  boolean: { swift: "Bool", kotlin: "Boolean" },
  string: { swift: "String", kotlin: "String" },
  void: { swift: "Void", kotlin: "Unit" },
};
const identifier = (value: unknown): value is string =>
  typeof value === "string" &&
  safeIdentifier(value) &&
  ![
    "self",
    "super",
    "init",
    "deinit",
    "func",
    "fun",
    "protocol",
    "interface",
    "override",
    "object",
    "val",
    "typealias",
    "import",
  ].includes(value);
const qualified = (value: unknown): value is string => typeof value === "string" && value.split(".").every(identifier);
function fallback(method: DelegateMethod, language: "swift" | "kotlin"): string {
  if (method.errors.kind !== "fallback") throw new Error("Missing fallback policy");
  const value = method.errors.value;
  if (method.result === "void" && value === null) return "return";
  const valid =
    method.result === "boolean"
      ? typeof value === "boolean"
      : method.result === "string"
        ? typeof value === "string"
        : (method.result === "number" || method.result === "int32") &&
          typeof value === "number" &&
          Number.isFinite(value) &&
          (method.result !== "int32" || (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647));
  if (!valid) throw new Error(`Invalid fallback type for ${method.name}`);
  let literal = JSON.stringify(value);
  if (typeof value === "string")
    literal =
      '"' +
      [...value]
        .map((char) => {
          const code = char.codePointAt(0)!;
          if (char === '"' || char === "\\") return "\\" + char;
          if (language === "kotlin" && char === "$") return "\\$";
          if (code < 32 || code === 0x2028 || code === 0x2029)
            return language === "swift" ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, "0")}`;
          return char;
        })
        .join("") +
      '"';
  if (language === "kotlin" && method.result === "number" && /^-?\d+$/.test(literal)) literal += ".0";
  return `return ${literal}`;
}
const callbackType = (method: DelegateMethod) =>
  `NativeCallback<(${method.parameters.map((p) => `${p.name}:${p.type}`).join(",")})=>${method.result}>`;
const swiftCallback = (method: DelegateMethod) =>
  `(${method.parameters.map((p) => types[p.type].swift).join(", ")}) throws -> ${types[method.result].swift}`;
const kotlinCallback = (method: DelegateMethod) =>
  `(${method.parameters.map((p) => types[p.type].kotlin).join(", ")}) -> ${types[method.result].kotlin}`;

/** Curated protocol metadata in; concrete conformances and a public library manifest out. */
export function generateDelegateLibrary(schema: DelegateSchema): { library: LibraryModule; declarations: string } {
  if (
    !schema ||
    schema.version !== 1 ||
    !identifier(schema.name) ||
    !qualified(schema.swift?.protocol) ||
    !qualified(schema.kotlin?.interface) ||
    !Array.isArray(schema.swift.imports) ||
    !schema.swift.imports.every(qualified) ||
    (schema.swift.base !== undefined && schema.swift.base !== "NSObject") ||
    !Array.isArray(schema.methods) ||
    !schema.methods.length
  )
    throw new Error("Invalid delegate schema");
  const names = new Set<string>();
  for (const method of schema.methods) {
    if (
      !identifier(method.name) ||
      names.has(method.name) ||
      !Array.isArray(method.parameters) ||
      !Object.hasOwn(types, method.result)
    )
      throw new Error("Invalid or duplicate delegate method");
    names.add(method.name);
    const parameters = new Set<string>();
    for (const p of method.parameters) {
      if (
        !identifier(p.name) ||
        parameters.has(p.name) ||
        !Object.hasOwn(types, p.type) ||
        (p.type as string) === "void" ||
        (p.swiftLabel !== undefined && p.swiftLabel !== "_" && !identifier(p.swiftLabel))
      )
        throw new Error(`Invalid parameter in ${method.name}`);
      parameters.add(p.name);
    }
    if (method.errors?.kind === "fallback") {
      if (typeof method.errors.reason !== "string" || !method.errors.reason.trim())
        throw new Error(`Fallback for ${method.name} requires a reason`);
      fallback(method, "swift");
      fallback(method, "kotlin");
    } else if (method.errors?.kind !== "propagate" || method.errors.swiftThrows !== true)
      throw new Error(`Explicit callback error policy required for ${method.name}`);
  }
  const nativeName = `LucentDelegate_${createHash("sha256").update(JSON.stringify(schema)).digest("hex").slice(0, 16)}`;
  const swiftMethods = schema.methods.map((method) => {
    const params = method.parameters.map((p) => `${p.swiftLabel ?? "_"} ${p.name}: ${types[p.type].swift}`).join(", ");
    const invocation = `${method.result === "void" ? "" : "return "}try lucent_${method.name}(${method.parameters.map((p) => p.name).join(", ")})`;
    const body =
      method.errors.kind === "propagate" ? invocation : `do { ${invocation} } catch { ${fallback(method, "swift")} }`;
    return `  func ${method.name}(${params})${method.errors.kind === "propagate" ? " throws" : ""} -> ${types[method.result].swift} { ${body} }`;
  });
  const kotlinMethods = schema.methods.map((method) => {
    const params = method.parameters.map((p) => `${p.name}: ${types[p.type].kotlin}`).join(", ");
    const invocation = `${method.result === "void" ? "" : "return "}lucent_${method.name}(${method.parameters.map((p) => p.name).join(", ")})`;
    const body =
      method.errors.kind === "propagate"
        ? invocation
        : `try { ${invocation} } catch (error: Exception) { ${fallback(method, "kotlin")} }`;
    return `  override fun ${method.name}(${params}): ${types[method.result].kotlin} { ${body} }`;
  });
  const swift =
    [...new Set([...schema.swift.imports, ...(schema.swift.base ? ["Foundation"] : [])])]
      .map((i) => `import ${i}`)
      .join("\n") +
    `\nfinal class ${nativeName}: ${schema.swift.base ? schema.swift.base + ", " : ""}${schema.swift.protocol} {\n${schema.methods.map((m) => `  private let lucent_${m.name}: ${swiftCallback(m)}`).join("\n")}\n  init(${schema.methods.map((m) => `${m.name}: @escaping ${swiftCallback(m)}`).join(", ")}) {\n${schema.methods.map((m) => `    self.lucent_${m.name} = ${m.name}`).join("\n")}\n${schema.swift.base ? "    super.init()\n" : ""}  }\n${swiftMethods.join("\n")}\n}\n`;
  const kotlin = `package {{androidPackage}}\nclass ${nativeName}(${schema.methods.map((m) => `private val lucent_${m.name}: ${kotlinCallback(m)}`).join(", ")}): ${schema.kotlin.interface} {\n${kotlinMethods.join("\n")}\n}\n`;
  const params = schema.methods.map((m) => `${m.name}:${callbackType(m)}`).join(",");
  const prefix = 'import type {NativeCallback,int32} from "@lucent-lang/core/types";\n';
  return {
    library: {
      schemaVersion: 1,
      source:
        prefix +
        `export type ${schema.name}={};\nexport declare function ${schema.name}__create(${params}):${schema.name};`,
      references: {
        [schema.name]: {
          nativeOnly: true,
          swift: nativeName,
          kotlin: nativeName,
          contract: { ownership: "owned", executor: "caller" },
        },
      },
      bindings: {
        [`${schema.name}__create`]: {
          nativeOnly: true,
          contract: {
            symbolId: nativeSymbolId("delegate", schema.name, "init", nativeName),
            result: "owned",
            parameters: Object.fromEntries(
              schema.methods.map((m) => [
                m.name,
                {
                  ownership: "retained",
                  callback: { retention: "subscription", executor: "caller", errors: "propagate" },
                },
              ]),
            ),
          },
          swift: [`return ${nativeName}(${schema.methods.map((m) => `${m.name}: ${m.name}`).join(", ")})`],
          kotlin: [`return ${nativeName}(${schema.methods.map((m) => m.name).join(", ")})`],
        },
      },
      native: { swift: { [`${nativeName}.swift`]: swift }, kotlin: { [`${nativeName}.kt`]: kotlin } },
    },
    declarations:
      prefix +
      `/** Compiled-only native delegate; retain it for the SDK registration lifetime. */\nexport declare class ${schema.name} { constructor(${params}); }\n`,
  };
}
