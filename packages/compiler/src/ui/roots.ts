/**
 * Which exports are components: functions whose code returns a platform
 * view. A view is an object of a class deriving from a platform's root
 * view class, the class Fabric hosts on that platform. The roots are
 * platform fundamentals, not a catalog: every view class is recognized by
 * its ancestry in the discovered SDK.
 */
import path from "node:path";
import ts from "typescript";
import { branchPlatform } from "../platforms.ts";
import { builtinSdkModuleOf, sdkModuleOf } from "../program.ts";
import type { Platform } from "../sdk/schema.ts";
import { toolkit, TOOLKITS, type ToolkitName, toolkitOfModule } from "./toolkits.ts";

/** The class each platform's Fabric host mounts. */
export const ROOT_VIEWS: Record<Platform, { readonly module: string; readonly name: string }> = {
  ios: { module: "UIKit", name: "UIView" },
  android: { module: "android.view", name: "View" },
};

/**
 * The class of the view each platform's host makes for a component's React
 * children (lucent:ui's `slot`): a view holding others.
 */
export const SLOT_VIEWS: Record<Platform, { readonly module: string; readonly name: string }> = {
  ios: { module: "UIKit", name: "UIView" },
  android: { module: "android.view", name: "ViewGroup" },
};

/** Whether a class is one of a platform's classes (its root view class, its slot's), and whose. */
export type RootOf = (decl: ts.ClassDeclaration) => Platform | undefined;

/** Which platform's class of `classes` a discovered SDK class is. */
const sdkClassOf =
  (classes: typeof ROOT_VIEWS): RootOf =>
  (decl) => {
    const sdk = sdkModuleOf(decl.getSourceFile());
    const found = sdk && classes[sdk.platform];

    return found && found.module === sdk.module && decl.name?.text === found.name
      ? sdk.platform
      : undefined;
  };

/** The toolkit a component's root class (`platforms[p].root`) is the root view of, if any. */
export function toolkitOf(root: { module: string; name: string }): ToolkitName | undefined {
  const toolkit = toolkitOfModule(root.module);

  return toolkit && TOOLKITS[toolkit].root === root.name ? toolkit : undefined;
}

const sdkRootView = sdkClassOf(ROOT_VIEWS);

/** The platform root view classes of the discovered SDKs, and the toolkits' root views. */
export const sdkRoot: RootOf = (decl) => {
  const builtin = builtinSdkModuleOf(decl.getSourceFile());
  const toolkit = builtin && toolkitOf({ module: builtin, name: decl.name?.text ?? "" });

  return toolkit ? TOOLKITS[toolkit].platform : sdkRootView(decl);
};

/** The platform slot classes of the discovered SDKs. */
export const sdkSlot: RootOf = sdkClassOf(SLOT_VIEWS);

/** What a function returns, as far as views go. */
export type Shape =
  | { readonly kind: "value" }
  | { readonly kind: "view"; readonly root: ts.ClassDeclaration }
  /** Views on some paths, other values (named) on others. */
  | { readonly kind: "ambiguous"; readonly view: string; readonly other: string }
  /** A promise of a view. */
  | { readonly kind: "promised" };

export type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

/**
 * The shape of what `fn` returns in the code the target runs: the types of
 * its return expressions outside other platforms' branches (a declaration:
 * its signature's). Views are the target's; the host keeps every branch
 * and takes any platform's.
 */
export function returnShape(
  checker: ts.TypeChecker,
  fn: FunctionLike,
  platform: Platform | undefined,
  rootOf: RootOf,
): Shape {
  const signature = checker.getSignatureFromDeclaration(fn);
  const declared = signature ? checker.getReturnTypeOfSignature(signature) : undefined;
  const promised = declared && promisedType(checker, declared);

  // Another platform's view (a branch the checker types but the target leaves out) is not a value.
  const viewOf = (t: ts.Type) => viewClass(checker, t, rootOf);
  const isView = (t: ts.Type) => {
    const found = viewOf(t);

    return found && (!platform || found.platform === platform) ? found.decl : undefined;
  };

  if (promised) return members(promised).some(isView) ? { kind: "promised" } : { kind: "value" };

  const returned = returnedExpressions(checker, fn, platform).map(
    (e) => nativeTagType(checker, e) ?? checker.getTypeAtLocation(e),
  );
  const types = (fn.body ? returned : declared ? [declared] : []).flatMap(members);
  const views: ts.ClassDeclaration[] = [];
  let other: string | undefined;
  let viewName = "";

  for (const t of types) {
    // An SDK the machine lacks leaves its platform's classes untyped.
    if (t.flags & ts.TypeFlags.Any || (viewOf(t) && !isView(t))) continue;

    const cls = isView(t);

    if (cls) {
      views.push(cls);
      viewName ||= checker.typeToString(t);
    } else other ??= checker.typeToString(t);
  }

  if (!views.length) return { kind: "value" };

  if (other !== undefined) return { kind: "ambiguous", view: viewName, other };

  return { kind: "view", root: commonClass(checker, views) };
}

/**
 * The SDK module and name of the platform class a component returns: the
 * class itself, or for a Lucent subclass the SDK class it derives from.
 */
export function classIdentity(
  checker: ts.TypeChecker,
  returned: ts.ClassDeclaration,
): { module: string; name: string } {
  const decl =
    ancestors(checker, returned).find((c) => c.getSourceFile().isDeclarationFile) ?? returned;
  const sf = decl.getSourceFile();
  const module =
    sdkModuleOf(sf)?.module ?? builtinSdkModuleOf(sf) ?? path.basename(sf.fileName, ".d.ts");

  return { module, name: decl.name?.text ?? "" };
}

function members(t: ts.Type): readonly ts.Type[] {
  return t.isUnion() ? t.types.flatMap(members) : (elementsOf(t) ?? [t]);
}

/**
 * The toolkits' element types a JSX element is at once (`View & Composed`
 * in a shared file): each is the view of its toolkit's platform. The
 * platforms' root view classes it also is (`View & UIView`: an element
 * may be a native view's, T48) are not toolkits'; such an element's view is
 * its tag's (nativeTagType).
 */
export function elementsOf(t: ts.Type): readonly ts.Type[] | undefined {
  if (!t.isIntersection()) return undefined;

  const declOf = (m: ts.Type) => m.getSymbol()?.declarations?.[0];
  const elements = t.types.filter((m) => {
    const decl = declOf(m);

    return !!decl && ts.isInterfaceDeclaration(decl) && !!toolkitElement(decl);
  });
  const rest = t.types.filter((m) => !elements.includes(m));
  const views = rest.every((m) => {
    const decl = declOf(m);

    return !!decl && ts.isClassDeclaration(decl) && !!sdkRootView(decl);
  });

  return elements.length && views ? elements : undefined;
}

/**
 * The view a returned JSX element of a native view class makes (T48): an
 * instance of its tag (`<UILabel/>` a UILabel), which the element's type
 * (JSX.Element, the same for every tag) does not say.
 */
export function nativeTagType(checker: ts.TypeChecker, e: ts.Expression): ts.Type | undefined {
  let jsx: ts.Node = e;
  while (ts.isParenthesizedExpression(jsx)) jsx = jsx.expression;

  const tag = ts.isJsxElement(jsx)
    ? jsx.openingElement.tagName
    : ts.isJsxSelfClosingElement(jsx)
      ? jsx.tagName
      : undefined;
  const symbol = tag && checker.getSymbolAtLocation(tag);
  const target =
    symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const decl = target?.declarations?.[0];

  return decl && ts.isClassDeclaration(decl) ? checker.getDeclaredTypeOfSymbol(target!) : undefined;
}

/** `T` of a `Promise<T>` (or `PromiseLike<T>`), if the type is one. */
function promisedType(checker: ts.TypeChecker, t: ts.Type): ts.Type | undefined {
  const name = t.getSymbol()?.getName();

  if (name !== "Promise" && name !== "PromiseLike") return undefined;

  return checker.getTypeArguments(t as ts.TypeReference)[0];
}

/** The class of a view type, and the platform whose root view class it derives from. */
function viewClass(
  checker: ts.TypeChecker,
  t: ts.Type,
  rootOf: RootOf,
): { decl: ts.ClassDeclaration; platform: Platform } | undefined {
  const decl = t.getSymbol()?.declarations?.[0];

  if (decl && ts.isInterfaceDeclaration(decl)) return toolkitElement(decl);

  if (!decl || !ts.isClassDeclaration(decl)) return undefined;

  for (const c of ancestors(checker, decl)) {
    const platform = rootOf(c);

    if (platform) return { decl, platform };
  }

  return undefined;
}

/**
 * A toolkit's JSX element type (SwiftUI's `View`): what a component whose
 * body it is returns, whose root is the toolkit's root class.
 */
function toolkitElement(
  decl: ts.InterfaceDeclaration,
): { decl: ts.ClassDeclaration; platform: Platform } | undefined {
  const sf = decl.getSourceFile();
  const name = toolkitOfModule(builtinSdkModuleOf(sf));
  const found = name && toolkit(name);

  if (!found || found.element !== decl.name.text) return undefined;

  const root = sf.statements.find(
    (s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === found.root,
  );

  return root && { decl: root, platform: found.platform };
}

/**
 * The type of the view a toolkit's element type makes (a SwiftUI View's
 * UIHostingController, Compose's Composed's ComposeView): what a function
 * returning `t` returns as a component; none for any other type.
 */
export function toolkitRootType(checker: ts.TypeChecker, t: ts.Type): ts.Type | undefined {
  const [first] = elementsOf(t) ?? [t];
  const decl = first?.getSymbol()?.declarations?.[0];
  const root = decl && ts.isInterfaceDeclaration(decl) ? toolkitElement(decl) : undefined;

  return root?.decl.name && checker.getTypeAtLocation(root.decl.name);
}

/** A class and the classes it derives from, nearest first. */
function ancestors(checker: ts.TypeChecker, decl: ts.ClassDeclaration): ts.ClassDeclaration[] {
  const out: ts.ClassDeclaration[] = [];

  for (
    let c: ts.ClassDeclaration | undefined = decl;
    c && !out.includes(c);
    c = baseClass(checker, c)
  )
    out.push(c);

  return out;
}

function baseClass(
  checker: ts.TypeChecker,
  c: ts.ClassDeclaration,
): ts.ClassDeclaration | undefined {
  const symbol: ts.Symbol | undefined = c.name && checker.getSymbolAtLocation(c.name);

  if (!symbol) return undefined;

  const type = checker.getDeclaredTypeOfSymbol(symbol) as ts.InterfaceType;
  const base = checker.getBaseTypes(type)[0]?.getSymbol()?.declarations?.[0];

  return base && ts.isClassDeclaration(base) ? base : undefined;
}

/** The nearest class every one of `classes` derives from. */
function commonClass(checker: ts.TypeChecker, classes: ts.ClassDeclaration[]): ts.ClassDeclaration {
  const [first, ...rest] = classes;
  const others = rest.map((c) => ancestors(checker, c));

  return ancestors(checker, first!).find((c) => others.every((a) => a.includes(c))) ?? first!;
}

/** The expressions `fn` returns in the target's code: not nested functions', not other platforms' (none on the host). */
function returnedExpressions(
  checker: ts.TypeChecker,
  fn: FunctionLike,
  platform: Platform | undefined,
): ts.Expression[] {
  if (!fn.body) return [];

  if (!ts.isBlock(fn.body)) return [fn.body];

  const out: ts.Expression[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionLike(n)) return;

    const branch = platform && branchPlatform(checker, n);

    if (branch && branch !== platform) return;

    if (ts.isReturnStatement(n) && n.expression) out.push(n.expression);

    ts.forEachChild(n, visit);
  };

  ts.forEachChild(fn.body, visit);

  return out;
}
