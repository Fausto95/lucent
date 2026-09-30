/**
 * The plain data a view's boundary carries, from checked types: numbers,
 * strings, booleans, string literal unions, arrays and plain objects, each
 * possibly null. What cannot cross (native objects, functions, promises)
 * is refused by the analysis's transfer rule; what could cross to a
 * compute task but has no Fabric props representation (bigints, dates,
 * maps, class instances) is refused here.
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

export class ViewTypes {
  private readonly checker: ts.TypeChecker;
  private readonly transfer: Transfer;
  /** The object types being converted, outermost first: meeting one again is a cycle. */
  private readonly visiting = new Set<ts.Type>();

  constructor(checker: ts.TypeChecker, transfer: Transfer) {
    this.checker = checker;
    this.transfer = transfer;
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
    const mapped =
      !!(t.flags & ts.TypeFlags.Object) &&
      !!((t as ts.ObjectType).objectFlags & ts.ObjectFlags.Mapped);
    const plain =
      (mapped ||
        (!!decl &&
          !decl.getSourceFile().isDeclarationFile &&
          !(symbol!.flags & ts.SymbolFlags.Class))) &&
      !(t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter));

    if (!plain) {
      const refused = this.transfer(t, path);

      if (refused) return problem(refused.path, `${refused.reason}: ${PLAIN}`);

      const kind = decl && isLibFile(decl.getSourceFile()) ? "" : " object";

      return problem(
        path,
        `a \`${symbol?.getName() ?? this.checker.typeToString(t)}\`${kind}: ${PLAIN}`,
      );
    }

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
