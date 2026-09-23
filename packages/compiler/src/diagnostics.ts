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
  TypeScript: "LUCENT9001",
} as const;

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
