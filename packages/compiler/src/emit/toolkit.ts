/**
 * A toolkit body in its setup's C++ (LUCENT_VIEWS=fabric): the JSX a
 * component returns makes the host the toolkit draws in, and feeds the
 * body's slots (ui/toolkit-body.ts), the same way for every toolkit:
 *
 * - each value slot is an effect of the mount: it evaluates the slot's
 *   expression now, and again whenever what it read changes, and sets the
 *   toolkit's state, on the main context, so the body never shows a value
 *   older than the latest commit; the expression is the IR's thunk (a
 *   function of the setup's code), which the effect calls;
 * - each action slot is the setup function itself, which enters its mount
 *   when it runs (lucent/view.h), so what it changes is measured again;
 *   given a list's item, it is called with the item its key finds (and
 *   not at all once the item is gone);
 * - each list slot is an effect too: it evaluates the array, and for each
 *   item its key and its values (thunks of the item), and sets the
 *   toolkit's list with records of them (`[key, value…]`), which the
 *   toolkit merges by key. It keeps the items by key (lucent::ui::Items)
 *   for the actions.
 *
 * What differs (the host, how a slot is set, the file written in Swift or
 * Kotlin) is each toolkit's emitter's.
 */
import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import type { Thunk } from "../ir/lower.ts";
import { T, type LType } from "../types.ts";
import {
  type ActionSlot,
  type Body,
  bodyFail,
  bodyOf,
  type Crossings,
  crossingOf,
  inSetupCode,
  jsxRoot,
  jsxToolkitOf,
  type ListSlot,
  scalarOf,
  skipParentheses,
  toolkitDeclaration,
  usedAt,
  type ValueSlot,
} from "../ui/toolkit-body.ts";
import { helperAt, type HelperUse, propReads } from "../ui/view-helpers.ts";
import { TOOLKITS, type ToolkitName } from "../ui/toolkits.ts";
import { nativeTagType } from "../ui/roots.ts";
import { composeEmitter } from "./compose.ts";
import { nativeJsx } from "./native-jsx.ts";
import type { Ctx, E } from "./context.ts";
import type { FnEmitter } from "./function.ts";
import { enterMount, type Setup, setupOf, site } from "./setups.ts";
import { swiftUIEmitter } from "./swiftui.ts";
import { encoded, scalarType } from "./toolkit-values.ts";
import { traceSite } from "./trace-site.ts";

/** A body's generated file: `views/<registration>.swift`, or Kotlin under the library's sources. */
export interface ToolkitFile {
  readonly name: string;
  readonly text: string;
}

/** The host a body call made, as the setup's C++ feeds it. */
export interface ToolkitHost {
  /** What the effects keeping its values capture (the host's handle). */
  readonly captures: cpp.Capture[];
  /** The namespace of the toolkit's runtime, whose functions encode plain data (toolkit-values.ts). */
  readonly runtime: string;
  /** The C++ type of what they make (`id`, `jobject`). */
  readonly encoded: cpp.Type;
  /**
   * Sets `slot`'s state to `value`: a number, a boolean or a string as it
   * is (`as: "scalar"`), or any other value encoded (`as: "encoded"`).
   */
  set(slot: ValueSlot, value: cpp.Expr, as: "scalar" | "encoded"): cpp.Expr;
  /** Gives the host `slot`'s function (a Lucent function of the slot's type). */
  act(slot: ActionSlot, fn: cpp.Expr): cpp.Stmt;
  /** Sets `list`'s items to `records`: an array of them, encoded (`[key, value…]` each). */
  setList(list: ListSlot, records: cpp.Expr): cpp.Expr;
  /** What ends the host with the mount. */
  readonly dispose: cpp.Stmt[];
  /** The body call's value: the component's root. */
  readonly value: cpp.Expr;
}

/** What each toolkit writes for a body, and for its other calls in setup code. */
export interface ToolkitEmitter {
  /**
   * Writes the body out in the toolkit's language (kept for the program's
   * Swift or Kotlin), and emits into `em` the C++ making its host. `site`
   * is where the setup makes it: the returned JSX, or the body call.
   */
  body(
    em: FnEmitter,
    setup: Setup,
    body: Body,
    site: ts.Expression,
  ): {
    crossings: Crossings;
    host: ToolkitHost;
    /** The body's file, in the toolkit's language: written once the whole setup is compiled. */
    file: () => ToolkitFile;
  };
  /** A call of the toolkit's in the setup's code that is no body (`withAnimation`), lowered. */
  call?(em: FnEmitter, node: ts.CallExpression, decl: ts.Declaration): E | undefined;
  /**
   * The statements of a setup's own code the body takes (Compose's
   * composition statements), which its C++ leaves out; the setup's code is
   * checked against them first.
   */
  lifted?(checker: ts.TypeChecker, setup: Setup): readonly ts.Statement[];
}

const EMITTERS: Record<ToolkitName, ToolkitEmitter> = {
  swiftui: swiftUIEmitter,
  compose: composeEmitter,
};

const liftedBySetup = new WeakMap<Setup, ReadonlySet<ts.Statement>>();

/** The statements of `setup`'s own code its body takes, checked once, before its C++ is written. */
export function liftedStatements(checker: ts.TypeChecker, setup: Setup): ReadonlySet<ts.Statement> {
  let found = liftedBySetup.get(setup);

  if (!found) {
    found = new Set(setup.toolkit ? (EMITTERS[setup.toolkit].lifted?.(checker, setup) ?? []) : []);
    liftedBySetup.set(setup, found);
  }

  return found;
}

/** Whether a statement of a setup's own code is its body's (lifted): the setup's C++ leaves it out. */
export function liftedStatement(ctx: Ctx, s: ts.Statement): boolean {
  const setup = setupOf(ctx, s);

  return !!setup && liftedStatements(ctx.checker, setup).has(s);
}

/**
 * A call of a toolkit's function in Lucent code, lowered: the body (the
 * returned JSX with modifiers chained after it, or a body call), or
 * another call the toolkit's emitter knows (`withAnimation`). Undefined for
 * any other call; refused for the toolkit's views and values, which exist
 * only in a body.
 */
export function toolkitCall(em: FnEmitter, node: ts.CallExpression): E | undefined {
  if (jsxRoot(node)) return toolkitJsx(em, node);

  const helper = helperAt(em.checker, node.expression);

  if (helper)
    bodyFail(
      node,
      `\`${helper.name}\` is a helper view: use it in the JSX the component returns, \`<${helper.name} …/>\``,
    );

  const found = toolkitDeclaration(em.checker, node.expression);

  if (!found) return undefined;

  const { toolkit, decl } = found;

  const lowered = EMITTERS[toolkit].call?.(em, node, decl);

  if (lowered) return lowered;

  return bodyFail(
    node,
    `a ${TOOLKITS[toolkit].title} view or value is made only in ${BODY_PLACE}: write \`${made(node)}\` there`,
  );
}

/** A toolkit value read in Lucent code, outside a body: refused. */
export function toolkitMember(em: FnEmitter, node: ts.PropertyAccessExpression): void {
  const found = toolkitDeclaration(em.checker, node);

  if (!found) return;

  bodyFail(
    node,
    `\`${node.getText()}\` is ${TOOLKITS[found.toolkit].title}'s: use it in ${BODY_PLACE}`,
  );
}

/** Where a toolkit's views are made: its body. */
const BODY_PLACE = "the body a component returns";

/**
 * JSX in Lucent code: the body its setup returns, which makes the host;
 * refused anywhere else (a toolkit's views are made only in the body).
 */
export function toolkitJsx(em: FnEmitter, node: ts.Expression): E {
  // A native view's (T48): its tag is a UIKit or Android view class.
  if (nativeTagType(em.checker, node)) return nativeJsx(em, node);

  const toolkit = jsxToolkitOf(node, em.checker);
  const setup = setupOf(em.ctx, node);

  if (!toolkit) throw new Error("JSX in a file of no toolkit (the program refuses it)");

  const { title } = TOOLKITS[toolkit];

  if (!setup || setup.toolkit !== toolkit || !inSetupCode(node, setup.fn))
    bodyFail(
      node,
      `${title}'s views are a component's body: JSX the component returns, as the last statement of its setup`,
    );

  const body = bodyOf(setup.fn, toolkit, em.checker);

  if (skipParentheses(body) !== skipParentheses(node))
    bodyFail(
      node,
      `${title}'s views are made in the body, the JSX the component returns: write this view in it`,
    );

  return host(em, setup, body, node);
}

/** A body: the host, its actions, and an effect per value. */
function host(em: FnEmitter, setup: Setup, bodyNode: Body, where: ts.Expression): E {
  const toolkit = setup.toolkit!;
  const emitter = EMITTERS[toolkit];

  if (em.ctx.toolkitFiles.has(setup))
    bodyFail(where, `${setup.component.export} makes its body once`);

  const graph = cpp.call("lucent::ui::mainGraph");
  let written: ReturnType<ToolkitEmitter["body"]> | undefined;

  const madeHost = em.collect(() => {
    written = emitter.body(em, setup, bodyNode, where);
  });
  const { host, crossings, file } = written!;

  em.ctx.toolkitFiles.set(setup, { toolkit, file });

  const items = new Map(crossings.lists.map((l) => [l, em.ctx.fresh(`items_${l.index}`)]));
  const effect = (keep: cpp.Expr, at: ts.Node) =>
    cpp.exprStmt(
      cpp.call("lucent::ui::effect", [graph, keep, cpp.str(site(at)), traceSite("effect", at)]),
    );

  const statements: cpp.Stmt[] = [
    ...madeHost,
    ...crossings.lists.map((l) =>
      cpp.varDecl(cpp.auto, items.get(l)!, cpp.call("std::make_shared", [], [itemsType(em, l)])),
    ),
    ...crossings.actions.map((a) => host.act(a, actionFn(em, a, items))),
    ...crossings.values.map((v) => effect(valueEffect(em, host, v), slotSite(v))),
    ...crossings.lists.map((l) => effect(listEffect(em, host, l, items.get(l)!), l.site)),
    cpp.exprStmt(
      cpp.call(cpp.arrow(graph, "onCleanup"), [cpp.lambda(host.captures, [], host.dispose)]),
    ),
  ];

  return { c: cpp.statementExpr(statements, host.value), t: setup.root };
}

/**
 * The effect keeping `slot`'s state: it enters the mount, so a change is
 * measured again. A number, a boolean or a string (never null) crosses
 * as it is; any other value encoded.
 */
function valueEffect(em: FnEmitter, host: ToolkitHost, slot: ValueSlot): cpp.Expr {
  const scalar = scalarOf(slot.type);
  const plain = !slot.bound && scalar && !scalar.nullable;
  const get = em.thunk(slot.source, {
    site: slotSite(slot),
    given: givens(em.checker, slot.source, slot.use),
    ...(plain ? { type: scalarType(scalar) } : {}),
  });
  const value = cpp.id("lucent_value");
  // A bound signal's value: the signal, read.
  const set = slot.bound
    ? host.set(slot, cpp.call(cpp.dot(value, "get")), "scalar")
    : plain
      ? host.set(slot, value, "scalar")
      : host.set(slot, encoded(em.ctx, host.runtime, slot.type, returned(get), value), "encoded");
  const keep = cpp.lambda(
    [...host.captures, { name: "lucent_get", init: get.c }],
    [],
    [cpp.varDecl(cpp.auto, "lucent_value", cpp.call(cpp.id("lucent_get"))), cpp.exprStmt(set)],
    { mutable: true },
  );

  return enterMount(em, slotSite(slot), keep);
}

/** What a thunk gives. */
function returned(thunk: E): LType {
  if (thunk.t.k !== "fn") throw new Error("a thunk is not a function");

  return thunk.t.ret;
}

/** Where the setup computes a value: its expression, or, for a helper's, where the body uses the helper. */
function slotSite(slot: ValueSlot): ts.Node {
  return slot.use ? usedAt(slot.use) : slot.source;
}

/**
 * What a thunk of `node` computes first for its reads of a helper's props
 * (`props.title`): what the helper's user gives each (`t.title`), itself
 * given where a helper gives it, each evaluated once, in order, before
 * `node` is: so the setup computes a helper's value as JavaScript would,
 * the helper called with its props.
 */
function givens(
  checker: ts.TypeChecker,
  node: ts.Node,
  use: HelperUse | undefined,
): NonNullable<Thunk["given"]> {
  if (!use) return [];

  return propReads(checker, node, use.helper).flatMap((read) => {
    const arg = use.args.get(read.name.text);

    return arg ? [...givens(checker, arg, use.outer), { read, value: arg }] : [{ read }];
  });
}

/** The C++ name each list's item has, in the code computing its key and values. */
const ITEM = "lucent_item";

/** `lucent::ui::Items<Key, Item>`: a list's items by key. */
function itemsType(em: FnEmitter, list: ListSlot): cpp.Type {
  const element = em.lt(list.source);

  if (element.k !== "array") throw new Error("a list's source is not an array");

  return cpp.type(
    "lucent::ui::Items",
    em.reg.cppType(scalarType(list.keyType)),
    em.reg.cppType(element.e),
  );
}

/**
 * The function an action slot gives the host: the setup function, or,
 * when it takes a list's item, a function of the item's key calling it
 * with the item the key finds (none: the item is gone, nothing runs).
 */
function actionFn(em: FnEmitter, a: ActionSlot, items: ReadonlyMap<ListSlot, string>): cpp.Expr {
  const crossing: LType = {
    k: "fn",
    params: a.params.map((p) => scalarType(crossingOf(p))),
    ret: T.void,
  };

  // A bound signal's change: the signal is set, in its mount.
  if (a.writes) {
    const value = cpp.param(em.reg.cppType(scalarType(crossingOf(a.params[0]!))), "value");
    const write = cpp.lambda(
      [{ name: "signal", init: em.expr(a.source).c }],
      [value],
      [cpp.exprStmt(cpp.call(cpp.dot(cpp.id("signal"), "set"), [cpp.id("value")]))],
      { mutable: true },
    );

    return cpp.construct(em.reg.cppType(crossing), [enterMount(em, a.source, write)]);
  }

  if (!a.params.some((p) => p.k === "item")) return em.exprAs(a.source, crossing);

  const f = em.expr(a.source);
  const params = a.params.map((p, i) =>
    cpp.param(em.reg.cppType(scalarType(crossingOf(p))), `p${i}`),
  );
  const body: cpp.Stmt[] = [];
  const args = a.params.map((p, i) => {
    if (p.k !== "item") return cpp.id(`p${i}`);

    const found = `found${i}`;

    body.push(
      cpp.varDecl(
        cpp.auto,
        found,
        cpp.call(cpp.arrow(cpp.id(items.get(p.list)!), "find"), [cpp.id(`p${i}`)]),
      ),
      cpp.ifStmt(cpp.not(cpp.call(cpp.dot(cpp.id(found), "has"))), [cpp.ret()]),
    );

    return cpp.call(cpp.dot(cpp.id(found), "get"));
  });

  const lists = [...new Set(a.params.flatMap((p) => (p.k === "item" ? [p.list] : [])))];
  const lambda = cpp.lambda(
    [{ name: "f", init: f.c }, ...lists.map((l) => items.get(l)!)],
    params,
    [...body, cpp.exprStmt(cpp.call(cpp.id("f"), args))],
    { mutable: true },
  );

  return cpp.construct(em.reg.cppType(crossing), [lambda]);
}

/**
 * The effect keeping a list: the array, then each item's key and values
 * (in order, the item named ITEM), as records the host merges by key.
 */
function listEffect(em: FnEmitter, host: ToolkitHost, list: ListSlot, items: string): cpp.Expr {
  const source = em.thunk(list.source);
  const array = returned(source);

  if (array.k !== "array") throw new Error("a list's source is not an array");

  const element = array.e;
  const item: Thunk["params"] = [{ names: list.names, type: element }];
  const key = em.thunk(list.key, { params: item, type: scalarType(list.keyType) });
  const values = list.values.map((v) =>
    em.thunk(v.source, {
      params: item,
      site: slotSite(v),
      given: givens(em.checker, v.source, v.use),
    }),
  );
  const run = (name: string) => cpp.id(`${host.runtime}::${name}`);
  const of = (name: string) => cpp.call(cpp.id(name), [cpp.id(ITEM)]);

  const fields = values.map((v, i) => {
    const name = `lucent_v${i}`;
    const value = cpp.id(`${name}_value`);

    return {
      stmts: [
        cpp.varDecl(cpp.auto, `${name}_value`, of(`${name}_of`)),
        cpp.varDecl(
          host.encoded,
          name,
          encoded(em.ctx, host.runtime, list.values[i]!.type, returned(v), value),
        ),
      ],
      name,
    };
  });
  const record = cpp.lambda(
    ["&"],
    [cpp.param(cpp.reference(cpp.constType(em.reg.cppType(element))), ITEM)],
    [
      cpp.varDecl(cpp.auto, "lucent_key", of("lucent_key_of")),
      cpp.exprStmt(cpp.call(cpp.arrow(cpp.id(items), "add"), [cpp.id("lucent_key"), cpp.id(ITEM)])),
      ...fields.flatMap((f) => f.stmts),
      cpp.ret(
        cpp.call(run("record"), [
          cpp.initList([
            cpp.call(run("value"), [cpp.id("lucent_key")]),
            ...fields.map((f) => cpp.id(f.name)),
          ]),
        ]),
      ),
    ],
  );
  const keep = cpp.lambda(
    [
      ...host.captures,
      items,
      { name: "lucent_source_of", init: source.c },
      { name: "lucent_key_of", init: key.c },
      ...values.map((v, i) => ({ name: `lucent_v${i}_of`, init: v.c })),
    ],
    [],
    [
      cpp.varDecl(cpp.auto, "lucent_source", cpp.call(cpp.id("lucent_source_of"))),
      cpp.exprStmt(cpp.call(cpp.arrow(cpp.id(items), "clear"))),
      cpp.exprStmt(host.setList(list, cpp.call(run("array"), [cpp.id("lucent_source"), record]))),
    ],
    { mutable: true },
  );

  return enterMount(em, list.site, keep);
}

/** The view a chain of modifiers starts from (`Circle()` in `Circle().fill(…)`), as written. */
function made(e: ts.Expression): string {
  let out: ts.Expression = e;

  for (;;) {
    const inner = ts.isCallExpression(out) ? out.expression : out;

    if (!ts.isPropertyAccessExpression(inner) || !ts.isCallExpression(inner.expression))
      return out.getText();

    out = inner.expression;
  }
}
