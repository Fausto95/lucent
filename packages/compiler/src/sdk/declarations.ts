/**
 * The binding schema members that declarations in the generated SDK
 * .d.ts files stand for: the checker resolves a use to a declaration, and
 * the declaration leads back to its class, method or constructor.
 */
import ts from "typescript";
import { sdkModuleOf } from "../program.ts";
import { INHERITED_TAG } from "./dts.ts";
import {
  declaresPromise,
  findSdkType,
  type Platform,
  type SdkCallable,
  type SdkClassSchema,
  type SdkMethodSchema,
  type SdkPropertySchema,
} from "./schema.ts";

export interface SdkClassRef {
  platform: Platform;
  module: string;
  cls: SdkClassSchema;
}

/** The schema class a declaration in an SDK .d.ts belongs to. */
export function classOfDecl(decl: ts.Node): SdkClassRef | undefined {
  const sdk = sdkModuleOf(decl.getSourceFile());
  if (!sdk) return undefined;
  const owner = ts.isClassDeclaration(decl) ? decl : decl.parent;
  if (!owner || !ts.isClassDeclaration(owner) || !owner.name) return undefined;
  const cls = findSdkType(sdk.platform, sdk.module, owner.name.text);
  return cls?.kind === "class" ? { ...sdk, cls } : undefined;
}

/** The SDK protocols (and Java interfaces) a Lucent class names in `implements`. */
export function sdkInterfacesOf(
  checker: ts.TypeChecker,
  decl: ts.ClassLikeDeclaration,
): SdkClassRef[] {
  const out: SdkClassRef[] = [];
  for (const h of decl.heritageClauses ?? []) {
    if (h.token !== ts.SyntaxKind.ImplementsKeyword) continue;
    for (const t of h.types) {
      const d = checker.getTypeAtLocation(t).getSymbol()?.declarations?.find(ts.isClassDeclaration);
      const ref = d ? classOfDecl(d) : undefined;
      if (ref?.cls.interface) out.push(ref);
    }
  }
  return out;
}

/**
 * The protocol requirement a Lucent class's method implements, and whether
 * the platform calls it on the main thread.
 */
export function requirementOf(
  checker: ts.TypeChecker,
  m: ts.MethodDeclaration,
): { protocol: SdkClassRef; method: SdkMethodSchema; main: boolean } | undefined {
  const cls = m.parent;
  if (!ts.isClassLike(cls) || !ts.isIdentifier(m.name)) return undefined;
  for (const protocol of sdkInterfacesOf(checker, cls)) {
    const method = protocol.cls.methods?.find(
      (x) => !x.static && x.name === (m.name as ts.Identifier).text,
    );
    if (method) return { protocol, method, main: !!(protocol.cls.mainActor || method.mainActor) };
  }
  return undefined;
}

/**
 * The schema method an SDK class's method declaration stands for: sdkDts
 * writes each method, then its promise form (under the async form's name).
 */
export function schemaMethod(
  ref: SdkClassRef,
  decl: ts.MethodDeclaration,
): { ref: SdkClassRef; method: SdkMethodSchema; promise: boolean } {
  // An overload the class inherits, declared again: the class declaring it.
  const inherited = inheritedFrom(ref, decl);
  if (inherited)
    return {
      ref: inherited.ref,
      method: inherited.ref.cls.methods![inherited.index]!,
      promise: false,
    };

  const name = (decl.name as ts.Identifier).text;
  const index = (decl.parent as ts.ClassDeclaration).members
    .filter((m) => ts.isMethodDeclaration(m) && (m.name as ts.Identifier).text === name)
    .indexOf(decl);
  return (ref.cls.methods ?? []).flatMap((m) => [
    ...(m.name === name ? [{ ref, method: m, promise: false }] : []),
    ...(m.async && declaresPromise(ref.cls, m) && (m.async.name ?? m.name) === name
      ? [{ ref, method: m, promise: true }]
      : []),
  ])[index]!;
}

/**
 * The schema property an SDK class's property declaration stands for, and
 * the class declaring it: its own, or (declared again, tagged) a
 * superclass's.
 */
export function schemaProperty(
  ref: SdkClassRef,
  decl: SdkPropertyDecl,
): { ref: SdkClassRef; property: SdkPropertySchema } | undefined {
  const inherited = inheritedFrom(ref, decl);
  if (inherited)
    return { ref: inherited.ref, property: inherited.ref.cls.properties![inherited.index]! };

  const name = (decl.name as ts.Identifier).text;
  const isStatic = !!ts.getModifiers(decl)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
  const property = ref.cls.properties?.find((p) => p.name === name && !!p.static === isStatic);

  return property ? { ref, property } : undefined;
}

/** A property's declaration: a property, or the get and set accessors of one whose write type is its own. */
export type SdkPropertyDecl = ts.PropertyDeclaration | ts.AccessorDeclaration;

export const isSdkPropertyDecl = (d: ts.Node): d is SdkPropertyDecl =>
  ts.isPropertyDeclaration(d) || ts.isGetAccessorDeclaration(d) || ts.isSetAccessorDeclaration(d);

/** A member declared again from a supertype (INHERITED_TAG): the class declaring it, and its index there. */
function inheritedFrom(
  ref: SdkClassRef,
  decl: ts.Declaration,
): { ref: SdkClassRef; index: number } | undefined {
  const tag = ts.getJSDocTags(decl).find((t) => `@${t.tagName.text}` === INHERITED_TAG);
  if (!tag) return undefined;

  const [owner, index] = (ts.getTextOfJSDocComment(tag.comment) ?? "").split(" ");
  const dot = owner!.lastIndexOf(".");
  const module = owner!.slice(0, dot);
  const cls = findSdkType(ref.platform, module, owner!.slice(dot + 1));
  if (cls?.kind !== "class") throw new Error(`${owner}: no class for an inherited member`);

  return { ref: { ...ref, module, cls }, index: Number(index) };
}

export function schemaConstructor(ref: SdkClassRef, decl: ts.ConstructorDeclaration): SdkCallable {
  return ref.cls.constructors![
    (decl.parent as ts.ClassDeclaration).members.filter(ts.isConstructorDeclaration).indexOf(decl)
  ]!;
}

/** A completion-handler method as its promise form is called: without the handler, giving what it gets. */
export function promiseForm(m: SdkMethodSchema): SdkMethodSchema {
  const { throws: _, ...rest } = m;
  return { ...rest, params: m.params.slice(0, -1), returns: m.async!.returns };
}
