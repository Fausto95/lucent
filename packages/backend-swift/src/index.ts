import { swiftErrorWire } from "./errors.ts";
import { swiftType } from "./types.ts";
export { swiftType } from "./types.ts";
import { swiftClass } from "./objects.ts";
export { swiftClass, swiftObjectRuntime } from "./objects.ts";
import { swiftEventValue } from "./events.ts";
export { swiftEventRuntime } from "./events.ts";
/**
 * IR → Swift. Emits struct and function bodies only; hosts wrap them.
 * Generated code relies on a small runtime prelude (`LucentError`,
 * `LucentBytes`, `lucentStr`) that each host provides via `swiftRuntime`.
 */
import { swiftView } from "./views.ts";
export { swiftViewRuntime, swiftHostedViewRuntime } from "./views.ts";
import type { IRExpr, IRFunction, IRModule, IRPlace, IRStmt, IRStruct, NativeType } from "@lucent-lang/compiler";

export interface GeneratedField {
  name: string;
  type: string;
}

export interface GeneratedStruct {
  reference?: boolean;
  name: string;
  exported: boolean;
  fields: GeneratedField[];
}

export interface GeneratedFunction {
  view?: boolean;
  thread?: "main" | "worker" | "caller";
  name: string;
  exported: boolean;
  async: boolean;
  params: GeneratedField[];
  state?: { name: string; type: string }[];
  returnType: string;
  /** Body lines without indentation. */
  body: string[];
}

export interface GeneratedUnit {
  /** Standalone source: structs and free functions, compilable against the runtime prelude. */
  code: string;
  imports: string[];
  structs: GeneratedStruct[];
  functions: GeneratedFunction[];
}

/** The plain-Swift LucentError used when no host supplies one (tests, verification). */
export const SWIFT_DEFAULT_ERROR = `struct LucentError: Error {
  let code: String
  let message: String
  let metadata: [String: Any]

  init(code: String, message: String? = nil, metadata: [String: Any] = [:]) {
    self.metadata = metadata
    self.code = code
    self.message = message ?? code
  }
}`;

/** Runtime prelude; `bytes` supplies the host's `ArrayBuffer` accessors, `error` its LucentError type. */
export function swiftRuntime(
  bytes: { length: string; get: string; data?: string; fromData?: string },
  error: string = SWIFT_DEFAULT_ERROR,
): string {
  return `import Foundation

${error}
${swiftErrorWire}

enum LucentBytes {
  static func data(_ buffer: ArrayBuffer) -> Data {
    ${bytes.data ?? "return Data(buffer)"}
  }
  static func fromData(_ data: Data) throws -> ArrayBuffer {
    ${bytes.fromData ?? "return Array(data)"}
  }
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
  const functions = module.functions.map((f) => generateFunction(f, paramNames, module));
  const imports = [
    ...new Set([
      ...Object.values(module.views ?? {}).flatMap((v) => v.swift.imports ?? []),
      ...module.functions.flatMap((f) =>
        f.binding?.platforms && !f.binding.platforms.includes("ios") ? [] : (f.binding?.swiftImports ?? []),
      ),
      ...(module.functions.some((f) => f.returnType.kind === "view") ? ["SwiftUI"] : []),
    ]),
  ];
  const code = [
    ...imports.map((i) => `import ${i}`),
    ...structs.map((s) =>
      s.reference
        ? swiftClass(module.structs.find((ir) => ir.name === s.name)!)
        : `struct ${s.name} {\n${s.fields.map((f) => `  var ${f.name}: ${f.type}`).join("\n")}\n}`,
    ),
    ...functions.map((f) => `${signature(f)} {\n${indent(f.body).join("\n")}\n}`),
  ].join("\n\n");
  return { code: code + "\n", structs, functions, imports };
}

export function signature(f: GeneratedFunction): string {
  const params = f.params.map((p) => `${p.name}: ${p.type}`).join(", ");
  const state = (f.state ?? [])
    .map(
      (slot) =>
        `lucentGet_${slot.name}: @escaping () -> ${slot.type}, lucentSet_${slot.name}: @escaping (${slot.type}) -> Void`,
    )
    .join(", ");
  if (f.view) return `@MainActor func ${f.name}(${[params, state].filter(Boolean).join(", ")}) -> AnyView`;
  return `${f.thread === "main" ? "@MainActor " : ""}func ${f.name}(${params})${f.async ? " async" : ""} throws -> ${f.returnType}`;
}

export const indent = (lines: string[], depth = 1): string[] =>
  lines.map((l) => (l === "" ? l : "  ".repeat(depth) + l));

function generateStruct(s: IRStruct): GeneratedStruct {
  return {
    name: s.name,
    exported: s.exported,
    ...(s.reference ? { reference: true } : {}),
    fields: s.fields.map((f) => ({ name: f.name, type: swiftType(f.type) })),
  };
}

function generateFunction(
  f: IRFunction,
  paramNames: ReadonlyMap<string, string[]>,
  module: IRModule,
): GeneratedFunction {
  if (f.binding?.platforms && !f.binding.platforms.includes("ios")) {
    f = {
      ...f,
      binding: {
        ...f.binding,
        swift: ['throw LucentError(code: "PLATFORM_UNAVAILABLE", message: "API unavailable on iOS")'],
      },
    };
  }
  const emitter = new SwiftEmitter(f, paramNames);
  const body = f.event
    ? [
        `try LucentEventHub.shared.emit(${JSON.stringify(f.event.id)}, ${swiftEventValue("payload", f.params[0]?.type ?? { kind: "void" }, module)})`,
      ]
    : (f.binding?.swift ?? emitter.block(f.body));
  return {
    name: f.name,
    ...(f.returnType.kind === "view" ? { view: true } : {}),
    ...(f.thread ? { thread: f.thread } : {}),
    exported: f.exported,
    async: f.async,
    params: f.params.map((p) => ({
      name: p.name,
      type: (p.type.kind === "callback" ? "@escaping " : "") + swiftType(p.type),
    })),
    ...(f.state?.length ? { state: f.state.map((slot) => ({ name: slot.name, type: swiftType(slot.type) })) } : {}),
    returnType: swiftType(f.returnType),
    body: f.thread === "worker" ? ["return try await Task.detached {", ...indent(body), "}.value"] : body,
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

  private forRows(e: Extract<IRExpr, { op: "view" }>): string {
    const data = e.props.find((prop) => prop.name === "each");
    const child = e.children[0];
    if (!data || child?.op !== "closure" || Array.isArray(child.body) || !child.params[0])
      return "AnyView(EmptyView())";
    const param = child.params[0].name;
    return `AnyView(VStack(alignment: .leading, spacing: 0) { ForEach(Array(${this.expr(data.value)}.enumerated()), id: \\.offset) { pair in let ${param} = pair.element; AnyView(${this.expr(child.body)}) } })`;
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
        return [
          `throw LucentError(code: ${str(s.code)}${s.message ? `, message: ${this.top(s.message)}` : ""}${s.metadata ? `, metadata: [${s.metadata.map((f) => `${str(f.name)}: ${f.value.op === "const" && f.value.value === null ? "lucentNull()" : this.top(f.value)}`).join(", ")}]` : ""})`,
        ];
      case "stateWrite":
        return [`lucentSet_${s.name}(${this.top(s.value)})`];
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
      case "view":
        return e.name === "For" ? this.forRows(e) : swiftView(e, (x) => this.expr(x));
      case "stateRead":
        return `lucentGet_${e.name}()`;
      case "stateWrite":
        return `lucentSet_${e.name}(${this.top(e.value)})`;
      case "ifExpr":
        return e.type.kind === "view"
          ? `AnyView(Group { if ${this.expr(e.cond)} { ${this.expr(e.consequent)} } else { ${this.expr(e.alternate)} } })`
          : `(${this.expr(e.cond)} ? ${this.expr(e.consequent)} : ${this.expr(e.alternate)})`;
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
      case "weak":
        return e.name;
      case "closure": {
        const result = e.type.kind === "callback" ? e.type.result : Array.isArray(e.body) ? e.type : e.body.type;
        const weak = e.captures
          .filter((capture) => capture.kind === "weak")
          .map((capture) => `weak ${capture.name}`)
          .join(", ");
        const head = `{ ${weak ? `[${weak}] ` : ""}(${e.params.map((p) => `${p.name}: ${swiftType(p.type)}`).join(", ")}) throws -> ${swiftType(result)} in `;
        return Array.isArray(e.body)
          ? `${head}\n${indent(this.block(e.body)).join("\n")}\n}`
          : `${head}${this.top(e.body)} }`;
      }
      case "functionRef":
        return e.name;
      case "invoke":
        return `${this.expr(e.callback)}(${e.args.map((a) => this.expr(a)).join(", ")})`;
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

function collectCalls(e: IRExpr): Extract<IRExpr, { op: "call" | "invoke" }>[] {
  const out: Extract<IRExpr, { op: "call" | "invoke" }>[] = [];
  const visit = (x: IRExpr): void => {
    switch (x.op) {
      case "invoke":
        visit(x.callback);
        out.push(x);
        x.args.forEach(visit);
        break;
      case "call":
        if (x.type.kind !== "view") out.push(x);
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

/** Native namespace used by host view wrappers, independent of bridge types. */
export function generateSwiftNamespace(module: IRModule, name: string): string {
  const unit = generateSwift(module);
  const members = [
    ...unit.structs
      .filter((s) => !s.reference)
      .map((s) => `struct ${s.name} {\n${s.fields.map((f) => `  var ${f.name}: ${f.type}`).join("\n")}\n}`),
    ...unit.functions.map((f) => `${signature(f).replace("func ", "static func ")} {\n${indent(f.body).join("\n")}\n}`),
  ];
  return [
    ...unit.imports.map((i) => `import ${i}`),
    `enum ${name} {`,
    ...indent(members.join("\n\n").split("\n")),
    "}",
    "",
  ].join("\n");
}
