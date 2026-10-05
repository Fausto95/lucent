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
 *   declares for it;
 * - a child written `{cond && <X/>}` or `{c ? <X/> : <Y/>}` is a branch
 *   (T49, lucent/ui_children.h): an effect choosing which element shows,
 *   each made in a scope of its own when it shows and ended when it goes;
 * - a child written `{items.map((item) => <X key={item.id} … />)}` is a
 *   keyed list: one element per key, made once in a scope of its own, its
 *   `item` a signal the list writes when the key's item changes, its view
 *   moved where the order changes and let go with its key.
 */
import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { findSdkModule } from "../sdk/schema.ts";
import { type ViewOwner, viewTag } from "../sdk/view-rules.ts";
import { nativeTagType } from "../ui/roots.ts";
import type { Thunk } from "../ir/lower.ts";
import { type LType, T } from "../types.ts";
import type { E } from "./context.ts";
import type { FnEmitter } from "./function.ts";
import {
  controlEvent,
  insertChild,
  listenerEvent,
  propertySetter,
  removeChild,
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

  const made = madeIn();
  const root = element(em, node, made);

  return { c: cpp.statementExpr(ended(made), cpp.id(root)), t: setup.root };
}

/**
 * What making elements writes: statements, and those of the end of the
 * scope they run in (the mount's, an item's, a branch's).
 */
interface Made {
  statements: cpp.Stmt[];
  cleanup: cpp.Stmt[];
  /** What the scope's end captures: the views and actions it takes back. */
  captures: string[];
  /** Inside a list's callback: its item, read from the signal the list keeps for it. */
  item?: Item;
}

/** A keyed list's item: the callback's parameter, and the C++ name of its signal. */
interface Item {
  names: ts.Symbol[];
  type: LType;
  signal: string;
}

const madeIn = (item?: Item): Made => ({
  statements: [],
  cleanup: [],
  captures: [],
  ...(item ? { item } : {}),
});

const graph = () => cpp.call("lucent::ui::mainGraph");

/** `made`'s statements, then its end registered with the scope they run in. */
const ended = (made: Made): cpp.Stmt[] => [
  ...made.statements,
  cpp.exprStmt(
    cpp.call(cpp.arrow(graph(), "onCleanup"), [cpp.lambda(made.captures, [], made.cleanup)]),
  ),
];

/**
 * A function computing `node` later: inside a list's callback, it takes
 * the item (`call` gives it the item's signal's value).
 */
function later(em: FnEmitter, made: Made, node: ts.Expression, thunk: Thunk = {}): E {
  return em.thunk(
    node,
    made.item ? { ...thunk, params: [{ names: made.item.names, type: made.item.type }] } : thunk,
  );
}

/** A call of what `later` gave: the item read (tracked) or peeked inside a list's callback. */
function call(made: Made, f: cpp.Expr, read: "get" | "peek" = "get"): cpp.Expr {
  return cpp.call(f, made.item ? [cpp.call(cpp.dot(cpp.id(made.item.signal), read))] : []);
}

/** What `later` gives: its function's result. */
const resultOf = (f: E, or: LType): LType => (f.t.k === "fn" ? f.t.ret : or);

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

/** Whether `n` is an element (not a fragment): what a native view's child is. */
const isElement = (n: ts.Node): n is ts.JsxElement | ts.JsxSelfClosingElement =>
  ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n);

function unwrapped(e: ts.Expression): ts.Expression {
  let out = e;

  while (ts.isParenthesizedExpression(out)) out = out.expression;

  return out;
}

/**
 * One element: its view made, its attributes and children given; the
 * view's C++ name. `keyed`: the element a list's callback returns, whose
 * `key` the list reads.
 */
function element(em: FnEmitter, node: ts.Expression, made: Made, keyed = false): string {
  const setup = setupOf(em.ctx, node)!;
  const jsx = unwrapped(node);

  if (!isElement(jsx))
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

  // The view: `create`'s, or made by rule.
  const create = named("create");
  const createdBy = create && valueOf(create);
  if (createdBy) {
    const f = em.ctx.fresh("create");

    made.statements.push(
      cpp.varDecl(cpp.auto, f, call(made, later(em, made, createdBy).c, "peek")),
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

    if (name === "key") {
      if (keyed) continue;

      fail(
        a,
        Codes.NativeViewJsx,
        "`key` is for the element a list's callback returns: `{items.map((item) => <X key={item.id} />)}`",
      );
    }

    const value = valueOf(a);
    const prop = rules.props.get(name);
    const event = rules.events.get(name);

    if (event) {
      if (!value) fail(a, Codes.NativeViewJsx, `${name} takes a function`);

      const owner = owned(event.owner);
      const register = (handler: E, into: Made) => {
        if (event.event.kind === "listener") {
          const listened = listenerEvent(em, value, owner, event.event.setter, self, handler);

          into.statements.push(cpp.exprStmt(listened.add));
          into.cleanup.push(cpp.exprStmt(listened.remove));
          return;
        }

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

        into.statements.push(cpp.varDecl(cpp.auto, action, control.add));
        into.cleanup.push(cpp.exprStmt(control.remove(cpp.id(action))));
        into.captures.push(action);
      };

      if (!made.item) {
        register(em.expr(value), made);
        continue;
      }

      // In a list's item, the handler is the item's: registered again when the item changes.
      const get = later(em, made, value);
      const run = madeIn();
      const handler = em.ctx.fresh("handler");

      run.statements.push(cpp.varDecl(cpp.auto, handler, call(made, cpp.id("lucent_get"))));
      register({ c: cpp.id(handler), t: resultOf(get, em.lt(value)) }, run);
      run.captures.push(view);

      made.statements.push(
        effectOf(em, value, [view, made.item.signal, { name: "lucent_get", init: get.c }], ended(run)),
      );
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
    const get = later(em, made, value, { site: value, ...(property ? { type } : {}) });
    const got = !property ? resultOf(get, type) : type;

    made.statements.push(
      effectOf(
        em,
        value,
        [view, ...(made.item ? [made.item.signal] : []), { name: "lucent_get", init: get.c }],
        [
          cpp.varDecl(cpp.auto, "lucent_value", call(made, cpp.id("lucent_get"))),
          discarded(set({ c: cpp.id("lucent_value"), t: got })),
        ],
      ),
    );
  }

  children(em, jsx, made, ref, rules, self);

  return view;
}

/** An attribute's value: its expression, its string, or none (a bare attribute). */
function valueOf(a: ts.JsxAttribute): ts.Expression | undefined {
  return a.initializer && ts.isJsxExpression(a.initializer)
    ? a.initializer.expression
    : (a.initializer as ts.StringLiteral | undefined);
}

/** An effect of the scope setup runs in, entering the mount whenever it runs. */
function effectOf(
  em: FnEmitter,
  at: ts.Expression,
  captures: cpp.Capture[],
  body: cpp.Stmt[],
): cpp.Stmt {
  return cpp.exprStmt(
    cpp.call("lucent::ui::effect", [
      graph(),
      enterMount(em, at, cpp.lambda(captures, [], body, { mutable: true })),
      cpp.str(site(at)),
    ]),
  );
}

type Rules = ReturnType<typeof viewTag>;

/**
 * An element's children, in order, where the class inserts views at an
 * index. Fixed ones are inserted at their index once; with a branch or a
 * list among them, each child is a region of the parent's children (one
 * view, or as many as the region shows), inserted where the regions
 * before it end.
 */
function children(
  em: FnEmitter,
  jsx: ts.JsxElement | ts.JsxSelfClosingElement,
  made: Made,
  ref: NonNullable<ReturnType<typeof sdkTagClass>>,
  rules: Rules,
  self: E,
): void {
  const written = ts.isJsxElement(jsx)
    ? jsx.children.filter(
        (c) =>
          !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces) &&
          !(ts.isJsxExpression(c) && !c.expression),
      )
    : [];
  if (!written.length) return;

  if (!rules.children)
    fail(
      written[0]!,
      Codes.NativeViewJsx,
      `<${ref.cls.name}> takes no children: its class declares no method inserting a view at an index`,
    );

  const { rule, owner } = rules.children;
  const parent = { platform: ref.platform, module: owner.schema.module, cls: owner.cls };
  const insert = (child: cpp.Expr, index: cpp.Expr) =>
    insertChild(em, jsx, parent, rule.insert, self, { c: child, t: self.t }, index);

  // All fixed: each inserted at its index.
  if (written.every(isElement)) {
    written.forEach((c, index) => {
      const child = element(em, c, made);

      made.statements.push(cpp.exprStmt(insert(cpp.id(child), cpp.num(index))));
    });
    return;
  }

  for (const c of written)
    if (!isElement(c) && !ts.isJsxExpression(c))
      fail(c, Codes.NativeViewJsx, "a native view's children are elements of native views");

  if (ref.platform === "android" && !rule.remove)
    fail(
      written.find((c) => !isElement(c))!,
      Codes.NativeViewJsx,
      `<${ref.cls.name}>'s children are fixed: its class declares no method letting a view go (removeView)`,
    );

  // What the parent does with its children, natively.
  const regions = em.ctx.fresh("regions");
  const ops = em.ctx.fresh("ops");
  const viewType = cpp.type("lucent::NativeRef");
  const child = cpp.param(cpp.constType(cpp.reference(viewType)), "lucent_child");
  const at = (name: string) => cpp.param(cpp.type("int"), name);
  const moves = rule.movesByInsert
    ? [
        cpp.lambda(["="], [child, at("lucent_from"), at("lucent_to")], [
          cpp.exprStmt(insert(cpp.id("lucent_child"), cpp.id("lucent_to"))),
        ]),
      ]
    : [];

  made.statements.push(
    cpp.varDecl(
      cpp.auto,
      regions,
      cpp.call(cpp.templateId("std::make_shared", [cpp.type("lucent::ui::ChildRegions")]), []),
    ),
    cpp.varDecl(
      cpp.auto,
      ops,
      cpp.construct(
        cpp.type("lucent::ui::ChildOps", viewType),
        [
          cpp.lambda(["="], [child, at("lucent_index")], [
            cpp.exprStmt(insert(cpp.id("lucent_child"), cpp.id("lucent_index"))),
          ]),
          cpp.lambda(
            ["="],
            [child],
            removeChild(em, jsx, parent, rule.remove, self, {
              c: cpp.id("lucent_child"),
              t: self.t,
            }),
          ),
          ...moves,
        ],
        true,
      ),
    ),
  );
  made.captures.push(regions);

  written.forEach((c, region) => {
    const index = cpp.call(cpp.arrow(cpp.id(regions), "offset"), [cpp.num(region)]);

    if (isElement(c)) {
      const fixed = element(em, c, made);

      made.statements.push(
        cpp.exprStmt(cpp.call(cpp.arrow(cpp.id(regions), "add"), [cpp.num(1)])),
        cpp.exprStmt(insert(cpp.id(fixed), index)),
      );
      return;
    }

    const e = unwrapped((c as ts.JsxExpression).expression!);
    const added = cpp.call(cpp.arrow(cpp.id(regions), "add"), [cpp.num(0)]);

    if (ts.isCallExpression(e) && mapped(e)) list(em, e, made, ops, regions, added);
    else branch(em, e, made, ops, regions, added);
  });
}

/** Whether `e` is `items.map(…)`: a keyed list. */
function mapped(e: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === "map";
}

/**
 * A branch: `cond && <X/>`, `c ? <X/> : <Y/>`, nested, each side an
 * element or nothing (`null`, `undefined`, `false`).
 */
function branch(
  em: FnEmitter,
  e: ts.Expression,
  made: Made,
  ops: string,
  regions: string,
  region: cpp.Expr,
): void {
  const elements: ts.Expression[] = [];
  const conditions: cpp.Capture[] = [];

  const none = (n: ts.Expression) =>
    n.kind === ts.SyntaxKind.NullKeyword ||
    n.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(n) && n.text === "undefined");

  const condition = (n: ts.Expression): cpp.Expr => {
    const name = em.ctx.fresh("cond");

    conditions.push({ name, init: later(em, made, n).c });
    return cpp.call("lucent::truthy", [call(made, cpp.id(name))]);
  };

  const which = (at: ts.Expression): cpp.Expr => {
    const n = unwrapped(at);

    if (isElement(n)) {
      elements.push(n);
      return cpp.num(elements.length - 1);
    }

    if (none(n)) return cpp.num(-1);

    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
      return cpp.conditional(condition(n.left), which(n.right), cpp.num(-1));

    if (ts.isConditionalExpression(n))
      return cpp.conditional(condition(n.condition), which(n.whenTrue), which(n.whenFalse));

    if (ts.isCallExpression(n) && mapped(n))
      fail(n, Codes.NativeViewJsx, "a list is a child of its own: write it outside the condition");

    fail(
      n,
      Codes.NativeViewJsx,
      "a native view's child that comes and goes is `{cond && <X />}`, `{c ? <X /> : <Y />}` or `{items.map((item) => <X key={…} />)}`",
    );
  };

  const choice = which(e);

  // Each element made where it shows, in its branch's scope.
  const built = elements.map((el, i) => {
    const own = madeIn(made.item);
    const view = element(em, el, own);
    const body = [...ended(own), cpp.ret(cpp.id(view))];

    return i === elements.length - 1
      ? cpp.block(body)
      : cpp.ifStmt(cpp.binary(cpp.id("lucent_branch"), "==", cpp.num(i)), body);
  });

  made.statements.push(
    cpp.exprStmt(
      cpp.call(cpp.templateId("lucent::ui::branch", [cpp.type("lucent::NativeRef")]), [
        graph(),
        cpp.id(ops),
        cpp.id(regions),
        region,
        enterMount(
          em,
          e,
          cpp.lambda(
            ["=", ...conditions],
            [],
            [cpp.ret(choice)],
            { ret: cpp.type("int") },
          ),
        ),
        enterMount(
          em,
          e,
          cpp.lambda(["="], [cpp.param(cpp.type("int"), "lucent_branch")], built, {
            ret: cpp.type("lucent::NativeRef"),
          }),
        ),
      ]),
    ),
  );
}

/** A keyed list: `items.map((item) => <X key={item.id} … />)`. */
function list(
  em: FnEmitter,
  e: ts.CallExpression,
  made: Made,
  ops: string,
  regions: string,
  region: cpp.Expr,
): void {
  if (made.item)
    fail(e, Codes.NativeViewJsx, "a list inside a list's item: make the item a component of its own");

  const items = (e.expression as ts.PropertyAccessExpression).expression;
  const arrayType = em.lt(items);
  const [callback] = e.arguments;
  const fn = callback && unwrapped(callback);

  if (arrayType.k !== "array")
    fail(items, Codes.NativeViewJsx, `a list maps an array: ${items.getText()} is none`);

  if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) || e.arguments.length !== 1)
    fail(e, Codes.NativeViewJsx, "a list maps a function literal: `items.map((item) => <X key={…} />)`");

  const [param, index] = fn.parameters;

  if (index)
    fail(
      index,
      Codes.NativeViewJsx,
      "a list's item has no index: indexes change as items move; its `key` says which it is",
    );

  if (!param || !ts.isIdentifier(param.name))
    fail(fn, Codes.NativeViewJsx, "a list's callback names its item: `(item) => <X key={item.id} />`");

  const body = ts.isBlock(fn.body)
    ? fn.body.statements.length === 1 && ts.isReturnStatement(fn.body.statements[0]!)
      ? fn.body.statements[0].expression
      : undefined
    : fn.body;
  const returned = body && unwrapped(body);

  if (!returned || !isElement(returned))
    fail(fn, Codes.NativeViewJsx, "a list's callback returns one element of a native view");

  const opening = ts.isJsxElement(returned) ? returned.openingElement : returned;
  const key = opening.attributes.properties.find(
    (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === "key",
  );
  const keyValue = key && valueOf(key);

  if (!keyValue)
    fail(
      opening,
      Codes.NativeViewJsx,
      "a list's element has a `key` saying which item it is: `<X key={item.id} />`",
    );

  const keyType = em.lt(keyValue);
  if (keyType.k !== "string" && keyType.k !== "number")
    fail(keyValue, Codes.NativeViewJsx, "a list's key is a string or a number");

  const symbol = em.checker.getSymbolAtLocation(param.name)!;
  const item: Item = { names: [symbol], type: arrayType.e, signal: "lucent_item" };
  const own = madeIn(item);
  const view = element(em, returned, own, true);

  const itemType = em.reg.cppType(arrayType.e);
  const keyCpp = em.reg.cppType(keyType);
  const keyOf = later(em, own, keyValue, { type: keyType });
  const array = em.thunk(items, { type: arrayType });
  const listName = em.ctx.fresh("list");
  const signalType = cpp.constType(
    cpp.reference(cpp.type("lucent::ui::Signal", itemType)),
  );

  made.statements.push(
    cpp.varDecl(
      cpp.auto,
      listName,
      cpp.call(
        cpp.templateId("std::make_shared", [
          cpp.type("lucent::ui::KeyedList", keyCpp, itemType, cpp.type("lucent::NativeRef")),
        ]),
        [
          graph(),
          cpp.call(cpp.arrow(graph(), "scope")),
          cpp.id(ops),
          cpp.id(regions),
          region,
          enterMount(
            em,
            e,
            cpp.lambda(["="], [cpp.param(signalType, "lucent_item")], [
              ...ended(own),
              cpp.ret(cpp.id(view)),
            ], { ret: cpp.type("lucent::NativeRef") }),
          ),
        ],
      ),
    ),
    effectOf(
      em,
      e,
      [listName, { name: "lucent_items", init: array.c }, { name: "lucent_key", init: keyOf.c }],
      [
        cpp.exprStmt(
          cpp.call(cpp.arrow(cpp.id(listName), "update"), [
            cpp.call(cpp.id("lucent_items"), []),
            cpp.lambda(
              ["&"],
              [cpp.param(cpp.constType(cpp.reference(itemType)), "lucent_value")],
              [cpp.ret(cpp.call(cpp.id("lucent_key"), [cpp.id("lucent_value")]))],
              { ret: keyCpp },
            ),
          ]),
        ),
      ],
    ),
  );
  made.captures.push(listName);
}
