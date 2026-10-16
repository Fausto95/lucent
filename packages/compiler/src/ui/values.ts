/**
 * The plain data a view's boundary carries, from checked types: numbers,
 * strings, booleans, string literal unions, arrays and plain objects, each
 * possibly null; and in a prop, an instance of an exported Lucent class,
 * which crosses as its id (decision 0075). What cannot cross (native
 * objects, functions, promises) is refused by the analysis's transfer
 * rule; what could cross to a compute task but has no Fabric props
 * representation (bigints, dates, maps, other class instances) is refused
 * here.
 */
import ts from "typescript";
import type { TransferProblem } from "../analysis/index.ts";
import { isLibFile } from "../program.ts";
import type { ViewField, ViewType } from "./contract.ts";

/** Where in a value the problem is (`range.min`, `marks[i]`), and what it is, after "is". */
export interface Problem {
  readonly path: string;
  readonly text: string;
}

export type Converted<T> = { readonly ok: T } | { readonly problem: Problem };

const PLAIN = "views take plain data (numbers, strings, booleans, arrays and plain objects)";

const EMPTY = ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void;

/** Where a value must be present: an array's element, a command's result. */
export const UNDEFINED = "a value that may be undefined: use null for a missing value";

type Transfer = (type: ts.Type, path: string) => TransferProblem | undefined;

/**
 * A Lucent class: its id (`<module>.<name>`), its Lucent module's name and
 * whether the module exports it; none for a class Lucent code does not
 * declare.
 */
export type InstanceClass = (
  decl: ts.ClassDeclaration,
) => { readonly id: string; readonly module: string; readonly exported: boolean } | undefined;

/** Whether `t` is JavaScript's Date, which its library declares. */
export function isDateType(t: ts.Type): boolean {
  const symbol = t.getSymbol() ?? t.aliasSymbol;
  const decl = symbol?.declarations?.[0];

  return symbol?.name === "Date" && !!decl && isLibFile(decl.getSourceFile());
}

export class ViewTypes {
  private readonly checker: ts.TypeChecker;
  private readonly transfer: Transfer;
  private readonly instanceClass: InstanceClass;
  /** The object types being converted, outermost first: meeting one again is a cycle. */
  private readonly visiting = new Set<ts.Type>();
  /** Whether what is converted is a prop's: an instance may be one. */
  private inProp = false;

  /** Whether a `Date` is a value: a widget's body's, as WidgetKit draws it once (decision 0124). */
  private readonly dates: boolean;

  constructor(
    checker: ts.TypeChecker,
    transfer: Transfer,
    instanceClass: InstanceClass = () => undefined,
    options: { dates?: boolean } = {},
  ) {
    this.checker = checker;
    this.transfer = transfer;
    this.instanceClass = instanceClass;
    this.dates = !!options.dates;
  }

  /** A component's prop: a field, which may hold instances of exported classes. */
  prop(symbol: ts.Symbol, path: string): Converted<ViewField> {
    this.inProp = true;

    try {
      return this.field(symbol, path);
    } finally {
      this.inProp = false;
    }
  }

  /** A property of an object type (a prop, a field), named by `path`; undefined makes it optional. */
  field(symbol: ts.Symbol, path: string): Converted<ViewField> {
    const type = this.checker.getTypeOfSymbol(symbol);
    const optional = !!(symbol.flags & ts.SymbolFlags.Optional) || maybeUndefined(type);
    const value = this.value(this.checker.getNonNullableType(type), path, nullable(type));

    return "ok" in value ? { ok: { name: symbol.getName(), type: value.ok, optional } } : value;
  }

  /** A function's parameter, named by its own name; undefined makes it optional. */
  param(symbol: ts.Symbol): Converted<ViewField> {
    const decl = symbol.valueDeclaration;
    const type = this.checker.getTypeOfSymbol(symbol);
    const declared = !!decl && ts.isParameter(decl) && !!(decl.questionToken || decl.initializer);
    const optional = declared || maybeUndefined(type);

    if (decl && ts.isParameter(decl) && decl.dotDotDotToken)
      return { problem: { path: symbol.getName(), text: `a rest parameter: ${PLAIN}` } };

    const value = this.value(
      this.checker.getNonNullableType(type),
      symbol.getName(),
      nullable(type),
    );

    return "ok" in value ? { ok: { name: symbol.getName(), type: value.ok, optional } } : value;
  }

  /** A value of `type` at `path`; `orNull`: null is one of its values. */
  value(type: ts.Type, path: string, orNull = false): Converted<ViewType> {
    const inner = this.present(type, path);

    if (!("ok" in inner) || !orNull) return inner;

    return { ok: { k: "nullable", inner: inner.ok } };
  }

  private present(t: ts.Type, path: string): Converted<ViewType> {
    const c = this.checker;
    const f = t.flags;

    if (f & ts.TypeFlags.BooleanLike) return { ok: { k: "boolean" } };

    if (f & ts.TypeFlags.NumberLike) return { ok: { k: "number" } };

    if (f & ts.TypeFlags.String) return { ok: { k: "string" } };

    if (f & ts.TypeFlags.StringLiteral)
      return { ok: { k: "enum", values: [(t as ts.StringLiteralType).value] } };

    if (f & ts.TypeFlags.BigIntLike)
      return problem(path, "a bigint, which view props cannot carry: pass a number or a string");

    if (t.isUnion()) return this.union(t, path);

    if (f & EMPTY) return problem(path, `always \`${c.typeToString(t)}\`: ${PLAIN}`);

    if (t.getCallSignatures().length)
      return problem(path, "a function: only a top-level prop can be an event");

    if (c.isArrayType(t)) {
      const [element] = c.getTypeArguments(t as ts.TypeReference);

      if (maybeUndefined(element!)) return problem(`${path}[i]`, UNDEFINED);

      const value = this.value(c.getNonNullableType(element!), `${path}[i]`, nullable(element!));

      return "ok" in value ? { ok: { k: "array", element: value.ok } } : value;
    }

    if (c.isTupleType(t)) return problem(path, `a tuple: ${PLAIN}`);

    return this.object(t, path);
  }

  /** A union: of booleans, of numbers, of string literals, or not one type. */
  private union(t: ts.UnionType, path: string): Converted<ViewType> {
    const all = (flags: ts.TypeFlags) => t.types.every((m) => m.flags & flags);

    if (all(ts.TypeFlags.BooleanLiteral)) return { ok: { k: "boolean" } };

    if (all(ts.TypeFlags.NumberLike)) return { ok: { k: "number" } };

    if (all(ts.TypeFlags.StringLiteral)) {
      const values = t.types.map((m) => (m as ts.StringLiteralType).value).sort();

      return { ok: { k: "enum", values } };
    }

    return problem(path, `\`${this.checker.typeToString(t)}\`, a union: a view value has one type`);
  }

  /**
   * An object: a plain object type declared in Lucent code has its data
   * properties, in order; anything else (library, native and class objects,
   * values of unknown or generic type) is not plain data.
   */
  private object(t: ts.Type, path: string): Converted<ViewType> {
    const symbol = t.getSymbol() ?? t.aliasSymbol;
    const decl = symbol?.declarations?.[0];

    if (symbol && symbol.flags & ts.SymbolFlags.Class && decl && ts.isClassDeclaration(decl))
      return this.instance(t, decl, path);

    if (this.dates && isDateType(t)) return { ok: { k: "date" } };

    const mapped =
      !!(t.flags & ts.TypeFlags.Object) &&
      !!((t as ts.ObjectType).objectFlags & ts.ObjectFlags.Mapped);
    const plain =
      (mapped ||
        (!!decl &&
          !decl.getSourceFile().isDeclarationFile &&
          !(symbol!.flags & ts.SymbolFlags.Class))) &&
      !(t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter));

    if (!plain) return this.notPlain(t, path);

    if (this.checker.getIndexInfosOfType(t).length)
      return problem(
        path,
        "an object with an index signature: views take objects with declared fields",
      );

    if (this.visiting.has(t)) return problem(path, `a recursive type: ${PLAIN}`);

    this.visiting.add(t);

    try {
      return this.fields(t, path);
    } finally {
      this.visiting.delete(t);
    }
  }

  /** Why a value of `t`, an object that is not plain data, cannot cross. */
  private notPlain(t: ts.Type, path: string): Converted<ViewType> {
    const symbol = t.getSymbol() ?? t.aliasSymbol;
    const decl = symbol?.declarations?.[0];
    const refused = this.transfer(t, path);

    if (refused) return problem(refused.path, `${refused.reason}: ${PLAIN}`);

    const kind = decl && isLibFile(decl.getSourceFile()) ? "" : " object";

    return problem(
      path,
      `a \`${symbol?.getName() ?? this.checker.typeToString(t)}\`${kind}: ${PLAIN}`,
    );
  }

  /**
   * An instance of a class: a prop's may be one of an exported Lucent
   * class that takes no type arguments, which crosses as its id. Other
   * classes' instances (the SDK's, the library's) are not plain data.
   */
  private instance(t: ts.Type, decl: ts.ClassDeclaration, path: string): Converted<ViewType> {
    const name = decl.name?.text ?? this.checker.typeToString(t);
    const known = decl.getSourceFile().isDeclarationFile ? undefined : this.instanceClass(decl);

    if (!known) return this.notPlain(t, path);

    if (!this.inProp) return problem(path, `a \`${name}\`, an instance: only a prop may be one`);

    if (!known.exported)
      return problem(
        path,
        `a \`${name}\`, which its module does not export: a prop takes instances of an exported class, which JavaScript makes`,
      );

    if (decl.typeParameters?.length)
      return problem(
        path,
        `a \`${name}\`, an instance of a generic class: a prop's class takes no type arguments`,
      );

    return { ok: { k: "instance", class: known.id, name, module: known.module } };
  }

  private fields(t: ts.Type, path: string): Converted<ViewType> {
    const fields: ViewField[] = [];

    for (const p of this.checker.getPropertiesOfType(t)) {
      const field = this.field(p, `${path}.${p.getName()}`);

      if (!("ok" in field)) return field;

      fields.push(field.ok);
    }

    return { ok: { k: "object", fields } };
  }
}

/**
 * What code for a toolkit body (SwiftUI, Compose) does with an instance:
 * nothing, as one never crosses into Swift or Kotlin. The body shows what
 * the setup computes from it, and a slot's type has no instance classes
 * (Crossings), so an instance is never a slot's value (decision 0121).
 */
export function toolkitInstance(): never {
  throw new Error("an instance never crosses into a toolkit body: it stays in C++ (decision 0121)");
}

/** Whether null is one of a type's values. */
export function nullable(type: ts.Type): boolean {
  const members = type.isUnion() ? type.types : [type];

  return members.some((m) => m.flags & ts.TypeFlags.Null);
}

/** Whether undefined is one of a type's values. */
export function maybeUndefined(type: ts.Type): boolean {
  const members = type.isUnion() ? type.types : [type];

  return members.some((m) => m.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void));
}

/** Whether a function returning `type` answers nothing. */
export function returnsNothing(type: ts.Type): boolean {
  const members = type.isUnion() ? type.types : [type];

  return members.every((m) => m.flags & EMPTY);
}

function problem<T>(path: string, text: string): Converted<T> {
  return { problem: { path, text } };
}
