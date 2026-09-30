/**
 * What each unit does by itself: the facts its own code proves (module
 * reads, allocations, throws, native uses…), the calls it makes, and how
 * object and function values flow between variables, literals, closures
 * and calls. The flow graph is shared by every unit (symbols and nodes are
 * unique in a program), so a closure's use of a captured variable and the
 * enclosing function's are one graph.
 */
import ts from "typescript";
import type { Platform } from "../sdk/schema.ts";
import { isToolkitBody, type Jsx, jsxToolkitOf } from "../ui/toolkit-body.ts";
import { helperStatement, isViewHelper } from "../ui/view-helpers.ts";
import { type Cause, code, step, SummaryBuilder } from "./facts.ts";
import { type LibraryEffect, type LibraryMember, libraryMember } from "./library.ts";
import type { NativeFactsSource, NativeUse } from "./native.ts";
import { freeVariables, isFunctionLike, parameterSymbol, symbolOf, usesThis } from "./scopes.ts";
import {
  type ClassUnits,
  inOtherPlatform,
  type ModuleVar,
  type ProgramUnits,
  type Unit,
} from "./units.ts";

/** `this` in the units of a class (or object literal): one value per owner. */
export class ThisValue {
  readonly owner: ts.Node;

  constructor(owner: ts.Node) {
    this.owner = owner;
  }
}

/**
 * A value the flow graph tracks: a variable (its symbol), a node that
 * makes one (a literal, a closure, a call's result, a field read), or
 * `this`.
 */
export type Value = ts.Symbol | ts.Node | ThisValue;

/** What a node value is, for where values come from. */
export type NodeKind =
  /** Made here, and no one else has it yet: a literal, a new library collection. */
  | "fresh"
  /** A function or closure (its unit). */
  | "function"
  /** A call's result, an awaited value: made elsewhere. */
  | "call"
  /** Read out of an object: a field, an element, a destructured name. */
  | "part";

/**
 * How a value moves: `bind` into a variable, `alias` as (part of) a
 * call's result, `contain` into an object, `capture` into a closure, `part`
 * out of an object it is read from.
 */
export type FlowKind = "bind" | "alias" | "contain" | "capture" | "part";

export interface Flow {
  readonly to: Value;
  readonly kind: FlowKind;
  readonly unit: Unit;
  readonly node: ts.Node;
  readonly text: string;
}

/** How a value can outlive the code that has it. */
export type EscapeKind =
  | "returned"
  | "stored"
  | "captured"
  | "passed"
  | "thrown"
  | "yielded"
  | "await";

export interface Sink {
  readonly kind: EscapeKind;
  readonly unit: Unit;
  readonly node: ts.Node;
  readonly text: string;
  /** Handed to code that runs it later on a known context (not an unknown escape). */
  readonly dispatched?: true;
}

/** A call a unit makes, as its code names the callee. */
export type Callee =
  | { readonly kind: "units"; readonly units: readonly Unit[] }
  /** A function value: resolved from where the value comes from. */
  | { readonly kind: "value"; readonly values: readonly Value[] }
  /** A method of an object literal: its unit when the receiver is that literal. */
  | {
      readonly kind: "literal";
      readonly receiver: readonly Value[];
      readonly literal: ts.Node;
      readonly unit: Unit;
    }
  | { readonly kind: "library"; readonly member: LibraryMember }
  | { readonly kind: "native"; readonly use: NativeUse }
  | { readonly kind: "unknown"; readonly why: string };

export interface CallSite {
  readonly unit: Unit;
  readonly node: ts.Node;
  /** "calls `decode`". */
  readonly text: string;
  readonly callee: Callee;
  /** What each argument may be (objects and functions). */
  readonly args: readonly (readonly Value[])[];
  /** Which arguments are functions. */
  readonly functions: readonly boolean[];
  /** A spread argument: positions from it on are not known. */
  readonly spread: boolean;
}

/** An object a unit mutates, as the values it may be. */
export interface Mutation {
  readonly values: readonly Value[];
  readonly node: ts.Node;
  readonly text: string;
}

export interface LocalFacts {
  readonly unit: Unit;
  /** What its own code proves. */
  readonly own: SummaryBuilder;
  readonly calls: CallSite[];
  readonly mutations: Mutation[];
  /** Variables of enclosing units it uses, and where first. */
  readonly captured: Map<ts.Symbol, ts.Node>;
}

/** The program-wide flow graph. */
export class FlowGraph {
  readonly forward = new Map<Value, Flow[]>();
  readonly backward = new Map<Value, { from: Value; flow: Flow }[]>();
  readonly sinks = new Map<Value, Sink[]>();
  readonly kinds = new Map<ts.Node, NodeKind>();
  /** The units of function values. */
  readonly functions = new Map<ts.Node, Unit>();
  /** The unit declaring each local variable and parameter. */
  readonly declaredIn = new Map<ts.Symbol, Unit>();
  /** Parameters: their unit and position. */
  readonly params = new Map<ts.Symbol, { unit: Unit; index: number }>();
  private readonly thisValues = new Map<ts.Node, ThisValue>();

  flow(from: Value, flow: Flow): void {
    if (from === flow.to) return;

    push(this.forward, from, flow);
    push(this.backward, flow.to, { from, flow });
  }

  sink(value: Value, sink: Sink): void {
    push(this.sinks, value, sink);
  }

  thisOf(owner: ts.Node): ThisValue {
    let v = this.thisValues.get(owner);

    if (!v) {
      v = new ThisValue(owner);
      this.thisValues.set(owner, v);
    }

    return v;
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);

  if (list) list.push(value);
  else map.set(key, [value]);
}

/** What collecting a unit needs to know about the program. */
export interface Program {
  readonly checker: ts.TypeChecker;
  readonly units: ProgramUnits;
  readonly native: NativeFactsSource;
  readonly platform: Platform | undefined;
  readonly graph: FlowGraph;
  /** Calls that hand their arguments on and run none of the program's code while they run. */
  posts(call: ts.CallExpression): boolean;
  /** Import aliases resolved to what they name. */
  resolve(symbol: ts.Symbol): ts.Symbol;
}

/** The flags of types whose values cannot be objects or functions. */
const SCALAR =
  ts.TypeFlags.NumberLike |
  ts.TypeFlags.StringLike |
  ts.TypeFlags.BooleanLike |
  ts.TypeFlags.BigIntLike |
  ts.TypeFlags.EnumLike |
  ts.TypeFlags.Null |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Void |
  ts.TypeFlags.Never;

/** Whether values of `type` can be objects or functions: values that flow and alias. */
export function tracked(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.some(tracked);

  return !(type.flags & SCALAR);
}

const LOOPS = new Set([
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
]);

/** Syntax whose code the analyses do not model yet: it may do anything. */
const UNMODELED: Partial<Record<ts.SyntaxKind, string>> = {
  [ts.SyntaxKind.TaggedTemplateExpression]: "a tagged template",
  [ts.SyntaxKind.ClassExpression]: "a class expression",
};

/** JSX: a toolkit's body, whose code is the toolkit's (Swift, Kotlin). */
const JSX = [
  ts.SyntaxKind.JsxElement,
  ts.SyntaxKind.JsxSelfClosingElement,
  ts.SyntaxKind.JsxFragment,
] as const;

/** What a library member's result is, by how it relates to its receiver. */
const RESULTS: Record<NonNullable<LibraryEffect["result"]> | "new" | "call", NodeKind> = {
  receiver: "call",
  element: "part",
  copy: "fresh",
  new: "fresh",
  call: "call",
};

const AFFINITY_TEXT: Record<"main" | "worker" | "unknown", string> = {
  main: "runs on the main thread only",
  worker: "must run off the main thread",
  unknown: "has no known thread requirement",
};

/** Collects one unit's own facts, calls and flows. */
export class Collector {
  private readonly p: Program;
  private readonly unit: Unit;
  private readonly checker: ts.TypeChecker;
  private readonly graph: FlowGraph;
  private readonly facts: LocalFacts;
  /** Suspension points (await, yield) in the unit's own code. */
  private readonly suspensions: ts.Node[] = [];
  /** Uses of variables holding objects or functions, checked against suspension points. */
  private readonly references: { symbol: ts.Symbol; node: ts.Node }[] = [];

  constructor(p: Program, unit: Unit) {
    this.p = p;
    this.unit = unit;
    this.checker = p.checker;
    this.graph = p.graph;
    this.facts = { unit, own: new SummaryBuilder(), calls: [], mutations: [], captured: new Map() };
  }

  collect(): LocalFacts {
    const u = this.unit;

    u.params.forEach((param, index) => this.declareParam(param, index));

    if (u.async) this.own("allocates", "yes", u.node, "is async (it makes a promise)");

    if (u.generator) this.own("allocates", "yes", u.node, "is a generator (it makes an iterator)");

    if (u.kind === "constructor") this.construction();

    for (const n of u.code) {
      if (ts.isArrowFunction(u.node) && n === u.node.body && ts.isExpression(n))
        this.expressionBody(n);
      else this.visit(n);
    }

    this.awaitSinks();
    return this.facts;
  }

  /** An arrow's expression body: what it returns. */
  private expressionBody(body: ts.Expression): void {
    if (!this.pruned(body)) this.sink(this.expr(body), "returned", body, "is returned");
  }

  private declareParam(param: ts.ParameterDeclaration, index: number): void {
    if (!ts.isIdentifier(param.name)) {
      this.bindPattern(param.name, this.made(param.name, "part"), param);
      return;
    }

    const sym = parameterSymbol(
      this.checker,
      param as ts.ParameterDeclaration & { name: ts.Identifier },
    );

    this.graph.params.set(sym, { unit: this.unit, index });
    this.graph.declaredIn.set(sym, this.unit);
  }

  // --- facts -----------------------------------------------------------------------

  private cause(node: ts.Node, text: string): Cause {
    return step(this.unit, node, text);
  }

  private own(
    field: "allocates" | "throws",
    level: "yes" | "unknown",
    node: ts.Node,
    text: string,
  ): void {
    this.facts.own.level(this.facts.own[field], level, this.cause(node, text));
  }

  private flag(field: "suspends" | "schedules", node: ts.Node, text: string): void {
    this.facts.own.flag(field, this.cause(node, text));
  }

  /** A call the compiler cannot resolve may do anything. */
  private unknownEffects(node: ts.Node, text: string): void {
    this.facts.own.anything(this.cause(node, text));
  }

  private readModule(v: ModuleVar, node: ts.Node): void {
    const own = this.facts.own;
    const at = declaredAt(v.declaration);

    if (v.state) {
      const text = `reads module state ${code(v.name)}, ${v.state} (${at})`;

      own.entry(own.reads.vars, v.key, this.cause(node, text));
    } else if (v.assigned) {
      const text = `reads module constant ${code(v.name)}, ${v.assigned} (${at})`;

      own.entry(own.reads.constants, v.key, this.cause(node, text));
    }
  }

  // --- values and flows --------------------------------------------------------------

  private flow(
    from: readonly Value[],
    to: Value,
    kind: FlowKind,
    node: ts.Node,
    text: string,
  ): void {
    for (const f of from) this.graph.flow(f, { to, kind, unit: this.unit, node, text });
  }

  private sink(
    values: readonly Value[],
    kind: EscapeKind,
    node: ts.Node,
    text: string,
    dispatched = false,
  ): void {
    const sink: Sink = { kind, unit: this.unit, node, text, ...(dispatched ? { dispatched } : {}) };

    for (const v of values) this.graph.sink(v, sink);
  }

  /** `node` as a value of `kind`. */
  private made(node: ts.Node, kind: NodeKind): Value[] {
    this.graph.kinds.set(node, kind);
    return [node];
  }

  /** Whether the value at `node` can be an object or a function. */
  private carries(node: ts.Node): boolean {
    return tracked(this.checker.getTypeAtLocation(node));
  }

  /** The result of `node`, made elsewhere: a call's, an await's. */
  private result(node: ts.Node, kind: NodeKind = "call"): Value[] {
    return this.carries(node) ? this.made(node, kind) : [];
  }

  // --- statements ------------------------------------------------------------------

  private visit(n: ts.Node): void {
    if (this.pruned(n)) return;

    // A statement a toolkit's body takes (Compose's composition statements): its code is Kotlin.
    if (
      (ts.isVariableStatement(n) || ts.isExpressionStatement(n)) &&
      isToolkitBody(this.checker, n)
    )
      return;

    // A helper view: Swift or Kotlin, used by a body.
    if (
      helperStatement(this.checker, n) ||
      (ts.isVariableDeclaration(n) && !!n.initializer && isViewHelper(this.checker, n.initializer))
    )
      return;

    if (ts.isExpression(n)) {
      this.expr(n);
      return;
    }

    const statement = Collector.STATEMENTS[n.kind];

    if (statement) statement(this, n as never);
    else ts.forEachChild(n, (c) => this.visit(c));
  }

  /** How each kind of declaration or statement runs (the rest: its children, in order). */
  private static readonly STATEMENTS: Partial<
    Record<ts.SyntaxKind, (c: Collector, n: never) => void>
  > = {
    [ts.SyntaxKind.Parameter]: (c, p: ts.ParameterDeclaration) => {
      if (p.initializer) c.bindPattern(p.name, c.expr(p.initializer), p);
    },
    [ts.SyntaxKind.VariableDeclaration]: (c, d: ts.VariableDeclaration) =>
      c.bindPattern(d.name, d.initializer ? c.expr(d.initializer) : [], d),
    [ts.SyntaxKind.VariableDeclarationList]: (c, list: ts.VariableDeclarationList) => {
      for (const d of list.declarations) {
        c.visit(d);

        if (list.flags & ts.NodeFlags.Using) c.dispose(d);
      }
    },
    [ts.SyntaxKind.PropertyDeclaration]: (c, f: ts.PropertyDeclaration) => c.field(f),
    [ts.SyntaxKind.ReturnStatement]: (c, r: ts.ReturnStatement) => {
      if (r.expression) c.sink(c.expr(r.expression), "returned", r, "is returned");
    },
    [ts.SyntaxKind.ThrowStatement]: (c, t: ts.ThrowStatement) => {
      c.sink(c.expr(t.expression), "thrown", t, "is thrown");
      c.own("throws", "yes", t, "throws");
    },
    [ts.SyntaxKind.ForOfStatement]: (c, f: ts.ForOfStatement) => c.forOf(f),
    [ts.SyntaxKind.FunctionDeclaration]: (c, f: ts.FunctionDeclaration) => c.nestedFunction(f),
    // A nested class's members are units of their own.
    [ts.SyntaxKind.ClassDeclaration]: () => {},
  };

  /** Code for another platform: left out (on the host, it throws). */
  private pruned(n: ts.Node): boolean {
    if (!inOtherPlatform(this.checker, n, this.p.platform)) return false;

    if (!this.p.platform)
      this.own("throws", "yes", n, "runs platform code, which throws on the host");

    return true;
  }

  /** A field's initializer: a static field is module state, an instance's is part of `this`. */
  private field(f: ts.PropertyDeclaration): void {
    if (!f.initializer) return;

    const values = this.expr(f.initializer);
    const isStatic = !!ts.getModifiers(f)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
    const sym = this.checker.getSymbolAtLocation(f.name);

    if (isStatic && sym) this.flow(values, sym, "bind", f, `is stored in ${code(sym.name)}`);
    else this.flow(values, this.thisValue(), "contain", f, "is stored in a field");
  }

  /** Declares the names a binding binds; destructured names get parts of the value. */
  private bindPattern(name: ts.BindingName, values: readonly Value[], at: ts.Node): void {
    if (ts.isIdentifier(name)) {
      const sym = this.checker.getSymbolAtLocation(name);
      if (!sym) return;

      if (!this.graph.params.has(sym)) this.graph.declaredIn.set(sym, this.unit);

      this.flow(values, sym, "bind", at, `is assigned to ${code(sym.name)}`);
      return;
    }

    const part = this.made(name, "part");

    this.flow(values, name, "part", at, "is destructured");

    for (const e of name.elements) {
      if (ts.isOmittedExpression(e)) continue;

      const defaults = e.initializer ? this.expr(e.initializer) : [];

      this.bindPattern(e.name, [...part, ...defaults], e);
    }
  }

  private forOf(n: ts.ForOfStatement): void {
    const iterated = this.expr(n.expression);

    this.iterate(n.expression, n);

    if (n.awaitModifier) {
      this.suspend(n, "awaits in `for await`");
      this.flag("schedules", n, "awaits in `for await`");
      this.own("throws", "yes", n, "awaits (a rejection throws)");
    }

    const element = this.made(n.initializer, "part");

    this.flow(iterated, n.initializer, "part", n, "is iterated");

    if (ts.isVariableDeclarationList(n.initializer))
      for (const d of n.initializer.declarations) this.bindPattern(d.name, element, d);
    else this.assignTo(n.initializer, element, n);

    this.visit(n.statement);
  }

  private nestedFunction(f: ts.FunctionDeclaration): void {
    const values = this.closure(f);
    const sym = f.name && this.checker.getSymbolAtLocation(f.name);

    if (!sym) return;

    this.graph.declaredIn.set(sym, this.unit);
    this.flow(values, sym, "bind", f, `is ${code(sym.name)}`);
  }

  /** `using x = …`: its dispose method runs when the block ends. */
  private dispose(d: ts.VariableDeclaration): void {
    const type = this.checker.getNonNullableType(this.checker.getTypeAtLocation(d.name));
    const decl = type.getSymbol()?.declarations?.find(ts.isClassLike);
    const method = decl && this.p.units.classes.get(decl)?.members.get("[Symbol.dispose]");
    const text = `disposes ${code(d.name.getText())}`;
    const library = !method && decl ? libraryDisposer(decl) : undefined;
    const callee: Callee = method
      ? { kind: "units", units: method }
      : library
        ? { kind: "library", member: library }
        : { kind: "unknown", why: "a disposer the compiler cannot resolve" };

    this.call(d, text, callee, NO_ARGS);

    if (library?.effect?.throws) this.own("throws", "yes", d, `${text}, which can throw`);
  }

  /** A class without a constructor constructs its base first. */
  private construction(): void {
    const cls = this.classUnits();
    const explicit = cls?.declaration.members.some(
      (m) => ts.isConstructorDeclaration(m) && !!m.body,
    );
    const base = this.baseUnits();

    if (!explicit && base) this.constructBase(cls!.declaration, base, NO_ARGS);
  }

  private classUnits(): ClassUnits | undefined {
    return this.unit.class && this.p.units.classes.get(this.unit.class);
  }

  private baseUnits(): ClassUnits | undefined {
    const base = this.classUnits()?.base;

    return base && this.p.units.classes.get(base);
  }

  private constructBase(node: ts.Node, base: ClassUnits, args: Arguments): void {
    const text = `constructs its base ${code(base.construction.display)}`;

    this.call(node, text, { kind: "units", units: [base.construction] }, args);
  }

  /** References to variables after a suspension point of this unit: held across it. */
  private awaitSinks(): void {
    if (!this.suspensions.length) return;

    for (const { symbol, node } of this.references) {
      const local = this.graph.declaredIn.get(symbol) === this.unit;
      const from = local && symbol.valueDeclaration ? symbol.valueDeclaration.getEnd() : -1;
      const after = this.suspensions.find(
        (s) => s.getStart() > from && (s.getEnd() <= node.getStart() || sameLoop(s, node)),
      );

      if (!after) continue;

      const what = ts.isYieldExpression(after) ? "`yield`" : "`await`";

      this.graph.sink(symbol, {
        kind: "await",
        unit: this.unit,
        node,
        text: `is used after ${what} (${lineOf(after)})`,
      });
    }
  }

  // --- expressions -----------------------------------------------------------------

  /** Records what `e` does and gives the values it may evaluate to. */
  private expr(e: ts.Expression): Value[] {
    if (this.pruned(e)) return [];

    const expression = Collector.EXPRESSIONS[e.kind];

    if (expression) return expression(this, e as never);

    ts.forEachChild(e, (c) => this.visit(c));
    return [];
  }

  /** How each kind of expression is evaluated (the rest: its children, in order, giving no value). */
  private static readonly EXPRESSIONS: Partial<
    Record<ts.SyntaxKind, (c: Collector, e: never) => Value[]>
  > = {
    ...Object.fromEntries(
      Object.entries(UNMODELED).map(([kind, what]) => [
        kind,
        (c: Collector, e: ts.Expression) => c.unmodeled(e, what),
      ]),
    ),
    ...Object.fromEntries(JSX.map((kind) => [kind, (c: Collector, e: Jsx) => c.jsx(e)])),
    [ts.SyntaxKind.ParenthesizedExpression]: (c, e: ts.ParenthesizedExpression) =>
      c.expr(e.expression),
    [ts.SyntaxKind.AsExpression]: (c, e: ts.AsExpression) => c.expr(e.expression),
    [ts.SyntaxKind.TypeAssertionExpression]: (c, e: ts.TypeAssertion) => c.expr(e.expression),
    [ts.SyntaxKind.SatisfiesExpression]: (c, e: ts.SatisfiesExpression) => c.expr(e.expression),
    [ts.SyntaxKind.NonNullExpression]: (c, e: ts.NonNullExpression) => {
      c.own("throws", "yes", e, "asserts a value is present (`!` throws a TypeError)");
      return c.expr(e.expression);
    },
    [ts.SyntaxKind.Identifier]: (c, e: ts.Identifier) => c.identifier(e),
    [ts.SyntaxKind.ThisKeyword]: (c) => [c.thisValue()],
    [ts.SyntaxKind.ArrowFunction]: (c, e: ts.ArrowFunction) => c.closure(e),
    [ts.SyntaxKind.FunctionExpression]: (c, e: ts.FunctionExpression) => c.closure(e),
    [ts.SyntaxKind.ObjectLiteralExpression]: (c, e: ts.ObjectLiteralExpression) =>
      c.objectLiteral(e),
    [ts.SyntaxKind.ArrayLiteralExpression]: (c, e: ts.ArrayLiteralExpression) => c.arrayLiteral(e),
    [ts.SyntaxKind.CallExpression]: (c, e: ts.CallExpression) => c.callExpression(e),
    [ts.SyntaxKind.NewExpression]: (c, e: ts.NewExpression) => c.newExpression(e),
    [ts.SyntaxKind.PropertyAccessExpression]: (c, e: ts.PropertyAccessExpression) => c.property(e),
    [ts.SyntaxKind.ElementAccessExpression]: (c, e: ts.ElementAccessExpression) => {
      const object = c.expr(e.expression);

      c.expr(e.argumentExpression);
      return c.part(e, object);
    },
    [ts.SyntaxKind.BinaryExpression]: (c, e: ts.BinaryExpression) => c.binary(e),
    [ts.SyntaxKind.ConditionalExpression]: (c, e: ts.ConditionalExpression) => {
      c.expr(e.condition);
      return [...c.expr(e.whenTrue), ...c.expr(e.whenFalse)];
    },
    [ts.SyntaxKind.PrefixUnaryExpression]: (c, e: ts.PrefixUnaryExpression) => c.unary(e),
    [ts.SyntaxKind.PostfixUnaryExpression]: (c, e: ts.PostfixUnaryExpression) => c.unary(e),
    [ts.SyntaxKind.TemplateExpression]: (c, e: ts.TemplateExpression) => {
      c.own("allocates", "yes", e, "builds a string");
      for (const span of e.templateSpans) c.expr(span.expression);
      return [];
    },
    [ts.SyntaxKind.RegularExpressionLiteral]: (c, e: ts.RegularExpressionLiteral) => {
      c.own("allocates", "yes", e, "makes a regular expression");
      return c.made(e, "fresh");
    },
    [ts.SyntaxKind.AwaitExpression]: (c, e: ts.AwaitExpression) => {
      c.expr(e.expression);
      c.suspend(e, "awaits");
      c.flag("schedules", e, "awaits");
      c.own("throws", "yes", e, "awaits (a rejection throws)");
      return c.result(e);
    },
    [ts.SyntaxKind.YieldExpression]: (c, e: ts.YieldExpression) => {
      if (e.expression) c.sink(c.expr(e.expression), "yielded", e, "is yielded");
      c.suspend(e, "yields");
      return c.result(e);
    },
    [ts.SyntaxKind.DeleteExpression]: (c, e: ts.DeleteExpression) => {
      const target = skipOuter(e.expression);

      if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target))
        c.mutate(c.expr(target.expression), e, `deletes ${code(target.getText())}`);
      return [];
    },
    [ts.SyntaxKind.SpreadElement]: (c, e: ts.SpreadElement) => {
      c.own("allocates", "yes", e, "spreads values");
      c.iterate(e.expression, e);
      return c.expr(e.expression);
    },
  };

  /**
   * Iterating `e` runs code when it is an iterator (a generator, say) this
   * unit did not just make by calling a generator function, whose call
   * already counts: its code may do anything.
   */
  private iterate(e: ts.Expression, at: ts.Node): void {
    const type = this.checker.getTypeAtLocation(e);
    const inner = skipOuter(e);

    if (collection(this.checker, type) || isLiteral(inner)) return;

    if (ts.isCallExpression(inner) && this.generatorCall(inner)) return;

    this.unknownEffects(at, `iterates ${code(e.getText())}, an iterator whose code is not known`);
  }

  private generatorCall(call: ts.CallExpression): boolean {
    const decl = this.checker.getResolvedSignature(call)?.declaration;
    const unit = decl && this.p.units.byNode.get(decl);

    return !!unit?.generator;
  }

  /**
   * JSX: in a platform file, its toolkit's body, which makes the host the
   * toolkit draws in (its code is the toolkit's);
   * anywhere else, syntax the analyses do not model.
   */
  private jsx(e: Jsx): Value[] {
    if (!jsxToolkitOf(e))
      return this.unmodeled(e, ts.isJsxFragment(e) ? "a JSX fragment" : "a JSX element");

    this.own("allocates", "yes", e, "makes a toolkit's body");
    return this.made(e, "fresh");
  }

  /** Syntax the analyses do not model: anything may happen. */
  private unmodeled(e: ts.Expression, what: string): Value[] {
    this.unknownEffects(e, `uses ${what}, which the analyses do not model`);
    return this.result(e);
  }

  private suspend(e: ts.Node, text: string): void {
    this.suspensions.push(e);
    this.flag("suspends", e, text);
  }

  /** `x++`, `!x`, `-x`: an increment reads and writes its operand. */
  private unary(e: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression): Value[] {
    this.expr(e.operand);

    if (e.operator === ts.SyntaxKind.PlusPlusToken || e.operator === ts.SyntaxKind.MinusMinusToken)
      this.assignTo(e.operand, [], e, true);

    return [];
  }

  /** `this` here: its class's, or for an arrow function the enclosing unit's. */
  private thisValue(): ThisValue {
    let u: Unit | undefined = this.unit;

    while (u && ts.isArrowFunction(u.node)) u = u.parent;

    const owner =
      u?.class ?? (u && ts.isObjectLiteralExpression(u.node.parent) ? u.node.parent : u?.node);

    return this.graph.thisOf(owner ?? this.unit.node);
  }

  private identifier(id: ts.Identifier): Value[] {
    const found = symbolOf(this.checker, id);
    if (!found) return [];

    const sym = this.p.resolve(found);
    const moduleVar = this.p.units.moduleVars.get(sym);

    if (moduleVar) {
      this.readModule(moduleVar, id);
      return this.carries(id) ? [sym] : [];
    }

    const decl = sym.valueDeclaration;

    // A function declared at the top level, or not yet reached in this body.
    if (decl && ts.isFunctionDeclaration(decl) && !this.graph.declaredIn.has(sym)) {
      const unit = this.p.units.byNode.get(decl);

      if (unit) {
        this.graph.functions.set(decl, unit);
        return this.made(decl, "function");
      }
    }

    if (!this.carries(id)) {
      this.capture(sym, id);
      return [];
    }

    this.reference(sym, id);
    return [sym];
  }

  /** A use of a local, parameter or captured variable holding an object or a function. */
  private reference(sym: ts.Symbol, node: ts.Node): void {
    this.references.push({ symbol: sym, node });
    this.capture(sym, node);
  }

  /** Records a variable of an enclosing unit that this unit uses. */
  private capture(sym: ts.Symbol, node: ts.Node): void {
    const declared = this.graph.declaredIn.get(sym);
    const captured = declared && declared !== this.unit && within(this.unit, declared);

    if (captured && !this.facts.captured.has(sym)) this.facts.captured.set(sym, node);
  }

  private closure(f: ts.Node): Value[] {
    const unit = this.p.units.byNode.get(f);

    this.own("allocates", "yes", f, "makes a closure");

    if (!unit) return [];

    const values = this.made(f, "function");
    const text = `is captured by ${code(unit.display)}`;

    this.graph.functions.set(f, unit);

    for (const sym of freeVariables(this.checker, f as never)) {
      if (!tracked(this.checker.getTypeOfSymbol(sym))) continue;

      this.reference(sym, f);
      this.flow([sym], f, "capture", f, text);
    }

    if (ts.isArrowFunction(f) && usesThis(f)) this.flow([this.thisValue()], f, "capture", f, text);

    return values;
  }

  private objectLiteral(e: ts.ObjectLiteralExpression): Value[] {
    this.own("allocates", "yes", e, "makes an object");

    const literal = this.made(e, "fresh");

    for (const p of e.properties) {
      const values = ts.isPropertyAssignment(p)
        ? this.expr(p.initializer)
        : ts.isShorthandPropertyAssignment(p)
          ? this.identifier(p.name)
          : ts.isSpreadAssignment(p)
            ? this.expr(p.expression)
            : isFunctionLike(p)
              ? this.closure(p)
              : [];

      this.flow(values, e, "contain", p, "is put in an object");
    }

    return literal;
  }

  private arrayLiteral(e: ts.ArrayLiteralExpression): Value[] {
    this.own("allocates", "yes", e, "makes an array");

    const literal = this.made(e, "fresh");

    for (const el of e.elements) this.flow(this.expr(el), e, "contain", el, "is put in an array");

    return literal;
  }

  /** A value read out of `object` (a field, an element). */
  private part(e: ts.Expression, object: readonly Value[]): Value[] {
    if (!this.carries(e)) return [];

    this.flow(object, e, "part", e, `is read from ${code(e.getText())}`);
    return this.made(e, "part");
  }

  private property(e: ts.PropertyAccessExpression): Value[] {
    const object = this.expr(e.expression);
    const field = this.staticField(e);

    if (field) {
      this.readModule(field.v, e);
      return this.carries(e) ? [field.sym] : [];
    }

    const decl = this.declarationOf(e.name);
    const getters = decl ? this.accessors(e, decl, "get") : [];

    if (getters.length) {
      this.call(e, `reads ${code(e.getText())}`, { kind: "units", units: getters }, NO_ARGS);
      return this.result(e);
    }

    const use = decl && this.p.native.use(decl, "get");

    if (use) return this.native(e, use, NO_ARGS, `reads ${code(use.display)}`);

    return this.part(e, object);
  }

  /** A static field, which is module state. */
  private staticField(
    e: ts.PropertyAccessExpression,
  ): { v: ModuleVar; sym: ts.Symbol } | undefined {
    const found = this.checker.getSymbolAtLocation(e.name);
    const sym = found && this.p.resolve(found);
    const v = sym && this.p.units.moduleVars.get(sym);

    return v && sym ? { v, sym } : undefined;
  }

  /**
   * The getters (or setters) a property access runs: the declared one and
   * its overrides, or for an interface's property its implementers'.
   */
  private accessors(
    e: ts.PropertyAccessExpression,
    decl: ts.Declaration,
    kind: "get" | "set",
  ): Unit[] {
    const accessor = ts.isGetAccessorDeclaration(decl) || ts.isSetAccessorDeclaration(decl);
    const owner = decl.parent;
    const key = `${kind} ${e.name.text}`;

    if (accessor && ts.isClassLike(owner)) return this.dispatch(owner, key, isSuper(e.expression));

    const lucent = !decl.getSourceFile().isDeclarationFile;

    return lucent && ts.isPropertySignature(decl) && ts.isInterfaceDeclaration(owner)
      ? this.implementations(owner, key)
      : [];
  }

  /**
   * The units a call of member `key` of `cls` may run: its own (or
   * inherited) and, unless the call names it exactly (`super.m()`), its
   * subclasses' overrides. Every subclass is in the program.
   */
  private dispatch(cls: ts.ClassLikeDeclaration, key: string, exact: boolean): Unit[] {
    const own = this.inherited(cls, key);
    if (exact) return own;

    const overrides = [...this.p.units.classes.values()]
      .filter((c) => c.declaration !== cls && this.derives(c, cls))
      .flatMap((c) => c.members.get(key) ?? []);

    return [...own, ...overrides];
  }

  /** A member as a class has it: its own, else its nearest base's. */
  private inherited(cls: ts.ClassLikeDeclaration, key: string): Unit[] {
    const classes = this.p.units.classes;

    for (let c = classes.get(cls); c; c = c.base ? classes.get(c.base) : undefined) {
      const found = c.members.get(key);
      if (found) return [...found];
    }

    return [];
  }

  /** The methods named `key` of every class implementing `iface` (and its subclasses'). */
  private implementations(iface: ts.InterfaceDeclaration, key: string): Unit[] {
    const out = new Set<Unit>();
    const classes = this.p.units.classes;
    const implementing = (c: ClassUnits | undefined): boolean =>
      !!c && (c.implements.includes(iface) || implementing(c.base && classes.get(c.base)));

    for (const c of classes.values())
      if (implementing(c)) for (const u of this.dispatch(c.declaration, key, false)) out.add(u);

    return [...out];
  }

  private derives(c: ClassUnits, base: ts.ClassLikeDeclaration): boolean {
    for (let b = c.base; b; b = this.p.units.classes.get(b)?.base) if (b === base) return true;

    return false;
  }

  private declarationOf(name: ts.Node): ts.Declaration | undefined {
    const sym = this.checker.getSymbolAtLocation(name);
    const resolved = sym && this.p.resolve(sym);

    return resolved?.valueDeclaration ?? resolved?.declarations?.[0];
  }

  // --- assignments -----------------------------------------------------------------

  private binary(e: ts.BinaryExpression): Value[] {
    const op = e.operatorToken.kind;

    if (op === ts.SyntaxKind.EqualsToken) {
      const values = this.expr(e.right);

      this.assignTo(e.left, values, e);
      return values;
    }

    if (op >= ts.SyntaxKind.FirstCompoundAssignment && op <= ts.SyntaxKind.LastCompoundAssignment) {
      const current = this.expr(e.left);
      const values = this.expr(e.right);
      const logical =
        op === ts.SyntaxKind.BarBarEqualsToken ||
        op === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
        op === ts.SyntaxKind.QuestionQuestionEqualsToken;

      if (op === ts.SyntaxKind.PlusEqualsToken && isString(this.checker, e))
        this.own("allocates", "yes", e, "builds a string");

      this.assignTo(e.left, logical ? values : [], e, true);
      return [...current, ...values];
    }

    if (
      op === ts.SyntaxKind.AmpersandAmpersandToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken
    )
      return [...this.expr(e.left), ...this.expr(e.right)];

    if (op === ts.SyntaxKind.CommaToken) {
      this.expr(e.left);
      return this.expr(e.right);
    }

    this.expr(e.left);
    this.expr(e.right);

    if (op === ts.SyntaxKind.PlusToken && isString(this.checker, e))
      this.own("allocates", "yes", e, "builds a string");

    return [];
  }

  /**
   * Writes `values` to `target`. `evaluated`: the target was already
   * evaluated (a compound assignment's left side), so its parts are not
   * visited again.
   */
  private assignTo(
    target: ts.Node,
    values: readonly Value[],
    at: ts.Node,
    evaluated = false,
  ): void {
    if (
      ts.isParenthesizedExpression(target) ||
      ts.isNonNullExpression(target) ||
      ts.isAsExpression(target) ||
      ts.isTypeAssertionExpression(target)
    ) {
      this.assignTo(target.expression, values, at, evaluated);
      return;
    }

    if (ts.isIdentifier(target)) {
      this.assignVariable(target, values, at);
      return;
    }

    if (ts.isPropertyAccessExpression(target)) {
      this.assignProperty(target, values, at, evaluated);
      return;
    }

    if (ts.isElementAccessExpression(target)) {
      const object = evaluated ? this.valuesOf(target.expression) : this.expr(target.expression);

      if (!evaluated) this.expr(target.argumentExpression);

      this.store(
        object,
        values,
        at,
        `writes ${code(target.getText())}`,
        `is stored in ${code(target.getText())}`,
      );
      return;
    }

    if (ts.isArrayLiteralExpression(target) || ts.isObjectLiteralExpression(target)) {
      this.destructure(target, values, at);
      return;
    }

    this.visit(target);
  }

  /** `[a, b] = …`, `({ a } = …)`: each target gets part of the value. */
  private destructure(
    target: ts.ArrayLiteralExpression | ts.ObjectLiteralExpression,
    values: readonly Value[],
    at: ts.Node,
  ): void {
    const part = this.made(target, "part");

    this.flow(values, target, "part", at, "is destructured");

    const elements = ts.isArrayLiteralExpression(target)
      ? target.elements
      : target.properties.map((p) =>
          ts.isPropertyAssignment(p)
            ? p.initializer
            : ts.isShorthandPropertyAssignment(p)
              ? p.name
              : ts.isSpreadAssignment(p)
                ? p.expression
                : p,
        );

    for (const el of elements) {
      const inner = ts.isSpreadElement(el) ? el.expression : el;
      const withDefault =
        ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.EqualsToken;
      const defaults = withDefault ? this.expr(inner.right) : [];

      this.assignTo(withDefault ? inner.left : inner, [...part, ...defaults], at);
    }
  }

  private assignVariable(id: ts.Identifier, values: readonly Value[], at: ts.Node): void {
    const found = symbolOf(this.checker, id);
    if (!found) return;

    const sym = this.p.resolve(found);
    const moduleVar = this.p.units.moduleVars.get(sym);

    if (moduleVar) {
      const text = `assigns module state ${code(moduleVar.name)}`;

      this.facts.own.entry(this.facts.own.writes.vars, moduleVar.key, this.cause(at, text));
      this.flow(values, sym, "bind", at, `is assigned to ${code(moduleVar.name)}`);
      return;
    }

    this.reference(sym, id);
    this.flow(values, sym, "bind", at, `is assigned to ${code(sym.name)}`);
  }

  private assignProperty(
    target: ts.PropertyAccessExpression,
    values: readonly Value[],
    at: ts.Node,
    evaluated: boolean,
  ): void {
    const object = evaluated ? this.valuesOf(target.expression) : this.expr(target.expression);
    const field = this.staticField(target);

    if (field) {
      const text = `assigns module state ${code(field.v.name)}`;

      this.facts.own.entry(this.facts.own.writes.vars, field.v.key, this.cause(at, text));
      this.flow(values, field.sym, "bind", at, `is assigned to ${code(field.v.name)}`);
      return;
    }

    const decl = this.declarationOf(target.name);
    const setters = decl ? this.accessors(target, decl, "set") : [];

    if (setters.length) {
      this.call(
        at,
        `sets ${code(target.getText())}`,
        { kind: "units", units: setters },
        given(values),
      );
      return;
    }

    const use = decl && this.p.native.use(decl, "set");

    if (use) {
      this.native(at, use, given(values), `sets ${code(use.display)}`);
      return;
    }

    this.store(
      object,
      values,
      at,
      `writes ${code(target.getText())}`,
      `is stored in ${code(target.getText())}`,
    );
  }

  /** The values an already evaluated expression is. */
  private valuesOf(e: ts.Expression): Value[] {
    const inner = skipOuter(e);

    if (inner.kind === ts.SyntaxKind.ThisKeyword) return [this.thisValue()];

    if (ts.isIdentifier(inner)) {
      const found = symbolOf(this.checker, inner);

      return found && this.carries(inner) ? [this.p.resolve(found)] : [];
    }

    const field = ts.isPropertyAccessExpression(inner) ? this.staticField(inner) : undefined;

    if (field) return this.carries(inner) ? [field.sym] : [];

    return this.graph.kinds.has(inner) ? [inner] : [];
  }

  /** Stores `values` into the object `object` may be: it mutates it, and now holds them. */
  private store(
    object: readonly Value[],
    values: readonly Value[],
    at: ts.Node,
    text: string,
    stored: string,
  ): void {
    this.mutate(object, at, text);

    for (const o of object) this.flow(values, o, "contain", at, stored);
  }

  private mutate(values: readonly Value[], node: ts.Node, text: string): void {
    this.facts.mutations.push({ values, node, text });
  }

  // --- calls -----------------------------------------------------------------------

  private args(node: ts.CallExpression | ts.NewExpression): Arguments {
    const list = node.arguments ?? [];

    return {
      args: list.map((a) => this.expr(a)),
      functions: list.map((a) => this.isFunction(a)),
      spread: list.some(ts.isSpreadElement),
    };
  }

  private isFunction(n: ts.Node): boolean {
    const t = this.checker.getNonNullableType(this.checker.getTypeAtLocation(n));

    return t.getCallSignatures().length > 0;
  }

  private callExpression(e: ts.CallExpression): Value[] {
    const callee = skipOuter(e.expression);

    if (this.p.posts(e)) return this.posted(e, callee);

    if (isSuper(callee)) {
      const args = this.args(e);
      const base = this.baseUnits();

      if (base) this.constructBase(e, base, args);
      return [];
    }

    if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
      return this.methodCall(e, callee);

    if (!ts.isIdentifier(callee)) {
      const fn = this.expr(callee);
      return this.call(e, "calls a function value", valueCallee(fn), this.args(e));
    }

    const decl = this.declarationOf(callee);

    // A helper view, called: it makes views, its code the toolkit's (the emitter refuses it outside a body).
    const helper =
      decl && ts.isVariableDeclaration(decl) && decl.initializer ? decl.initializer : decl;

    if (helper && isViewHelper(this.checker, helper)) {
      this.own("allocates", "yes", e, "makes a toolkit's views");
      return this.made(e, "fresh");
    }

    const text = `calls ${code(callee.text)}`;
    const unit = decl && ts.isFunctionDeclaration(decl) ? this.p.units.byNode.get(decl) : undefined;
    const local = !!decl && !decl.getSourceFile().isDeclarationFile && !unit;
    const fn = local ? this.expr(callee) : [];
    const args = this.args(e);

    if (unit) return this.call(e, text, { kind: "units", units: [unit] }, args);

    if (local) return this.call(e, text, valueCallee(fn), args);

    const signature = this.checker.getResolvedSignature(e)?.declaration;

    return this.external(e, signature ?? decl, [], args, text);
  }

  /** A call that hands its arguments on: its operands are evaluated here, and its arguments copied. */
  private posted(e: ts.CallExpression, callee: ts.Expression): Value[] {
    const access = ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee);

    this.expr(access ? callee.expression : callee);

    if (ts.isElementAccessExpression(callee)) this.expr(callee.argumentExpression);

    for (const a of e.arguments) this.expr(a);

    this.own("allocates", "yes", e, `posts a call of ${code(callee.getText())}`);

    return [];
  }

  private methodCall(
    e: ts.CallExpression,
    callee: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  ): Value[] {
    const receiver = this.expr(callee.expression);
    const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee.argumentExpression;

    if (ts.isElementAccessExpression(callee)) this.expr(callee.argumentExpression);

    const signature = this.checker.getResolvedSignature(e)?.declaration;
    // A computed name (`[Symbol.dispose]`) names its key's symbol: the signature names the method.
    const decl =
      signature && ts.isMethodDeclaration(signature) ? signature : this.declarationOf(name);
    const unit = decl && this.p.units.byNode.get(decl);
    const args = this.args(e);
    const text = `calls ${code(callee.getText())}`;
    const cls =
      decl && ts.isMethodDeclaration(decl) && ts.isClassLike(decl.parent) ? decl.parent : undefined;

    // A Lucent class's method, abstract ones included: whichever override the object has.
    if (decl && cls && this.p.units.classes.has(cls)) {
      const units = unit?.static
        ? [unit]
        : this.dispatch(cls, memberKeyOf(decl as ts.MethodDeclaration), isSuper(callee.expression));

      return this.call(e, text, { kind: "units", units }, args);
    }

    // An interface's method: only classes that declare they implement it derive from it.
    if (
      decl &&
      ts.isMethodSignature(decl) &&
      ts.isInterfaceDeclaration(decl.parent) &&
      !decl.getSourceFile().isDeclarationFile
    )
      return this.call(
        e,
        text,
        { kind: "units", units: this.implementations(decl.parent, memberKeyOf(decl)) },
        args,
      );

    if (decl && unit && ts.isObjectLiteralExpression(decl.parent)) {
      const literal = { kind: "literal" as const, receiver, literal: decl.parent, unit };

      return this.call(e, text, literal, args);
    }

    if (decl && decl.getSourceFile().isDeclarationFile && !isField(decl))
      return this.external(e, signature ?? decl, receiver, args, text);

    // A field holding a function, an interface's method: whatever the object holds.
    return this.call(e, text, valueCallee(this.part(callee, receiver)), args);
  }

  private newExpression(e: ts.NewExpression): Value[] {
    const decl = this.declarationOf(e.expression);
    const cls = decl && ts.isClassLike(decl) ? this.p.units.classes.get(decl) : undefined;
    const args = this.args(e);
    const text = `constructs ${code(e.expression.getText())}`;

    if (cls) {
      this.own("allocates", "yes", e, "makes an object");
      return this.call(e, text, { kind: "units", units: [cls.construction] }, args);
    }

    // An SDK class without a declared constructor: a use of the class itself.
    const signature = this.checker.getResolvedSignature(e)?.declaration;

    return this.external(e, signature ?? decl, [], args, text);
  }

  /** A call of something declared outside Lucent code: the library's, an SDK's, or unknown. */
  private external(
    e: ts.CallExpression | ts.NewExpression,
    decl: ts.Declaration | undefined,
    receiver: readonly Value[],
    args: Arguments,
    text: string,
  ): Value[] {
    const member = decl && libraryMember(decl);

    if (member) return this.library(e, member, receiver, args, text);

    const use = decl && this.p.native.use(decl, ts.isNewExpression(e) ? "new" : "call");

    if (use) return this.native(e, use, args, `calls ${code(use.display)}`);

    const unknown = { kind: "unknown" as const, why: "a function the compiler cannot resolve" };

    return this.call(e, text, unknown, args);
  }

  /** Records a call and gives its result's values. */
  private call(node: ts.Node, text: string, callee: Callee, args: Arguments): Value[] {
    this.facts.calls.push({ unit: this.unit, node, text, callee, ...args });

    if (callee.kind === "unknown") {
      this.unknownEffects(node, `${text}, ${callee.why}`);
      this.sink(args.args.flat(), "passed", node, `is passed to ${callee.why}`);
    }

    return this.result(node);
  }

  private library(
    e: ts.CallExpression | ts.NewExpression,
    member: LibraryMember,
    receiver: readonly Value[],
    given: Arguments,
    text: string,
  ): Value[] {
    const effect = member.effect;
    const named = `calls ${code(member.name)}`;
    const args = given.args;

    this.facts.calls.push({
      unit: this.unit,
      node: e,
      text,
      callee: { kind: "library", member },
      ...given,
    });

    // A member missing from the table may do anything: `f.call()` runs its receiver.
    if (!effect) {
      const why = `${code(member.name)}, whose effects are not known`;

      this.unknownEffects(e, `calls ${why}`);
      this.sink([...receiver, ...args.flat()], "passed", e, `is passed to ${why}`);
      return this.result(e);
    }

    if (effect.allocates) this.own("allocates", "yes", e, named);

    const iterated = effect.iterates ? e.arguments?.[0] : undefined;

    if (iterated) this.iterate(iterated, e);

    if (effect.throws) this.own("throws", "yes", e, `${named}, which can throw`);

    if (effect.schedules) this.flag("schedules", e, `${named}, which continues later`);

    if (effect.mutates) this.mutate(receiver, e, named);

    if (effect.task)
      this.sink(
        args[0] ?? [],
        "passed",
        e,
        `is passed to ${code(member.name)}, which runs it on a worker`,
        true,
      );

    if (effect.calls === "later" || effect.main)
      this.sink(
        args.flat(),
        "passed",
        e,
        `is passed to ${code(member.name)}, which runs it later`,
        true,
      );

    const result = this.result(e, RESULTS[effect.result ?? (effect.allocates ? "new" : "call")]);

    if (effect.keeps === "receiver") {
      const into =
        ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)
          ? ` in ${code(e.expression.expression.getText())}`
          : "";

      this.store(receiver, args.flat(), e, named, `is kept by ${code(member.name)}${into}`);
    }

    if (effect.keeps === "result")
      for (const r of result)
        this.flow(args.flat(), r, "contain", e, `is kept by ${code(member.name)}`);

    for (const r of result) this.returned(effect.result, receiver, r, e, member.name);

    return result;
  }

  /** How what a library member returns relates to its receiver. */
  private returned(
    kind: LibraryEffect["result"],
    receiver: readonly Value[],
    result: Value,
    e: ts.CallExpression | ts.NewExpression,
    name: string,
  ): void {
    const text = `is returned by ${code(name)}`;

    if (kind === "receiver") this.flow(receiver, result, "alias", e, text);

    if (kind === "element") this.flow(receiver, result, "part", e, text);

    // A new object holding the receiver's elements: a part of it, contained.
    if (kind === "copy") {
      const elements = this.made(e.expression, "part");

      this.flow(receiver, e.expression, "part", e, `is read by ${code(name)}`);
      this.flow(elements, result, "contain", e, text);
    }
  }

  private native(node: ts.Node, use: NativeUse, given: Arguments, text: string): Value[] {
    const args = given.args;

    this.facts.calls.push({
      unit: this.unit,
      node,
      text,
      callee: { kind: "native", use },
      ...given,
    });

    if (use.constant) return [];

    const c = this.cause(node, text);
    const own = this.facts.own;
    const { affinity, blocking } = use.facts;

    own.level(own.native, "known", c);

    if (affinity !== "any")
      own.level(
        own.affinity,
        affinity,
        this.cause(node, `${text}, which ${AFFINITY_TEXT[affinity]}`),
      );

    if (blocking !== "no") own.level(own.blocking, blocking, c);

    own.level(own.throws, use.throws ? "yes" : "unknown", c);
    own.level(own.allocates, "unknown", c);

    args.forEach((values, i) => {
      const cb = use.callbacks.get(i);

      if (use.copies.has(i) || cb?.timing === "during-call") return;

      this.sink(
        values,
        "passed",
        node,
        `is passed to ${code(use.display)}, which may keep it`,
        !!cb,
      );
    });

    return this.result(node);
  }
}

/** A call's arguments: what each may be, which are functions, and whether one is spread. */
export interface Arguments {
  readonly args: readonly (readonly Value[])[];
  readonly functions: readonly boolean[];
  readonly spread: boolean;
}

const NO_ARGS: Arguments = { args: [], functions: [], spread: false };

/** A single value given (a setter's). */
function given(values: readonly Value[]): Arguments {
  return { args: [values], functions: [false], spread: false };
}

/** Iterables whose iteration runs no user code: the library's collections, strings, tuples. */
const COLLECTIONS = new Set([
  "Array",
  "ReadonlyArray",
  "Set",
  "ReadonlySet",
  "Map",
  "ReadonlyMap",
  "Uint8Array",
  "String",
  // The library's own iterators.
  "ArrayIterator",
  "MapIterator",
  "SetIterator",
  "StringIterator",
  "RegExpStringIterator",
]);

function isLiteral(e: ts.Expression): boolean {
  return ts.isObjectLiteralExpression(e) || ts.isArrayLiteralExpression(e);
}

function collection(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (type.isUnion()) return type.types.every((t) => collection(checker, t));

  if (type.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined))
    return true;

  if (checker.isTupleType(type) || checker.isArrayType(type)) return true;

  return COLLECTIONS.has(type.getSymbol()?.getName() ?? "");
}

/** A call of a function value, or an unknown one when there is no value to follow. */
function valueCallee(values: readonly Value[]): Callee {
  return values.length
    ? { kind: "value", values }
    : { kind: "unknown", why: "a function value the compiler cannot resolve" };
}

/** `x` without the parentheses, type assertions and `!` around it. */
function skipOuter(e: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isTypeAssertionExpression(e)
  )
    e = e.expression;

  return e;
}

function isSuper(e: ts.Node): boolean {
  return e.kind === ts.SyntaxKind.SuperKeyword;
}

/** A property declaration: its value may be any function of its type. */
function isField(d: ts.Declaration): boolean {
  return ts.isPropertyDeclaration(d) || ts.isPropertySignature(d) || ts.isPropertyAssignment(d);
}

function memberKeyOf(m: ts.MethodDeclaration | ts.MethodSignature): string {
  return ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name) || ts.isStringLiteral(m.name)
    ? m.name.text
    : m.name.getText();
}

function isString(checker: ts.TypeChecker, e: ts.Node): boolean {
  return !!(checker.getTypeAtLocation(e).flags & ts.TypeFlags.StringLike);
}

/** Whether a loop around `a` (in its function) also runs `b`, so `b` can follow `a`. */
function sameLoop(a: ts.Node, b: ts.Node): boolean {
  for (let n: ts.Node | undefined = a.parent; n && !isFunctionLike(n); n = n.parent)
    if (LOOPS.has(n.kind) && b.getStart() >= n.getStart() && b.getEnd() <= n.getEnd()) return true;

  return false;
}

/** Whether `inner` is `outer` or created (transitively) by it. */
export function within(inner: Unit, outer: Unit): boolean {
  for (let u: Unit | undefined = inner; u; u = u.parent) if (u === outer) return true;

  return false;
}

/** "line 12". */
function lineOf(n: ts.Node): string {
  const sf = n.getSourceFile();

  return `line ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
}

/** "declared at m.lucent.ts:3:7". */
export function declaredAt(n: ts.Node): string {
  const sf = n.getSourceFile();
  const { line, character } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
  const file = sf.fileName.split(/[\\/]/).pop();

  return `declared at ${file}:${line + 1}:${character + 1}`;
}

/** The library's `[Symbol.dispose]` of a declared class (lucent:core's NativeBuffer), when its effects are known. */
function libraryDisposer(cls: ts.ClassLikeDeclaration): LibraryMember | undefined {
  if (!cls.getSourceFile().isDeclarationFile) return undefined;

  const disposer = cls.members.find(
    (m) =>
      !!m.name &&
      ts.isComputedPropertyName(m.name) &&
      m.name.expression.getText() === "Symbol.dispose",
  );
  const member = disposer && libraryMember(disposer);

  return member?.effect ? member : undefined;
}
