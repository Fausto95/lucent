/**
 * Module state the main thread owns: a top-level variable that only
 * main-thread code uses (component setups, what they run, `main()`
 * callbacks). Views read and write it without the module's lock, as each
 * use runs on the one main thread. It stays the main thread's alone only
 * if no reference to an object of its leaves that code: it holds plain
 * values or native objects, and an object it is (a Map, say) is used
 * through its members, and made fresh where it is assigned.
 */
import ts from "typescript";
import { isLibFile } from "../program.ts";
import { type Cause, code } from "./facts.ts";
import type { NativeFactsSource } from "./native.ts";
import type { OwnerId } from "../ir/ir.ts";
import { immutableType, type ModuleVar, type ProgramUnits as Units, type Unit } from "./units.ts";

export interface MainState {
  /** Why each module variable that is state is not the main thread's, by key: none for those that are. */
  readonly why: ReadonlyMap<string, string | undefined>;
  /** The variables that are. */
  readonly owned: ReadonlySet<ts.Symbol>;
}

/** The library collections main-thread state may be, used through their members. */
const COLLECTIONS = new Set(["Map", "Set", "Array"]);

export function mainStateOf(
  checker: ts.TypeChecker,
  units: Units,
  native: NativeFactsSource,
  owners: (u: Unit) => ReadonlyMap<OwnerId, Cause>,
): MainState {
  const refs = references(checker, units);
  const why = new Map<string, string | undefined>();
  const owned = new Set<ts.Symbol>();

  for (const [sym, v] of units.moduleVars) {
    if (!v.state || !ts.isVariableDeclaration(v.declaration.parent)) continue;

    const reason = notOwned(checker, units, native, owners, v, refs.get(sym) ?? []);

    why.set(v.key, reason);
    if (!reason) owned.add(sym);
  }

  return { why, owned };
}

function notOwned(
  checker: ts.TypeChecker,
  units: Units,
  native: NativeFactsSource,
  owners: (u: Unit) => ReadonlyMap<OwnerId, Cause>,
  v: ModuleVar,
  refs: readonly ts.Identifier[],
): string | undefined {
  const declaration = v.declaration.parent as ts.VariableDeclaration;
  const type = checker.getTypeAtLocation(declaration.name);
  const plain = plainOrNative(native, type);

  if (!plain) {
    const held = heldTypes(checker, type);

    if (!held) return `it is a ${code(checker.typeToString(type))}`;

    const own = held.find((t) => !plainOrNative(native, t));

    if (own) return `it holds ${code(checker.typeToString(own))}, an object of its own`;

    if (declaration.initializer && !fresh(declaration.initializer))
      return `its initial value is computed (${at(declaration.initializer)})`;
  }

  for (const ref of refs) {
    const unit = unitAt(units, ref);
    const run = unit && owners(unit);

    if (!unit || !run || run.size !== 1 || !run.has("main"))
      return `${code(unit?.display ?? "module code")} (${at(ref)}) uses it too`;

    if (plain) continue;

    const assigned = assignment(ref);

    if (assigned) {
      if (!fresh(assigned.right)) return `it is assigned a value made elsewhere (${at(ref)})`;
      continue;
    }

    if (!member(ref)) return `it is used as a value (${at(ref)})`;
  }

  return undefined;
}

/** Every reference to a module variable, but its declaration. */
function references(checker: ts.TypeChecker, units: Units): Map<ts.Symbol, ts.Identifier[]> {
  const out = new Map<ts.Symbol, ts.Identifier[]>();
  const files = new Set([...units.byNode.keys()].map((n) => n.getSourceFile()));

  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && !isDeclarationName(n)) {
      const sym = checker.getSymbolAtLocation(n);
      const target = sym && sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;

      if (target && units.moduleVars.has(target)) {
        const list = out.get(target);

        if (list) list.push(n);
        else out.set(target, [n]);
      }
    }

    ts.forEachChild(n, visit);
  };

  for (const f of files) visit(f);

  return out;
}

function isDeclarationName(n: ts.Identifier): boolean {
  const p = n.parent;

  return (
    (ts.isVariableDeclaration(p) && p.name === n) ||
    ts.isImportSpecifier(p) ||
    ts.isImportClause(p) ||
    ts.isExportSpecifier(p)
  );
}

/** The innermost unit whose code holds `node`. */
function unitAt(units: Units, node: ts.Node): Unit | undefined {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    const u = units.byNode.get(n);

    if (u) return u;
  }

  return undefined;
}

/** `v.member` or `v.method(…)`: a use through a member, the variable not taken as a value. */
function member(ref: ts.Identifier): boolean {
  const p = ref.parent;

  return (
    (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === ref
  );
}

/** `v = value`, with the variable assigned. */
function assignment(ref: ts.Identifier): ts.BinaryExpression | undefined {
  const p = ref.parent;

  return ts.isBinaryExpression(p) &&
    p.left === ref &&
    p.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ? p
    : undefined;
}

/** A value no other code holds a reference to: a literal, or an empty collection made here. */
function fresh(e: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e))
    return fresh(e.expression);

  if (ts.isArrayLiteralExpression(e)) return e.elements.length === 0;

  if (ts.isNewExpression(e))
    return (
      ts.isIdentifier(e.expression) &&
      COLLECTIONS.has(e.expression.text) &&
      (e.arguments?.length ?? 0) === 0
    );

  return (
    ts.isLiteralExpression(e) ||
    ts.isNoSubstitutionTemplateLiteral(e) ||
    e.kind === ts.SyntaxKind.TrueKeyword ||
    e.kind === ts.SyntaxKind.FalseKeyword ||
    e.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(e) && e.text === "undefined")
  );
}

/** Values whose reference no code can share: copies, or native objects. */
function plainOrNative(native: NativeFactsSource, t: ts.Type): boolean {
  if (t.isUnion()) return t.types.every((m) => plainOrNative(native, m));

  if (immutableType(t)) return true;

  const decl = (t.getSymbol() ?? t.aliasSymbol)?.declarations?.[0];

  return !!decl && !!native.classOf(decl);
}

/** What a library collection holds (its keys too), or undefined for any other object. */
function heldTypes(checker: ts.TypeChecker, t: ts.Type): readonly ts.Type[] | undefined {
  const sym = t.getSymbol();
  const decl = sym?.declarations?.[0];

  if (!sym || !decl || !isLibFile(decl.getSourceFile()) || !COLLECTIONS.has(sym.getName()))
    return undefined;

  return checker.getTypeArguments(t as ts.TypeReference);
}

/** `video.lucent.tsx:12:5`. */
function at(n: ts.Node): string {
  const sf = n.getSourceFile();
  const { line, character } = sf.getLineAndCharacterOfPosition(n.getStart(sf));

  return `${sf.fileName.split(/[\\/]/).pop()}:${line + 1}:${character + 1}`;
}
