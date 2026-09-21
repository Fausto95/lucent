import { diagnostic, type Diagnostic } from "../diagnostics/index.ts";
import type { SurfaceType } from "../parser/surface.ts";
import { SIZED_NUMERIC_TYPES, T, type NativeType } from "./native-type.ts";

export interface TypeScope {
  /** Struct names declared by type aliases in the module. */
  readonly structs: ReadonlySet<string>;
  /** Sized numeric names imported from `@lucent/types`. */
  readonly sized: ReadonlySet<string>;
}

export type ResolveResult = { ok: true; type: NativeType } | { ok: false; diagnostic: Diagnostic };

const ok = (type: NativeType): ResolveResult => ({ ok: true, type });
const fail = (d: Diagnostic): ResolveResult => ({ ok: false, diagnostic: d });

const KEYWORDS: Readonly<Record<string, NativeType>> = {
  number: T.float64,
  string: T.string,
  boolean: T.bool,
  void: T.void,
};

const PROHIBITED_KEYWORDS: ReadonlySet<string> = new Set(["any", "unknown"]);

/** Builtin generic references: arity and how to build the type from resolved arguments. */
const GENERICS: Readonly<Record<string, { arity: number; build: (args: NativeType[]) => NativeType }>> = {
  Array: { arity: 1, build: ([e]) => T.array(e!) },
  Promise: { arity: 1, build: ([v]) => T.promise(v!) },
  Record: { arity: 2, build: ([, v]) => T.map(v!) },
};

const BUILTIN_REFERENCES: Readonly<Record<string, NativeType>> = {
  Uint8Array: T.bytes,
};

export function resolveType(type: SurfaceType, scope: TypeScope): ResolveResult {
  switch (type.kind) {
    case "keyword": {
      const builtin = KEYWORDS[type.name];
      if (builtin) return ok(builtin);
      if (PROHIBITED_KEYWORDS.has(type.name)) {
        return fail(
          diagnostic(
            "NT1004",
            type.span,
            `Native functions cannot expose \`${type.name}\`.`,
            "Lucent needs to know the exact memory representation of every value crossing the native boundary. Use a concrete type such as `string`, `number`, or a struct type alias.",
          ),
        );
      }
      if (type.name === "null" || type.name === "undefined") {
        return fail(diagnostic("NT1003", type.span, `\`${type.name}\` is only supported as part of \`T | ${type.name}\`.`));
      }
      return fail(diagnostic("NT1003", type.span, `\`${type.name}\` has no native representation.`));
    }
    case "reference":
      return resolveReference(type, scope);
    case "array": {
      const element = resolveType(type.element, scope);
      return element.ok ? ok(T.array(element.type)) : element;
    }
    case "union":
      return resolveUnion(type, scope);
    case "object":
      return fail(diagnostic("NT1003", type.span, "Inline object types are not supported.", "Declare a type alias: `type Name = { … }` and use `Name` here."));
    case "function":
      return fail(
        diagnostic("NT1005", type.span, "Function values cannot cross the native boundary.", "Native code has no representation for JavaScript closures. Pass data instead."),
      );
    case "unsupported":
      return fail(diagnostic("NT1003", type.span, `${capitalize(type.description)} has no native representation.`));
  }
}

function resolveReference(type: Extract<SurfaceType, { kind: "reference" }>, scope: TypeScope): ResolveResult {
  const generic = GENERICS[type.name];
  if (generic) {
    if (type.args.length !== generic.arity) {
      return fail(diagnostic("NT1003", type.span, `\`${type.name}\` expects ${generic.arity} type argument${generic.arity === 1 ? "" : "s"}.`));
    }
    if (type.name === "Record") {
      const key = type.args[0]!;
      if (key.kind !== "keyword" || key.name !== "string") {
        return fail(diagnostic("NT1003", key.span, "`Record` keys must be `string`.", "Native maps are keyed by strings; use `Record<string, T>`."));
      }
    }
    const args: NativeType[] = [];
    for (const arg of type.args) {
      const resolved = resolveType(arg, scope);
      if (!resolved.ok) return resolved;
      args.push(resolved.type);
    }
    return ok(generic.build(args));
  }
  if (type.args.length > 0) return fail(diagnostic("NT1003", type.span, `\`${type.name}\` is not a supported generic type.`));
  const builtin = BUILTIN_REFERENCES[type.name];
  if (builtin) return ok(builtin);
  if (scope.sized.has(type.name) && SIZED_NUMERIC_TYPES[type.name]) return ok(SIZED_NUMERIC_TYPES[type.name]!);
  if (scope.structs.has(type.name)) return ok(T.struct(type.name));
  const sizedHint = SIZED_NUMERIC_TYPES[type.name] ? ` Import it: \`import type { ${type.name} } from "@lucent/types";\`.` : "";
  return fail(diagnostic("NT1003", type.span, `Unknown type \`${type.name}\`.`, sizedHint || "Declare it as a type alias in this module."));
}

function resolveUnion(type: Extract<SurfaceType, { kind: "union" }>, scope: TypeScope): ResolveResult {
  const isNullish = (m: SurfaceType) => m.kind === "keyword" && (m.name === "null" || m.name === "undefined");
  const values = type.members.filter((m) => !isNullish(m));
  if (values.length !== 1 || values.length === type.members.length) {
    return fail(
      diagnostic(
        "NT1003",
        type.span,
        "Unions are only supported in the form `T | null` or `T | undefined`.",
        "Arbitrary unions have no single native representation. Use an optional or a struct with a discriminating field.",
      ),
    );
  }
  const inner = resolveType(values[0]!, scope);
  return inner.ok ? ok(T.optional(inner.type)) : inner;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
