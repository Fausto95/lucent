/**
 * What the analyses know about native extension calls: the thread and
 * blocking their package declared, that nothing Lucent passes escapes
 * the call but a callback, and that a call whose result reports failure,
 * or whose callback may throw, throws.
 */
import ts from "typescript";
import type { NativeCallback, NativeFactsSource, NativeUse } from "../analysis/native.ts";
import { extensionModuleOf } from "../program.ts";
import type { NativeFacts } from "../sdk/schema.ts";
import type { FunctionBinding } from "./bind.ts";
import { findClass, findExtension, findHandle } from "./registry.ts";

const DECLARED = "the extension's lucent.json";

export const EXTENSION_NATIVE: NativeFactsSource = {
  use(decl) {
    const extension = extensionModuleOf(decl.getSourceFile());
    const f = extension ? bindingOf(extension, decl) : undefined;

    return f ? useOf(f, decl) : extension ? cxxUseOf(extension, decl) : undefined;
  },

  classOf(decl) {
    const extension = extensionModuleOf(decl.getSourceFile());
    if (!extension || !ts.isClassDeclaration(decl) || !decl.name) return undefined;

    const h = findHandle(extension, decl.name.text) ?? findClass(extension, decl.name.text);
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

/**
 * A C++ class's member (decision 0125): its class's thread, a new object
 * Lucent owns from a constructor or a result by value, nothing passed
 * kept, and a C++ exception to throw.
 */
function cxxUseOf(extension: string, decl: ts.Declaration): NativeUse | undefined {
  const cls = decl.parent;
  if (!ts.isClassDeclaration(cls) || !cls.name) return undefined;

  const c = findClass(extension, cls.name.text);
  if (!c || !(ts.isConstructorDeclaration(decl) || ts.isMethodDeclaration(decl))) return undefined;

  const made =
    ts.isConstructorDeclaration(decl) ||
    (!!decl.type &&
      ts.isTypeReferenceNode(decl.type) &&
      !!findClass(extension, decl.type.typeName.getText()));
  const name = ts.isMethodDeclaration(decl) ? decl.name.getText() : "constructor";
  const facts: NativeFacts = {
    affinity: c.affinity,
    blocking: "unknown",
    ownership: made ? "transferred" : "borrowed",
    evidence: [
      { fact: "affinity", source: "metadata", detail: DECLARED },
      { fact: "ownership", source: "metadata", detail: "the C++ header" },
    ],
  };

  // A std::function parameter is a callback C++ keeps (decisions 0126 and 0128); the rest copy.
  const callbacks = new Map<number, NativeCallback>();
  const copies = new Set<number>();
  decl.parameters.forEach((p, i) => {
    if (isCallback(p)) callbacks.set(i, CALLBACK);
    else copies.add(i);
  });

  return { display: `${c.name}.${name}`, facts, callbacks, copies, throws: true };
}

/** A parameter its declaration gives a function type: a C++ member's callback. */
const isCallback = (p: ts.ParameterDeclaration) => !!p.type && ts.isFunctionTypeNode(p.type);

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

  // What Lucent passes, by its position: a method's handle is its receiver.
  const passed = f.params.filter((p) => !HIDDEN.has(p.kind));
  const own = ts.isMethodDeclaration(decl) ? passed.slice(1) : passed;

  // A callback runs at once during a native call on the caller's context, during this call
  // or a later one, or queued there; C keeps it (decisions 0126 and 0128). Nothing else
  // Lucent passes escapes the call: native code cannot keep any of it.
  const callbacks = new Map<number, NativeCallback>();
  const copies = new Set<number>();
  own.forEach((p, i) => {
    if (p.kind === "callback") callbacks.set(i, CALLBACK);
    else copies.add(i);
  });

  return {
    display: f.name,
    facts,
    callbacks,
    copies,
    throws: f.failsWhen !== undefined || callbacks.size > 0,
  };
}

/** Parameters Lucent passes nothing for: the binding fills them in. */
const HIDDEN = new Set(["length", "error", "context"]);

const CALLBACK: NativeCallback = { timing: "unknown", main: false, delivery: "either" };
