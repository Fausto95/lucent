/**
 * The units the program analyses summarize: every body of code that runs
 * as one call. Functions, closures, methods, accessors, a class's
 * construction (its constructor and field initializers) and each module's
 * initialization. Code for another platform than the program's is left
 * out, as the emitter leaves it out, so the call graph is the one the
 * target runs.
 */
import ts from "typescript";
import { branchPlatform, classMembersFor, platformScopes } from "../platforms.ts";
import type { Platform } from "../sdk/schema.ts";
import { isToolkitBody } from "../ui/toolkit-body.ts";
import { isViewHelper } from "../ui/view-helpers.ts";
import { type FunctionLike, isFunctionLike } from "./scopes.ts";

export type UnitKind =
  | "function"
  | "closure"
  | "method"
  | "getter"
  | "setter"
  | "constructor"
  | "module-init";

export interface Unit {
  /** Unique and stable across builds of the same sources: `geo.distance`, `geo.Cache.get`. */
  readonly id: string;
  readonly kind: UnitKind;
  /** The Lucent module it is in. */
  readonly module: string;
  /** The function, class (construction) or source file (initialization) it is. */
  readonly node: ts.Node;
  /** What runs: a body, parameter defaults, field initializers, top-level initializers. */
  readonly code: readonly ts.Node[];
  /** Its parameters, in order. */
  readonly params: readonly ts.ParameterDeclaration[];
  /** The unit whose code creates it (closures, nested functions, object literal methods). */
  readonly parent?: Unit;
  /** How messages name it: `distance`, `Cache.get`, `new Cache`. */
  readonly display: string;
  /** JavaScript can call it: an export, or a public member of an exported class. */
  readonly exported: boolean;
  readonly async: boolean;
  readonly generator: boolean;
  /** A method's or construction's class. */
  readonly class?: ts.ClassLikeDeclaration;
  readonly static: boolean;
}

/** A variable declared at the top level of a module, or a static field. */
export interface ModuleVar {
  /** `geo.cache`, `geo.Registry.count`. */
  readonly key: string;
  /** How messages name it: `cache`, `Registry.count`. */
  readonly name: string;
  readonly declaration: ts.Node;
  /**
   * Why reading it reads module state (a `let`; a const holding an object,
   * whose contents stay mutable whatever `readonly` says), or undefined for
   * a const whose value can never change.
   */
  readonly state?: string;
  /**
   * Why a compute task may not read a constant that is not module state,
   * or undefined for a literal one, which code reads as the literal. The
   * module's initialization assigns the rest, and a reload of JavaScript
   * runs it again while tasks may still run.
   */
  readonly assigned?: string;
  /** It holds an object: mutating through it writes module state. */
  readonly reference: boolean;
}

/** A Lucent class and the units that make and run its instances. */
export interface ClassUnits {
  readonly declaration: ts.ClassLikeDeclaration;
  readonly construction: Unit;
  /** Instance and static members by name: methods, getters and setters. */
  readonly members: ReadonlyMap<string, readonly Unit[]>;
  readonly base?: ts.ClassLikeDeclaration;
  /** The Lucent interfaces it names in `implements`, and those they extend. */
  readonly implements: readonly ts.InterfaceDeclaration[];
}

export interface ProgramUnits {
  readonly list: readonly Unit[];
  /** Units by the node they are, and by the constructor of a class. */
  readonly byNode: ReadonlyMap<ts.Node, Unit>;
  readonly moduleVars: ReadonlyMap<ts.Symbol, ModuleVar>;
  readonly classes: ReadonlyMap<ts.ClassLikeDeclaration, ClassUnits>;
  /** Each module's initialization. */
  readonly inits: ReadonlyMap<string, Unit>;
}

/** A Lucent module, as the analyses need it. */
export interface AnalysedModule {
  readonly name: string;
  readonly sourceFile: ts.SourceFile;
  /** For a platform module: the shared file declaring its exports. */
  readonly declaration?: ts.SourceFile;
}

/**
 * The units of `modules` compiled for `platform` (none: the host). Units
 * are listed in source order, modules in the order given.
 */
export function findUnits(
  checker: ts.TypeChecker,
  modules: readonly AnalysedModule[],
  platform: Platform | undefined,
): ProgramUnits {
  const finder = new Finder(checker, platform);

  for (const m of modules) finder.module(m);

  finder.aliasDeclarations(modules);
  return finder.result();
}

class Finder {
  readonly list: Unit[] = [];
  readonly byNode = new Map<ts.Node, Unit>();
  readonly moduleVars = new Map<ts.Symbol, ModuleVar>();
  readonly classes = new Map<ts.ClassLikeDeclaration, ClassUnits>();
  readonly inits = new Map<string, Unit>();
  private readonly ids = new Set<string>();
  private readonly checker: ts.TypeChecker;
  private readonly platform: Platform | undefined;

  constructor(checker: ts.TypeChecker, platform: Platform | undefined) {
    this.checker = checker;
    this.platform = platform;
  }

  result(): ProgramUnits {
    return {
      list: this.list,
      byNode: this.byNode,
      moduleVars: this.moduleVars,
      classes: this.classes,
      inits: this.inits,
    };
  }

  module(m: AnalysedModule): void {
    const sf = m.sourceFile;
    const scoped = platformScopes(this.checker, sf).platforms;
    const here = sf.statements.filter((s) => !scoped.has(s) || scoped.get(s) === this.platform);
    const code: ts.Node[] = [];
    const init = this.unit({
      id: `${m.name}.<init>`,
      kind: "module-init",
      module: m.name,
      node: sf,
      code,
      params: [],
      display: `the initialization of ${m.name}`,
      exported: false,
      async: false,
      generator: false,
      static: false,
    });

    this.inits.set(m.name, init);

    for (const s of here) {
      // A helper view is its toolkit's code: none of it runs as the program's.
      if (ts.isFunctionDeclaration(s) && s.body && s.name && !isViewHelper(this.checker, s))
        this.function(s, m.name, undefined, s.name.text, exportedStatement(s));

      if (ts.isClassDeclaration(s) && s.name) this.class(s, m.name, init, exportedStatement(s));

      if (ts.isVariableStatement(s)) this.variables(s, m.name, init, code);
    }
  }

  /**
   * A platform module's exports are declared in its shared file: calls from
   * other modules resolve to those declarations, which stand for the
   * implementations (as the emitter routes them).
   */
  aliasDeclarations(modules: readonly AnalysedModule[]): void {
    for (const m of modules) {
      if (!m.declaration) continue;

      const implemented = new Map<string, Unit>();

      for (const s of m.sourceFile.statements)
        if (ts.isFunctionDeclaration(s) && s.name) {
          const u = this.byNode.get(s);
          if (u) implemented.set(s.name.text, u);
        }

      for (const s of m.declaration.statements)
        if (ts.isFunctionDeclaration(s) && s.name) {
          const u = implemented.get(s.name.text);
          if (u) this.byNode.set(s, u);
        }
    }
  }

  private variables(s: ts.VariableStatement, module: string, init: Unit, code: ts.Node[]): void {
    const mutable = !(s.declarationList.flags & ts.NodeFlags.Const);

    for (const d of s.declarationList.declarations) {
      code.push(d);

      if (d.initializer) this.nested(d.initializer, init, module);

      if (!ts.isIdentifier(d.name)) continue;

      const sym = this.checker.getSymbolAtLocation(d.name);
      if (!sym) continue;

      this.moduleVar(sym, `${module}.${d.name.text}`, d.name.text, d, mutable);
    }
  }

  /** `declared`: the variable or static field, whose name is where messages point. */
  private moduleVar(
    sym: ts.Symbol,
    key: string,
    name: string,
    declared: ts.VariableDeclaration | ts.PropertyDeclaration,
    mutable: boolean,
  ): void {
    const declaration = declared.name;
    const type = this.checker.getTypeOfSymbolAtLocation(sym, declaration);
    const immutable = immutableType(type);
    const state = mutable
      ? "a `let`"
      : immutable
        ? undefined
        : "a const reference to a mutable object";
    const assigned =
      state || literalConstant(declared)
        ? undefined
        : "which is not a literal: a reload of JavaScript assigns it again";

    this.moduleVars.set(sym, {
      key,
      name,
      declaration,
      ...(state ? { state } : {}),
      ...(assigned ? { assigned } : {}),
      reference: !immutable,
    });
  }

  private function(
    f: FunctionLike,
    module: string,
    parent: Unit | undefined,
    display: string,
    exported: boolean,
    cls?: ts.ClassLikeDeclaration,
  ): Unit {
    const kind = unitKind(f, parent);
    const isStatic = !!cls && hasModifier(f, ts.SyntaxKind.StaticKeyword);
    const owner = cls?.name?.text;
    const local = parent && !cls ? `${parent.id}/${display}@${position(f)}` : "";
    const member = owner ? `${module}.${owner}.${isStatic ? "static " : ""}${memberKey(f)}` : "";
    const u = this.unit({
      id: local || member || `${module}.${display}`,
      kind,
      module,
      node: f,
      code: [...f.parameters, ...(f.body ? [f.body] : [])],
      params: f.parameters,
      ...(parent ? { parent } : {}),
      display,
      exported,
      async: hasModifier(f, ts.SyntaxKind.AsyncKeyword),
      generator: "asteriskToken" in f && !!f.asteriskToken,
      ...(cls ? { class: cls } : {}),
      static: isStatic,
    });

    for (const p of f.parameters) if (p.initializer) this.nested(p.initializer, u, module);

    if (f.body) this.nested(f.body, u, module);

    return u;
  }

  private class(
    c: ts.ClassLikeDeclaration,
    module: string,
    init: Unit,
    exported: boolean,
    parent?: Unit,
  ): void {
    const name = c.name?.text ?? "class";
    // A private member of another platform is not this program's code.
    const own = classMembersFor(this.checker, c, this.platform);
    const ctor = own.find(
      (m): m is ts.ConstructorDeclaration => ts.isConstructorDeclaration(m) && !!m.body,
    );
    const fields = own.filter(
      (m): m is ts.PropertyDeclaration =>
        ts.isPropertyDeclaration(m) && !hasModifier(m, ts.SyntaxKind.StaticKeyword),
    );
    const construction = this.unit({
      id: `${module}.${name}.constructor`,
      kind: "constructor",
      module,
      node: c,
      code: [...fields, ...(ctor ? [...ctor.parameters, ctor.body!] : [])],
      params: ctor?.parameters ?? [],
      ...(parent ? { parent } : {}),
      display: `new ${name}`,
      exported,
      async: false,
      generator: false,
      class: c,
      static: false,
    });

    if (ctor) this.byNode.set(ctor, construction);

    for (const f of fields) if (f.initializer) this.nested(f.initializer, construction, module);

    if (ctor) {
      for (const p of ctor.parameters)
        if (p.initializer) this.nested(p.initializer, construction, module);
      this.nested(ctor.body!, construction, module);
    }

    const members = new Map<string, Unit[]>();

    for (const m of own) {
      const isStatic = hasModifier(m, ts.SyntaxKind.StaticKeyword);

      if (
        (ts.isMethodDeclaration(m) ||
          ts.isGetAccessorDeclaration(m) ||
          ts.isSetAccessorDeclaration(m)) &&
        m.body
      ) {
        const key = memberKey(m);
        const shown = `${name}.${memberName(m)}`;
        const isPublic =
          !hasModifier(m, ts.SyntaxKind.PrivateKeyword) && !ts.isPrivateIdentifier(m.name);
        const u = this.function(m, module, parent, shown, exported && isPublic, c);

        members.set(key, [...(members.get(key) ?? []), u]);
        continue;
      }

      // Static fields and blocks run when the module initializes.
      if (ts.isPropertyDeclaration(m) && isStatic) {
        if (m.initializer) {
          (init.code as ts.Node[]).push(m);
          this.nested(m.initializer, init, module);
        }

        const sym = this.checker.getSymbolAtLocation(m.name);
        const readonly = hasModifier(m, ts.SyntaxKind.ReadonlyKeyword);

        if (sym && ts.isIdentifier(m.name))
          this.moduleVar(
            sym,
            `${module}.${name}.${m.name.text}`,
            `${name}.${m.name.text}`,
            m,
            !readonly,
          );
      }

      if (ts.isClassStaticBlockDeclaration(m)) {
        (init.code as ts.Node[]).push(m.body);
        this.nested(m.body, init, module);
      }
    }

    this.classes.set(c, {
      declaration: c,
      construction,
      members,
      ...baseOf(this.checker, c),
      implements: implementsOf(this.checker, c),
    });
  }

  /** The units `node`'s code creates: closures, nested functions and classes, object literal members. */
  private nested(node: ts.Node, parent: Unit, module: string): void {
    const visit = (n: ts.Node): void => {
      if (inOtherPlatform(this.checker, n, this.platform)) return;

      if (isFunctionLike(n) && !ts.isConstructorDeclaration(n)) {
        // A toolkit's body is Swift or Kotlin: none of its code runs as the program's.
        if (!n.body || isToolkitBody(this.checker, n) || isViewHelper(this.checker, n)) return;

        this.function(n, module, parent, closureName(n, parent), false);
        return;
      }

      if (ts.isClassLike(n)) {
        this.class(n, module, parent, false, parent);
        return;
      }

      ts.forEachChild(n, visit);
    };

    visit(node);
  }

  private unit(u: Unit): Unit {
    let id = u.id;

    for (let n = 2; this.ids.has(id); n++) id = `${u.id}#${n}`;

    const unit = id === u.id ? u : { ...u, id };

    this.ids.add(id);
    this.list.push(unit);
    this.byNode.set(u.node, unit);
    return unit;
  }
}

/** Whether a node is the true or false side of a conditional expression. */
function isBranch(n: ts.Node): boolean {
  const p = n.parent;

  return !!p && ts.isConditionalExpression(p) && (p.whenTrue === n || p.whenFalse === n);
}

/** Whether a node's code is in a branch for another platform than `platform` (all of them, on the host). */
export function inOtherPlatform(
  checker: ts.TypeChecker,
  n: ts.Node,
  platform: Platform | undefined,
): boolean {
  const branch = ts.isStatement(n) || isBranch(n) ? branchPlatform(checker, n) : undefined;

  return branch !== undefined && branch !== platform;
}

function unitKind(f: FunctionLike, parent: Unit | undefined): UnitKind {
  if (ts.isGetAccessorDeclaration(f)) return "getter";

  if (ts.isSetAccessorDeclaration(f)) return "setter";

  if (ts.isMethodDeclaration(f)) return "method";

  return parent ? "closure" : "function";
}

/** A closure's name: its own, the variable or property it initializes, or where it is. */
function closureName(f: FunctionLike, parent: Unit): string {
  const own = f.name && ts.isIdentifier(f.name) ? f.name.text : undefined;
  const p = f.parent;
  const named =
    (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p)) && ts.isIdentifier(p.name)
      ? p.name.text
      : undefined;

  return own ?? named ?? `the closure in ${parent.display}`;
}

function memberName(m: ts.ClassElement | FunctionLike): string {
  const name = m.name;

  if (!name) return "member";

  return ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name)
    ? name.text
    : name.getText();
}

/** A member's key among its class's: `get size` and `set size` are two members of one name. */
function memberKey(m: FunctionLike): string {
  const prefix = ts.isGetAccessorDeclaration(m)
    ? "get "
    : ts.isSetAccessorDeclaration(m)
      ? "set "
      : "";

  return `${prefix}${memberName(m)}`;
}

/** `line:column` of a node, 1-based. */
function position(n: ts.Node): string {
  const sf = n.getSourceFile();
  const { line, character } = sf.getLineAndCharacterOfPosition(n.getStart(sf));

  return `${line + 1}:${character + 1}`;
}

function hasModifier(n: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === kind);
}

function exportedStatement(s: ts.Statement): boolean {
  return hasModifier(s, ts.SyntaxKind.ExportKeyword);
}

/** The Lucent class a class extends, when it extends one. */
function baseOf(
  checker: ts.TypeChecker,
  c: ts.ClassLikeDeclaration,
): { base?: ts.ClassLikeDeclaration } {
  const clause = c.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword);
  const t = clause?.types[0];
  if (!t) return {};

  let sym = checker.getSymbolAtLocation(t.expression);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);

  const decl = sym?.declarations?.find(ts.isClassLike);

  return decl && !decl.getSourceFile().isDeclarationFile ? { base: decl } : {};
}

/** The Lucent interfaces a class names in `implements`, with those they extend. */
function implementsOf(
  checker: ts.TypeChecker,
  c: ts.ClassLikeDeclaration,
): ts.InterfaceDeclaration[] {
  const out: ts.InterfaceDeclaration[] = [];
  const add = (t: ts.ExpressionWithTypeArguments) => {
    const decl = checker
      .getTypeAtLocation(t)
      .getSymbol()
      ?.declarations?.find(ts.isInterfaceDeclaration);

    if (!decl || decl.getSourceFile().isDeclarationFile || out.includes(decl)) return;

    out.push(decl);
    for (const h of decl.heritageClauses ?? []) h.types.forEach(add);
  };

  for (const h of c.heritageClauses ?? [])
    if (h.token === ts.SyntaxKind.ImplementsKeyword) h.types.forEach(add);

  return out;
}

/** The literals a constant can be read as: no code runs to make them. */
const LITERALS: Partial<Record<ts.SyntaxKind, ts.SyntaxKind>> = {
  [ts.SyntaxKind.NumericLiteral]: ts.SyntaxKind.NumberKeyword,
  [ts.SyntaxKind.BigIntLiteral]: ts.SyntaxKind.BigIntKeyword,
  [ts.SyntaxKind.StringLiteral]: ts.SyntaxKind.StringKeyword,
  [ts.SyntaxKind.NoSubstitutionTemplateLiteral]: ts.SyntaxKind.StringKeyword,
  [ts.SyntaxKind.TrueKeyword]: ts.SyntaxKind.BooleanKeyword,
  [ts.SyntaxKind.FalseKeyword]: ts.SyntaxKind.BooleanKeyword,
};

/**
 * The literal a module constant or static readonly field is initialized
 * with (a number, negative ones included, a string, a boolean or a
 * bigint), when its declared type, if any, is that literal's: code reads
 * the literal rather than the storage the module's initialization
 * assigns. Undefined for anything else.
 */
export function literalConstant(
  d: ts.VariableDeclaration | ts.PropertyDeclaration,
): ts.Expression | undefined {
  const constant = ts.isVariableDeclaration(d)
    ? ts.isVariableDeclarationList(d.parent) && !!(d.parent.flags & ts.NodeFlags.Const)
    : hasModifier(d, ts.SyntaxKind.StaticKeyword) && hasModifier(d, ts.SyntaxKind.ReadonlyKeyword);
  const init = d.initializer;

  if (!constant || !init) return undefined;

  const negated = ts.isPrefixUnaryExpression(init) && init.operator === ts.SyntaxKind.MinusToken;
  const literal = negated ? init.operand : init;
  const keyword = LITERALS[literal.kind];
  const negatable =
    keyword === ts.SyntaxKind.NumberKeyword || keyword === ts.SyntaxKind.BigIntKeyword;

  if (!keyword || (negated && !negatable) || (d.type && d.type.kind !== keyword)) return undefined;

  return init;
}

/**
 * Whether no value of `type` can ever change: primitives, literals and
 * functions (Lucent functions carry no state of their own). Objects,
 * arrays, collections and class instances stay mutable even when
 * `readonly` in TypeScript, which other references can bypass.
 */
export function immutableType(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.every(immutableType);

  const scalar =
    ts.TypeFlags.NumberLike |
    ts.TypeFlags.StringLike |
    ts.TypeFlags.BooleanLike |
    ts.TypeFlags.BigIntLike |
    ts.TypeFlags.EnumLike |
    ts.TypeFlags.Null |
    ts.TypeFlags.Undefined |
    ts.TypeFlags.Void |
    ts.TypeFlags.Never;

  if (type.flags & scalar) return true;

  const functionOnly =
    type.getCallSignatures().length > 0 &&
    type.getProperties().length === 0 &&
    type.getConstructSignatures().length === 0;

  return functionOnly;
}
