/**
 * The code of iOS app extensions (decision 0124): the modules each
 * extension's code reaches through its imports, and in them, the APIs app
 * extensions can't use, refused (LUCENT3018), as Xcode refuses them under
 * `APPLICATION_EXTENSION_API_ONLY`. An SDK member is one when its schema
 * says so (bindgen reads `NS_EXTENSION_UNAVAILABLE_IOS`); a declaration of
 * Lucent's own, when its JSDoc carries the tag `@extensionUnavailable`.
 */
import ts from "typescript";
import { Codes } from "../codes.ts";
import { fail } from "../diagnostics.ts";
import { type LucentModule, sdkModuleOf } from "../program.ts";
import {
  classOfDecl,
  isSdkPropertyDecl,
  type SdkClassRef,
  schemaConstructor,
  schemaMethod,
  schemaProperty,
} from "../sdk/declarations.ts";
import { findSdkModule } from "../sdk/schema.ts";

/** The JSDoc tag marking a declaration of Lucent's own that app extensions can't use. */
export const EXTENSION_UNAVAILABLE_TAG = "extensionUnavailable";

/**
 * Each module the code of an app extension reaches, from the modules its
 * declaration names through their imports → the extensions, by name.
 */
export function extensionModules(
  roots: ReadonlyMap<string, readonly string[]>,
  modules: readonly LucentModule[],
  imports: ReadonlyMap<LucentModule, readonly LucentModule[]>,
): Map<LucentModule, string[]> {
  const byName = new Map(modules.map((m) => [m.name, m]));
  const out = new Map<LucentModule, string[]>();

  for (const [extension, names] of roots) {
    const reached = new Set<LucentModule>();
    const visit = (m: LucentModule): void => {
      if (reached.has(m)) return;
      reached.add(m);
      for (const i of imports.get(m) ?? []) visit(i);
    };
    for (const name of names) {
      const m = byName.get(name);
      if (m) visit(m);
    }
    for (const m of reached) out.set(m, [...(out.get(m) ?? []), extension]);
  }

  return out;
}

/** What `decl` is, when app extensions can't use it: its name, as code writes it. */
function unavailableIn(decl: ts.Declaration): string | undefined {
  const named = ts.getNameOfDeclaration(decl);
  const name = named && ts.isIdentifier(named) ? named.text : undefined;

  if (ts.getJSDocTags(decl).some((t) => t.tagName.text === EXTENSION_UNAVAILABLE_TAG))
    return `${name ?? "it"}()`;

  const sdk = sdkModuleOf(decl.getSourceFile());
  if (sdk?.platform !== "ios") return undefined;

  const ref = classOfDecl(decl);
  if (ref) return unavailableMember(ref, decl);

  // A module's function or constant.
  const schema = findSdkModule(sdk.platform, sdk.module);
  if (ts.isFunctionDeclaration(decl) && name)
    return schema?.functions?.some((f) => f.name === name && f.extensionUnavailable)
      ? `${name}()`
      : undefined;
  if (ts.isVariableDeclaration(decl) && name)
    return schema?.constants?.some((c) => c.name === name && c.extensionUnavailable)
      ? name
      : undefined;
  return undefined;
}

/** A class's or member's declaration of SDK class `ref`, when app extensions can't use it. */
function unavailableMember(ref: SdkClassRef, decl: ts.Declaration): string | undefined {
  try {
    if (ts.isClassDeclaration(decl)) return ref.cls.extensionUnavailable ? ref.cls.name : undefined;
    if (ts.isConstructorDeclaration(decl))
      return schemaConstructor(ref, decl)?.extensionUnavailable
        ? `new ${ref.cls.name}(…)`
        : undefined;
    if (ts.isMethodDeclaration(decl)) {
      const found = schemaMethod(ref, decl);
      return found?.method.extensionUnavailable
        ? `${found.ref.cls.name}.${found.method.name}`
        : undefined;
    }
    if (isSdkPropertyDecl(decl)) {
      const found = schemaProperty(ref, decl);
      return found?.property.extensionUnavailable
        ? `${found.ref.cls.name}.${found.property.name}`
        : undefined;
    }
  } catch {
    // A declaration with no schema member (written by Lucent itself): nothing to refuse.
  }
  return undefined;
}

/** The declarations a use at `n` stands for: a call's the one it resolves to. */
function usedAt(checker: ts.TypeChecker, n: ts.Node): ts.Declaration[] {
  // A constructor, as `new` or super(…) resolves it.
  if (
    ts.isNewExpression(n) ||
    (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.SuperKeyword)
  ) {
    const decl = checker.getResolvedSignature(n)?.declaration;
    return decl && ts.isConstructorDeclaration(decl) ? [decl] : [];
  }
  if (!ts.isIdentifier(n) || isDeclarationName(n)) return [];

  // A method called: the overload the call resolves to.
  const call = ts.isPropertyAccessExpression(n.parent) && n.parent.name === n ? n.parent : n;
  if (ts.isCallExpression(call.parent) && call.parent.expression === call) {
    const decl = checker.getResolvedSignature(call.parent)?.declaration;
    if (decl && !ts.isJSDocSignature(decl) && !ts.isConstructorDeclaration(decl)) {
      // Lucent's own overloads: any carrying the tag marks the function.
      const sym = checker.getSymbolAtLocation(n);
      return [decl, ...(sym ? declarationsOf(checker, sym).filter((d) => d !== decl) : [])].filter(
        (d) => d === decl || !sdkModuleOf(d.getSourceFile()),
      );
    }
  }

  const sym = checker.getSymbolAtLocation(n);
  return sym ? declarationsOf(checker, sym) : [];
}

function declarationsOf(checker: ts.TypeChecker, sym: ts.Symbol): ts.Declaration[] {
  const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
  return target.declarations ?? [];
}

function isDeclarationName(n: ts.Identifier): boolean {
  const p = n.parent;
  return (
    !!p &&
    (ts.isImportSpecifier(p) ||
      ts.isImportClause(p) ||
      ts.isNamespaceImport(p) ||
      ((ts.isClassDeclaration(p) ||
        ts.isFunctionDeclaration(p) ||
        ts.isMethodDeclaration(p) ||
        ts.isPropertyDeclaration(p) ||
        ts.isVariableDeclaration(p) ||
        ts.isParameter(p) ||
        ts.isGetAccessorDeclaration(p) ||
        ts.isSetAccessorDeclaration(p)) &&
        p.name === n))
  );
}

/**
 * Refuses each use in `m`, the code of `extensions`, of an API app
 * extensions can't use: each through `guard`, so every one is reported.
 */
export function checkExtensionCode(
  checker: ts.TypeChecker,
  m: LucentModule,
  extensions: readonly string[],
  guard: (f: () => void) => void,
): void {
  const of =
    extensions.length === 1
      ? `the app extension ${extensions[0]}`
      : `the app extensions ${extensions.join(" and ")}`;
  const visit = (n: ts.Node): void => {
    for (const decl of usedAt(checker, n)) {
      const what = unavailableIn(decl);
      if (!what) continue;
      guard(() =>
        fail(
          n,
          Codes.ExtensionUnavailable,
          `${what} is unavailable in app extensions, and ${m.name} is code of ${of}`,
        ),
      );
      break;
    }
    ts.forEachChild(n, visit);
  };
  visit(m.sourceFile);
}
