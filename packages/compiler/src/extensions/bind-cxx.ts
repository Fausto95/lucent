/**
 * A C++ header's classes and enums, bound (decision 0125): each class a
 * handle class of `lucent:ext/<name>` whose members the generated C++
 * calls, its overloads expanded for default arguments, and what crosses
 * checked. What can't be bound is left out with its reason, as a C
 * header's functions are; only a class the declaration names must bind.
 */
import { type CxxHeader, type CxxParam, type CxxType, formatCxxType } from "@lucent-lang/bindgen";
import type { Affinity, ExtensionDeclaration } from "../package-config.ts";

/** A value crossing between Lucent and C++, and how. */
export type CxxValue =
  /** An integer of 32 bits or fewer, or a floating-point number: `c` is its C++ type. */
  | { kind: "number"; c: string }
  /** An integer of 64 bits. */
  | { kind: "bigint"; c: string }
  | { kind: "boolean" }
  | { kind: "string"; of: "string" | "string_view" | "chars" }
  /** A `std::vector` of `of`, whose element type C++ spells `c`. */
  | { kind: "array"; of: CxxValue; c: string }
  /** A `std::optional` of `of`, whose value type C++ spells `c`. */
  | { kind: "optional"; of: CxxValue; c: string }
  /** An enum: `name` is Lucent's, `cxx` C++'s. */
  | { kind: "enum"; name: string; cxx: string }
  /** A bound class's object: by reference or pointer as a parameter, by value as a result. */
  | {
      kind: "object";
      class: string;
      cxx: string;
      by: "value" | "ref" | "constRef" | "pointer" | "constPointer";
    };

export interface CxxParamBinding {
  /** The C++ parameter's name; `arg<i>$` when it has none. */
  name: string;
  value: CxxValue;
}

/** One overload of a constructor or member function: its parameters and its result (none for void). */
export interface CxxCallBinding {
  params: CxxParamBinding[];
  result?: CxxValue;
}

export interface ClassBinding {
  /** Its own name: the class of `lucent:ext/<name>`. */
  name: string;
  /** Its name in C++: `acme::Counter`. */
  qualified: string;
  /** Its constructor's overloads; none: Lucent code can't make one. */
  constructors: CxxCallBinding[];
  methods: { name: string; static: boolean; overloads: CxxCallBinding[] }[];
  affinity: Affinity;
}

export interface EnumBinding {
  name: string;
  qualified: string;
  values: { name: string; value: number }[];
}

/** A shape the declaration asks for that the header contradicts: its field, and why. */
export class CxxRefused extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.field = field;
  }
}

/** What a C++ type can't be bound as. */
class Unbindable extends Error {}

const unbindable = (why: string): never => {
  throw new Unbindable(why);
};

/**
 * The header's classes and enums, bound, and what was left out
 * (`name: reason`). Throws CxxRefused for a class the declaration names
 * that the header doesn't bind.
 */
export function bindCxx(
  header: CxxHeader,
  d: ExtensionDeclaration,
  file: string,
): { classes: ClassBinding[]; enums: EnumBinding[]; skipped: string[] } {
  const skipped: string[] = [...header.skipped];

  // Names Lucent code sees: a name two of them have is neither's.
  const counts = new Map<string, number>();
  for (const x of [...header.classes, ...header.enums])
    counts.set(x.name, (counts.get(x.name) ?? 0) + 1);
  const unique = (x: { name: string; qualified: string }) => {
    if (counts.get(x.name) === 1) return true;
    skipped.push(`${x.qualified}: another class or enum of the header is named ${x.name}`);
    return false;
  };

  const enums = header.enums
    .filter(unique)
    .map((e): EnumBinding => ({ name: e.name, qualified: e.qualified, values: e.values }));
  const enumNames = new Map(enums.map((e) => [e.qualified, e.name]));

  // The classes Lucent can hold: bound, with a name of their own.
  const candidates = header.classes.filter((c) => {
    if (c.refused) {
      skipped.push(`${c.name}: ${c.refused}, which Lucent doesn't bind`);
      return false;
    }
    return unique(c);
  });
  const classNames = new Map(candidates.map((c) => [c.qualified, c]));

  const value = (t: CxxType, at: "param" | "result" | "element"): CxxValue => {
    switch (t.k) {
      case "bool":
        return { kind: "boolean" };
      case "int":
        return t.bits === 64 ? { kind: "bigint", c: t.name } : { kind: "number", c: t.name };
      case "float":
        return { kind: "number", c: t.name };
      case "string":
        if (at === "result" && t.of === "chars")
          return unbindable("a const char * result: whose memory it is is unknown");
        // A container holds strings of its own: a view or a pointer would point at nothing.
        if (at === "element" && t.of !== "string")
          return unbindable(`${formatCxxType(t)} in a container`);
        return { kind: "string", of: t.of };
      case "vector": {
        const of = value(t.of, "element");
        return { kind: "array", of, c: cxxSpelling(t.of) };
      }
      case "optional": {
        const of = value(t.of, "element");
        if (of.kind === "object") return unbindable(`${formatCxxType(t)}: an optional object`);
        return { kind: "optional", of, c: cxxSpelling(t.of) };
      }
      case "enum": {
        const name = enumNames.get(t.name);
        return name
          ? { kind: "enum", name, cxx: t.name }
          : unbindable(`${t.name}, an enum Lucent doesn't bind`);
      }
      case "class": {
        const c = classNames.get(t.name);
        if (!c) return unbindable(`${t.name}, a class Lucent doesn't bind`);
        if (at === "element") return unbindable(`${formatCxxType(t)} in a container`);
        if (at === "param" && t.by === "value")
          return unbindable(`${t.name} by value: Lucent passes a class's object by reference`);
        if (at === "result" && t.by !== "value")
          return unbindable(
            `${formatCxxType(t)}: who owns the object is unknown; a result by value is a new handle`,
          );
        if (at === "result" && !c.movable)
          return unbindable(`${t.name} by value, which C++ can't move into a handle`);
        return { kind: "object", class: c.name, cxx: c.qualified, by: t.by };
      }
      case "void":
        return unbindable("void, which is no value");
      case "unknown":
        return unbindable(`${t.spelling}, which Lucent can't pass`);
    }
  };

  // Each arity a call can have: one per default argument left out, and the full one.
  const overloads = (params: CxxParam[], result: CxxType | undefined): CxxCallBinding[] => {
    const bound = params.map((p, i) => ({
      name: p.name || `arg${i}$`,
      value: value(p.type, "param"),
    }));
    const r = result && result.k !== "void" ? value(result, "result") : undefined;
    const first = params.findIndex((p) => p.defaulted);
    const arities = first < 0 ? [params.length] : range(first, params.length);

    return arities.map((n) => ({ params: bound.slice(0, n), ...(r ? { result: r } : {}) }));
  };

  // Two overloads TypeScript can't tell apart: neither, with the reason.
  const distinct = (what: string, calls: CxxCallBinding[]): CxxCallBinding[] => {
    const keys = calls.map((c) => c.params.map((p) => lucentKey(p.value)).join(", "));
    const clashing = new Set(keys.filter((k, i) => keys.indexOf(k) !== i));
    for (const k of clashing)
      skipped.push(`${what}(${k}): overloads TypeScript can't tell apart, so neither is bound`);
    return calls.filter((_, i) => !clashing.has(keys[i]!));
  };

  const classes = candidates.flatMap((c): ClassBinding[] => {
    const skip = (member: string, why: string) => skipped.push(`${c.name}.${member}: ${why}`);
    for (const s of c.skipped) skipped.push(`${c.name}.${s}`);

    const constructors = distinct(
      `new ${c.name}`,
      c.constructors.flatMap((k) => {
        try {
          return overloads(k.params, undefined);
        } catch (e) {
          if (!(e instanceof Unbindable)) throw e;
          skip("constructor", e.message);
          return [];
        }
      }),
    );

    const byName = new Map<string, { static: boolean; overloads: CxxCallBinding[] }>();
    for (const m of c.methods) {
      if (m.name === "close" || m.name === "constructor") {
        skip(m.name, `${m.name} is the handle's own`);
        continue;
      }
      // A static member and an instance member may share a name: a class's and an object's.
      const key = `${m.static ? "static " : ""}${m.name}`;
      try {
        const calls = overloads(m.params, m.result);
        const known = byName.get(key) ?? { static: m.static, overloads: [] };
        known.overloads.push(...calls);
        byName.set(key, known);
      } catch (e) {
        if (!(e instanceof Unbindable)) throw e;
        skip(m.name, e.message);
      }
    }

    const methods = [...byName].map(([key, m]) => {
      const name = key.replace(/^static /, "");
      return { name, static: m.static, overloads: distinct(`${c.name}.${name}`, m.overloads) };
    });
    // A class with nothing Lucent can call (a C struct of fields) isn't a class to Lucent.
    const bound = methods.filter((m) => m.overloads.length);
    if (!constructors.length && !bound.length) return [];

    return [
      {
        name: c.name,
        qualified: c.qualified,
        constructors,
        methods: bound,
        affinity: d.classes?.[c.name]?.affinity ?? "any",
      },
    ];
  });

  for (const name of Object.keys(d.classes ?? {}))
    if (!classes.some((c) => c.name === name))
      throw new CxxRefused(
        `classes.${name}`,
        `${file} has no class ${name} Lucent binds${skippedReason(skipped, name)}`,
      );

  return { classes, enums, skipped };
}

/** Why `name` was left out, as the rest of a sentence, when it was. */
function skippedReason(skipped: readonly string[], name: string): string {
  const why = skipped.find((s) => s.startsWith(`${name}: `));
  return why ? ` (${why.slice(name.length + 2)})` : "";
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** What TypeScript sees of a value: two overloads with the same keys are the same to it. */
function lucentKey(v: CxxValue): string {
  switch (v.kind) {
    case "number":
    case "bigint":
    case "boolean":
    case "string":
      return v.kind;
    case "array":
      return `${lucentKey(v.of)}[]`;
    case "optional":
      return `${lucentKey(v.of)} | undefined`;
    case "enum":
      return v.name;
    case "object":
      return v.class;
  }
}

/** A value type as C++ spells it, for a container's element: `std::string`, `acme::Mode`. */
function cxxSpelling(t: CxxType): string {
  switch (t.k) {
    case "string":
      return t.of === "string_view" ? "std::string_view" : "std::string";
    case "enum":
    case "class":
      return `::${t.name}`;
    default:
      return formatCxxType(t);
  }
}
