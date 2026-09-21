/**
 * IR → Swift. Emits struct and function bodies only; hosts wrap them.
 * Generated code relies on a small runtime prelude (`LucentError`,
 * `LucentBytes`, `lucentStr`) that each host provides via `swiftRuntime`.
 */
import type { IRExpr, IRFunction, IRModule, IRPlace, IRStmt, IRStruct, NativeType } from "@lucent/compiler";

export interface GeneratedField {
  name: string;
  type: string;
}

export interface GeneratedStruct {
  name: string;
  exported: boolean;
  fields: GeneratedField[];
}

export interface GeneratedFunction {
  name: string;
  exported: boolean;
  async: boolean;
  params: GeneratedField[];
  returnType: string;
  /** Body lines without indentation. */
  body: string[];
}

export interface GeneratedUnit {
  /** Standalone source: structs and free functions, compilable against the runtime prelude. */
  code: string;
  structs: GeneratedStruct[];
  functions: GeneratedFunction[];
}

const PRIMITIVES: Readonly<Record<string, string>> = {
  void: "Void",
  bool: "Bool",
  string: "String",
  bytes: "ArrayBuffer",
};

export function swiftType(t: NativeType): string {
  switch (t.kind) {
    case "float":
      return t.bits === 64 ? "Double" : "Float";
    case "int":
      return `${t.signed ? "Int" : "UInt"}${t.bits}`;
    case "array":
      return `[${swiftType(t.element)}]`;
    case "map":
      return `[String: ${swiftType(t.value)}]`;
    case "optional":
      return `${swiftType(t.value)}?`;
    case "struct":
      return t.name;
    case "promise":
      return swiftType(t.value);
    default:
      return PRIMITIVES[t.kind]!;
  }
}

/** Runtime prelude; `bytes` supplies the host's `ArrayBuffer` accessors. */
export function swiftRuntime(bytes: { length: string; get: string }): string {
  return `import Foundation

struct LucentError: Error {
  let code: String
  let message: String

  init(code: String, message: String? = nil) {
    self.code = code
    self.message = message ?? code
  }
}

enum LucentBytes {
  static func length(_ buffer: ArrayBuffer) -> Double {
    ${bytes.length}
  }

  static func get(_ buffer: ArrayBuffer, _ index: Double) -> Double {
    ${bytes.get}
  }
}

func lucentStr(_ value: Double) -> String {
  if value.isFinite && value == value.rounded() && abs(value) < 1e15 {
    return String(Int64(value))
  }
  return String(value)
}

func lucentStr(_ value: Float) -> String {
  return lucentStr(Double(value))
}

func lucentStr<T: BinaryInteger>(_ value: T) -> String {
  return String(value)
}

func lucentStr(_ value: Bool) -> String {
  return value ? "true" : "false"
}
`;
}

export const localName = (id: string): string => id.replace(/^%/, "").replace(/\./g, "_");

export function generateSwift(module: IRModule): GeneratedUnit {
  const structs = module.structs.map((s) => generateStruct(s));
  const paramNames = new Map(module.functions.map((f) => [f.name, f.params.map((p) => p.name)]));
  const functions = module.functions.map((f) => generateFunction(f, paramNames));
  const code = [
    ...structs.map((s) => `struct ${s.name} {\n${s.fields.map((f) => `  var ${f.name}: ${f.type}`).join("\n")}\n}`),
    ...functions.map((f) => `${signature(f)} {\n${indent(f.body).join("\n")}\n}`),
  ].join("\n\n");
  return { code: code + "\n", structs, functions };
}

export function signature(f: GeneratedFunction): string {
  const params = f.params.map((p) => `${p.name}: ${p.type}`).join(", ");
  return `func ${f.name}(${params})${f.async ? " async" : ""} throws -> ${f.returnType}`;
}

export const indent = (lines: string[], depth = 1): string[] =>
  lines.map((l) => (l === "" ? l : "  ".repeat(depth) + l));

function generateStruct(s: IRStruct): GeneratedStruct {
  return {
    name: s.name,
    exported: s.exported,
    fields: s.fields.map((f) => ({ name: f.name, type: swiftType(f.type) })),
  };
}

function generateFunction(f: IRFunction, paramNames: ReadonlyMap<string, string[]>): GeneratedFunction {
  const emitter = new SwiftEmitter(f, paramNames);
  return {
    name: f.name,
    exported: f.exported,
    async: f.async,
    params: f.params.map((p) => ({ name: p.name, type: swiftType(p.type) })),
    returnType: swiftType(f.returnType),
    body: emitter.block(f.body),
  };
}

class SwiftEmitter {
  private readonly mutable: ReadonlySet<string>;
  private readonly types: ReadonlyMap<string, NativeType>;

  constructor(
    f: IRFunction,
    private readonly paramNames: ReadonlyMap<string, string[]>,
  ) {
    this.mutable = new Set(f.locals.filter((l) => l.mutable).map((l) => l.id));
    this.types = new Map(f.locals.map((l) => [l.id, l.type]));
  }

  block(stmts: IRStmt[]): string[] {
    return stmts.flatMap((s) => this.stmt(s));
  }

  /** A condition without the redundant outer parentheses of a binary/logical expression. */
  private condition(e: IRExpr): string {
    const text = this.expr(e);
    const wrapped = e.op === "binary" || e.op === "and" || e.op === "or";
    return this.effects(e) + (wrapped && text.startsWith("(") && text.endsWith(")") ? text.slice(1, -1) : text);
  }

  /** A statement-level expression, prefixed with `try`/`try await` once: Swift forbids `try` inside operators. */
  private top(e: IRExpr): string {
    return this.effects(e) + this.expr(e);
  }

  private effects(e: IRExpr): string {
    const calls = collectCalls(e);
    if (calls.length === 0) return "";
    return calls.some((c) => c.type.kind === "promise") ? "try await " : "try ";
  }

  private stmt(s: IRStmt): string[] {
    switch (s.op) {
      case "let":
        return [
          `${this.mutable.has(s.id) ? "var" : "let"} ${localName(s.id)}: ${swiftType(this.types.get(s.id)!)} = ${this.top(s.value)}`,
        ];
      case "assign":
        return [`${this.place(s.target)} = ${this.top(s.value)}`];
      case "if": {
        const lines = [`if ${this.condition(s.cond)} {`, ...indent(this.block(s.consequent))];
        if (s.alternate.length) lines.push("} else {", ...indent(this.block(s.alternate)));
        lines.push("}");
        return lines;
      }
      case "while":
        return [`while ${this.condition(s.cond)} {`, ...indent(this.block(s.body)), "}"];
      case "forEach":
        return [`for ${localName(s.id)} in ${this.top(s.iterable)} {`, ...indent(this.block(s.body)), "}"];
      case "break":
      case "continue":
        return [s.op];
      case "return":
        return [s.value ? `return ${this.top(s.value)}` : "return"];
      case "throw":
        return [`throw LucentError(code: ${str(s.code)}${s.message ? `, message: ${this.top(s.message)}` : ""})`];
      case "expr":
        return [`_ = ${this.top(s.value)}`];
      case "push":
        return [`${this.expr(s.array)}.append(${this.top(s.value)})`];
    }
  }

  private place(p: IRPlace): string {
    switch (p.kind) {
      case "local":
        return localName(p.id);
      case "field":
        return `${this.expr(p.object)}.${p.field}`;
      case "index":
        return `${this.expr(p.object)}[${this.index(p.index)}]`;
    }
  }

  private index(e: IRExpr): string {
    return `Int(${this.expr(e)})`;
  }

  expr(e: IRExpr): string {
    switch (e.op) {
      case "const":
        return constant(e.value, e.type);
      case "param":
        return e.name;
      case "local":
        return localName(e.id);
      case "unwrap":
        return `${this.expr(e.value)}!`;
      case "binary":
        return this.binary(e);
      case "concat":
        return e.parts.map((p) => this.expr(p)).join(" + ");
      case "str":
        return `lucentStr(${this.expr(e.value)})`;
      case "and":
        return `(${this.expr(e.left)} && ${this.expr(e.right)})`;
      case "or":
        return `(${this.expr(e.left)} || ${this.expr(e.right)})`;
      case "not":
        return `!${this.expr(e.value)}`;
      case "neg":
        return `-${this.expr(e.value)}`;
      case "call":
        return `${e.callee}(${e.args.map((a, i) => `${this.paramNames.get(e.callee)?.[i] ?? "_"}: ${this.expr(a)}`).join(", ")})`;
      case "await":
        return this.expr(e.value);
      case "field":
        return `${this.expr(e.object)}.${e.field}`;
      case "length":
        return this.length(e.object);
      case "index":
        return e.object.type.kind === "bytes"
          ? `LucentBytes.get(${this.expr(e.object)}, ${this.expr(e.index)})`
          : `${this.expr(e.object)}[${this.index(e.index)}]`;
      case "mapGet":
        return `${this.expr(e.map)}[${this.expr(e.key)}]`;
      case "array":
        return `[${e.elements.map((x) => this.expr(x)).join(", ")}]`;
      case "struct":
        return `${e.name}(${e.fields.map((f) => `${f.name}: ${this.expr(f.value)}`).join(", ")})`;
    }
  }

  private length(object: IRExpr): string {
    const inner = this.expr(object);
    switch (object.type.kind) {
      case "string":
        return `Double(${inner}.utf16.count)`;
      case "bytes":
        return `LucentBytes.length(${inner})`;
      default:
        return `Double(${inner}.count)`;
    }
  }

  private binary(e: Extract<IRExpr, { op: "binary" }>): string {
    const l = this.expr(e.left);
    const r = this.expr(e.right);
    const isInt = e.left.type.kind === "int";
    switch (e.operator) {
      case "add":
        return `(${l} ${isInt ? "&+" : "+"} ${r})`;
      case "sub":
        return `(${l} ${isInt ? "&-" : "-"} ${r})`;
      case "mul":
        return `(${l} ${isInt ? "&*" : "*"} ${r})`;
      case "div":
        return `(${l} / ${r})`;
      case "rem":
        return isInt ? `(${l} % ${r})` : `${l}.truncatingRemainder(dividingBy: ${r})`;
      case "lt":
        return `(${l} < ${r})`;
      case "le":
        return `(${l} <= ${r})`;
      case "gt":
        return `(${l} > ${r})`;
      case "ge":
        return `(${l} >= ${r})`;
      case "eq":
        return `(${l} == ${r})`;
      case "ne":
        return `(${l} != ${r})`;
    }
  }
}

function collectCalls(e: IRExpr): Extract<IRExpr, { op: "call" }>[] {
  const out: Extract<IRExpr, { op: "call" }>[] = [];
  const visit = (x: IRExpr): void => {
    switch (x.op) {
      case "call":
        out.push(x);
        x.args.forEach(visit);
        break;
      case "unwrap":
      case "str":
      case "not":
      case "neg":
      case "await":
        visit(x.value);
        break;
      case "binary":
      case "and":
      case "or":
        visit(x.left);
        visit(x.right);
        break;
      case "concat":
        x.parts.forEach(visit);
        break;
      case "field":
      case "length":
        visit(x.object);
        break;
      case "index":
        visit(x.object);
        visit(x.index);
        break;
      case "mapGet":
        visit(x.map);
        visit(x.key);
        break;
      case "array":
        x.elements.forEach(visit);
        break;
      case "struct":
        x.fields.forEach((f) => visit(f.value));
        break;
      default:
        break;
    }
  };
  visit(e);
  return out;
}

function constant(value: number | string | boolean | null, type: NativeType): string {
  if (value === null) return "nil";
  if (typeof value === "string") return str(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (type.kind === "float" || (type.kind === "optional" && type.value.kind === "float"))
    return Number.isInteger(value) ? `${value}.0` : String(value);
  return String(value);
}

/** Swift string literal; JSON escaping is a valid subset of Swift's. */
export function str(s: string): string {
  return JSON.stringify(s);
}
