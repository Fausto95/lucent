import ts from "typescript";

export { Codes, type Code } from "./codes.ts";

export interface Diagnostic {
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  /** Offset and length of the offending code in the file, for editors. */
  start?: number;
  length?: number;
  /** How to fix it, in one line. */
  fix?: string;
  /** Where the code is explained. */
  docs?: string;
  /** A warning: reported, but the code compiles. Errors leave it out. */
  severity?: "warning";
}

export class CompileError extends Error {
  readonly node: ts.Node | undefined;
  readonly code: string;
  /** What to do, when it is this error's own rather than its code's usual fix. */
  readonly fix: string | undefined;
  constructor(node: ts.Node | undefined, code: string, message: string, fix?: string) {
    super(message);
    this.node = node;
    this.code = code;
    this.fix = fix;
  }
}

export function fail(
  node: ts.Node | undefined,
  code: string,
  message: string,
  fix?: string,
): never {
  throw new CompileError(node, code, message, fix);
}

export function toDiagnostic(e: CompileError): Diagnostic {
  const fix = e.fix ? { fix: e.fix } : {};
  if (!e.node) return { code: e.code, message: e.message, ...fix };
  const sf = e.node.getSourceFile();
  const start = e.node.getStart(sf);
  const { line, character } = sf.getLineAndCharacterOfPosition(start);
  return {
    code: e.code,
    message: e.message,
    file: sf.fileName,
    line: line + 1,
    column: character + 1,
    start,
    length: e.node.getEnd() - start,
    ...fix,
  };
}

export function formatDiagnostic(d: Diagnostic): string {
  const where = d.file ? `${d.file}:${d.line}:${d.column}: ` : "";
  return `${where}${d.code}: ${d.message}`;
}
