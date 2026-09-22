import type { LibraryModule, NativeBinding } from "@lucent-lang/compiler";
export type SDKPlatform = "ios" | "android";
export interface SDKParameter {
  name: string;
  nativeType: string;
  label?: string;
}
export interface SDKFunction {
  name: string;
  nativeName: string;
  parameters: SDKParameter[];
  returnType: string;
  throws?: boolean;
}
export interface SDKClass {
  name: string;
  nativeName: string;
  constructor: { parameters: SDKParameter[]; throws?: boolean };
  properties: { name: string; nativeType: string; getter?: string; setter?: string }[];
  /** Distinct public names explicitly select native overloads. */
  methods: SDKFunction[];
}
export interface SDKSchema {
  classes?: SDKClass[];
  version: 1;
  platform: SDKPlatform;
  module: string;
  functions: SDKFunction[];
  diagnostics: string[];
}
interface Mapping {
  lucent: string;
  argument: (value: string) => string;
  result: (value: string) => string;
}
const identity = (value: string) => value;
const mapping = (lucent: string, argument = identity, result = identity): Mapping => ({ lucent, argument, result });
const swiftTypes: Record<string, Mapping> = {
  Double: mapping("number"),
  String: mapping("string"),
  Bool: mapping("boolean"),
  Void: mapping("void"),
  "()": mapping("void"),
  Int32: mapping("int32"),
};
const javaTypes: Record<string, Mapping> = {
  double: mapping("number"),
  boolean: mapping("boolean"),
  int: mapping("int32"),
  void: mapping("void"),
  "java.lang.String": mapping("string"),
  String: mapping("string"),
};
const types = (platform: SDKPlatform) => (platform === "ios" ? swiftTypes : javaTypes);
const nativeType = (name: string) => name.trim().replace(/^Swift\./, "");
const safeIdentifier = (name: string) =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
  ![
    "default",
    "return",
    "class",
    "function",
    "new",
    "var",
    "let",
    "const",
    "delete",
    "switch",
    "case",
    "throw",
    "try",
    "catch",
    "repeat",
    "when",
    "is",
    "in",
  ].includes(name);
function validate(schema: SDKSchema): SDKSchema {
  const names = new Map<string, number>();
  for (const f of schema.functions) names.set(f.name, (names.get(f.name) ?? 0) + 1);
  schema.functions = schema.functions.filter((f) => {
    if ((names.get(f.name) ?? 0) > 1) {
      schema.diagnostics.push(`Skipped ${f.name}: overload selection is required`);
      return false;
    }
    if (!safeIdentifier(f.name) || f.parameters.some((p) => !safeIdentifier(p.name))) {
      schema.diagnostics.push(`Skipped ${f.name}: unsupported identifier`);
      return false;
    }
    if (
      !types(schema.platform)[nativeType(f.returnType)] ||
      f.parameters.some((p) => !types(schema.platform)[nativeType(p.nativeType)])
    ) {
      schema.diagnostics.push(`Skipped ${f.name}: unsupported SDK type`);
      return false;
    }
    return true;
  });
  return schema;
}
/** Declaration-only Swift interface subset. Unsupported APIs are reported, never guessed. */
export function extractSwiftInterface(source: string, module: string): SDKSchema {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(module)) throw new Error("Invalid Swift module");
  const schema: SDKSchema = { version: 1, platform: "ios", module, functions: [], diagnostics: [] };
  let depth = 0;
  let availability = false;
  for (const line of source.split("\n")) {
    const text = line.trim();
    if (text.startsWith("@")) availability = true;
    if (/\bfunc\b/.test(text)) {
      const match = /^public func (\w+)\(([^()]*)\)\s*(throws\s*)?(?:->\s*([^{}]+))?;?$/.exec(text);
      if (!match || depth !== 0 || availability) schema.diagnostics.push(`Skipped Swift declaration: ${text}`);
      else {
        const params: SDKParameter[] = [];
        let valid = true;
        for (const item of match[2]!.split(",").filter((p) => p.trim())) {
          const param = /^\s*(?:(\w+)\s+)?(\w+)\s*:\s*([\w.]+)\s*$/.exec(item);
          if (!param) {
            valid = false;
            break;
          }
          params.push({ name: param[2]!, label: param[1] ?? param[2]!, nativeType: param[3]! });
        }
        if (valid)
          schema.functions.push({
            name: match[1]!,
            nativeName: `${module}.${match[1]!}`,
            parameters: params,
            returnType: match[4]?.trim() ?? "Void",
            throws: !!match[3],
          });
        else schema.diagnostics.push(`Skipped ${match[1]}: unsupported parameters`);
      }
      availability = false;
    }
    depth += (text.match(/{/g)?.length ?? 0) - (text.match(/}/g)?.length ?? 0);
  }
  return validate(schema);
}
/** Consumes javap -public output from android.jar or another trusted SDK classpath. */
export function extractJavaSignatures(source: string): SDKSchema {
  const owner = /\b(?:class|interface)\s+([\w.$]+)/.exec(source)?.[1];
  if (!owner) throw new Error("Expected javap public class signatures");
  const schema: SDKSchema = { version: 1, platform: "android", module: owner, functions: [], diagnostics: [] };
  for (const line of source.split("\n")) {
    if (!line.includes("(")) continue;
    const match = /^\s*public static (?:final )?([\w.]+) (\w+)\(([^()]*)\)(?: throws [\w., ]+)?;\s*$/.exec(line);
    if (!match) {
      schema.diagnostics.push(`Skipped instance or unsupported Java member: ${line.trim()}`);
      continue;
    }
    schema.functions.push({
      name: match[2]!,
      nativeName: `${owner.replaceAll("$", ".")}.${match[2]!}`,
      parameters: match[3]!
        .split(",")
        .filter((p) => p.trim())
        .map((type, i) => ({ name: `arg${i}`, nativeType: type.trim() })),
      returnType: match[1]!,
    });
  }
  return validate(schema);
}
export function generateBindingLibrary(schema: SDKSchema): { library: LibraryModule; declarations: string } {
  const signatures: string[] = [];
  const bindings: Record<string, NativeBinding> = {};
  for (const fn of schema.functions) {
    const table = types(schema.platform);
    const ret = table[nativeType(fn.returnType)];
    if (!ret || fn.parameters.some((p) => !table[nativeType(p.nativeType)]))
      throw new Error(`Unsupported schema type in ${fn.name}`);
    const params = fn.parameters.map((p) => `${p.name}: ${table[nativeType(p.nativeType)]!.lucent}`).join(", ");
    signatures.push(`export declare function ${fn.name}(${params}): ${ret.lucent};`);
    const args = fn.parameters
      .map((p) => {
        const value = table[nativeType(p.nativeType)]!.argument(p.name);
        return schema.platform === "ios" && p.label && p.label !== "_" ? `${p.label}: ${value}` : value;
      })
      .join(", ");
    const invocation = `${schema.platform === "ios" && fn.throws ? "try " : ""}${fn.nativeName}(${args})`;
    const body = [ret.lucent === "void" ? invocation : `return ${ret.result(invocation)}`];
    bindings[fn.name] = {
      platforms: [schema.platform],
      swift: schema.platform === "ios" ? body : ['throw LucentError(code: "PLATFORM_UNAVAILABLE")'],
      kotlin: schema.platform === "android" ? body : ['throw LucentError("PLATFORM_UNAVAILABLE")'],
      ...(schema.platform === "ios" ? { swiftImports: [schema.module] } : {}),
    };
  }
  const references: NonNullable<LibraryModule["references"]> = {};
  const declarations: string[] = [];
  const table = { ...types(schema.platform) };
  for (const cls of schema.classes ?? []) {
    if (!safeIdentifier(cls.name) || !/^[A-Za-z_][\w.]*(?:\$[\w]+)*$/.test(cls.nativeName))
      throw new Error("Invalid SDK class identifier");
    if (references[cls.name]) throw new Error(`Duplicate SDK class ${cls.name}`);
    references[cls.name] =
      schema.platform === "ios"
        ? { swift: cls.nativeName, swiftImports: [schema.module] }
        : { kotlin: cls.nativeName.replaceAll("$", ".") };
    table[nativeType(cls.nativeName)] = mapping(cls.name);
  }
  const mapped = (name: string): Mapping => {
    const value = table[nativeType(name)];
    if (!value) throw new Error(`Unsupported SDK type ${name}`);
    return value;
  };
  const parameters = (params: SDKParameter[]) =>
    params
      .map((p) => {
        if (!safeIdentifier(p.name)) throw new Error(`Invalid SDK parameter ${p.name}`);
        return `${p.name}: ${mapped(p.nativeType).lucent}`;
      })
      .join(", ");
  const argumentsFor = (params: SDKParameter[]) =>
    params
      .map((p) => {
        const value = mapped(p.nativeType).argument(p.name);
        return schema.platform === "ios" && p.label && p.label !== "_" ? `${p.label}: ${value}` : value;
      })
      .join(", ");
  const bind = (name: string, params: string, result: string, body: string) => {
    if (bindings[name]) throw new Error(`Duplicate SDK operation ${name}`);
    signatures.push(`export declare function ${name}(${params}): ${result};`);
    bindings[name] = {
      platforms: [schema.platform],
      swift: schema.platform === "ios" ? [body] : [],
      kotlin: schema.platform === "android" ? [body] : [],
      ...(schema.platform === "ios" ? { swiftImports: [schema.module] } : {}),
    };
  };
  for (const cls of schema.classes ?? []) {
    const fields = cls.properties.map((p) => `${p.name}: ${mapped(p.nativeType).lucent}`).join("; ");
    signatures.push(`export type ${cls.name} = {${fields}};`);
    const ctor = cls.constructor;
    bind(
      `${cls.name}__create`,
      parameters(ctor.parameters),
      cls.name,
      `return ${schema.platform === "ios" && ctor.throws ? "try " : ""}${cls.nativeName.replaceAll("$", ".")}(${argumentsFor(ctor.parameters)})`,
    );
    const members: string[] = [];
    const names = new Set<string>();
    for (const p of cls.properties) {
      if (!safeIdentifier(p.name) || names.has(p.name)) throw new Error(`Invalid or duplicate SDK member ${p.name}`);
      names.add(p.name);
      const type = mapped(p.nativeType);
      bind(
        `${cls.name}__get_${p.name}`,
        `lucentSelf: ${cls.name}`,
        type.lucent,
        `return ${type.result(`lucentSelf.${p.getter ?? p.name}`)}`,
      );
      if (p.setter)
        bind(
          `${cls.name}__set_${p.name}`,
          `lucentSelf: ${cls.name}, value: ${type.lucent}`,
          "void",
          p.setter.includes("{value}")
            ? p.setter.replaceAll("{self}", "lucentSelf").replaceAll("{value}", type.argument("value"))
            : `lucentSelf.${p.setter} = ${type.argument("value")}`,
        );
      members.push(`${p.setter ? "" : "readonly "}${p.name}: ${type.lucent};`);
    }
    for (const fn of cls.methods) {
      if (!safeIdentifier(fn.name) || !safeIdentifier(fn.nativeName) || names.has(fn.name))
        throw new Error(`Invalid or duplicate SDK member ${fn.name}`);
      names.add(fn.name);
      const result = mapped(fn.returnType);
      const call = `${schema.platform === "ios" && fn.throws ? "try " : ""}lucentSelf.${fn.nativeName}(${argumentsFor(fn.parameters)})`;
      bind(
        `${cls.name}__method_${fn.name}`,
        [`lucentSelf: ${cls.name}`, parameters(fn.parameters)].filter(Boolean).join(", "),
        result.lucent,
        result.lucent === "void" ? call : `return ${result.result(call)}`,
      );
      members.push(`${fn.name}(${parameters(fn.parameters)}): ${result.lucent};`);
    }
    declarations.push(
      `export declare class ${cls.name} { constructor(${parameters(ctor.parameters)}); dispose():void; ${members.join(" ")} }`,
    );
  }
  const prefix = signatures.some((s) => s.includes("int32")) ? 'import type {int32} from "@lucent-lang/types";\n' : "";
  const source = prefix + signatures.join("\n") + "\n";
  return {
    library: { source, bindings, ...(schema.classes?.length ? { references } : {}) },
    declarations:
      prefix +
      signatures.filter((s) => !s.startsWith("export type ") && !s.includes("__")).join("\n") +
      "\n" +
      declarations.join("\n"),
  };
}
