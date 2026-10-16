/**
 * Helper views: functions of a platform file that
 * return its toolkit's JSX, which a body uses as elements (`<Row …/>`) to
 * split its views up, as SwiftUI views and Compose composables are split.
 * Each is written once per component in the toolkit's language (a Swift
 * `View`, a Kotlin `@Composable` function), never in C++.
 *
 * A helper takes one props object, read as `props.name`: plain data,
 * callbacks and the toolkit's values. What it computes from its props is
 * computed by the setup where it is used (ui/toolkit-body.ts, a use's
 * values), with JavaScript's semantics; its callbacks are what its user
 * gives it, and a toolkit's value (a `Color`, a `Modifier`) is what its
 * user writes, given to it as it is (T123). It reads nothing of its
 * setup's but its props. What a helper cannot be fails with LUCENT3024.
 */
import ts from "typescript";
import { cacheOf } from "../checker-caches.ts";
import { builtinSdkModuleOf, platformOf } from "../program.ts";
import { compositionStatements } from "./composition.ts";
import { type FunctionLike, toolkitRootType } from "./roots.ts";
import { bodyFail, jsxRoot, jsxToolkitOf, skipParentheses, symbolOf } from "./toolkit-body.ts";
import { TOOLKITS, type ToolkitName, toolkitOfModule, toolkitOfPlatform } from "./toolkits.ts";
import { ViewTypes } from "./values.ts";

/** A callback prop: what it is given (numbers, booleans, strings), in order. */
export interface HelperCallback {
  readonly name: string;
  readonly params: readonly ("number" | "boolean" | "string")[];
  readonly optional: boolean;
}

/**
 * A prop holding a value of the helper's toolkit (a `Color`, a `Font`, a
 * `Modifier`): its user writes it, in Swift or Kotlin, and the helper's
 * view takes it as a parameter of the toolkit's type.
 */
export interface HelperToolkitValue {
  readonly name: string;
  /** The type's path in the toolkit (`Color`, `Alignment.Horizontal`). */
  readonly type: readonly string[];
  /** Its declaration in the toolkit's module. */
  readonly decl: ts.Declaration;
  readonly optional: boolean;
}

/**
 * A prop holding a bound signal (`Bound<boolean>`): its user binds it
 * (`bind(signal)`, or a bound prop of its own), and the helper's view shows
 * it and changes it (`<Toggle isOn={props.on}>`). A Swift `Binding`, a
 * Kotlin value and its change callback (`on`, `onChanged`).
 */
export interface HelperBinding {
  readonly name: string;
  readonly type: "number" | "boolean" | "string";
}

export interface ViewHelper {
  readonly fn: FunctionLike;
  readonly name: string;
  readonly toolkit: ToolkitName;
  /** Its props parameter; none for a helper taking nothing, or destructuring its props. */
  readonly props?: ts.Symbol;
  /** The names its props are destructured into (`({ title, done })`), and the props they read. */
  readonly aliases: ReadonlyMap<ts.Symbol, string>;
  /** The JSX it returns. */
  readonly jsx: ts.Expression;
  /** Its statements before the JSX: Compose's composition statements. */
  readonly statements: readonly ts.Statement[];
  /** Its callback props, in their declaration's order. */
  readonly callbacks: readonly HelperCallback[];
  /** Its props holding the toolkit's values, in their declaration's order. */
  readonly toolkitValues: readonly HelperToolkitValue[];
  /** Its props holding bound signals, in their declaration's order. */
  readonly bindings: readonly HelperBinding[];
  /**
   * Whether it takes children (`children: Content`, `Shown` in Compose):
   * what its user's element holds, which it shows where it reads
   * `props.children`, a content closure (lambda) of its view.
   */
  readonly children: boolean;
}

/** What a helper's props give where it is used: each prop's value or callback, in the user's code. */
export interface HelperUse {
  readonly helper: ViewHelper;
  readonly args: ReadonlyMap<string, ts.Expression>;
  /** The element (or call) using it. */
  readonly site: ts.Node;
  /** The helper whose code uses it; none in the body. */
  readonly outer?: HelperUse;
}

/**
 * Whether `fn` is a helper view: a function of a platform file declared by
 * a statement of its own (`function Row(…)`, `const Row = (…) => …`), not
 * exported (an exported one is a component), returning its toolkit's JSX.
 */
export function isViewHelper(checker: ts.TypeChecker, fn: ts.Node): boolean {
  // A platform file's, or a shared file's writing its platforms' toolkits (one-file components).
  const file = fn.getSourceFile().fileName;
  const platform = platformOf(file);

  if (platform ? !toolkitOfPlatform(platform) : !file.endsWith(".tsx")) return false;

  const own = ts.isArrowFunction(fn) || ts.isFunctionExpression(fn);
  const declared = ts.isFunctionDeclaration(fn)
    ? fn
    : own && ts.isVariableDeclaration(fn.parent) && fn.parent.initializer === fn
      ? fn.parent.parent.parent
      : undefined;

  if (!declared || !(ts.isFunctionDeclaration(fn) || own) || !fn.body || exported(declared))
    return false;

  const signature = checker.getSignatureFromDeclaration(fn);

  return !!signature && !!toolkitRootType(checker, checker.getReturnTypeOfSignature(signature));
}

function exported(n: ts.Node): boolean {
  return (
    ts.canHaveModifiers(n) &&
    !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** Whether a statement only declares helper views: the C++ and the analyses leave it out. */
export function helperStatement(checker: ts.TypeChecker, s: ts.Node): boolean {
  if (ts.isFunctionDeclaration(s)) return isViewHelper(checker, s);

  if (!ts.isVariableStatement(s)) return false;

  return s.declarationList.declarations.every((d) => {
    const init = d.initializer && skipParentheses(d.initializer);

    return !!init && isViewHelper(checker, init);
  });
}

/** Each helper's facts, checked once per program (source files outlive one: CompileSession). */
const checked = new WeakMap<ts.TypeChecker, WeakMap<FunctionLike, ViewHelper>>();

/** The helper view an element's tag (or a call's callee) names, checked; none for any other name. */
export function helperAt(checker: ts.TypeChecker, name: ts.Node): ViewHelper | undefined {
  const decl = symbolOf(checker, name)?.declarations?.[0];
  const fn =
    decl && ts.isVariableDeclaration(decl) && decl.initializer
      ? skipParentheses(decl.initializer)
      : decl;

  if (!fn || !isViewHelper(checker, fn)) return undefined;

  const helperFn = fn as FunctionLike;
  const ofChecker = cacheOf(checked, checker);
  let helper = ofChecker.get(helperFn);

  if (!helper) {
    helper = check(checker, helperFn, name);
    ofChecker.set(helperFn, helper);
  }

  return helper;
}

function check(checker: ts.TypeChecker, fn: FunctionLike, at: ts.Node): ViewHelper {
  const named = fn.name ?? (ts.isVariableDeclaration(fn.parent) ? fn.parent.name : undefined);
  const name = named && ts.isIdentifier(named) ? named.text : at.getText();
  const what = `the helper view \`${name}\``;
  // A platform file's toolkit; in a shared file, the toolkit of the views it shows.
  const last = fn.body && ts.isBlock(fn.body) ? fn.body.statements.at(-1) : undefined;
  const shown =
    fn.body && !ts.isBlock(fn.body)
      ? fn.body
      : last && ts.isReturnStatement(last)
        ? last.expression
        : undefined;
  const toolkit =
    toolkitOfPlatform(platformOf(fn.getSourceFile().fileName)) ??
    (shown ? jsxToolkitOf(shown, checker) : undefined);

  if (!toolkit) bodyFail(fn, `${what} returns a toolkit's JSX: SwiftUI's or Compose's views`);

  const { title } = TOOLKITS[toolkit];
  const [param, extra] = fn.parameters;

  if (
    extra ||
    (param &&
      (!(ts.isIdentifier(param.name) || ts.isObjectBindingPattern(param.name)) ||
        param.dotDotDotToken)) ||
    fn.typeParameters?.length
  )
    bodyFail(
      param ?? fn,
      `${what} takes its props as one name, \`(props) => …\` reading \`props.name\`, or destructured: \`({ name }) => …\``,
    );

  // Destructured (T123): each name reads the prop it names.
  const aliases = new Map<ts.Symbol, string>();

  if (param && ts.isObjectBindingPattern(param.name))
    for (const e of param.name.elements) {
      const prop = e.propertyName ?? e.name;

      if (e.dotDotDotToken || e.initializer || !ts.isIdentifier(e.name) || !ts.isIdentifier(prop))
        bodyFail(
          e,
          `${what} destructures each prop to a name, \`({ title, done: isDone })\`: no defaults, \`...\` or nested patterns`,
        );

      const symbol = checker.getSymbolAtLocation(e.name);

      if (symbol) aliases.set(symbol, prop.text);
    }

  if (fn.asteriskToken || ts.getModifiers(fn)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword))
    bodyFail(fn, `${what} draws at once: it cannot be async or a generator`);

  const props =
    param && ts.isIdentifier(param.name) ? checker.getSymbolAtLocation(param.name) : undefined;
  const { jsx, statements } = returned(checker, fn, toolkit, title, what);

  captures(checker, fn, props, what);

  const given = param ? propsOf(checker, param, what, toolkit) : undefined;

  return {
    fn,
    name,
    toolkit,
    ...(props ? { props } : {}),
    aliases,
    jsx,
    statements,
    callbacks: given?.callbacks ?? [],
    toolkitValues: given?.toolkitValues ?? [],
    bindings: given?.bindings ?? [],
    children: given?.children ?? false,
  };
}

/** What a helper returns, as its last statement, and the statements before it (Compose's composing ones). */
function returned(
  checker: ts.TypeChecker,
  fn: FunctionLike,
  toolkit: ToolkitName,
  title: string,
  what: string,
): { jsx: ts.Expression; statements: readonly ts.Statement[] } {
  const body = fn.body!;

  if (!ts.isBlock(body)) {
    if (jsxRoot(body)) return { jsx: body, statements: [] };

    bodyFail(body, `${what} returns ${title}'s JSX`);
  }

  const last = body.statements.at(-1);
  const before = body.statements.slice(0, -1);

  if (!last || !ts.isReturnStatement(last) || !last.expression || !jsxRoot(last.expression))
    bodyFail(last ?? body, `${what} returns ${title}'s JSX, once, as its last statement`);

  if (toolkit === "swiftui" && before.length)
    bodyFail(
      before[0]!,
      `a SwiftUI helper view returns its view, its only statement: compute its values in the JSX, from its props`,
    );

  const composing = new Set(compositionStatements(checker, fn));
  const other = before.find((s) => !composing.has(s));

  if (other)
    bodyFail(
      other,
      `a ${title} helper view's statements compose (\`const x = animateDpAsState(…)\`): it computes its other values in the JSX, from its props`,
    );

  return { jsx: last.expression, statements: before };
}

/**
 * Refused: a helper reading a name of a function it is in (its setup's),
 * but another helper's, or its props as a whole.
 */
function captures(
  checker: ts.TypeChecker,
  fn: FunctionLike,
  props: ts.Symbol | undefined,
  what: string,
): void {
  const enclosing = (n: ts.Node): boolean => {
    for (let p = fn.parent; p; p = p.parent) if (ts.isFunctionLike(p) && p === n) return true;

    return false;
  };
  const within = (n: ts.Node, of: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n; p; p = p.parent) if (p === of) return true;

    return false;
  };

  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && !named(n)) {
      const symbol = symbolOf(checker, n);
      const decl = symbol?.declarations?.[0];

      if (symbol && symbol === props && !ts.isPropertyAccessExpression(n.parent))
        bodyFail(n, `${what} reads each prop where it uses it: \`${n.text}.name\``);

      if (decl && !within(decl, fn)) {
        let owner: ts.Node | undefined = decl.parent;

        while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;

        const helper =
          ts.isVariableDeclaration(decl) && decl.initializer
            ? isViewHelper(checker, skipParentheses(decl.initializer))
            : isViewHelper(checker, decl);

        if (owner && enclosing(owner) && !helper)
          bodyFail(
            n,
            `${what} reads \`${n.text}\`, its setup's: a helper reads its props, so give it \`${n.text}\` as one`,
          );
      }
    }

    ts.forEachChild(n, visit);
  };

  if (fn.body) visit(fn.body);
}

/** Whether an identifier names something rather than reads it. */
function named(id: ts.Identifier): boolean {
  const p = id.parent;

  return (
    (ts.isPropertyAccessExpression(p) && p.name === id) ||
    (ts.isPropertyAssignment(p) && p.name === id) ||
    ts.isJsxAttribute(p) ||
    (ts.isParameter(p) && p.name === id) ||
    (ts.isVariableDeclaration(p) && p.name === id)
  );
}

/**
 * A helper's props: each plain data, a callback of scalars returning
 * nothing, or a value of its toolkit's; the callbacks and the toolkit's
 * values.
 */
function propsOf(
  checker: ts.TypeChecker,
  param: ts.ParameterDeclaration,
  what: string,
  toolkit: ToolkitName,
): {
  callbacks: HelperCallback[];
  toolkitValues: HelperToolkitValue[];
  bindings: HelperBinding[];
  children: boolean;
} {
  const types = new ViewTypes(checker, () => undefined);
  const type = checker.getTypeAtLocation(param);
  const callbacks: HelperCallback[] = [];
  const toolkitValues: HelperToolkitValue[] = [];
  const bindings: HelperBinding[] = [];
  let children = false;

  for (const p of type.getProperties()) {
    const t = checker.getTypeOfSymbolAtLocation(p, param);

    // Content: what its user's element holds, as its children alone.
    if (contentType(checker, p, toolkit)) {
      if (p.name !== "children")
        bodyFail(param, `${what} takes content as its children: \`children\`, not \`${p.name}\``);

      children = true;
      continue;
    }

    const present = checker.getNonNullableType(t);
    const optional = !!(p.flags & ts.SymbolFlags.Optional);
    const [signature, more] = present.getCallSignatures();

    if (signature && !more) {
      const params = signature.parameters.map((q) =>
        scalar(checker.getTypeOfSymbolAtLocation(q, param)),
      );
      const ret = checker.getReturnTypeOfSignature(signature);

      if (params.every((x) => x) && ret.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) {
        callbacks.push({ name: p.name, params: params as HelperCallback["params"], optional });
        continue;
      }
    }

    const bound = boundOf(checker, present);

    if (bound) {
      if (optional || present !== t)
        bodyFail(param, `${what}'s bound \`${p.name}\` is one its user binds: it is not optional`);

      if (!bound.scalar)
        bodyFail(
          param,
          `${what}'s \`${p.name}\` binds a number, a boolean or a string: \`${checker.typeToString(t)}\` is not one`,
        );

      bindings.push({ name: p.name, type: bound.scalar });
      continue;
    }

    const value = toolkitValueType(present, toolkit);

    if (value) {
      toolkitValues.push({ name: p.name, ...value, optional: optional || present !== t });
      continue;
    }

    if (!("ok" in types.value(present, "value", present !== t)))
      bodyFail(
        param,
        `${what} takes plain data, callbacks and ${TOOLKITS[toolkit].title}'s values: \`${p.name}\` is \`${checker.typeToString(t)}\``,
      );
  }

  // A bound prop's change callback is a Kotlin parameter of its own.
  for (const b of bindings)
    if (type.getProperty(`${b.name}Changed`))
      bodyFail(
        param,
        `${what}'s \`${b.name}Changed\` is the name its bound \`${b.name}\`'s changes take: rename it`,
      );

  return { callbacks, toolkitValues, bindings, children };
}

/** Whether a prop is declared of the toolkit's content type: SwiftUI's `Content`, Compose's `Shown`. */
function contentType(checker: ts.TypeChecker, p: ts.Symbol, toolkit: ToolkitName): boolean {
  const decl = p.valueDeclaration;
  const node = decl && ts.isPropertySignature(decl) ? decl.type : undefined;

  if (!node || !ts.isTypeReferenceNode(node)) return false;

  const alias = symbolOf(checker, node.typeName)?.declarations?.[0];

  return (
    !!alias &&
    ts.isTypeAliasDeclaration(alias) &&
    alias.name.text === (toolkit === "swiftui" ? "Content" : "Shown") &&
    toolkitOfModule(builtinSdkModuleOf(alias.getSourceFile())) === toolkit
  );
}

/** Whether `e` reads `helper`'s children (`props.children`). */
export function childrenProp(
  checker: ts.TypeChecker,
  e: ts.Expression,
  helper: ViewHelper | undefined,
): boolean {
  return !!helper?.children && propNameOf(checker, e, helper) === "children";
}

/** What an element using `helper` holds, less the whitespace JSX leaves: its children. */
export function helperChildren(
  node: ts.JsxElement | ts.JsxSelfClosingElement | ts.CallExpression,
): ts.JsxChild[] {
  return ts.isJsxElement(node)
    ? node.children.filter(
        (c) =>
          !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces) &&
          !(ts.isJsxExpression(c) && !c.expression),
      )
    : [];
}

/** lucent:ui's `Bound<T>`, and T when it is a scalar. */
function boundOf(
  checker: ts.TypeChecker,
  t: ts.Type,
): { scalar: HelperBinding["type"] | undefined } | undefined {
  const symbol = t.aliasSymbol ?? t.getSymbol();
  const decl = symbol?.declarations?.find(ts.isInterfaceDeclaration);

  if (
    !decl ||
    decl.name.text !== "Bound" ||
    builtinSdkModuleOf(decl.getSourceFile()) !== "lucent:ui"
  )
    return undefined;

  const [inner] = checker.getTypeArguments(t as ts.TypeReference);

  // `boolean` is a union of its literals, which scalar() takes; `string | null` is not one.
  return { scalar: inner ? scalar(inner) : undefined };
}

/** The binding `e` reads, when it is `props.name` of `helper` holding one. */
export function helperBindingProp(
  checker: ts.TypeChecker,
  e: ts.Expression,
  helper: ViewHelper | undefined,
): HelperBinding | undefined {
  const name = propNameOf(checker, e, helper);

  return name === undefined ? undefined : helper!.bindings.find((b) => b.name === name);
}

/**
 * A value type of `toolkit`'s module, by its path (`Color`; a namespace's
 * `Alignment.Horizontal`): an interface of no type parameters, of a
 * concrete type (`Color`, a SwiftUI view too, but not `View`, which a
 * helper would take as content).
 */
function toolkitValueType(
  t: ts.Type,
  toolkit: ToolkitName,
): { type: string[]; decl: ts.Declaration } | undefined {
  // The interface, which a value of its statics may share a name with (`Color`).
  const decl = (t.aliasSymbol ?? t.getSymbol())?.declarations?.find(ts.isInterfaceDeclaration);

  if (!decl || decl.typeParameters?.length) return undefined;
  if (toolkitOfModule(builtinSdkModuleOf(decl.getSourceFile())) !== toolkit) return undefined;

  if (decl.name.text === TOOLKITS[toolkit].element) return undefined;

  const path = [decl.name.text];

  for (let n: ts.Node | undefined = decl.parent; n && !ts.isSourceFile(n); n = n.parent)
    if (ts.isModuleDeclaration(n) && ts.isIdentifier(n.name)) path.unshift(n.name.text);

  return { type: path, decl };
}

/** The prop `e` reads of `helper`: `props.name`, or a name its props are destructured into. */
export function propNameOf(
  checker: ts.TypeChecker,
  e: ts.Expression,
  helper: ViewHelper | undefined,
): string | undefined {
  if (!helper) return undefined;

  if (ts.isIdentifier(e)) {
    const symbol = checker.getSymbolAtLocation(e);

    return symbol && helper.aliases.get(symbol);
  }

  if (!helper.props || !ts.isPropertyAccessExpression(e) || !ts.isIdentifier(e.expression))
    return undefined;

  return symbolOf(checker, e.expression) === helper.props ? e.name.text : undefined;
}

/** The toolkit value `e` reads, when it is `props.name` of `helper` holding one. */
export function toolkitValueProp(
  checker: ts.TypeChecker,
  e: ts.Expression,
  helper: ViewHelper | undefined,
): HelperToolkitValue | undefined {
  const name = propNameOf(checker, e, helper);

  return name === undefined ? undefined : helper!.toolkitValues.find((v) => v.name === name);
}

function scalar(t: ts.Type): "number" | "boolean" | "string" | undefined {
  const flags = t.flags;

  return flags & ts.TypeFlags.NumberLike
    ? "number"
    : flags & ts.TypeFlags.BooleanLike
      ? "boolean"
      : flags & ts.TypeFlags.StringLike
        ? "string"
        : undefined;
}

/**
 * `node`'s reads of `helper`'s props (`props.name`, or a name they are
 * destructured into), each a prop's value where the helper is used.
 */
export function propReads(
  checker: ts.TypeChecker,
  node: ts.Node,
  helper: ViewHelper,
): { node: ts.Expression; name: string }[] {
  const out: { node: ts.Expression; name: string }[] = [];
  const visit = (n: ts.Node): void => {
    const named =
      ts.isIdentifier(n) &&
      ((ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) ||
        (ts.isPropertyAssignment(n.parent) && n.parent.name === n));
    const name = ts.isExpression(n) && !named ? propNameOf(checker, n, helper) : undefined;

    if (name !== undefined) {
      out.push({ node: n as ts.Expression, name });
      return;
    }

    ts.forEachChild(n, visit);
  };

  visit(node);

  return out;
}

/** `use` at the end of the uses `via` (innermost first): where a helper's value is used from. */
export function chainUse(via: HelperUse | undefined, use: HelperUse): HelperUse {
  return via ? { ...via, outer: chainUse(via.outer, use) } : use;
}

/**
 * What an element (or a call's object) gives a helper view's props, by
 * name: a value, or a callback; an attribute alone is true.
 */
export function helperArgs(
  node: ts.JsxElement | ts.JsxSelfClosingElement | ts.CallExpression,
  helper: ViewHelper,
): Map<string, ts.Expression> {
  const args = new Map<string, ts.Expression>();

  if (ts.isCallExpression(node)) {
    const [object] = node.arguments;
    const literal = object && skipParentheses(object);

    if (object && !(literal && ts.isObjectLiteralExpression(literal)))
      bodyFail(
        object,
        `\`${helper.name}\` takes its props as one object: \`${helper.name}({ title: … })\``,
      );

    for (const p of literal && ts.isObjectLiteralExpression(literal) ? literal.properties : []) {
      if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p))
        bodyFail(p, `write each of \`${helper.name}\`'s props as \`name: value\``);

      args.set(p.name.getText(), ts.isPropertyAssignment(p) ? p.initializer : p.name);
    }

    return args;
  }

  const opening = ts.isJsxElement(node) ? node.openingElement : node;

  for (const a of opening.attributes.properties) {
    if (!ts.isJsxAttribute(a))
      bodyFail(
        a,
        `write each of \`${helper.name}\`'s props as \`name={value}\`: \`{...}\` is not supported`,
      );

    const init = a.initializer;
    const value = !init
      ? ts.factory.createTrue()
      : ts.isStringLiteral(init)
        ? init
        : ts.isJsxExpression(init) && init.expression && !init.dotDotDotToken
          ? init.expression
          : bodyFail(init, `write \`${a.name.getText()}\`'s value in its braces`);

    args.set(a.name.getText(), value);
  }

  const children = helperChildren(node);

  if (children.length && !helper.children)
    bodyFail(
      children[0]!,
      `the helper view \`${helper.name}\` takes its props, and no children: give it \`children: ${helper.toolkit === "swiftui" ? "Content" : "Shown"}\` to take them`,
    );

  return args;
}
