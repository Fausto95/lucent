/**
 * SwiftUI bodies (iOS, under the internal LUCENT_VIEWS=fabric switch): the
 * function a component's setup gives `swiftUI(() => …)`, written out as
 * SwiftUI (`views/<registration>.swift`). The rest of the setup is compiled
 * into C++ as any setup's; toolkit.ts feeds the body's slots
 * (ui/toolkit-body.ts) through the C functions of lucent/platform/swiftui.h.
 *
 * In the body, SwiftUI's views, modifiers and values (`Color.green`) are
 * Swift, and so are literals. A value the setup computes (`on.get()`,
 * `` `${props.title}` ``) is a property of the view's observable model,
 * which an effect of the setup sets on the main thread, so SwiftUI draws
 * again. A callback calls the setup's functions (actions), which the Swift
 * calls by index.
 *
 * lucent:swiftui is generated from SwiftUI's own declarations, and each
 * call is written as its member's schema says (ui/source-members.ts):
 * Swift's unlabeled arguments are given in order, its labeled ones as one
 * object literal, and a closure last (a view's content as an array
 * literal, which becomes a trailing view builder, or an action); each
 * argument goes back where its parameter is, with its label. A
 * conditional view in content is SwiftUI's `if`.
 *
 * `withAnimation(animation, body)` in the setup's code runs SwiftUI's
 * withAnimation (a `@_cdecl` shim per call site, the animation written out
 * in Swift) around the Lucent `body`, whose writes' effects run inside it.
 *
 * The generated Swift, for a component `Toggle`:
 *
 *   fileprivate final class ToggleActions   (the C context and its functions)
 *   fileprivate final class ToggleModel: ObservableObject   (@Published per value)
 *   fileprivate struct ToggleView: View      (the body)
 *   @_cdecl lucent_swiftui_<registration>_make      → a retained UIHostingController
 *   @_cdecl lucent_swiftui_<registration>_set<n>    (one per value slot)
 *   @_cdecl lucent_swiftui_<registration>_animate<n> (one per withAnimation)
 */
import { type CallPart, SWIFT_SCALARS, unsupportedReason } from "@lucent-lang/bindgen";
import { cpp, swift } from "@lucent-lang/codegen";
import path from "node:path";
import ts from "typescript";
import { compareVersions } from "../package-versions.ts";
import { MIN_IOS, type SdkParam } from "../sdk/schema.ts";
import { cppIdent, T } from "../types.ts";
import type { ViewType } from "../ui/contract.ts";
import { type SourceMember, sourceMemberOf } from "../ui/source-members.ts";
import {
  bodyFail,
  type BodyFunction,
  isBind,
  isUiForm,
  Crossings,
  type ListSlot,
  type ScalarType,
  scalarOf,
  skipParentheses,
  toolkitOfDeclaration,
  toolkitDeclaration,
} from "../ui/toolkit-body.ts";
import type { E } from "./context.ts";
import type { FnEmitter } from "./function.ts";
import { bodySetup, mountContent, type Setup, setupOf } from "./setups.ts";
import type { ToolkitEmitter, ToolkitFile } from "./toolkit.ts";
import { scalarType } from "./toolkit-values.ts";

/** How each kind of value is held in Swift and crosses from C++. */
const VALUE_TYPES: Record<
  ScalarType["k"],
  {
    readonly swift: swift.Type;
    readonly initial: swift.Expr;
    readonly c: cpp.Type;
    /** The C argument for a Lucent value. */
    readonly toC: (value: cpp.Expr) => cpp.Expr;
    /** The Swift value of the C argument `value`. */
    readonly fromC: (value: swift.Expr) => swift.Expr;
  }
> = {
  boolean: {
    swift: swift.type("Bool"),
    initial: swift.bool(false),
    c: cpp.type("bool"),
    toC: (v) => v,
    fromC: (v) => v,
  },
  number: {
    swift: swift.type("Double"),
    initial: swift.num(0),
    c: cpp.type("double"),
    toC: (v) => v,
    fromC: (v) => v,
  },
  string: {
    swift: swift.type("String"),
    initial: swift.str(""),
    c: cpp.pointer(cpp.voidType),
    // Borrowed: the string lives until the call returns.
    toC: (v) =>
      cpp.cast("bridge", cpp.pointer(cpp.voidType), cpp.call("lucent::objc::toNSString", [v])),
    fromC: (v) =>
      swift.cast(
        swift.call(
          swift.member(
            swift.call(swift.name("Unmanaged<NSString>.fromOpaque"), [{ value: v }]),
            "takeUnretainedValue",
          ),
          [],
        ),
        "as",
        swift.type("String"),
      ),
  },
};

/** A value of the model that crosses as it is: a number, a boolean or a string, never null. */
function typedScalar(t: ViewType): ScalarType | undefined {
  const scalar = scalarOf(t);

  return scalar && !scalar.nullable ? scalar : undefined;
}

/**
 * The Swift side of plain data (emit/toolkit-values.ts): each value's
 * Swift type, its first value, and how it is read from the Foundation
 * objects that encode it. An object is a struct of its own, whose fields
 * are read by place.
 */
class SwiftValues {
  /** The structs of the objects met, by their view type. */
  readonly structs: swift.Decl[] = [];

  private readonly names = new Map<string, string>();
  private readonly prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  type(t: ViewType): swift.Type {
    switch (t.k) {
      case "number":
        return swift.type("Double");
      case "boolean":
        return swift.type("Bool");
      case "string":
      case "enum":
        return swift.type("String");
      case "nullable":
        return swift.optional(this.type(t.inner));
      case "array":
        return swift.array(this.type(t.element));
      case "object":
        return swift.type(this.struct(t));
    }
  }

  /** The value a model property holds before the setup's effect sets it. */
  zero(t: ViewType): swift.Expr {
    switch (t.k) {
      case "number":
        return swift.num(0);
      case "boolean":
        return swift.bool(false);
      case "string":
      case "enum":
        return swift.str("");
      case "nullable":
        return swift.nil;
      case "array":
        return swift.arrayLiteral([]);
      case "object":
        return swift.call(swift.name(this.struct(t)), []);
    }
  }

  /** The value of type `t` the Foundation object `x` encodes. */
  decode(t: ViewType, x: swift.Expr): swift.Expr {
    switch (t.k) {
      case "number":
        return swift.member(swift.cast(x, "as!", swift.type("NSNumber")), "doubleValue");
      case "boolean":
        return swift.member(swift.cast(x, "as!", swift.type("NSNumber")), "boolValue");
      case "string":
      case "enum":
        return swift.cast(x, "as!", swift.type("String"));
      case "nullable":
        return swift.cast(
          swift.conditional(
            swift.binary(swift.cast(x, "as?", swift.type("NSNull")), "==", swift.nil),
            this.decode(t.inner, x),
            swift.nil,
          ),
          "as",
          this.type(t),
        );
      case "array":
        return swift.call(
          swift.member(swift.cast(x, "as!", swift.array(swift.type("Any"))), "map"),
          [],
          swift.closure([], [swift.exprStmt(this.decode(t.element, swift.name("$0")))]),
        );
      case "object":
        return swift.call(swift.name(this.struct(t)), [{ value: x }]);
    }
  }

  /** The struct of an object type: its fields (f0, f1… in order), read from a record. */
  private struct(t: ViewType & { k: "object" }): string {
    const key = JSON.stringify(t);
    const found = this.names.get(key);

    if (found) return found;

    const name = `${this.prefix}Value${this.names.size}`;
    const fields = swift.name("fields");

    this.names.set(key, name);
    this.structs.push({
      k: "struct",
      name,
      modifiers: ["fileprivate"],
      protocols: [swift.type("Equatable")],
      members: [
        ...t.fields.map((f, i): swift.Member => {
          const type: ViewType =
            f.optional && f.type.k !== "nullable" ? { k: "nullable", inner: f.type } : f.type;

          return {
            k: "var",
            modifiers: [],
            name: `f${i}`,
            type: this.type(type),
            init: this.zero(type),
          };
        }),
        { k: "init", modifiers: [], params: [], body: [] },
        {
          k: "init",
          modifiers: [],
          params: [{ external: "_", name: "x", type: swift.type("Any") }],
          body: [
            swift.letStmt(
              "fields",
              swift.cast(swift.name("x"), "as!", swift.array(swift.type("Any"))),
            ),
            ...t.fields.map((f, i) => {
              const type: ViewType =
                f.optional && f.type.k !== "nullable" ? { k: "nullable", inner: f.type } : f.type;

              return swift.exprStmt(
                swift.assign(
                  swift.name(`f${i}`),
                  this.decode(type, swift.index(fields, swift.num(i))),
                ),
              );
            }),
          ],
        },
      ],
    });

    return name;
  }
}

/** A SwiftUI component's body and animations, as its setup is compiled. */
class SwiftUIBody {
  /** The Swift of each withAnimation call's animation, by call site. */
  readonly animations: { animation: swift.Expr; args: readonly ScalarType[] }[] = [];
  /** The body's slots, its view and its lists' rows, once its swiftUI() call is compiled. */
  written?: {
    crossings: Crossings;
    view: swift.Expr;
    rows: readonly Row[];
    environment: ReadonlyMap<string, swift.Type>;
  };

  readonly setup: Setup;

  constructor(setup: Setup) {
    this.setup = setup;
  }

  get registration(): string {
    return this.setup.component.registration;
  }

  /** The Swift names of the component's view, model, actions and hosting controller. */
  get names(): { view: string; model: string; actions: string; hosting: string } {
    const base = cppIdent(this.setup.component.export);

    return {
      view: `${base}View`,
      model: `${base}Model`,
      actions: `${base}Actions`,
      hosting: `${base}Hosting`,
    };
  }

  symbol(what: string): string {
    return `lucent_swiftui_${this.registration}_${what}`;
  }
}

/** Each SwiftUI setup's body, made as its setup is compiled. */
const bodies = new WeakMap<Setup, SwiftUIBody>();

function swiftUIBodyOf(setup: Setup): SwiftUIBody {
  let body = bodies.get(setup);

  if (!body) {
    body = new SwiftUIBody(setup);
    bodies.set(setup, body);
  }

  return body;
}

export const swiftUIEmitter: ToolkitEmitter = {
  body(em, setup, fn) {
    const body = swiftUIBodyOf(setup);
    const crossings = new Crossings(em.checker, "swiftui", bodySetup(setup), fn);
    const rows: Row[] = [];
    const writer = new BodyWriter(em.checker, crossings, ROOT, rows);
    const view = writer.view(returnedView(fn));
    const unit = em.ctx.nativeUnit(em.opts.module);
    const actions = em.ctx.fresh("lucent_actions");
    const host = em.ctx.fresh("lucent_host");
    const make = body.symbol("make");
    const raw = cpp.pointer(cpp.voidType);

    body.written = { crossings, view, rows, environment: writer.environment };

    unit.include("lucent/platform/swiftui.h");
    unit.include("lucent/platform/ios.h");
    declare(em, make, raw, [
      cpp.param(raw, "context"),
      cpp.param(cpp.type("lucent::swiftui::Invoke"), "invoke"),
      cpp.param(cpp.type("lucent::swiftui::Release"), "release"),
      cpp.param(cpp.type("lucent::swiftui::Resized"), "resized"),
    ]);

    // The actions hold the mount's content, which a size change of the body marks.
    em.emit(
      cpp.varDecl(
        cpp.auto,
        actions,
        cpp.call("std::make_shared", [mountContent(em)], [cpp.type("lucent::swiftui::Actions")]),
      ),
    );
    em.emit(
      cpp.varDecl(
        cpp.type("lucent::NativeRef"),
        host,
        cpp.call("lucent::swiftui::adopt", [
          cpp.call(make, [
            cpp.call("lucent::swiftui::context", [cpp.id(actions)]),
            cpp.addressOf(cpp.id("lucent::swiftui::invoke")),
            cpp.addressOf(cpp.id("lucent::swiftui::release")),
            cpp.addressOf(cpp.id("lucent::swiftui::resized")),
          ]),
          cpp.str(`${setup.component.export}'s SwiftUI view`),
        ]),
      ),
    );

    return {
      crossings,
      file: () => swiftUIFile(body),
      host: {
        captures: [host, actions],
        runtime: "lucent::swiftui",
        encoded: cpp.type("id"),
        set: (slot, value, as) => {
          const set = body.symbol(`set${slot.index}`);
          const typed = as === "scalar" ? VALUE_TYPES[scalarOf(slot.type)!.k] : undefined;

          declare(em, set, cpp.voidType, [
            cpp.param(raw, "host"),
            cpp.param(typed?.c ?? raw, "value"),
          ]);

          // An encoded value is borrowed: it lives until the call returns.
          return cpp.call(set, [
            cpp.call(cpp.dot(cpp.id(host), "get")),
            typed ? typed.toC(value) : cpp.cast("bridge", raw, value),
          ]);
        },
        setList: (list, records) => {
          const set = body.symbol(list.name);

          declare(em, set, cpp.voidType, [cpp.param(raw, "host"), cpp.param(raw, "records")]);

          // Borrowed, as an encoded value.
          return cpp.call(set, [
            cpp.call(cpp.dot(cpp.id(host), "get")),
            cpp.cast("bridge", raw, records),
          ]);
        },
        act: (_slot, f) =>
          cpp.exprStmt(
            cpp.call(cpp.dot(cpp.arrow(cpp.id(actions), "list"), "push_back"), [
              cpp.call("lucent::swiftui::action", [f]),
            ]),
          ),
        // What the actions captured goes with the mount: the Swift side does not keep it.
        dispose: [cpp.exprStmt(cpp.call(cpp.dot(cpp.arrow(cpp.id(actions), "list"), "clear")))],
        value: cpp.id(host),
      },
    };
  },

  call(em, node, decl) {
    if (!ts.isFunctionDeclaration(decl) || decl.name?.text !== "withAnimation") return undefined;

    const setup = setupOf(em.ctx, node);

    if (setup?.toolkit !== "swiftui")
      bodyFail(
        node,
        "withAnimation animates a SwiftUI component's views: call it in the setup of a component whose body is SwiftUI, or in a function that setup creates",
      );

    return withAnimation(em, swiftUIBodyOf(setup), node);
  },
};

/** The one view a body returns: its expression, or a block's only statement. */
function returnedView(fn: BodyFunction): ts.Expression {
  if (!ts.isBlock(fn.body)) return fn.body;

  const [only] = fn.body.statements;

  if (fn.body.statements.length !== 1 || !only || !ts.isReturnStatement(only) || !only.expression)
    bodyFail(fn.body, "a SwiftUI body is one view: return it, `swiftUI(() => VStack([…]))`");

  return only.expression;
}

/** Declares a C function of the component's Swift file for the module's glue. */
function declare(em: FnEmitter, name: string, ret: cpp.Type, params: cpp.Param[]): void {
  em.ctx
    .nativeUnit(em.opts.module)
    .add(`swiftui ${name}`, [{ k: "externC", body: [cpp.fn(name, ret, params)] }]);
}

/** `withAnimation(animation, body)`: SwiftUI's, around the Lucent body, through the call site's shim. */
function withAnimation(em: FnEmitter, body: SwiftUIBody, node: ts.CallExpression): E {
  const [animation, run] = node.arguments;

  if (!animation || !run || node.arguments.length !== 2)
    bodyFail(node, "withAnimation takes an animation and a function");

  const index = body.animations.length;
  const writer = new BodyWriter(em.checker);
  const written = writer.constant(animation);
  const args = writer.animationArgs;

  body.animations.push({ animation: written, args: args.map((a) => a.type) });

  const shim = body.symbol(`animate${index}`);
  const raw = cpp.pointer(cpp.voidType);

  declare(em, shim, cpp.voidType, [
    cpp.param(raw, "context"),
    cpp.param(cpp.type("lucent::swiftui::Body"), "body"),
    ...args.map((a, i) => cpp.param(VALUE_TYPES[a.type.k].c, `a${i}`)),
  ]);
  em.ctx.nativeUnit(em.opts.module).include("lucent/platform/swiftui.h");

  // The animation's Lucent values, computed in order when it runs.
  const values = args.map((a, i) => {
    const name = `lucent_a${i}`;
    const type = scalarType(a.type);

    return {
      name,
      k: a.type.k,
      decl: cpp.varDecl(em.reg.cppType(type), name, em.exprAs(a.expr, type)),
    };
  });

  return {
    c: cpp.statementExpr(
      values.map((v) => v.decl),
      cpp.call("lucent::swiftui::animate", [
        cpp.addressOf(cpp.id(shim)),
        em.exprAs(run, { k: "fn", params: [], ret: T.void }),
        ...values.map((v) => VALUE_TYPES[v.k].toC(cpp.id(v.name))),
      ]),
    ),
    t: T.undefined,
  };
}

/**
 * Where a body's writer is: the body itself, whose values are the model's
 * and whose actions the model holds, or a list's row, whose values are
 * its item's.
 */
interface Scope {
  /** What holds the values the setup computes. */
  readonly values: swift.Expr;
  /** What calls the actions. */
  readonly actions: swift.Expr;
}

const ROOT: Scope = {
  values: swift.name("model"),
  actions: swift.member(swift.name("model"), "actions"),
};

const ROW: Scope = { values: swift.name("item"), actions: swift.name("actions") };

/** A list's row view: what each of its items shows, and the environment it reads. */
interface Row {
  readonly list: ListSlot;
  readonly body: swift.Stmt[];
  readonly environment: ReadonlyMap<string, swift.Type>;
}

/**
 * Writes a body (or an animation) out in Swift. A body's writer finds its
 * slots in `crossings`; an animation's has none: it is Swift alone.
 */
class BodyWriter {
  private readonly checker: ts.TypeChecker;
  private readonly crossings?: Crossings;
  private readonly scope: Scope;
  /** The rows of the lists written so far, which the file declares. */
  private readonly rows: Row[];
  /** The body's own names (a callback's parameters): their Swift names. */
  private readonly locals = new Map<ts.Symbol, string>();
  /** The environment values the view reads, by key path: its properties' types. */
  readonly environment = new Map<string, swift.Type>();

  constructor(checker: ts.TypeChecker, crossings?: Crossings, scope = ROOT, rows: Row[] = []) {
    this.checker = checker;
    this.crossings = crossings;
    this.scope = scope;
    this.rows = rows;
  }

  /** A view: a call of SwiftUI's, with its modifiers. */
  view(node: ts.Expression): swift.Expr {
    return this.value(node);
  }

  /**
   * An animation's Lucent values (a number, a boolean or a string Lucent
   * code computes), the arguments of withAnimation's shim, in order.
   */
  readonly animationArgs: { expr: ts.Expression; type: ScalarType }[] = [];
  private readonly argNames = new Map<ts.Node, swift.Expr>();

  /**
   * An animation, written out in Swift: SwiftUI's own values and literals,
   * and the Lucent values it takes, each an argument of its shim.
   */
  constant(node: ts.Expression): swift.Expr {
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && isEnvironment(this.checker, n))
        bodyFail(
          n,
          "withAnimation's animation reads no environment: a view reads it where it draws",
        );

      const lucent =
        ts.isExpression(n) && literal(skipParentheses(n)) === undefined && !namePartOf(n)
          ? lucentScalar(this.checker, n)
          : undefined;

      if (ts.isExpression(n) && (lucent || !this.swiftOnly(n))) {
        const type = lucent;

        if (!type)
          bodyFail(
            n,
            "withAnimation's animation takes SwiftUI's values, and numbers, booleans and strings Lucent code computes",
          );

        const name = swift.name(`a${this.animationArgs.length}`);

        this.animationArgs.push({ expr: n, type });
        this.argNames.set(n, type.k === "string" ? VALUE_TYPES.string.fromC(name) : name);
        return;
      }

      ts.forEachChild(n, visit);
    };

    visit(node);

    return this.value(node);
  }

  /** Whether an expression is SwiftUI's or a literal: part of what is written out in Swift. */
  private swiftOnly(n: ts.Expression): boolean {
    const e = skipParentheses(n);

    if (ts.isIdentifier(e)) return !!toolkitDeclaration(this.checker, e) || namePart(e);

    return (
      ts.isCallExpression(e) ||
      ts.isPropertyAccessExpression(e) ||
      ts.isObjectLiteralExpression(e) ||
      literal(e) !== undefined
    );
  }

  private value(node: ts.Expression): swift.Expr {
    const argument = this.argNames.get(node) ?? this.argNames.get(skipParentheses(node));

    if (argument) return argument;

    const e = skipParentheses(node);
    const constant = literal(e);

    if (constant) return constant;

    if (this.crossings && ts.isCallExpression(e) && isBind(this.checker, e)) return this.binding(e);

    if (ts.isCallExpression(e) && isUiForm(this.checker, e, "range")) return this.range(e);

    if (ts.isCallExpression(e) && isEnvironment(this.checker, e)) return this.environmentValue(e);

    // What the setup computes: the model's property its effect keeps.
    if (this.crossings?.computedBySetup(e)) return this.slot(e);

    if (ts.isCallExpression(e) && this.crossings && isList(this.checker, e)) return this.list(e);

    if (ts.isCallExpression(e) && toolkitDeclaration(this.checker, e.expression))
      return this.call(e);

    const named = ts.isPropertyAccessExpression(e)
      ? toolkitDeclaration(this.checker, e)
      : undefined;

    if (ts.isPropertyAccessExpression(e) && named) {
      const found = sourceMemberOf(named.toolkit, named.decl);

      if (found) writable(e, found);

      return swift.member(this.value(e.expression), e.name.text);
    }

    if (ts.isIdentifier(e) && toolkitDeclaration(this.checker, e)) return swift.name(e.text);

    if (ts.isArrayLiteralExpression(e))
      return swift.arrayLiteral(e.elements.map((x) => this.value(x)));

    const local = ts.isIdentifier(e) ? this.localName(e) : undefined;

    if (local) return swift.name(local);

    // The setup computes neither: SwiftUI's values (the environment) are compared in Swift.
    if (ts.isConditionalExpression(e))
      return swift.conditional(
        this.value(e.condition),
        this.value(e.whenTrue),
        this.value(e.whenFalse),
      );

    const compared = ts.isBinaryExpression(e) ? EQUALITY[e.operatorToken.kind] : undefined;

    if (ts.isBinaryExpression(e) && compared)
      return swift.binary(this.value(e.left), compared, this.value(e.right));

    if (this.crossings && (ts.isPropertyAccessExpression(e) || ts.isCallExpression(e)))
      this.crossings.setupMember(e);

    if (this.crossings && ts.isIdentifier(e) && this.crossings.inSetup(this.symbolDecl(e)))
      this.crossings.setupName(e);

    bodyFail(e, `\`${e.getText()}\` cannot be written out in Swift`);
  }

  private localName(e: ts.Identifier): string | undefined {
    const symbol = this.crossings?.symbol(e);

    return symbol && this.locals.get(symbol);
  }

  private symbolDecl(e: ts.Identifier): ts.Declaration | undefined {
    return this.crossings?.symbol(e)?.declarations?.[0];
  }

  /** A value the setup computes: its model's property, or its item's in a row. */
  private slot(e: ts.Expression): swift.Expr {
    const slot = this.crossings!.value(e);

    return swift.member(this.scope.values, slot.name);
  }

  /**
   * `Environment((values) => values.colorScheme)`: a property of the view
   * reading it (`@Environment(\.colorScheme)`), typed as SwiftUI's
   * EnvironmentValues types it.
   */
  private environmentValue(call: ts.CallExpression): swift.Expr {
    const [arg] = call.arguments;
    const fn = arg && skipParentheses(arg);
    const read =
      fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && !ts.isBlock(fn.body)
        ? skipParentheses(fn.body)
        : undefined;
    const param =
      fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) ? fn.parameters[0] : undefined;

    if (
      !read ||
      !param ||
      !ts.isPropertyAccessExpression(read) ||
      !ts.isIdentifier(read.expression) ||
      read.expression.text !== param.name.getText()
    )
      bodyFail(call, "Environment reads one value: `Environment((values) => values.colorScheme)`");

    const decl = this.checker.getSymbolAtLocation(read.name)?.declarations?.[0];
    const found = decl && sourceMemberOf("swiftui", decl);

    if (!found || !("type" in found.member))
      bodyFail(read, `\`${read.name.text}\` is no value of SwiftUI's environment`);

    writable(read, found);

    const key = found.member.swift?.name ?? read.name.text;

    this.environment.set(key, swiftTypeOf(read, found.member.type));

    return swift.name(`environment_${key}`);
  }

  /**
   * `bind(signal)`: a Binding reading the signal's value, and setting the
   * signal through the setup, whose effect sets the value back.
   */
  private binding(call: ts.CallExpression): swift.Expr {
    const { value, change } = this.crossings!.bind(call);

    return swift.call(swift.name("Binding"), [
      {
        label: "get",
        value: closure([], [swift.exprStmt(swift.member(this.scope.values, value.name))]),
      },
      {
        label: "set",
        value: closure(
          [],
          [
            swift.exprStmt(
              swift.call(this.scope.actions, [
                { value: swift.num(change.index) },
                { value: swift.arrayLiteral([swift.name("$0")]) },
              ]),
            ),
          ],
        ),
      },
    ]);
  }

  /**
   * A keyed list (`ForEach(data, { id }, content)`, Lucent's form): SwiftUI's
   * ForEach over the models of its items, each shown by a row view of its
   * own, which the file declares.
   */
  private list(node: ts.CallExpression): swift.Expr {
    const [data, identified, content] = node.arguments;
    const literal = identified && skipParentheses(identified);
    const id =
      literal && ts.isObjectLiteralExpression(literal)
        ? literal.properties.find((p) => p.name?.getText() === "id")
        : undefined;
    const keyFn = id && ts.isPropertyAssignment(id) ? skipParentheses(id.initializer) : undefined;

    if (
      !data ||
      !content ||
      !keyFn ||
      !(ts.isArrowFunction(keyFn) || ts.isFunctionExpression(keyFn))
    )
      bodyFail(
        node,
        "a SwiftUI list is `ForEach(items, { id: (item) => item.id }, (item) => [...])`",
      );

    const key = returned(keyFn, "a list's key function returns the key: `(item) => item.id`");
    const list = this.crossings!.list(node, data, content, {
      ...(keyFn.parameters[0] ? { param: keyFn.parameters[0] } : {}),
      expression: key,
    });
    const row = new BodyWriter(this.checker, this.crossings, ROW, this.rows);
    const shown = list.content.body;
    const body = ts.isBlock(shown)
      ? row.content(returned(list.content, "a list's item shows what its function returns"))
      : ts.isArrayLiteralExpression(skipParentheses(shown))
        ? row.content(shown)
        : row.item(shown);

    this.rows.push({ list, body, environment: row.environment });

    return swift.call(
      swift.name("ForEach"),
      [{ value: swift.member(swift.name("model"), list.name) }],
      closure(
        ["item"],
        [
          swift.exprStmt(
            swift.call(swift.name(rowName(this.crossings!, list)), [
              { label: "item", value: swift.name("item") },
              { label: "actions", value: swift.member(swift.name("model"), "actions") },
            ]),
          ),
        ],
      ),
    );
  }

  /**
   * A call of SwiftUI's: a view, a modifier, a static function. Each
   * argument goes back where its Swift parameter is, with its label, as
   * the member's call form says.
   */
  private call(node: ts.CallExpression): swift.Expr {
    const callee = skipParentheses(node.expression);
    const decl = this.checker.getResolvedSignature(node)?.declaration;
    const found = decl && !ts.isJSDocSignature(decl) ? sourceMemberOf("swiftui", decl) : undefined;

    if (!found?.form || !("params" in found.member))
      bodyFail(node, `\`${callee.getText()}\` has no declaration of SwiftUI's`);

    writable(node, found);

    const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText();
    const target = ts.isPropertyAccessExpression(callee)
      ? swift.member(this.value(callee.expression), name)
      : swift.name(name);
    const params = found.member.params;
    const args = new Map<number, swift.Arg>();
    let trailing: (swift.Expr & { k: "closure" }) | undefined;

    found.form.parts.forEach((part, i) => {
      const arg = node.arguments[i];

      if (!arg) return;

      if (part.k === "trailing") {
        trailing = this.closure(params[part.param]!, arg);
        return;
      }

      for (const [index, value] of this.given(name, part, params, arg))
        args.set(index, this.argument(params[index]!, value));
    });

    const inOrder = [...args].sort(([a], [b]) => a - b).map(([, a]) => a);

    return swift.call(target, inOrder, trailing);
  }

  /** What an argument gives, by parameter: itself, or an object literal's values by their labels. */
  private given(
    callee: string,
    part: Exclude<CallPart, { k: "trailing" }>,
    params: readonly SdkParam[],
    arg: ts.Expression,
  ): [number, ts.Expression][] {
    if (part.k === "positional") return [[part.param, arg]];

    const literal = skipParentheses(arg);
    const first = params[part.params[0]!]!.swift?.label ?? "label";

    if (!ts.isObjectLiteralExpression(literal))
      bodyFail(
        arg,
        `\`${callee}\` takes Swift's labeled arguments as an object literal: \`${callee}({ ${first}: … })\``,
      );

    const byLabel = new Map(part.params.map((i) => [params[i]!.swift?.label, i]));

    return literal.properties.map((p): [number, ts.Expression] => {
      if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p))
        bodyFail(p, `write each of \`${callee}\`'s arguments as \`label: value\``);

      const index = byLabel.get(p.name.getText());

      if (index === undefined)
        bodyFail(p, `\`${callee}\` takes no argument labeled \`${p.name.getText()}\``);

      return [index, ts.isPropertyAssignment(p) ? p.initializer : p.name];
    });
  }

  /** One argument as Swift passes it: with its label, a value, or a closure (a builder's, an action). */
  private argument(param: SdkParam, arg: ts.Expression): swift.Arg {
    const label = param.swift?.label;
    const value =
      (param.swift?.kind ?? "value") === "value"
        ? this.valueAs(param.type, arg)
        : this.closure(param, arg);

    return label ? { label, value } : { value };
  }

  /** A closure argument, the trailing one or not: a builder's content, or an action. */
  private closure(param: SdkParam, arg: ts.Expression): swift.Expr & { k: "closure" } {
    return param.swift?.kind === "builder"
      ? closure([], this.content(arg))
      : this.callback(arg, param.type.k === "fn" ? param.type.params.length : 0);
  }

  /**
   * A value of type `t`. A number the setup computes is a Double in the
   * model, which Swift makes a CGFloat by itself, and any other of its
   * number types (an Int) by name; a range's bounds are of its type.
   */
  private valueAs(t: SdkParam["type"], arg: ts.Expression): swift.Expr {
    const e = skipParentheses(arg);

    if (ts.isCallExpression(e) && isUiForm(this.checker, e, "range") && isClosedRange(t))
      return this.range(e, t.args[0]);

    const value = this.value(arg);
    const scalar = t.k === "prim" ? SWIFT_SCALARS[t.name]?.swift : undefined;
    const named = scalar && !["Double", "CGFloat", "Bool"].includes(scalar);

    if (named && this.crossings?.computedBySetup(e))
      return swift.call(swift.name(scalar), [{ value }]);

    // Swift makes a number literal an Int where the type is its to infer: a Lucent number is a Double.
    if (t.k === "tparam" && isNumberLiteral(e))
      return swift.call(swift.name("Double"), [{ value }]);

    return value;
  }

  /** `range(from, to)`: Swift's closed range, `from ... to`, its bounds of type `of` when given. */
  private range(call: ts.CallExpression, of?: SdkParam["type"]): swift.Expr {
    const [from, to] = call.arguments;

    if (!from || !to || call.arguments.length !== 2)
      bodyFail(call, "range takes its bounds: `range(0, 10)`");

    const bound = (b: ts.Expression) => (of ? this.valueAs(of, b) : this.value(b));

    return swift.binary(bound(from), "...", bound(to));
  }

  /** A view's content: its views, and SwiftUI's `if` for a conditional one. */
  private content(arg: ts.Expression): swift.Stmt[] {
    const list = skipParentheses(arg);

    if (!ts.isArrayLiteralExpression(list))
      bodyFail(
        arg,
        'a SwiftUI view\'s content is an array literal of views: `[Text("a"), Text("b")]`',
      );

    return list.elements.flatMap((item) => this.item(item));
  }

  /** One item of content: a view, one while a condition holds (`if`), or none (`null`, `false`). */
  private item(item: ts.Expression): swift.Stmt[] {
    if (ts.isSpreadElement(item))
      bodyFail(
        item,
        "a SwiftUI view's content is an array literal of views: `...` is not supported in a SwiftUI body",
      );

    const e = skipParentheses(item);

    if (isNothing(e)) return [];

    if (ts.isConditionalExpression(e)) {
      const orElse = this.item(e.whenFalse);

      return [
        {
          k: "if",
          test: this.condition(e.condition),
          body: this.item(e.whenTrue),
          ...(orElse.length ? { orElse } : {}),
        },
      ];
    }

    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
      return [{ k: "if", test: this.condition(e.left), body: this.item(e.right) }];

    return [swift.exprStmt(this.value(e))];
  }

  /** What decides whether content shows a view: a boolean, which Swift's `if` takes as it is. */
  private condition(e: ts.Expression): swift.Expr {
    const t = this.checker.getTypeAtLocation(e);

    // `boolean` itself, `true`, `false`: not `boolean | undefined`, which Swift's `if` does not take.
    if (!(t.flags & ts.TypeFlags.BooleanLike))
      bodyFail(
        e,
        `a condition in a SwiftUI view's content is a boolean: \`${e.getText()}\` is not one`,
      );

    return this.value(e);
  }

  /**
   * A callback: the setup's functions it calls, by the index the Swift
   * calls them with, and the arguments it gives them. A setup function
   * given as it is (`onTapGesture(tap)`) is one; a callback's parameters
   * are the Swift closure's.
   */
  private callback(arg: ts.Expression, arity: number): swift.Expr & { k: "closure" } {
    const crossings = this.crossings;

    if (!crossings) bodyFail(arg, "an animation has no actions");

    const e = skipParentheses(arg);

    if (ts.isIdentifier(e)) {
      const symbol = crossings.symbol(e);

      if (!symbol || !crossings.setupFunction(symbol))
        bodyFail(e, `a SwiftUI callback is a function of the setup: \`${e.text}\` is not one`);

      const params = crossings.action(e).params.map((_, i) => `p${i}`);

      return closure(padded(params, arity), [
        this.action(
          e,
          params.map((p) => swift.name(p)),
        ),
      ]);
    }

    if (!(ts.isArrowFunction(e) || ts.isFunctionExpression(e)))
      bodyFail(
        arg,
        "a SwiftUI callback is a function of the setup, or `() => …` calling the setup's functions",
      );

    const params = e.parameters.map((p) => {
      if (!ts.isIdentifier(p.name))
        bodyFail(p, "a SwiftUI callback's parameters are names: `(value) => …`");

      const symbol = crossings.symbol(p.name);

      if (symbol) this.locals.set(symbol, p.name.text);

      return p.name.text;
    });

    const calls = ts.isBlock(e.body)
      ? e.body.statements.map((s) =>
          ts.isExpressionStatement(s)
            ? s.expression
            : bodyFail(s, "a SwiftUI callback calls the setup's functions, one statement each"),
        )
      : [e.body];

    return closure(
      padded(params, arity),
      calls.map((c) => {
        const call = skipParentheses(c);

        if (!ts.isCallExpression(call))
          bodyFail(c, "a SwiftUI callback calls the setup's functions: logic is the setup's");

        crossings.setupMember(call);

        const callee = skipParentheses(call.expression);
        const symbol = ts.isIdentifier(callee) ? crossings.symbol(callee) : undefined;

        if (!ts.isIdentifier(callee) || !symbol || !crossings.setupFunction(symbol))
          bodyFail(
            call,
            `a SwiftUI callback calls the setup's functions: \`${callee.getText()}\` is not one`,
          );

        return this.action(callee, call.arguments);
      }),
    );
  }

  /**
   * `model.actions(i, [args])`: the Swift's call of a setup function, with
   * what it is given. A list's item crosses as its key.
   */
  private action(id: ts.Identifier, args: readonly (ts.Expression | swift.Expr)[]): swift.Stmt {
    const crossings = this.crossings!;
    const slot = crossings.action(
      id,
      args.filter((a): a is ts.Expression => !("k" in a)),
    );
    const values = args.map((a) =>
      "k" in a ? a : crossings.itemOf(a) ? swift.member(swift.name("item"), "id") : this.value(a),
    );
    const given = values.length ? [{ value: swift.arrayLiteral(values) }] : [];

    return swift.exprStmt(
      swift.call(this.scope.actions, [{ value: swift.num(slot.index) }, ...given]),
    );
  }
}

const closure = (params: string[], body: swift.Stmt[]) =>
  swift.closure(params, body) as swift.Expr & { k: "closure" };

/** A closure's parameters, as many as Swift gives it: those the callback leaves out are `_`. */
const padded = (params: string[], arity: number) => [
  ...params,
  ...Array.from({ length: Math.max(arity - params.length, 0) }, () => "_"),
];

/** JavaScript's strict equality of SwiftUI's values, as Swift's. */
const EQUALITY: Partial<Record<ts.SyntaxKind, swift.BinaryOp>> = {
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: "==",
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: "!=",
};

/** Whether a call is Lucent's environment read (`@environment`). */
function isEnvironment(checker: ts.TypeChecker, call: ts.CallExpression): boolean {
  const decl = checker.getResolvedSignature(call)?.declaration;

  return (
    !!decl &&
    !!toolkitOfDeclaration(decl) &&
    ts.getJSDocTags(decl).some((t) => t.tagName.text === "environment")
  );
}

/** The Swift type of an environment value, as SwiftUI's schema has it. */
function swiftTypeOf(node: ts.Node, t: SdkParam["type"]): swift.Type {
  const base = ((): swift.Type | undefined => {
    switch (t.k) {
      case "ref":
        return swift.type(t.name.replaceAll("_", "."));
      case "string":
        return swift.type("String");
      case "prim": {
        const scalar = SWIFT_SCALARS[t.name]?.swift;

        return scalar ? swift.type(scalar) : undefined;
      }
      default:
        return undefined;
    }
  })();

  if (!base)
    bodyFail(
      node,
      "a body reads environment values of SwiftUI's types, numbers, booleans and strings",
    );

  return t.nullable ? swift.optional(base) : base;
}

/** Whether `t` is Swift's ClosedRange of one type: what lucent:ui's `range(from, to)` gives. */
function isClosedRange(
  t: SdkParam["type"],
): t is SdkParam["type"] & { k: "ref"; args: [SdkParam["type"]] } {
  return t.k === "ref" && t.module === "Swift" && t.name === "ClosedRange" && t.args?.length === 1;
}

/** Whether a call is of Lucent's list form (`@list`). */
function isList(checker: ts.TypeChecker, call: ts.CallExpression): boolean {
  const decl = checker.getResolvedSignature(call)?.declaration;

  return !!decl && ts.getJSDocTags(decl).some((t) => t.tagName.text === "list");
}

/** What a function returns: its expression, or a block's one return. */
function returned(fn: ts.ArrowFunction | ts.FunctionExpression, message: string): ts.Expression {
  if (!ts.isBlock(fn.body)) return fn.body;

  const [only] = fn.body.statements;

  if (fn.body.statements.length !== 1 || !only || !ts.isReturnStatement(only) || !only.expression)
    bodyFail(fn.body, message);

  return only.expression;
}

/** The Swift names of a list's item model and row view. */
function itemName(crossings: Crossings, list: ListSlot): string {
  return `${cppIdent(crossings.component)}Item${list.index}`;
}

function rowName(crossings: Crossings, list: ListSlot): string {
  return `${cppIdent(crossings.component)}Row${list.index}`;
}

/** Whether a node is a name in the code (`x.name`, `name: value`), not a value. */
function namePartOf(n: ts.Node): boolean {
  return ts.isIdentifier(n) && namePart(n);
}

/** Whether an identifier is a name in the code (`x.name`, `name: value`), not a value. */
function namePart(e: ts.Identifier): boolean {
  const p = e.parent;

  return (ts.isPropertyAccessExpression(p) || ts.isPropertyAssignment(p)) && p.name === e;
}

/**
 * Fails unless a body can write `found`: its plan refuses nothing, and
 * every iOS the app runs on has it (a body checks no availability yet).
 */
function writable(node: ts.Node, found: SourceMember): void {
  const refused = unsupportedReason(found.plan);

  if (refused)
    bodyFail(node, `\`${found.display}\` cannot be written in a SwiftUI body yet: ${refused}`);

  const since = found.plan.availability?.since;

  if (typeof since === "string" && compareVersions(since, MIN_IOS) > 0)
    bodyFail(
      node,
      `\`${found.display}\` needs iOS ${since} (apps run from iOS ${MIN_IOS}): a SwiftUI body writes what every supported iOS has, for now`,
    );
}

/** What content leaves out: `null`, `undefined`, `false`. */
function isNothing(e: ts.Expression): boolean {
  return (
    e.kind === ts.SyntaxKind.NullKeyword ||
    e.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(e) && e.text === "undefined")
  );
}

/** A number literal, negative ones too. */
function isNumberLiteral(e: ts.Expression): boolean {
  return (
    ts.isNumericLiteral(e) ||
    (ts.isPrefixUnaryExpression(e) &&
      e.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(e.operand))
  );
}

/** A literal as Swift: numbers (negative ones too), strings without substitutions, booleans, null. */
function literal(e: ts.Expression): swift.Expr | undefined {
  if (ts.isNumericLiteral(e)) return swift.num(e.text);

  if (
    ts.isPrefixUnaryExpression(e) &&
    e.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(e.operand)
  )
    return swift.num(`-${e.operand.text}`);

  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return swift.str(e.text);

  if (e.kind === ts.SyntaxKind.TrueKeyword) return swift.bool(true);

  if (e.kind === ts.SyntaxKind.FalseKeyword) return swift.bool(false);

  if (e.kind === ts.SyntaxKind.NullKeyword) return swift.name("nil");

  return undefined;
}

// --- the Swift file ----------------------------------------------------------------------

/** `views/<registration>.swift`: the component's view, its model and the C functions its glue calls. */
function swiftUIFile(body: SwiftUIBody): ToolkitFile {
  const c = body.setup.component;
  const names = body.names;
  const { crossings, view: drawn, rows, environment } = body.written!;
  const values = new SwiftValues(cppIdent(c.export));

  const raw = swift.type("UnsafeMutableRawPointer");
  const invoke = swift.cFunction([raw, swift.type("Int32"), raw], swift.type("Void"));
  const release = swift.cFunction([raw], swift.type("Void"));
  const resize = swift.cFunction([raw], swift.type("Void"));
  const run = swift.cFunction([raw], swift.type("Void"));
  const self = (n: string) => swift.member(swift.self, n);
  const cdecl = (symbol: string) => [`@_cdecl("${symbol}")`, "@MainActor"];
  const hosting = names.hosting;
  const model = (host: swift.Expr) =>
    swift.member(
      swift.member(
        swift.call(
          swift.member(
            swift.call(swift.name(`Unmanaged<${hosting}>.fromOpaque`), [{ value: host }]),
            "takeUnretainedValue",
          ),
          [],
        ),
        "rootView",
      ),
      "model",
    );

  const actions: swift.Decl = {
    k: "class",
    name: names.actions,
    modifiers: ["fileprivate", "final"],
    members: [
      { k: "let", modifiers: [], name: "context", type: raw },
      { k: "let", modifiers: [], name: "invoke", type: invoke },
      { k: "let", modifiers: [], name: "release", type: release },
      { k: "let", modifiers: [], name: "resize", type: resize },
      {
        k: "init",
        modifiers: [],
        params: [
          { name: "context", type: raw },
          { name: "invoke", type: invoke },
          { name: "release", type: release },
          { name: "resize", type: resize },
        ],
        body: ["context", "invoke", "release", "resize"].map((n) =>
          swift.exprStmt(swift.assign(self(n), swift.name(n))),
        ),
      },
      // The arguments cross as an NSArray, which the C++ side takes.
      {
        k: "func",
        modifiers: [],
        name: "callAsFunction",
        params: [
          { external: "_", name: "action", type: swift.type("Int32") },
          {
            external: "_",
            name: "args",
            type: swift.array(swift.type("Any")),
            default: swift.arrayLiteral([]),
          },
        ],
        body: [
          swift.exprStmt(
            swift.call(swift.name("invoke"), [
              { value: swift.name("context") },
              { value: swift.name("action") },
              {
                value: swift.call(
                  swift.member(
                    swift.call(swift.name("Unmanaged.passRetained"), [
                      { value: swift.cast(swift.name("args"), "as", swift.type("NSArray")) },
                    ]),
                    "toOpaque",
                  ),
                  [],
                ),
              },
            ]),
          ),
        ],
      },
      {
        k: "func",
        modifiers: [],
        name: "contentResized",
        params: [],
        body: [
          swift.exprStmt(swift.call(swift.name("resize"), [{ value: swift.name("context") }])),
        ],
      },
      {
        k: "deinit",
        body: [
          swift.exprStmt(swift.call(swift.name("release"), [{ value: swift.name("context") }])),
        ],
      },
    ],
  };

  const modelClass: swift.Decl = {
    k: "class",
    name: names.model,
    modifiers: ["fileprivate", "final"],
    protocols: [swift.type("ObservableObject")],
    members: [
      ...crossings.values.map((s): swift.Member => ({
        k: "var",
        modifiers: ["@Published"],
        name: s.name,
        type: values.type(s.type),
        init: values.zero(s.type),
      })),
      ...crossings.lists.flatMap((l) => listMembers(values, crossings, l)),
      { k: "let", modifiers: [], name: "actions", type: swift.type(names.actions) },
      {
        k: "init",
        modifiers: [],
        params: [{ name: "actions", type: swift.type(names.actions) }],
        body: [swift.exprStmt(swift.assign(self("actions"), swift.name("actions")))],
      },
    ],
  };

  const items = crossings.lists.map((l) => itemClass(values, crossings, l));
  const rowViews = rows.map((r) => rowView(crossings, r, names.actions));

  const view: swift.Decl = {
    k: "struct",
    name: names.view,
    modifiers: ["fileprivate"],
    protocols: [swift.type("View")],
    members: [
      { k: "var", modifiers: ["@ObservedObject"], name: "model", type: swift.type(names.model) },
      ...environmentProperties(environment),
      {
        k: "property",
        modifiers: [],
        name: "body",
        type: swift.opaque(swift.type("View")),
        get: [swift.exprStmt(drawn)],
      },
    ],
  };

  // A size change of the content, SwiftUI's own too, is the mount's content changing,
  // which the host measures again. UIKit's own setter is never called: React Native lays
  // the host out, and the parent view controller (a sheet's, a popover's) never hears of it.
  const size = swift.type("CGSize");
  const reported = swift.name("reportedSize");
  const hostingClass: swift.Decl = {
    k: "class",
    name: names.hosting,
    modifiers: ["fileprivate", "final"],
    superclass: swift.type("UIHostingController", swift.type(names.view)),
    members: [
      {
        k: "var",
        modifiers: ["private"],
        name: "reportedSize",
        type: size,
        init: swift.name("CGSize.zero"),
      },
      {
        k: "property",
        modifiers: ["override"],
        name: "preferredContentSize",
        type: size,
        get: [swift.exprStmt(reported)],
        set: [
          {
            k: "if",
            test: swift.binary(swift.name("newValue"), "!=", reported),
            body: [
              swift.exprStmt(swift.assign(reported, swift.name("newValue"))),
              swift.exprStmt(
                swift.call(
                  swift.member(
                    swift.member(swift.member(swift.name("rootView"), "model"), "actions"),
                    "contentResized",
                  ),
                  [],
                ),
              ),
            ],
          },
        ],
      },
    ],
  };

  const make: swift.Decl = {
    k: "func",
    attributes: cdecl(body.symbol("make")),
    modifiers: ["public"],
    name: body.symbol("make"),
    params: [
      { external: "_", name: "context", type: raw },
      { external: "_", name: "invoke", type: invoke },
      { external: "_", name: "release", type: release },
      { external: "_", name: "resize", type: resize },
    ],
    ret: raw,
    body: [
      swift.letStmt(
        "controller",
        swift.call(swift.name(names.hosting), [
          {
            label: "rootView",
            value: swift.call(swift.name(names.view), [
              {
                label: "model",
                value: swift.call(swift.name(names.model), [
                  {
                    label: "actions",
                    value: swift.call(swift.name(names.actions), [
                      { label: "context", value: swift.name("context") },
                      { label: "invoke", value: swift.name("invoke") },
                      { label: "release", value: swift.name("release") },
                      { label: "resize", value: swift.name("resize") },
                    ]),
                  },
                ]),
              },
            ]),
          },
        ]),
      ),
      // It tracks its content's ideal size (iOS 16), which it reports (the hosting class).
      {
        k: "if",
        test: swift.available("iOS 16.0", "*"),
        body: [
          swift.exprStmt(
            swift.assign(
              swift.member(swift.name("controller"), "sizingOptions"),
              swift.name(".preferredContentSize"),
            ),
          ),
        ],
      },
      // Laid out in the host's box, which React Native places: no safe area of its own (iOS 16.4).
      {
        k: "if",
        test: swift.available("iOS 16.4", "*"),
        body: [
          swift.exprStmt(
            swift.assign(
              swift.member(swift.name("controller"), "safeAreaRegions"),
              swift.arrayLiteral([]),
            ),
          ),
        ],
      },
      // The React Native view behind it shows through.
      swift.exprStmt(
        swift.assign(
          swift.member(swift.member(swift.name("controller"), "view"), "backgroundColor"),
          swift.name("UIColor.clear"),
        ),
      ),
      swift.ret(
        swift.call(
          swift.member(
            swift.call(swift.name("Unmanaged.passRetained"), [{ value: swift.name("controller") }]),
            "toOpaque",
          ),
          [],
        ),
      ),
    ],
  };

  // A number, a boolean or a string crosses as it is; any other value encoded, borrowed.
  const setters = crossings.values.map((s): swift.Decl => {
    const typed = typedScalar(s.type);
    const value = swift.name("value");

    return {
      k: "func",
      attributes: cdecl(body.symbol(`set${s.index}`)),
      modifiers: ["public"],
      name: body.symbol(`set${s.index}`),
      params: [
        { external: "_", name: "host", type: raw },
        {
          external: "_",
          name: "value",
          type: !typed || typed.k === "string" ? raw : VALUE_TYPES[typed.k].swift,
        },
      ],
      body: [
        swift.exprStmt(
          swift.assign(
            swift.member(model(swift.name("host")), s.name),
            typed
              ? VALUE_TYPES[typed.k].fromC(value)
              : values.decode(
                  s.type,
                  swift.call(
                    swift.member(
                      swift.call(swift.name("Unmanaged<AnyObject>.fromOpaque"), [{ value }]),
                      "takeUnretainedValue",
                    ),
                    [],
                  ),
                ),
          ),
        ),
      ],
    };
  });

  const listSetters = crossings.lists.map((l): swift.Decl => ({
    k: "func",
    attributes: cdecl(body.symbol(l.name)),
    modifiers: ["public"],
    name: body.symbol(l.name),
    params: [
      { external: "_", name: "host", type: raw },
      { external: "_", name: "records", type: raw },
    ],
    body: [
      swift.exprStmt(
        swift.call(swift.member(model(swift.name("host")), `set${capital(l.name)}`), [
          {
            value: swift.call(
              swift.member(
                swift.call(swift.name("Unmanaged<AnyObject>.fromOpaque"), [
                  { value: swift.name("records") },
                ]),
                "takeUnretainedValue",
              ),
              [],
            ),
          },
        ]),
      ),
    ],
  }));

  const animations = body.animations.map(({ animation, args }, i): swift.Decl => ({
    k: "func",
    attributes: cdecl(body.symbol(`animate${i}`)),
    modifiers: ["public"],
    name: body.symbol(`animate${i}`),
    params: [
      { external: "_", name: "context", type: raw },
      { external: "_", name: "body", type: run },
      ...args.map((a, n) => ({
        external: "_",
        name: `a${n}`,
        type: a.k === "string" ? raw : VALUE_TYPES[a.k].swift,
      })),
    ],
    body: [
      swift.exprStmt(
        swift.call(
          swift.name("withAnimation"),
          [{ value: animation }],
          swift.closure(
            [],
            [swift.exprStmt(swift.call(swift.name("body"), [{ value: swift.name("context") }]))],
          ),
        ),
      ),
    ],
  }));

  return {
    name: `views/${c.registration}.swift`,
    text: swift.printUnit({
      banner: `Generated by Lucent from ${c.id} (${path.basename(c.source.file)}). Do not edit.`,
      decls: [
        { k: "import", module: "SwiftUI" },
        { k: "import", module: "UIKit" },
        actions,
        ...values.structs,
        ...items,
        modelClass,
        view,
        ...rowViews,
        hostingClass,
        make,
        ...setters,
        ...listSetters,
        ...animations,
      ],
    }),
  };
}

// --- lists -------------------------------------------------------------------------------

const capital = (name: string) => `${name[0]!.toUpperCase()}${name.slice(1)}`;

/** A list's key in Swift: a String, or a Double. */
function keyType(list: ListSlot): ViewType {
  return { k: list.keyType.k };
}

/**
 * A list's item model: its key (its id, for SwiftUI's ForEach), and a
 * published property per value the setup computes for it, which a record
 * updates in place (a value that did not change is not set).
 */
function itemClass(values: SwiftValues, crossings: Crossings, list: ListSlot): swift.Decl {
  const record = swift.name("record");
  const self = (n: string) => swift.member(swift.self, n);

  return {
    k: "class",
    name: itemName(crossings, list),
    modifiers: ["fileprivate", "final"],
    protocols: [swift.type("ObservableObject"), swift.type("Identifiable")],
    members: [
      { k: "let", modifiers: [], name: "id", type: values.type(keyType(list)) },
      ...list.values.map((v): swift.Member => ({
        k: "var",
        modifiers: ["@Published"],
        name: v.name,
        type: values.type(v.type),
        init: values.zero(v.type),
      })),
      {
        k: "init",
        modifiers: [],
        params: [{ name: "id", type: values.type(keyType(list)) }],
        body: [swift.exprStmt(swift.assign(self("id"), swift.name("id")))],
      },
      {
        k: "func",
        modifiers: [],
        name: "update",
        params: [{ external: "_", name: "record", type: swift.array(swift.type("Any")) }],
        body: list.values.flatMap((v, i) => [
          swift.letStmt(v.name, values.decode(v.type, swift.index(record, swift.num(i + 1)))),
          {
            k: "if" as const,
            test: swift.binary(self(v.name), "!=", swift.name(v.name)),
            body: [swift.exprStmt(swift.assign(self(v.name), swift.name(v.name)))],
          },
        ]),
      },
    ],
  };
}

/**
 * The model's members for a list: its items (published: ForEach shows
 * them), the items by key, and the merge of new records into them. An item
 * whose key stays keeps its model; the array changes only when the keys
 * or their order do.
 */
function listMembers(values: SwiftValues, crossings: Crossings, list: ListSlot): swift.Member[] {
  const item = itemName(crossings, list);
  const key = values.type(keyType(list));
  const byKey = `${list.name}Items`;
  const one = `${list.name}Item`;
  const ids = (of: swift.Expr) =>
    swift.call(swift.member(of, "map"), [
      { value: swift.closure([], [swift.exprStmt(swift.member(swift.name("$0"), "id"))]) },
    ]);

  return [
    {
      k: "var",
      modifiers: ["@Published"],
      name: list.name,
      type: swift.array(swift.type(item)),
      init: swift.arrayLiteral([]),
    },
    {
      k: "var",
      modifiers: [],
      name: byKey,
      type: swift.dictionary(key, swift.type(item)),
      init: swift.dictionaryLiteral([]),
    },
    {
      k: "func",
      modifiers: [],
      name: `set${capital(list.name)}`,
      params: [{ external: "_", name: "records", type: swift.type("Any") }],
      body: [
        swift.letStmt(
          "next",
          swift.call(
            swift.member(
              swift.cast(swift.name("records"), "as!", swift.array(swift.type("Any"))),
              "map",
            ),
            [],
            swift.closure(
              ["record"],
              [
                swift.exprStmt(
                  swift.call(swift.name(one), [
                    {
                      value: swift.cast(
                        swift.name("record"),
                        "as!",
                        swift.array(swift.type("Any")),
                      ),
                    },
                  ]),
                ),
              ],
            ),
          ),
        ),
        swift.letStmt("alive", swift.call(swift.name("Set"), [{ value: ids(swift.name("next")) }])),
        swift.exprStmt(
          swift.assign(
            swift.name(byKey),
            swift.call(
              swift.member(swift.name(byKey), "filter"),
              [],
              swift.closure(
                [],
                [
                  swift.exprStmt(
                    swift.call(swift.member(swift.name("alive"), "contains"), [
                      { value: swift.member(swift.name("$0"), "key") },
                    ]),
                  ),
                ],
              ),
            ),
          ),
        ),
        {
          k: "if",
          test: swift.binary(ids(swift.name("next")), "!=", ids(swift.name(list.name))),
          body: [swift.exprStmt(swift.assign(swift.name(list.name), swift.name("next")))],
        },
      ],
    },
    {
      k: "func",
      modifiers: [],
      name: one,
      params: [{ external: "_", name: "record", type: swift.array(swift.type("Any")) }],
      ret: swift.type(item),
      body: [
        swift.letStmt(
          "key",
          values.decode(keyType(list), swift.index(swift.name("record"), swift.num(0))),
        ),
        swift.letStmt(
          "item",
          swift.binary(
            swift.index(swift.name(byKey), swift.name("key")),
            "??",
            swift.call(swift.name(item), [{ label: "id", value: swift.name("key") }]),
          ),
        ),
        swift.exprStmt(
          swift.assign(swift.index(swift.name(byKey), swift.name("key")), swift.name("item")),
        ),
        swift.exprStmt(
          swift.call(swift.member(swift.name("item"), "update"), [{ value: swift.name("record") }]),
        ),
        swift.ret(swift.name("item")),
      ],
    },
  ];
}

/** A list's row view: what one item shows, observing its model, calling the body's actions. */
function rowView(crossings: Crossings, row: Row, actions: string): swift.Decl {
  return {
    k: "struct",
    name: rowName(crossings, row.list),
    modifiers: ["fileprivate"],
    protocols: [swift.type("View")],
    members: [
      {
        k: "var",
        modifiers: ["@ObservedObject"],
        name: "item",
        type: swift.type(itemName(crossings, row.list)),
      },
      { k: "let", modifiers: [], name: "actions", type: swift.type(actions) },
      ...environmentProperties(row.environment),
      {
        k: "property",
        modifiers: [],
        name: "body",
        type: swift.opaque(swift.type("View")),
        get: row.body,
      },
    ],
  };
}

/** `@Environment(\.key) private var environment_key: T`, for each value a view reads. */
function environmentProperties(environment: ReadonlyMap<string, swift.Type>): swift.Member[] {
  return [...environment].map(([key, type]) => ({
    k: "var",
    modifiers: [`@Environment(\\.${key})`, "private"],
    name: `environment_${key}`,
    type,
  }));
}

/**
 * A number, a boolean or a string (never null) Lucent code computes, as
 * the part of an animation it is: no literal, nothing of SwiftUI's.
 */
function lucentScalar(checker: ts.TypeChecker, e: ts.Expression): ScalarType | undefined {
  const flags = checker.getTypeAtLocation(e).flags;
  const k =
    flags & ts.TypeFlags.NumberLike
      ? "number"
      : flags & ts.TypeFlags.BooleanLike
        ? "boolean"
        : flags & ts.TypeFlags.StringLike
          ? "string"
          : undefined;
  let toolkit = false;
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && toolkitDeclaration(checker, n)) toolkit = true;

    ts.forEachChild(n, visit);
  };

  visit(e);

  return k && !toolkit ? { k, nullable: false } : undefined;
}
