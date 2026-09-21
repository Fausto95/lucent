/** Lucent's own type model. Nothing downstream of the resolver sees TypeScript types. */
export type IntBits = 8 | 16 | 32 | 64;
export type FloatBits = 32 | 64;

export type NativeType =
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
  | { readonly kind: "struct"; readonly name: string; readonly variant?: string }
  | { readonly kind: "promise"; readonly value: NativeType };

export const T = {
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
  struct: (name: string): NativeType => ({ kind: "struct", name }),
  promise: (value: NativeType): NativeType => ({ kind: "promise", value }),
} as const;

/** Names of the sized numeric types exported by `@lucent-lang/types`, mapped to their native type. */
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
