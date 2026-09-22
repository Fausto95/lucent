import {
  compile,
  parseModule,
  typeToString,
  type CompileOptions,
  type Diagnostic,
  type IRModule,
  type LibraryModule,
  type NativeTargets,
  type Span,
  type SurfaceModule,
  type Expr,
  type Stmt,
} from "@lucent-lang/compiler";

export interface LanguageServiceOptions {
  targets?: NativeTargets;
  /** Dependency source texts; the compiler never reads files. */
  sources?: Readonly<Record<string, string>>;
  libraries?: Readonly<Record<string, LibraryModule>>;
}

/** File + byte span pointing into Lucent source (P67 partial). */
export interface SourceLocation {
  fileName: string;
  start: number;
  end: number;
}

export interface LanguageService {
  /** Compile and return diagnostics (same resolver as the CLI / Metro path). */
  diagnose(source: string, fileName: string): Diagnostic[];
  /**
   * Hover for an identifier at `offset`: compile, then look up name + type.
   * Returns null when the offset is not an identifier or compile fails.
   */
  hoverSymbol(source: string, fileName: string, offset: number): string | null;
  /**
   * Go to definition for a local function or an import binding in this file.
   * Returns null when the offset is not a resolvable name.
   */
  gotoDefinition(source: string, fileName: string, offset: number): SourceLocation | null;
  /**
   * Find references to the identifier at `offset` within the same module
   * (definition + uses). Empty when the offset is not an identifier.
   */
  findReferences(source: string, fileName: string, offset: number): SourceLocation[];
}

/** Shared compiler-backed language service used by editor stubs and future LSP. */
export function createLanguageService(options: LanguageServiceOptions = {}): LanguageService {
  const compileOptions = (fileName: string): CompileOptions => ({
    fileName,
    ...(options.targets !== undefined ? { targets: options.targets } : {}),
    ...(options.sources !== undefined ? { sources: options.sources } : {}),
    ...(options.libraries !== undefined ? { libraries: options.libraries } : {}),
  });

  return {
    diagnose(source, fileName) {
      return compile(source, compileOptions(fileName)).diagnostics;
    },
    hoverSymbol(source, fileName, offset) {
      const name = identifierAt(source, offset);
      if (!name) return null;
      const result = compile(source, compileOptions(fileName));
      if (!result.module) return null;
      const type = lookupType(result.module, name);
      return type ? `${name}: ${type}` : null;
    },
    gotoDefinition(source, fileName, offset) {
      const name = identifierAt(source, offset);
      if (!name) return null;
      const parsed = parseModule(source, fileName);
      return definitionOf(parsed.module, fileName, name, source);
    },
    findReferences(source, fileName, offset) {
      const name = identifierAt(source, offset);
      if (!name) return [];
      const parsed = parseModule(source, fileName);
      return referencesOf(parsed.module, fileName, name, source);
    },
  };
}

function identifierAt(source: string, offset: number): string | null {
  if (offset < 0 || offset >= source.length) return null;
  let start = offset;
  let end = offset;
  while (start > 0 && /[A-Za-z0-9_]/.test(source[start - 1]!)) start--;
  while (end < source.length && /[A-Za-z0-9_]/.test(source[end]!)) end++;
  if (start === end) return null;
  const id = source.slice(start, end);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(id) ? id : null;
}

function lookupType(module: IRModule, name: string): string | null {
  for (const fn of module.functions) {
    if (fn.name === name) {
      const params = fn.params.map((p) => `${p.name}: ${typeToString(p.type)}`).join(", ");
      return `(${params}) -> ${typeToString(fn.returnType)}`;
    }
    for (const param of fn.params) {
      if (param.name === name) return typeToString(param.type);
    }
    for (const local of fn.locals) {
      if (local.name === name || local.id === name || local.id === `%${name}`) return typeToString(local.type);
    }
  }
  for (const struct of module.structs) {
    if (struct.name === name) {
      const fields = struct.fields.map((f) => `${f.name}: ${typeToString(f.type)}`).join(", ");
      return `struct { ${fields} }`;
    }
  }
  return null;
}

function definitionOf(module: SurfaceModule, fileName: string, name: string, source: string): SourceLocation | null {
  for (const fn of module.functions) {
    if (fn.name === name) {
      const nameSpan = nameSpanIn(source, fn.span, name);
      return loc(fileName, nameSpan ?? fn.span);
    }
  }
  for (const imp of module.imports) {
    if (imp.names.includes(name) || imp.bindings?.some((b) => b.local === name)) {
      const nameSpan = nameSpanIn(source, imp.span, name);
      return loc(fileName, nameSpan ?? imp.span);
    }
  }
  return null;
}

function referencesOf(module: SurfaceModule, fileName: string, name: string, source: string): SourceLocation[] {
  const found: SourceLocation[] = [];
  const seen = new Set<string>();
  const add = (span: Span) => {
    const key = `${span.start}:${span.end}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(loc(fileName, span));
  };

  const def = definitionOf(module, fileName, name, source);
  if (def) add({ start: def.start, end: def.end });

  for (const fn of module.functions) {
    if (fn.name === name) {
      const nameSpan = nameSpanIn(source, fn.span, name);
      if (nameSpan) add(nameSpan);
    }
    for (const param of fn.params) {
      if (param.name === name) add(param.span);
    }
    walkStmts(fn.body, name, source, add);
  }
  for (const imp of module.imports) {
    if (imp.names.includes(name) || imp.bindings?.some((b) => b.local === name)) {
      const nameSpan = nameSpanIn(source, imp.span, name);
      if (nameSpan) add(nameSpan);
      else add(imp.span);
    }
  }
  return found.toSorted((a, b) => a.start - b.start || a.end - b.end);
}

function walkStmts(stmts: Stmt[], name: string, source: string, add: (span: Span) => void): void {
  for (const stmt of stmts) walkStmt(stmt, name, source, add);
}

function walkStmt(stmt: Stmt, name: string, source: string, add: (span: Span) => void): void {
  switch (stmt.kind) {
    case "variable":
      if (stmt.name === name) add(stmt.span);
      if (stmt.init) walkExpr(stmt.init, name, source, add);
      break;
    case "if":
      walkExpr(stmt.test, name, source, add);
      walkStmts(stmt.consequent, name, source, add);
      if (stmt.alternate) walkStmts(stmt.alternate, name, source, add);
      break;
    case "while":
      walkExpr(stmt.test, name, source, add);
      walkStmts(stmt.body, name, source, add);
      break;
    case "for":
      if (stmt.init) walkStmt(stmt.init, name, source, add);
      if (stmt.test) walkExpr(stmt.test, name, source, add);
      if (stmt.update) walkExpr(stmt.update, name, source, add);
      walkStmts(stmt.body, name, source, add);
      break;
    case "forOf":
      if (stmt.variable === name) add(stmt.span);
      walkExpr(stmt.iterable, name, source, add);
      walkStmts(stmt.body, name, source, add);
      break;
    case "return":
      if (stmt.argument) walkExpr(stmt.argument, name, source, add);
      break;
    case "throw":
      if (stmt.message) walkExpr(stmt.message, name, source, add);
      for (const field of stmt.metadata ?? []) walkExpr(field.value, name, source, add);
      break;
    case "expression":
      walkExpr(stmt.expression, name, source, add);
      break;
    case "block":
      walkStmts(stmt.body, name, source, add);
      break;
    case "break":
    case "continue":
    case "unsupported":
      break;
  }
}

function walkExpr(expr: Expr, name: string, source: string, add: (span: Span) => void): void {
  switch (expr.kind) {
    case "identifier":
      if (expr.name === name) add(expr.span);
      break;
    case "call":
      if (expr.callee === name) {
        const nameSpan = nameSpanIn(source, expr.span, name);
        add(nameSpan ?? expr.span);
      }
      for (const arg of expr.args) walkExpr(arg, name, source, add);
      break;
    case "closure":
      for (const p of expr.params) if (p.name === name) add(p.span);
      if (Array.isArray(expr.body)) walkStmts(expr.body, name, source, add);
      else walkExpr(expr.body, name, source, add);
      break;
    case "view":
      for (const prop of expr.properties) walkExpr(prop.value, name, source, add);
      for (const child of expr.children) walkExpr(child, name, source, add);
      break;
    case "binary":
    case "logical":
      walkExpr(expr.left, name, source, add);
      walkExpr(expr.right, name, source, add);
      break;
    case "conditional":
      walkExpr(expr.test, name, source, add);
      walkExpr(expr.consequent, name, source, add);
      walkExpr(expr.alternate, name, source, add);
      break;
    case "unary":
    case "await":
      walkExpr(expr.argument, name, source, add);
      break;
    case "update":
      walkExpr(expr.target, name, source, add);
      break;
    case "assign":
      walkExpr(expr.target, name, source, add);
      walkExpr(expr.value, name, source, add);
      break;
    case "member":
      walkExpr(expr.object, name, source, add);
      break;
    case "index":
      walkExpr(expr.object, name, source, add);
      walkExpr(expr.index, name, source, add);
      break;
    case "methodCall":
      walkExpr(expr.object, name, source, add);
      for (const arg of expr.args) walkExpr(arg, name, source, add);
      break;
    case "template":
      for (const part of expr.expressions) walkExpr(part, name, source, add);
      break;
    case "array":
      for (const el of expr.elements) walkExpr(el, name, source, add);
      break;
    case "object":
      for (const prop of expr.properties) walkExpr(prop.value, name, source, add);
      break;
    case "number":
    case "string":
    case "boolean":
    case "null":
    case "undefined":
    case "unsupported":
      break;
  }
}

/** Locate the identifier token for `name` inside `span` (first whole-word hit). */
function nameSpanIn(source: string, span: Span, name: string): Span | null {
  const slice = source.slice(span.start, span.end);
  const re = new RegExp(`\\b${escapeRegExp(name)}\\b`);
  const match = re.exec(slice);
  if (!match || match.index === undefined) return null;
  const start = span.start + match.index;
  return { start, end: start + name.length };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loc(fileName: string, span: Span): SourceLocation {
  return { fileName, start: span.start, end: span.end };
}

/** Minimal stdio stub so the package can be launched as an LSP-ish process. */
function runStub(): void {
  const service = createLanguageService();
  process.stdin.setEncoding("utf8");
  let buffer = "";
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const request = JSON.parse(trimmed) as {
          method?: string;
          source?: string;
          fileName?: string;
          offset?: number;
        };
        if (request.method === "diagnose" && typeof request.source === "string") {
          const fileName = typeof request.fileName === "string" ? request.fileName : "stdin.lucent.ts";
          const diagnostics = service.diagnose(request.source, fileName);
          process.stdout.write(`${JSON.stringify({ diagnostics })}\n`);
          continue;
        }
        if (request.method === "hover" && typeof request.source === "string" && typeof request.offset === "number") {
          const fileName = typeof request.fileName === "string" ? request.fileName : "stdin.lucent.ts";
          const hover = service.hoverSymbol(request.source, fileName, request.offset);
          process.stdout.write(`${JSON.stringify({ hover })}\n`);
          continue;
        }
        if (
          request.method === "gotoDefinition" &&
          typeof request.source === "string" &&
          typeof request.offset === "number"
        ) {
          const fileName = typeof request.fileName === "string" ? request.fileName : "stdin.lucent.ts";
          const location = service.gotoDefinition(request.source, fileName, request.offset);
          process.stdout.write(`${JSON.stringify({ location })}\n`);
          continue;
        }
        if (
          request.method === "findReferences" &&
          typeof request.source === "string" &&
          typeof request.offset === "number"
        ) {
          const fileName = typeof request.fileName === "string" ? request.fileName : "stdin.lucent.ts";
          const references = service.findReferences(request.source, fileName, request.offset);
          process.stdout.write(`${JSON.stringify({ references })}\n`);
          continue;
        }
        process.stdout.write(
          `${JSON.stringify({ error: "unsupported method; use diagnose, hover, gotoDefinition, or findReferences" })}\n`,
        );
      } catch {
        process.stdout.write(`${JSON.stringify({ error: "expected JSON line: { method, source, fileName? }" })}\n`);
      }
    }
  });
}

const isMain =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("language-server/src/index.ts") ||
    process.argv[1].endsWith("lucent-language-server") ||
    process.argv[1].includes("@lucent-lang/language-server"));

if (isMain) runStub();
