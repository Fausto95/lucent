/**
 * What the analyses know about native extension calls: the thread and
 * blocking their package declared, that nothing Lucent passes escapes
 * the call, and that a call whose result reports failure throws.
 */
import ts from "typescript";
import type { NativeFactsSource, NativeUse } from "../analysis/native.ts";
import { extensionModuleOf } from "../program.ts";
import type { NativeFacts } from "../sdk/schema.ts";
import type { FunctionBinding } from "./bind.ts";
import { findExtension, findHandle } from "./registry.ts";

const DECLARED = "the extension's lucent.json";

export const EXTENSION_NATIVE: NativeFactsSource = {
  use(decl) {
    const extension = extensionModuleOf(decl.getSourceFile());
    const f = extension ? bindingOf(extension, decl) : undefined;

    return f ? useOf(f, decl) : undefined;
  },

  classOf(decl) {
    const extension = extensionModuleOf(decl.getSourceFile());
    if (!extension || !ts.isClassDeclaration(decl) || !decl.name) return undefined;

    const h = findHandle(extension, decl.name.text);
    return h ? { display: h.name, affinity: h.affinity } : undefined;
  },

  implemented: () => undefined,
};

/** The function a declaration of `lucent:ext/<extension>` calls: its own, a handle's create or method. */
function bindingOf(extension: string, decl: ts.Declaration): FunctionBinding | undefined {
  if (ts.isFunctionDeclaration(decl) && decl.name)
    return findExtension(extension)?.functions.find((f) => f.name === decl.name!.text);

  const cls = decl.parent;
  if (!ts.isClassDeclaration(cls) || !cls.name) return undefined;

  const h = findHandle(extension, cls.name.text);
  if (!h) return undefined;
  if (ts.isConstructorDeclaration(decl)) return h.create;
  if (ts.isMethodDeclaration(decl) && ts.isIdentifier(decl.name))
    return h.methods.find((m) => m.name === (decl.name as ts.Identifier).text)?.fn;

  return undefined;
}

function useOf(f: FunctionBinding, decl: ts.Declaration): NativeUse {
  const facts: NativeFacts = {
    affinity: f.affinity,
    blocking: f.blocking ? "yes" : "unknown",
    ownership: f.result.kind === "handle" ? "transferred" : "borrowed",
    evidence: [
      { fact: "affinity", source: "metadata", detail: DECLARED },
      { fact: "ownership", source: "metadata", detail: DECLARED },
      ...(f.blocking
        ? [{ fact: "blocking" as const, source: "metadata" as const, detail: DECLARED }]
        : []),
    ],
  };

  // Nothing Lucent passes escapes the call: native code cannot keep any of it.
  const count = ts.isFunctionLike(decl) ? decl.parameters.length : 0;

  return {
    display: f.name,
    facts,
    callbacks: new Map(),
    copies: new Set(Array.from({ length: count }, (_, i) => i)),
    throws: f.failsWhen !== undefined,
  };
}
