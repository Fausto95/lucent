/**
 * JSX of native views (T48, LUCENT_VIEWS=fabric): a component returning
 * `<UIStackView spacing={8}><UILabel text={props.title} /></UIStackView>`,
 * lowered as the setup a person would write, by the rules its classes'
 * declarations give (sdk/view-rules.ts):
 *
 * - each element's view is made when the component mounts, in source
 *   order, a parent before its children: by rule (a zero frame, init, the
 *   hosting view's Context), or by its `create` function;
 * - each prop is an effect of the mount, as a toolkit body's values are
 *   (emit/toolkit.ts): its expression evaluated now and whenever what it
 *   read changes, and set on the view; a literal is set once;
 * - each event's handler is evaluated once and registered (a listener, a
 *   control's action), and taken back when the mount ends;
 * - children are inserted in order, by the method their parent's class
 *   declares for it.
 */
import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { findSdkModule } from "../sdk/schema.ts";
import { type ViewOwner, viewTag } from "../sdk/view-rules.ts";
import { T } from "../types.ts";
import { nativeTagType } from "../ui/roots.ts";
import type { E } from "./context.ts";
import type { FnEmitter } from "./function.ts";
import {
  controlEvent,
  insertChild,
  listenerEvent,
  propertySetter,
  sdkTagClass,
  setterCall,
  viewNew,
} from "./native.ts";
import { enterMount, setupOf, site } from "./setups.ts";

/** The JSX a component returns, made: the root view, its children inside it. */
export function nativeJsx(em: FnEmitter, node: ts.Expression): E {
  const setup = setupOf(em.ctx, node);

  if (!setup || !returnedBy(node, setup.fn))
    fail(
      node,
      Codes.NativeViewJsx,
      "JSX of native views is what a component returns: return it, as the last statement of the component",
    );

  const made: Made = { statements: [], cleanup: [], captures: [] };
  const root = element(em, node, made);

  made.statements.push(
    cpp.exprStmt(
      cpp.call(cpp.arrow(cpp.call("lucent::ui::mainGraph"), "onCleanup"), [
        cpp.lambda(made.captures, [], made.cleanup),
      ]),
    ),
  );

  return { c: cpp.statementExpr(made.statements, cpp.id(root)), t: setup.root };
}

/** What making the elements writes: the setup's statements, and the mount's end's. */
interface Made {
  statements: cpp.Stmt[];
  cleanup: cpp.Stmt[];
  /** What the mount's end captures: the views and actions it takes back. */
  captures: string[];
}

/** A setter's call as a statement: what it gives (the value assigned) discarded. */
const discarded = (c: cpp.Expr): cpp.Stmt =>
  cpp.exprStmt(c.k === "call" ? c : cpp.cast("c", cpp.voidType, c));

/** Whether `node` is what `fn` returns last: the component's view. */
function returnedBy(node: ts.Expression, fn: ts.FunctionLikeDeclaration): boolean {
  let at: ts.Node = node;
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent;

  const body = fn.body;
  const last = body && ts.isBlock(body) ? body.statements.at(-1) : undefined;

  return body === at || (!!last && ts.isReturnStatement(last) && last.expression === at);
}

/**
 * Refuses a prop's value reading a copy setup made of a prop (`const title
 * = props.title`): it holds the prop as setup first read it, so the
 * attribute it keeps would never change.
 */
function refuseCopies(em: FnEmitter, fn: ts.FunctionLikeDeclaration, value: ts.Expression): void {
  const props = fn.parameters[0] && em.checker.getSymbolAtLocation(fn.parameters[0].name);
  const body = fn.body && ts.isBlock(fn.body) ? fn.body : undefined;
  if (!props || !body) return;

  const visit = (n: ts.Node): void => {
    if (ts.isFunctionLike(n)) return;

    const sym = ts.isIdentifier(n) ? em.checker.getSymbolAtLocation(n) : undefined;
    const decl = sym?.valueDeclaration;
    const statement = decl?.parent?.parent;
    let read = decl && ts.isVariableDeclaration(decl) ? decl.initializer : undefined;
    while (read && ts.isParenthesizedExpression(read)) read = read.expression;

    let root: ts.Expression | undefined = read;
    while (root && ts.isPropertyAccessExpression(root)) root = root.expression;

    if (
      read &&
      read !== root &&
      root &&
      ts.isIdentifier(root) &&
      em.checker.getSymbolAtLocation(root) === props &&
      statement &&
      ts.isVariableStatement(statement) &&
      statement.parent === body
    )
      fail(
        n,
        Codes.NativeViewJsx,
        `\`${n.getText()}\` is ${read.getText()} as setup first read it: the attribute would never change`,
        `read ${read.getText()} in the attribute, which keeps it up to date`,
      );

    ts.forEachChild(n, visit);
  };

  visit(value);
}

/** One element: its view made, its attributes and children given; the view's C++ name. */
function element(em: FnEmitter, node: ts.Expression, made: Made): string {
  const setup = setupOf(em.ctx, node)!;
  let jsx: ts.Node = node;
  while (ts.isParenthesizedExpression(jsx)) jsx = jsx.expression;

  if (!ts.isJsxElement(jsx) && !ts.isJsxSelfClosingElement(jsx))
    fail(node, Codes.NativeViewJsx, "a native view's children are elements of native views");

  const opening = ts.isJsxElement(jsx) ? jsx.openingElement : jsx;
  const tag = opening.tagName;
  const ref = sdkTagClass(em, tag);

  if (!ref)
    fail(
      tag,
      Codes.NativeViewJsx,
      `<${tag.getText()}> is no SDK view class: a native view's JSX is UIKit's or Android's views`,
    );

  // An SDK class's name: an identifier or a property access, an expression.
  const at = tag as ts.Expression;
  const schema = findSdkModule(ref.platform, ref.module);
  if (!schema) throw new Error(`${ref.module}: no schema for a class it declares`);

  const rules = viewTag(ref.cls, schema, (m) => findSdkModule(ref.platform, m));
  const owned = (o: ViewOwner) => ({ platform: ref.platform, module: o.schema.module, cls: o.cls });
  const lt = em.reg.lower(nativeTagType(em.checker, node)!, node);
  const view = em.ctx.fresh(`view_${ref.cls.name}`);
  const attributes = opening.attributes.properties;

  for (const a of attributes)
    if (!ts.isJsxAttribute(a))
      fail(a, Codes.NativeViewJsx, "a native view's attributes are written one by one, not spread");

  const named = (name: string) =>
    attributes.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === name);
  const valueOf = (a: ts.JsxAttribute): ts.Expression | undefined =>
    a.initializer && ts.isJsxExpression(a.initializer)
      ? a.initializer.expression
      : (a.initializer as ts.StringLiteral | undefined);

  // The view: `create`'s, or made by rule.
  const create = named("create");
  const createdBy = create && valueOf(create);
  if (createdBy) {
    const f = em.ctx.fresh("create");

    made.statements.push(
      cpp.varDecl(cpp.auto, f, em.expr(createdBy).c),
      cpp.varDecl(cpp.auto, view, cpp.call(cpp.id(f), [])),
    );
  } else {
    if (rules.construction.kind === "create")
      fail(tag, Codes.NativeViewJsx, rules.construction.reason);

    made.statements.push(
      cpp.varDecl(cpp.auto, view, viewNew(em, at, ref, rules.construction, lt).c),
    );
  }

  const self: E = { c: cpp.id(view), t: lt };
  made.captures.push(view);

  for (const a of attributes as ts.NodeArray<ts.JsxAttribute>) {
    const name = a.name.getText();
    if (name === "create") continue;

    const value = valueOf(a);
    const prop = rules.props.get(name);
    const event = rules.events.get(name);

    if (event) {
      if (!value) fail(a, Codes.NativeViewJsx, `${name} takes a function`);

      const owner = owned(event.owner);
      const handler = em.expr(value);

      if (event.event.kind === "listener") {
        const listened = listenerEvent(em, value, owner, event.event.setter, self, handler);

        made.statements.push(cpp.exprStmt(listened.add));
        made.cleanup.push(cpp.exprStmt(listened.remove));
      } else {
        const action = em.ctx.fresh("action");
        const control = controlEvent(
          em,
          value,
          owner,
          ref,
          event.event.register,
          event.event.value,
          self,
          handler,
        );

        made.statements.push(cpp.varDecl(cpp.auto, action, control.add));
        made.cleanup.push(cpp.exprStmt(control.remove(cpp.id(action))));
        made.captures.push(action);
      }
      continue;
    }

    if (!prop)
      fail(
        a,
        Codes.NativeViewJsx,
        `<${ref.cls.name}> has no ${name}: what its declarations give is a writable property, a setter, an event, or children`,
      );

    const owner = owned(prop.owner);
    const type = em.lt(a.name);
    const set = (v: E) =>
      prop.prop.kind === "property"
        ? propertySetter(em, value ?? at, owner, prop.prop.member, self, type)(v.c)
        : setterCall(em, value ?? at, owner, prop.prop.overloads, self, v);

    // A bare attribute is true, set once.
    if (!value) {
      made.statements.push(discarded(set({ c: cpp.id("true"), t: T.boolean })));
      continue;
    }

    refuseCopies(em, setup.fn, value);

    // A prop is an effect of the mount: set now, and again whenever what it read changes. A
    // property takes its type; a setter's value keeps its own, which chooses the overload.
    const property = prop.prop.kind === "property";
    const get = em.thunk(value, { site: value, ...(property ? { type } : {}) });
    const got = !property && get.t.k === "fn" ? get.t.ret : type;
    const keep = cpp.lambda(
      [view, { name: "lucent_get", init: get.c }],
      [],
      [
        cpp.varDecl(cpp.auto, "lucent_value", cpp.call(cpp.id("lucent_get"))),
        discarded(set({ c: cpp.id("lucent_value"), t: got })),
      ],
      { mutable: true },
    );

    made.statements.push(
      cpp.exprStmt(
        cpp.call("lucent::ui::effect", [
          cpp.call("lucent::ui::mainGraph"),
          enterMount(em, value, keep),
          cpp.str(site(value)),
        ]),
      ),
    );
  }

  // Children, in order, where the class inserts views at an index.
  const children = ts.isJsxElement(jsx)
    ? jsx.children.filter((c) => !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces))
    : [];
  if (children.length && !rules.children)
    fail(
      children[0]!,
      Codes.NativeViewJsx,
      `<${ref.cls.name}> takes no children: its class declares no method inserting a view at an index`,
    );

  children.forEach((c, index) => {
    if (!ts.isJsxElement(c) && !ts.isJsxSelfClosingElement(c))
      fail(c, Codes.NativeViewJsx, "a native view's children are elements of native views");

    const child = element(em, c, made);
    const { rule, owner } = rules.children!;

    made.statements.push(
      cpp.exprStmt(
        insertChild(em, c, owned(owner), rule.insert, self, { c: cpp.id(child), t: lt }, index),
      ),
    );
  });

  return view;
}
