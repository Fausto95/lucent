/**
 * What a generic function or class asks of the types it is instantiated
 * with. A generic compiles once, as a C++ template, so the checks that
 * depend on its type arguments run where a call or `new` sets them:
 *
 * - its comparisons (`===`, `==`, switch cases, indexOf, lastIndexOf and
 *   includes, Map and Set keys, and those of the generics it calls in
 *   turn) must stay valid between the instantiated types: two functions
 *   cannot be compared, and a loose `==` must not be one JavaScript
 *   converts for;
 * - each union and optional holding a type parameter, in any type the
 *   generic declares or computes, must keep its shape (types.ts
 *   unionShapeBreak).
 *
 * The facts are gathered once per generic, as Lucent types that may
 * mention its type parameters, and substituted at each instantiation.
 */
import ts from "typescript";
import { CompileError } from "../diagnostics.ts";
import { isLibFile } from "../program.ts";
import { type LType, substitute } from "../types.ts";

export type Generic = ts.SignatureDeclaration | ts.ClassLikeDeclaration;

/** A comparison in a generic, between types that may mention its type parameters. */
export interface Comparison {
  loose: boolean;
  left: LType;
  right: LType;
}

/** What instantiating a generic depends on. */
export interface GenericFacts {
  comparisons: Comparison[];
  /** The types it declares or computes, whose unions must keep their shape. */
  types: LType[];
}

/** A generic a call or `new` instantiates, and its type arguments by parameter name. */
export interface Instance {
  generic: Generic;
  name: string;
  args: Map<string, LType>;
  /** The same arguments as TypeScript types, to name them in diagnostics. */
  written: Map<string, ts.Type>;
}

/** Lowers a TypeScript type met at a node (the emitter's type registry). */
export type Lower = (type: ts.Type, at: ts.Node) => LType;

const EQUALITY: ReadonlyMap<ts.SyntaxKind, { loose: boolean }> = new Map([
  [ts.SyntaxKind.EqualsEqualsEqualsToken, { loose: false }],
  [ts.SyntaxKind.ExclamationEqualsEqualsToken, { loose: false }],
  [ts.SyntaxKind.EqualsEqualsToken, { loose: true }],
  [ts.SyntaxKind.ExclamationEqualsToken, { loose: true }],
]);

const ARRAY_SEARCHES: readonly string[] = ["indexOf", "lastIndexOf", "includes"];

const KEYED: readonly string[] = ["Map", "Set"];

const known = new WeakMap<Generic, GenericFacts>();

/** The generic of the program's sources that `node` instantiates, if any. */
export function instanceAt(
  checker: ts.TypeChecker,
  lower: Lower,
  node: ts.CallExpression | ts.NewExpression,
): Instance | undefined {
  const found = typeArguments(checker, node);
  if (!found) return undefined;

  const { generic, args } = found;
  const names = generic.typeParameters!.map((p) => p.name.text);
  const given = names.flatMap((name, i) => (args[i] ? [[name, args[i]] as const] : []));

  return {
    generic,
    name: generic.name ? `\`${generic.name.getText()}\`` : "this generic",
    args: new Map(given.map(([name, t]) => [name, lower(t, node)])),
    written: new Map(given),
  };
}

function typeArguments(
  checker: ts.TypeChecker,
  node: ts.CallExpression | ts.NewExpression,
): { generic: Generic; args: readonly ts.Type[] } | undefined {
  if (ts.isNewExpression(node)) {
    const type = checker.getTypeAtLocation(node);
    const generic = type.getSymbol()?.valueDeclaration;

    return generic && ts.isClassLike(generic) && isSource(generic)
      ? { generic, args: checker.getTypeArguments(type as ts.TypeReference) }
      : undefined;
  }

  const signature = checker.getResolvedSignature(node);
  const generic = signature?.declaration;
  const args = signature && checker.getTypeArgumentsForResolvedSignature(signature);

  return generic && args && !ts.isJSDocSignature(generic) && isSource(generic)
    ? { generic, args }
    : undefined;
}

/** A generic of the program's Lucent sources, with a body to look into (not a declaration file's). */
function isSource(generic: Generic): boolean {
  return !!generic.typeParameters?.length && !generic.getSourceFile().isDeclarationFile;
}

/** Runs `f`, or gives undefined for a type the emitter refuses: it reports that where it compiles the node. */
function unlessRefused<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch (e) {
    if (e instanceof CompileError) return undefined;
    throw e;
  }
}

/** What `generic` compares and which types it uses, in terms of its type parameters. */
export function genericFacts(
  checker: ts.TypeChecker,
  lower: Lower,
  generic: Generic,
): GenericFacts {
  const cached = known.get(generic);
  if (cached) return cached;

  const facts: GenericFacts = { comparisons: [], types: [] };

  // A generic that reaches itself again adds nothing on the way round.
  known.set(generic, facts);

  const typeAt = (node: ts.Node) =>
    unlessRefused(() => lower(checker.getTypeAtLocation(node), node));
  const compare = (loose: boolean, left: LType | undefined, right: LType | undefined) => {
    if (left && right) facts.comparisons.push({ loose, left, right });
  };

  const visit = (node: ts.Node): void => {
    const typed =
      ts.isExpression(node) ||
      ts.isParameter(node) ||
      ts.isVariableDeclaration(node) ||
      ts.isPropertyDeclaration(node);
    const t = typed ? typeAt(node) : undefined;

    if (t) facts.types.push(t);

    if (ts.isBinaryExpression(node)) {
      const op = EQUALITY.get(node.operatorToken.kind);

      if (op) compare(op.loose, typeAt(node.left), typeAt(node.right));
    }

    if (ts.isCaseClause(node))
      compare(false, typeAt(node.parent.parent.expression), typeAt(node.expression));

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ARRAY_SEARCHES.includes(node.expression.name.text)
    ) {
      const array = typeAt(node.expression.expression);

      if (array?.k === "array") compare(false, array.e, array.e);
    }

    if (ts.isNewExpression(node) && t && (t.k === "map" || t.k === "set")) {
      const symbol = checker.getTypeAtLocation(node).getSymbol();
      const lib = symbol?.declarations?.some((d) => isLibFile(d.getSourceFile()));
      const key = t.k === "map" ? t.key : t.e;

      if (symbol && lib && KEYED.includes(symbol.name)) compare(false, key, key);
    }

    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const inner = unlessRefused(() => instanceAt(checker, lower, node));

      if (inner) {
        const innerFacts = genericFacts(checker, lower, inner.generic);
        const sub = (u: LType) => substitute(u, inner.args);

        // Mapped before pushing: a generic calling itself reads the facts it adds to.
        const comparisons = innerFacts.comparisons.map((c) => ({
          loose: c.loose,
          left: sub(c.left),
          right: sub(c.right),
        }));
        const types = innerFacts.types.map(sub);

        facts.comparisons.push(...comparisons);
        facts.types.push(...types);
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(generic, visit);

  return facts;
}
