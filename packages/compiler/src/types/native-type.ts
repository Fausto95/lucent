import type { NativeExecutor } from "../native-contracts.ts";
/** Lucent's own type model. Nothing downstream of the resolver sees TypeScript types. */
export type IntBits = 8 | 16 | 32 | 64;
export type FloatBits = 32 | 64;

/** One target's spelling of an SDK enum: its native type and a native expression per case. */
export interface NativeEnumTarget {
  readonly type: string;
  readonly values: Readonly<Record<string, string>>;
  readonly imports?: readonly string[];
}

/**
 * An SDK enum or option set declared by a package manifest. Cases are ordinary
 * string literals in Lucent source and cross into JavaScript as those strings;
 * native code only ever sees the target's own value.
 */
export interface NativeEnumBinding {
  readonly cases: readonly string[];
  readonly swift: NativeEnumTarget;
  readonly kotlin: NativeEnumTarget;
}

export type NativeType =
  | {
      readonly kind: "callback";
      readonly params: NativeType[];
      readonly result: NativeType;
      readonly executor?: NativeExecutor;
    }
  | { readonly kind: "event"; readonly payload: NativeType }
  | { readonly kind: "view" }
  | { readonly kind: "void" }
  | { readonly kind: "bool" }
  | { readonly kind: "string" }
  | { readonly kind: "bytes" }
  | { readonly kind: "float"; readonly bits: FloatBits }
  | { readonly kind: "int"; readonly bits: IntBits; readonly signed: boolean }
  | { readonly kind: "array"; readonly element: NativeType }
  | { readonly kind: "map"; readonly value: NativeType }
  | { readonly kind: "optional"; readonly value: NativeType }
  | { readonly kind: "enum"; readonly name: string; readonly binding: NativeEnumBinding }
  | { readonly kind: "struct"; readonly name: string; readonly variant?: string }
  | { readonly kind: "promise"; readonly value: NativeType };

export const T = {
  callback: (params: NativeType[], result: NativeType, executor?: NativeExecutor): NativeType => ({
    kind: "callback",
    params,
    result,
    ...(executor && executor !== "caller" ? { executor } : {}),
  }),
  event: (payload: NativeType): NativeType => ({ kind: "event", payload }),
  view: { kind: "view" } as NativeType,
  void: { kind: "void" } as NativeType,
  bool: { kind: "bool" } as NativeType,
  string: { kind: "string" } as NativeType,
  bytes: { kind: "bytes" } as NativeType,
  float64: { kind: "float", bits: 64 } as NativeType,
  float32: { kind: "float", bits: 32 } as NativeType,
  int: (bits: IntBits, signed = true): NativeType => ({ kind: "int", bits, signed }),
  array: (element: NativeType): NativeType => ({ kind: "array", element }),
  map: (value: NativeType): NativeType => ({ kind: "map", value }),
  optional: (value: NativeType): NativeType => (value.kind === "optional" ? value : { kind: "optional", value }),
  enumeration: (name: string, binding: NativeEnumBinding): NativeType => ({ kind: "enum", name, binding }),
  struct: (name: string): NativeType => ({ kind: "struct", name }),
  promise: (value: NativeType): NativeType => ({ kind: "promise", value }),
} as const;

/** Names of the sized numeric types exported by `@lucent-lang/core/types`, mapped to their native type. */
export const SIZED_NUMERIC_TYPES: Readonly<Record<string, NativeType>> = {
  int8: T.int(8),
  int16: T.int(16),
  int32: T.int(32),
  int64: T.int(64),
  uint8: T.int(8, false),
  uint16: T.int(16, false),
  uint32: T.int(32, false),
  uint64: T.int(64, false),
  float32: T.float32,
  float64: T.float64,
};

export function typeToString(t: NativeType): string {
  switch (t.kind) {
    case "callback":
      return `callback<(${t.params.map(typeToString).join(",")})=>${typeToString(t.result)}>${t.executor && t.executor !== "caller" ? `@${t.executor}` : ""}`;
    case "event":
      return `event<${typeToString(t.payload)}>`;
    case "float":
      return `float${t.bits}`;
    case "int":
      return `${t.signed ? "" : "u"}int${t.bits}`;
    case "array":
      return `array<${typeToString(t.element)}>`;
    case "map":
      return `map<${typeToString(t.value)}>`;
    case "optional":
      return `optional<${typeToString(t.value)}>`;
    case "promise":
      return `promise<${typeToString(t.value)}>`;
    case "enum":
      return `enum ${t.name}`;
    case "struct":
      return `struct ${t.name}`;
    default:
      return t.kind;
  }
}

export function typeEquals(a: NativeType, b: NativeType): boolean {
  return typeToString(a) === typeToString(b);
}

export const isNumeric = (t: NativeType): boolean => t.kind === "float" || t.kind === "int";

/** Enum values are strings everywhere but native code, so they interpolate and compare like strings. */
export const isTextual = (t: NativeType): boolean => t.kind === "string" || t.kind === "enum";
