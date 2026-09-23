import ts from "typescript";

/**
 * Diagnostic codes. LUCENT1xxx: unsupported syntax; LUCENT2xxx: types that
 * have no native representation; LUCENT3xxx: module structure; LUCENT9xxx:
 * TypeScript errors passed through.
 */
export const Codes = {
  UnsupportedSyntax: "LUCENT1001",
  UnsupportedOperator: "LUCENT1002",
  UnsupportedBuiltin: "LUCENT1003",
  UnsupportedDestructuring: "LUCENT1004",
  UnsupportedClassFeature: "LUCENT1005",
  UnsupportedThrow: "LUCENT1006",
  UnsupportedCall: "LUCENT1007",
  UnsupportedAssignmentTarget: "LUCENT1008",
  UnsupportedLoop: "LUCENT1009",
  AnyType: "LUCENT2001",
  UnsupportedType: "LUCENT2002",
  InexactObject: "LUCENT2003",
  ArrayVariance: "LUCENT2004",
  AmbiguousUnion: "LUCENT2005",
  BoundaryType: "LUCENT2006",
  GenericBoundary: "LUCENT2007",
  InterfaceNotImplemented: "LUCENT2008",
  InterfaceMismatch: "LUCENT2009",
  UnsupportedImport: "LUCENT3001",
  UnsupportedTopLevel: "LUCENT3002",
  UnsupportedExport: "LUCENT3003",
  SdkImport: "LUCENT3004",
  PlatformConformance: "LUCENT3005",
  MainThreadOnly: "LUCENT3006",
  Unavailable: "LUCENT3007",
  TypeScript: "LUCENT9001",
} as const;

export type Code = (typeof Codes)[keyof typeof Codes];

/** What each code means, for documentation (the website's Diagnostics page is generated from it). */
export const CodeDescriptions = {
  LUCENT1001: "Syntax outside the subset, such as `var` or an async generator.",
  LUCENT1002: "An operator used outside what the subset supports, such as `delete` or `in` on anything but a record.",
  LUCENT1003: "A built-in function or method Lucent does not implement, such as `Symbol()` or an unknown `Math`, `Number` or string method.",
  LUCENT1004: "A destructuring form outside the subset: object rest, computed keys, or a pattern without an initializer.",
  LUCENT1005: "A class feature outside the subset, such as extending a built-in other than `Error`, or an override that changes the native signature.",
  LUCENT1006: "Throwing a value that is not an `Error`.",
  LUCENT1007: "A call Lucent cannot compile, such as spread arguments outside rest parameters.",
  LUCENT1008: "An assignment to something that cannot be assigned, such as an unknown field or a function.",
  LUCENT1009: "A loop over a value that is not iterable in Lucent, or `for await`.",
  LUCENT2001: "`any`, or `unknown` outside a `catch` clause: every value needs a native type.",
  LUCENT2002: "A type with no native representation: intersections, `bigint`, `symbol`, `WeakMap`, `Intl`, or an index signature mixed with properties.",
  LUCENT2003: "An object used as a type with a different shape; object types must match exactly to share a native representation.",
  LUCENT2004: "A collection used where its element type would change (`A[]` as `(A | B)[]`); annotate the value with the target type.",
  LUCENT2005: "A union JavaScript values cannot be told apart by at the boundary; add a string-literal discriminant.",
  LUCENT2006: "A value that cannot cross the JavaScript boundary, such as a generator, a match result or a platform object.",
  LUCENT2007: "A generic function or class exported to JavaScript; export a concrete wrapper.",
  LUCENT2008: "A value used as an interface its class does not declare with `implements`.",
  LUCENT2009: "A class member whose native signature differs from the interface member it implements.",
  LUCENT3001: "An import from something other than another `*.lucent.ts` file, `@lucent-lang/core`, or a platform SDK in a platform file.",
  LUCENT3002: "A top-level statement that is not a declaration.",
  LUCENT3003: "An export form Lucent does not support: export lists, re-exports, default exports.",
  LUCENT3004: "A platform SDK import in a file whose platform cannot use it, or an SDK module without bindings.",
  LUCENT3005: "Platform implementations that do not match their shared declaration file.",
  LUCENT3006: "A main-thread-only platform API used outside `main(() => …)`.",
  LUCENT3007: "A platform API newer than the oldest supported OS version, used without an `available()` or `SDK_INT` check around it.",
  LUCENT9001: "A TypeScript error. Lucent stops at type errors, because its lowering relies on the checker's types.",
} satisfies Record<Code, string>;

export interface Diagnostic {
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  /** Offset and length of the offending code in the file, for editors. */
  start?: number;
  length?: number;
}

export class CompileError extends Error {
  constructor(
    readonly node: ts.Node | undefined,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function fail(node: ts.Node | undefined, code: string, message: string): never {
  throw new CompileError(node, code, message);
}

export function toDiagnostic(e: CompileError): Diagnostic {
  if (!e.node) return { code: e.code, message: e.message };
  const sf = e.node.getSourceFile();
  const start = e.node.getStart(sf);
  const { line, character } = sf.getLineAndCharacterOfPosition(start);
  return { code: e.code, message: e.message, file: sf.fileName, line: line + 1, column: character + 1, start, length: e.node.getEnd() - start };
}

export function formatDiagnostic(d: Diagnostic): string {
  const where = d.file ? `${d.file}:${d.line}:${d.column}: ` : "";
  return `${where}${d.code}: ${d.message}`;
}
