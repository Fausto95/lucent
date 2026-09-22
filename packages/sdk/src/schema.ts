export type SDKPlatform = "ios" | "android";
export interface SDKParameter {
  name: string;
  nativeType: string;
  label?: string;
}
export interface SDKFunction {
  /** Compiler-produced stable SDK identity, when structured metadata supplies it. */
  nativeId?: string;
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
  coverage?: { symbolId: string; name: string; kind: string; status: "supported" | "skipped"; reason?: string }[];
  extraction?: {
    adapter: string;
    version: number;
    inputHash: string;
    generator: string;
    format: string;
    platform?: unknown;
  };
  classes?: SDKClass[];
  version: 1;
  platform: SDKPlatform;
  module: string;
  functions: SDKFunction[];
  diagnostics: string[];
}
export interface Mapping {
  lucent: string;
  argument: (value: string) => string;
  result: (value: string) => string;
}
const identity = (value: string) => value;
export const mapping = (lucent: string, argument = identity, result = identity): Mapping => ({
  lucent,
  argument,
  result,
});
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
export const types = (platform: SDKPlatform) => (platform === "ios" ? swiftTypes : javaTypes);
export const nativeType = (name: string) => name.trim().replace(/^Swift\./, "");
export const safeIdentifier = (name: string) =>
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
export function validateSDKSchema(schema: SDKSchema): SDKSchema {
  schema.functions = schema.functions.filter((f) => {
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
