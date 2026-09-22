import type { IRStruct, NativeType } from "@lucent-lang/compiler";
const JS_PRIMITIVES: Readonly<Record<string, string>> = {
  view: 'import("react").ReactElement',
  void: "void",
  bool: "boolean",
  string: "string",
  bytes: "Uint8Array",
};

export function jsType(t: NativeType): string {
  switch (t.kind) {
    case "event":
      return `(${t.payload.kind === "void" ? "" : `payload: ${jsType(t.payload)}`}) => void`;
    case "float":
    case "int":
      return "number";
    case "array": {
      const element = jsType(t.element);
      return t.element.kind === "optional" ? `(${element})[]` : `${element}[]`;
    }
    case "map":
      return `Record<string, ${jsType(t.value)}>`;
    case "optional":
      return `${jsType(t.value)} | null`;
    case "struct":
      return t.name;
    case "callback":
      return `(${t.params.map((p, i) => `arg${i}: ${jsType(p)}`).join(", ")}) => ${jsType(t.result)}`;
    case "promise":
      return `Promise<${jsType(t.value)}>`;
    default:
      return JS_PRIMITIVES[t.kind]!;
  }
}

export interface ConversionPolicy {
  structs: ReadonlyMap<string, IRStruct>;
  /** Nitro represents "absent" as `undefined`, while Lucent's JS contract uses `null`. */
  nullAsUndefined: boolean;
}

/** True when values of this type need a JS-side conversion at the boundary. */
export function needsConversion(t: NativeType, policy: ConversionPolicy, seen = new Set<string>()): boolean {
  switch (t.kind) {
    case "bytes":
      return true;
    case "optional":
      return policy.nullAsUndefined || needsConversion(t.value, policy, seen);
    case "array":
      return needsConversion(t.element, policy, seen);
    case "promise":
    case "map":
      return needsConversion(t.value, policy, seen);
    case "struct": {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      return (
        !!policy.structs.get(t.name)?.reference ||
        !!policy.structs.get(t.name)?.union ||
        (policy.structs.get(t.name)?.fields.some((f) => needsConversion(f.type, policy, seen)) ?? false)
      );
    }
    default:
      return false;
  }
}

/**
 * A JS expression converting `value` of type `t` across the boundary.
 * `direction` "in" turns app values into host values (Uint8Array → ArrayBuffer); "out" is the reverse.
 */
export function convert(value: string, t: NativeType, direction: "in" | "out", policy: ConversionPolicy): string {
  if (!needsConversion(t, policy)) return value;
  switch (t.kind) {
    case "bytes":
      return direction === "in" ? `toArrayBuffer(${value})` : `fromArrayBuffer(${value})`;
    case "array":
      return `${value}.map((x) => ${convert("x", t.element, direction, policy)})`;
    case "optional": {
      const absent = policy.nullAsUndefined && direction === "in" ? "undefined" : "null";
      const inner = needsConversion(t.value, policy) ? convert(value, t.value, direction, policy) : value;
      return `(${value} == null ? ${absent} : ${inner})`;
    }
    case "promise":
      return `${value}.then((x) => ${convert("x", t.value, direction, policy)})`;
    case "map":
      return `Object.fromEntries(Object.entries(${value}).map(([k, x]) => [k, ${convert("x", t.value, direction, policy)}]))`;
    case "struct": {
      const struct = policy.structs.get(t.name)!;
      if (struct.reference)
        return `${direction === "in" ? "nativeObjectHandle" : "nativeObjectFromHandle"}(${value}, ${JSON.stringify(t.name)})`;
      if (struct.union) {
        const union = struct.union;
        const absent = policy.nullAsUndefined && direction === "in" ? "undefined" : "null";
        const cases = union.variants.map((variant) => {
          const guards = variant.fields
            .filter((f) => f.type.kind !== "optional")
            .map(
              (f) =>
                `if (u[${JSON.stringify(f.name)}] == null) throw new TypeError(${JSON.stringify(`Missing ${t.name}.${f.name}`)});`,
            )
            .join(" ");
          const fields = variant.fields.map(
            (f) => `${JSON.stringify(f.name)}: ${convert(`u[${JSON.stringify(f.name)}]`, f.type, direction, policy)}`,
          );
          if (direction === "in")
            for (const f of struct.fields) {
              if (f.name !== union.tag && !variant.fields.some((v) => v.name === f.name))
                fields.push(`${JSON.stringify(f.name)}: ${absent}`);
            }
          return `case ${JSON.stringify(variant.tag)}: ${guards} return { ${JSON.stringify(union.tag)}: ${JSON.stringify(variant.tag)}, ${fields.join(", ")} };`;
        });
        return `((u) => { if (u == null || typeof u !== "object") throw new TypeError("Expected ${t.name}"); switch (u[${JSON.stringify(union.tag)}]) { ${cases.join(" ")} default: throw new TypeError("Invalid ${t.name} tag"); } })(${value})`;
      }
      const fields = policy.structs
        .get(t.name)!
        .fields.filter((f) => needsConversion(f.type, policy))
        .map((f) => `${f.name}: ${convert(`${value}.${f.name}`, f.type, direction, policy)}`);
      return `{ ...${value}, ${fields.join(", ")} }`;
    }
    default:
      return value;
  }
}
