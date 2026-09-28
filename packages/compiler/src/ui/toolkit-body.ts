/**
 * What SwiftUI and Compose bodies share (LUCENT_VIEWS=fabric): where a
 * body starts, and what crosses between it and its setup. The body is
 * written out in the toolkit's language (emit/swiftui.ts, ui/compose.ts);
 * the setup is compiled to C++ (emit/toolkit.ts); they meet through slots:
 *
 * - a value slot is plain data the setup computes (`on.get()`,
 *   `props.title`, a template of them, what a setup function returns, an
 *   object or an array): an effect of the setup evaluates it, with
 *   JavaScript's semantics, and sets the toolkit's state, so the body
 *   draws again. Numbers, booleans and strings cross as they are; other
 *   values encoded (emit/toolkit-values.ts);
 * - an action slot is a setup function the body calls from a callback, or
 *   passes as one (`onTapGesture(tap)`): the toolkit calls it, and it runs
 *   as Lucent code in the main context;
 * - a list slot is an array the setup computes, shown item by item
 *   (SwiftUI's ForEach, Compose's items and key): each item has a key, a
 *   string or a number its key function computes, and its own value
 *   slots, which the setup computes for it. The toolkit keeps one model
 *   per key, updated in place. A callback of an item may give a setup
 *   function the item itself: the toolkit passes its key, and the setup
 *   finds the item again.
 *
 * The body holds no logic of its own: it does not change the setup's
 * state, send events, or read the setup's other values. Everything it may
 * not do fails with LUCENT3024.
 */
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { builtinSdkModuleOf } from "../program.ts";
import type { ViewType } from "./contract.ts";
import type { FunctionLike } from "./roots.ts";
import { TOOLKITS, type ToolkitName, toolkitOfModule } from "./toolkits.ts";
import { ViewTypes } from "./values.ts";

/** A body: the function given to its toolkit's body function. */
export type BodyFunction = ts.ArrowFunction | ts.FunctionExpression;

/** The component a body belongs to: its setup. */
export interface BodySetup {
  readonly fn: FunctionLike;
  readonly propsSymbol?: ts.Symbol;
  readonly export: string;
  readonly registration: string;
}

/** A number (a Double), a boolean or a string, maybe null: what crosses back from a body. */
export interface ScalarType {
  readonly k: "number" | "boolean" | "string";
  readonly nullable: boolean;
}

/** A value's type as a scalar, when it is one: a string literal union is a string. */
export function scalarOf(t: ViewType): ScalarType | undefined {
  const nullable = t.k === "nullable";
  const inner = t.k === "nullable" ? t.inner : t;

  switch (inner.k) {
    case "number":
    case "boolean":
    case "string":
      return { k: inner.k, nullable };
    case "enum":
      return { k: "string", nullable };
    default:
      return undefined;
  }
}

export interface ValueSlot {
  readonly kind: "value";
  /** Its place among the body's value slots, or its list's. */
  readonly index: number;
  /** Its name in the generated code: what it reads, and its place among all slots. */
  readonly name: string;
  /** What the setup evaluates for it: `props.on`, `taps.get()`, `caption()`. */
  readonly source: ts.Expression;
  readonly type: ViewType;
  /** The list whose items it is computed for; none for the body's own. */
  readonly list?: ListSlot;
  /** A bound signal's value: `source` is the signal, read with get(). */
  readonly bound?: true;
}

/** An array the body shows item by item, each item keyed. */
export interface ListSlot {
  readonly kind: "list";
  /** Its place among the body's lists. */
  readonly index: number;
  readonly name: string;
  /** The call showing it (`ForEach(…)`, `items(…)`, `key(…)` in a map). */
  readonly site: ts.Node;
  /** The array the setup computes. */
  readonly source: ts.Expression;
  /** The names the item has: the content's parameter, and the key function's. */
  readonly names: readonly ts.Symbol[];
  /** What each item shows: a function of the item. */
  readonly content: ts.ArrowFunction | ts.FunctionExpression;
  /** The item's key, over one of `names`. */
  readonly key: ts.Expression;
  readonly keyType: ScalarType & { readonly k: "string" | "number" };
  /** What the setup computes for each item. */
  readonly values: ValueSlot[];
}

/**
 * What a parameter of an action is given: a number, a boolean or a
 * string, or a list's item (crossing as its key).
 */
export type ActionParam = ScalarType | { readonly k: "item"; readonly list: ListSlot };

export interface ActionSlot {
  readonly kind: "action";
  /** Its place among the body's action slots. */
  readonly index: number;
  readonly name: string;
  /** The setup function; or, for `writes`, the bound signal it sets. */
  readonly source: ts.Identifier;
  readonly params: readonly ActionParam[];
  /** A bound signal's change: it sets the signal to its argument. */
  readonly writes?: true;
}

/** What crosses back for an action's parameter: an item crosses as its key. */
export function crossingOf(p: ActionParam): ScalarType {
  return p.k === "item" ? p.list.keyType : p;
}

/** A LUCENT3024 diagnostic: what a toolkit body cannot contain. */
export function bodyFail(node: ts.Node | undefined, message: string): never {
  fail(node, Codes.ToolkitBody, message);
}

// --- where toolkits appear -------------------------------------------------------------------

/** The symbol an identifier or a member name names, through imports. */
export function symbolOf(checker: ts.TypeChecker, id: ts.Node): ts.Symbol | undefined {
  const found = checker.getSymbolAtLocation(id);

  return found && found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
}

/** The toolkit whose module declares `decl`, if one does. */
export function toolkitOfDeclaration(decl: ts.Node | undefined): ToolkitName | undefined {
  return decl && toolkitOfModule(builtinSdkModuleOf(decl.getSourceFile()));
}

/** The toolkit declaration an expression names (`Text`, `Color.green`, `Modifier.size`), if any. */
export function toolkitDeclaration(
  checker: ts.TypeChecker,
  e: ts.Expression,
): { toolkit: ToolkitName; decl: ts.Declaration } | undefined {
  const inner = skipParentheses(e);
  const name = ts.isPropertyAccessExpression(inner)
    ? inner.name
    : ts.isIdentifier(inner)
      ? inner
      : undefined;
  const decl = name && symbolOf(checker, name)?.declarations?.[0];
  const toolkit = toolkitOfDeclaration(decl);

  return toolkit && decl ? { toolkit, decl } : undefined;
}

/** The toolkit whose body function `call` calls (`swiftUI(…)`, `compose(…)`), if it calls one. */
export function bodyCallOf(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
): ToolkitName | undefined {
  const callee = skipParentheses(call.expression);

  if (!ts.isIdentifier(callee)) return undefined;

  const found = toolkitDeclaration(checker, callee);

  return found &&
    ts.isFunctionDeclaration(found.decl) &&
    found.decl.name?.text === TOOLKITS[found.toolkit].body
    ? found.toolkit
    : undefined;
}

/**
 * Whether `node` is a body: the function a body call is given. Its code is
 * the toolkit's, so the program's analyses and the C++ emitter leave it out.
 */
export function isToolkitBody(checker: ts.TypeChecker, node: ts.Node): boolean {
  let at: ts.Node = node;

  while (ts.isParenthesizedExpression(at.parent)) at = at.parent;

  const call = at.parent;

  return ts.isCallExpression(call) && call.arguments[0] === at && !!bodyCallOf(checker, call);
}

/**
 * The body a body call is given, checked: one function literal, taking
 * nothing (it reads the setup's names), not async (it draws at once).
 */
export function bodyFunction(call: ts.CallExpression, toolkit: ToolkitName): BodyFunction {
  const { body: name } = TOOLKITS[toolkit];
  const body = call.arguments[0] && skipParentheses(call.arguments[0]);

  if (
    !body ||
    !(ts.isArrowFunction(body) || ts.isFunctionExpression(body)) ||
    call.arguments.length !== 1
  )
    bodyFail(call, `${name} takes the component's body, a function: ${name}(() => …)`);

  if (body.parameters.length)
    bodyFail(
      body,
      "the body takes no parameters: it reads the setup's props, signals and functions",
    );

  if (isAsync(body)) bodyFail(body, `the body draws at once: it cannot be async`);

  return body;
}

/**
 * Whether a call is lucent:ui's `name`: one of the forms a body writes
 * where a view takes it (`bind(signal)`, `range(from, to)`).
 */
export function isUiForm(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
  name: "bind" | "range",
): boolean {
  const callee = skipParentheses(call.expression);
  const decl = ts.isIdentifier(callee) ? symbolOf(checker, callee)?.declarations?.[0] : undefined;

  return (
    !!decl &&
    ts.isFunctionDeclaration(decl) &&
    decl.name?.text === name &&
    builtinSdkModuleOf(decl.getSourceFile()) === "lucent:ui"
  );
}

/** Whether a call is lucent:ui's `bind(signal)`. */
export const isBind = (checker: ts.TypeChecker, call: ts.CallExpression): boolean =>
  isUiForm(checker, call, "bind");

/** Whether `node` is in the setup's own code: not in a function the setup makes. */
export function inSetupCode(node: ts.Node, setup: FunctionLike): boolean {
  for (let n = node.parent; n; n = n.parent) if (ts.isFunctionLike(n)) return n === setup;

  return false;
}

// --- what crosses -----------------------------------------------------------------------------

/**
 * The slots of one body, found as its writer reads it: what the setup
 * computes for it, and the setup functions it calls.
 */
export class Crossings {
  readonly values: ValueSlot[] = [];
  readonly actions: ActionSlot[] = [];
  readonly lists: ListSlot[] = [];

  private readonly byKey = new Map<string, ValueSlot | ActionSlot>();
  private readonly types: ViewTypes;
  private readonly checker: ts.TypeChecker;
  private readonly toolkit: ToolkitName;
  private readonly setup: BodySetup;
  private readonly body: BodyFunction;

  constructor(checker: ts.TypeChecker, toolkit: ToolkitName, setup: BodySetup, body: BodyFunction) {
    this.checker = checker;
    // What cannot cross is refused as a value of no plain type: the body never transfers it.
    this.types = new ViewTypes(checker, () => undefined);
    this.toolkit = toolkit;
    this.setup = setup;
    this.body = body;
  }

  /** The component's name (its export), which the generated code's names start with. */
  get component(): string {
    return this.setup.export;
  }

  /**
   * Whether the setup computes `e`: plain data that reads the setup's
   * names (its props, signals, functions and values), and nothing of the
   * body's or of a toolkit's, so that the setup's C++ evaluates it with
   * JavaScript's semantics, and the body reads the result. The largest
   * such expression is one slot.
   */
  computedBySetup(e: ts.Expression): boolean {
    const list = this.listOf(e);

    return this.computed(e, new Set(list?.names));
  }

  /**
   * Whether the setup computes `e`, reading its names and `items`: the
   * names of the item it is computed for, which count as the setup's.
   */
  private computed(e: ts.Expression, items: ReadonlySet<ts.Symbol>): boolean {
    if (!this.plain(this.checker.getTypeAtLocation(e))) return false;

    let setup = false;
    let other = false;
    const visit = (n: ts.Node): void => {
      if (other) return;

      if (ts.isFunctionLike(n) || ts.isAwaitExpression(n)) {
        other = true;
        return;
      }

      // A member's name is its object's: `props.on` reads props.
      const named = ts.isPropertyAccessExpression(n.parent) && n.parent.name === n;

      if (ts.isIdentifier(n) && !named) {
        const symbol = this.symbol(n);
        const decl = symbol?.declarations?.[0];

        if (symbol && items.has(symbol)) setup = true;
        else if (this.inBody(decl) || toolkitOfDeclaration(decl)) other = true;
        else if (this.inSetup(decl)) setup = true;
      }

      ts.forEachChild(n, visit);
    };

    visit(e);

    return setup && !other;
  }

  /**
   * The value slot of `source` (one per expression text): the body's, or,
   * in what a list's item shows, the item's.
   */
  value(source: ts.Expression): ValueSlot {
    const list = this.listOf(source);
    const key = `value:${list?.index ?? ""}:${source.getText()}`;
    const found = this.byKey.get(key);

    if (found?.kind === "value") return found;

    const into = list?.values ?? this.values;
    const slot: ValueSlot = {
      kind: "value",
      index: into.length,
      name: slotName(slotBase(source), this.byKey.size),
      source,
      type: this.valueType(source),
      ...(list ? { list } : {}),
    };

    this.byKey.set(key, slot);
    into.push(slot);

    return slot;
  }

  /**
   * A list: `source`, an array the setup computes, whose items `content`
   * shows, keyed by `key` (its expression, over `keyParam` or the item).
   * One level: an item shows no list of its own, for now.
   */
  list(
    site: ts.Node,
    source: ts.Expression,
    content: ts.Expression,
    key: { param?: ts.ParameterDeclaration; expression: ts.Expression },
    /** The content's parameter that is the item: its first, unless a scope comes before it. */
    itemAt = 0,
  ): ListSlot {
    const title = TOOLKITS[this.toolkit].title;

    if (this.listOf(site))
      bodyFail(site, `a ${title} list's item shows no list of its own, for now`);

    const shown = skipParentheses(content);

    if (
      !(ts.isArrowFunction(shown) || ts.isFunctionExpression(shown)) ||
      shown.parameters.length !== itemAt + 1
    )
      bodyFail(
        content,
        itemAt
          ? "a list shows each item with a function of its scope and the item: `(_, item) => …`"
          : "a list shows each item with a function of it: `(item) => …`",
      );

    const param = shown.parameters[itemAt];

    if (!param || !ts.isIdentifier(param.name))
      bodyFail(content, "a list's item is a name: `(item) => …`");

    if (
      !this.computed(source, new Set()) ||
      !this.checker.isArrayType(this.checker.getTypeAtLocation(source))
    )
      bodyFail(
        source,
        `a ${title} list shows an array the setup computes (a signal, a prop, what a setup function returns): \`${source.getText()}\` is not one`,
      );

    const names = [param, ...(key.param ? [key.param] : [])].flatMap((p) => {
      const symbol = ts.isIdentifier(p.name) ? this.symbol(p.name) : undefined;

      return symbol ? [symbol] : [];
    });
    const keyType = this.scalar(this.checker.getTypeAtLocation(key.expression));

    if (!keyType || keyType.nullable || keyType.k === "boolean")
      bodyFail(key.expression, `a ${title} list's key is a string or a number, never null`);

    if (!this.computed(key.expression, new Set(names)))
      bodyFail(
        key.expression,
        `a ${title} list's key is computed from its item and the setup's values: \`${key.expression.getText()}\``,
      );

    const list: ListSlot = {
      kind: "list",
      index: this.lists.length,
      // Apart from the values' names (a name and a number, no underscore).
      name: `list_${this.lists.length}`,
      site,
      source,
      names,
      content: shown,
      key: key.expression,
      keyType: keyType as ListSlot["keyType"],
      values: [],
    };

    this.lists.push(list);

    return list;
  }

  /**
   * `bind(signal)`: the signal's value, a slot the view reads, and its
   * change, an action setting the signal. A signal of the setup's, of a
   * number, a boolean or a string, given in the body itself (an item's
   * view binds no setup signal, for now).
   */
  bind(call: ts.CallExpression): { value: ValueSlot; change: ActionSlot } {
    const title = TOOLKITS[this.toolkit].title;
    const [arg] = call.arguments;
    const signal = arg && skipParentheses(arg);

    if (
      !signal ||
      !ts.isIdentifier(signal) ||
      !this.isSignal(signal) ||
      !this.inSetup(this.symbol(signal)?.declarations?.[0])
    )
      bodyFail(call, `bind takes a signal of the setup's: \`bind(draft)\``);

    if (this.listOf(call))
      bodyFail(
        call,
        `a ${title} list's item binds no signal of the setup's, for now: call a setup function from its callback`,
      );

    const get = this.checker.getTypeAtLocation(signal).getProperty("get");
    const inner =
      get &&
      this.checker.getTypeOfSymbolAtLocation(get, signal).getCallSignatures()[0]?.getReturnType();
    const scalar = inner && this.scalar(inner);

    if (!inner || !scalar || scalar.nullable)
      bodyFail(
        call,
        `a ${title} view binds a signal of a number, a boolean or a string: \`${signal.text}\` is not one`,
      );

    const valueKey = `bind:value:${signal.text}`;
    const changeKey = `bind:change:${signal.text}`;
    const found = [this.byKey.get(valueKey), this.byKey.get(changeKey)];

    if (found[0]?.kind === "value" && found[1]?.kind === "action")
      return { value: found[0], change: found[1] };

    const value: ValueSlot = {
      kind: "value",
      index: this.values.length,
      name: slotName(signal.text, this.byKey.size),
      source: signal,
      type: { k: scalar.k },
      bound: true,
    };

    this.byKey.set(valueKey, value);
    this.values.push(value);

    const change: ActionSlot = {
      kind: "action",
      index: this.actions.length,
      name: slotName(signal.text, this.byKey.size),
      source: signal,
      params: [scalar],
      writes: true,
    };

    this.byKey.set(changeKey, change);
    this.actions.push(change);

    return { value, change };
  }

  /** The list whose item `node` is in (in what the item shows), if any. */
  listOf(node: ts.Node): ListSlot | undefined {
    for (let n: ts.Node | undefined = node; n && n !== this.body; n = n.parent) {
      const found = this.lists.find((l) => l.content === n);

      if (found) return found;
    }

    return undefined;
  }

  /** The list whose item `e` names (the item itself, in what it shows), if it names one. */
  itemOf(e: ts.Expression): ListSlot | undefined {
    const inner = skipParentheses(e);
    const symbol = ts.isIdentifier(inner) ? this.symbol(inner) : undefined;
    const list = symbol && this.listOf(inner);

    return list?.names.includes(symbol!) ? list : undefined;
  }

  /**
   * The action slot of the setup function `id` names: a handler, which
   * returns nothing. A callback calls it with the arguments it gives, each
   * a number, a boolean or a string crossing back into Lucent.
   */
  action(id: ts.Identifier, args: readonly ts.Expression[] = []): ActionSlot {
    const items = args.map((a) => this.itemOf(a));
    const key = `action:${id.text}:${items.map((l) => l?.index ?? "").join(",")}`;
    const found = this.byKey.get(key);

    if (found?.kind === "action") return found;

    const symbol = this.symbol(id);
    const signature =
      symbol && this.checker.getTypeOfSymbolAtLocation(symbol, id).getCallSignatures()[0];

    if (!signature) bodyFail(id, `\`${id.text}\` is not a function`);

    const ret = this.checker.getReturnTypeOfSignature(signature);

    if (!(ret.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)))
      bodyFail(
        id,
        `the body calls \`${id.text}\` from a callback, where its result is lost: a handler returns nothing`,
      );

    const slot: ActionSlot = {
      kind: "action",
      index: this.actions.length,
      name: slotName(id.text, this.byKey.size),
      source: id,
      params: signature.parameters.map((p, i): ActionParam => {
        const list = items[i];

        return list ? { k: "item", list } : this.crossingBack(id, p);
      }),
    };

    this.byKey.set(key, slot);
    this.actions.push(slot);

    return slot;
  }

  /**
   * A setup name the body reads that is not a value it computes: a setup
   * function (an action), or refused.
   */
  setupName(id: ts.Identifier): ActionSlot {
    const symbol = this.symbol(id);

    if (symbol && this.setupFunction(symbol)) return this.action(id);

    if (symbol === this.setup.propsSymbol)
      bodyFail(id, "the body reads each prop where it uses it: `props.name`");

    if (this.isSignal(id)) bodyFail(id, `the body reads \`${id.text}\` with ${id.text}.get()`);

    bodyFail(
      id,
      `\`${id.text}\` is the setup's own value: the body reads props, signals and what setup functions compute (\`${id.text}()\` returning it)`,
    );
  }

  /**
   * A member of a setup value the body reads or calls, which is no value
   * the setup computes (computedBySetup): an event, a signal's write, a
   * value of another type. Refused; nothing when `e`'s object is not the
   * setup's.
   */
  setupMember(e: ts.PropertyAccessExpression | ts.CallExpression): void {
    const access = ts.isCallExpression(e) ? skipParentheses(e.expression) : e;

    if (!ts.isPropertyAccessExpression(access)) return;

    const receiver = skipParentheses(access.expression);

    if (!ts.isIdentifier(receiver)) return;

    const owner = this.symbol(receiver);
    const name = access.name.text;

    if (owner && owner === this.setup.propsSymbol) {
      if (
        ts.isCallExpression(e) ||
        this.checker.getNonNullableType(this.checker.getTypeAtLocation(e)).getCallSignatures()
          .length
      )
        bodyFail(e, `\`props.${name}\` is an event: call it in a setup function the body calls`);

      this.refusePlain(e);
    }

    if (!owner || !this.inSetup(owner.declarations?.[0])) return;

    if (this.isSignal(receiver) && name === "set" && ts.isCallExpression(e))
      bodyFail(
        e,
        `the body changes \`${receiver.text}\` through a setup function it calls: logic is the setup's`,
      );

    this.refusePlain(e);
  }

  /** Refused: a setup function called where the body draws, which would run each time it does. */
  refuseDrawingCall(c: ts.CallExpression, callee: ts.Identifier, toolkit: ToolkitName): never {
    bodyFail(
      c,
      `\`${callee.text}()\` would run each time ${TOOLKITS[toolkit].title} evaluates the body: call it from a callback (\`() => ${callee.text}()\`), or have it return what the body shows`,
    );
  }

  // --- the setup's names ---

  symbol(id: ts.Node): ts.Symbol | undefined {
    return symbolOf(this.checker, id);
  }

  /** Whether `decl` is the setup's own (declared in its code, not in the body). */
  inSetup(decl: ts.Node | undefined): boolean {
    let inSetup = false;

    for (let n: ts.Node | undefined = decl; n; n = n.parent) {
      if (n === this.body) return false;

      if (n === this.setup.fn) inSetup = true;
    }

    return inSetup;
  }

  /** Whether `decl` is the body's own (a local of it, a callback's parameter). */
  inBody(decl: ts.Node | undefined): boolean {
    for (let n: ts.Node | undefined = decl; n; n = n.parent) if (n === this.body) return true;

    return false;
  }

  /** Whether `symbol` is a function the setup declares. */
  setupFunction(symbol: ts.Symbol): boolean {
    const decl = symbol.declarations?.[0];

    if (!decl || !this.inSetup(decl)) return false;

    if (ts.isFunctionDeclaration(decl)) return true;

    const init =
      ts.isVariableDeclaration(decl) && decl.initializer && skipParentheses(decl.initializer);

    return !!init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
  }

  /** A parameter of the setup function `id` names, which a callback's argument crosses back into. */
  private crossingBack(id: ts.Identifier, param: ts.Symbol): ScalarType {
    const type = this.checker.getTypeOfSymbolAtLocation(param, id);
    const scalar = this.scalar(type);

    if (!scalar)
      bodyFail(
        id,
        `a ${TOOLKITS[this.toolkit].title} callback passes numbers, booleans and strings to the setup's functions: \`${id.text}\` takes \`${this.checker.typeToString(type)}\` (\`${param.name}\`)`,
      );

    return scalar;
  }

  private isSignal(e: ts.Expression): boolean {
    const decl = this.checker.getTypeAtLocation(e).getSymbol()?.declarations?.[0];

    return !!decl && builtinSdkModuleOf(decl.getSourceFile()) === "lucent:ui";
  }

  // --- types ---

  private valueType(node: ts.Node, type = this.checker.getTypeAtLocation(node)): ViewType {
    const found = this.convert(type);

    if ("ok" in found) return found.ok;

    bodyFail(
      node,
      `the body takes plain data from its setup: \`${node.getText()}\` is ${found.problem.text} (\`${found.problem.path}\`)`,
    );
  }

  /** Plain data (maybe null or undefined): what crosses into a body. */
  private plain(type: ts.Type): ViewType | undefined {
    const found = this.convert(type);

    return "ok" in found ? found.ok : undefined;
  }

  private convert(type: ts.Type) {
    const present = this.checker.getNonNullableType(type);

    return this.types.value(present, "value", present !== type);
  }

  /** A number, a boolean or a string (maybe null or undefined): what crosses into a body. */
  scalar(type: ts.Type): ScalarType | undefined {
    const nonNull = this.checker.getNonNullableType(type);
    const nullable = nonNull !== type;
    const members = nonNull.isUnion() ? nonNull.types : [nonNull];
    const kinds = new Set(
      members.map((m) =>
        m.flags & ts.TypeFlags.NumberLike
          ? "number"
          : m.flags & ts.TypeFlags.BooleanLike
            ? "boolean"
            : m.flags & ts.TypeFlags.StringLike
              ? "string"
              : "other",
      ),
    );
    const [k] = kinds;

    return kinds.size === 1 && k && k !== "other" ? { k, nullable } : undefined;
  }

  private refusePlain(node: ts.Node, type = this.checker.getTypeAtLocation(node)): never {
    bodyFail(
      node,
      `the body takes plain data from its setup (numbers, booleans, strings, arrays and plain objects), not \`${this.checker.typeToString(type)}\`: compute what it shows in setup`,
    );
  }
}

// --- helpers -----------------------------------------------------------------------------------

/** What a slot is named after: the prop, signal or function it reads. */
function slotBase(e: ts.Expression): string {
  if (ts.isPropertyAccessExpression(e)) return e.name.text;

  if (ts.isCallExpression(e)) {
    const callee = skipParentheses(e.expression);

    if (ts.isPropertyAccessExpression(callee)) return slotBase(callee.expression);

    if (ts.isIdentifier(callee)) return callee.text;
  }

  return ts.isIdentifier(e) ? e.text : "value";
}

function slotName(base: string, order: number): string {
  return `${base.replace(/[^A-Za-z0-9_]/g, "_")}${order}`;
}

export function isAsync(fn: ts.FunctionLikeDeclaration): boolean {
  return !!ts.getModifiers(fn)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
}

export function skipParentheses(e: ts.Expression): ts.Expression {
  let out = e;

  while (ts.isParenthesizedExpression(out) || ts.isNonNullExpression(out)) out = out.expression;

  return out;
}
