/**
 * IR → Kotlin. Emits data classes and function bodies only; hosts wrap them.
 * Generated code relies on a small runtime prelude (`LucentError`,
 * `LucentBytes`, `lucentStr`) that each host provides via `kotlinRuntime`.
 */
import type { IRExpr, IRFunction, IRModule, IRPlace, IRStmt, IRStruct, NativeType } from "@lucent-lang/compiler";

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
  /** Standalone source: data classes and top-level functions, compilable against the runtime prelude. */
  code: string;
  structs: GeneratedStruct[];
  functions: GeneratedFunction[];
}

const PRIMITIVES: Readonly<Record<string, string>> = {
  void: "Unit",
  bool: "Boolean",
  string: "String",
  bytes: "ArrayBuffer",
};

const INTS: Readonly<Record<string, string>> = { "8": "Byte", "16": "Short", "32": "Int", "64": "Long" };

export function kotlinType(t: NativeType): string {
  switch (t.kind) {
    case "float":
      return t.bits === 64 ? "Double" : "Float";
    case "int":
      return `${t.signed ? "" : "U"}${INTS[String(t.bits)]}`;
    case "array":
      return `MutableList<${kotlinType(t.element)}>`;
    case "map":
      return `Map<String, ${kotlinType(t.value)}>`;
    case "optional":
      return `${kotlinType(t.value)}?`;
    case "struct":
      return t.name;
    case "promise":
      return kotlinType(t.value);
    default:
      return PRIMITIVES[t.kind]!;
  }
}

/** The plain-Kotlin LucentError used when no host supplies one (tests, verification). */
export const KOTLIN_DEFAULT_ERROR =
  "class LucentError(val code: String, message: String? = null) : Exception(message ?: code)";

/** Runtime prelude; `bytes` supplies the host's `ArrayBuffer` accessors and import lines, `error` its LucentError type. */
export function kotlinRuntime(
  bytes: { imports: string[]; length: string; get: string },
  packageName?: string,
  error: string = KOTLIN_DEFAULT_ERROR,
): string {
  return `${packageName ? `package ${packageName}\n\n` : ""}${bytes.imports.join("\n")}${bytes.imports.length ? "\n\n" : ""}${error}

object LucentBytes {
  fun length(buffer: ArrayBuffer): Double {
    ${bytes.length}
  }

  fun get(buffer: ArrayBuffer, index: Double): Double {
    ${bytes.get}
  }
}

fun lucentStr(value: Double): String {
  if (value.isFinite() && value == Math.rint(value) && Math.abs(value) < 1e15) {
    return value.toLong().toString()
  }
  return value.toString()
}

fun lucentStr(value: Float): String = lucentStr(value.toDouble())
fun lucentStr(value: Int): String = value.toString()
fun lucentStr(value: Long): String = value.toString()
fun lucentStr(value: Short): String = value.toString()
fun lucentStr(value: Byte): String = value.toString()
fun lucentStr(value: UInt): String = value.toString()
fun lucentStr(value: ULong): String = value.toString()
fun lucentStr(value: UShort): String = value.toString()
fun lucentStr(value: UByte): String = value.toString()
fun lucentStr(value: Boolean): String = if (value) "true" else "false"
`;
}

export const localName = (id: string): string => id.replace(/^%/, "").replace(/\./g, "_");

export function generateKotlin(module: IRModule): GeneratedUnit {
  const structs = module.structs.map((s) => generateStruct(s));
  const functions = module.functions.map((f) => generateFunction(f));
  const code = [
    ...structs.map((s) => `data class ${s.name}(\n${s.fields.map((f) => `  var ${f.name}: ${f.type}`).join(",\n")}\n)`),
    ...functions.map((f) => `${signature(f)} {\n${indent(f.body).join("\n")}\n}`),
  ].join("\n\n");
  return { code: code + "\n", structs, functions };
}

export function signature(f: GeneratedFunction): string {
  const params = f.params.map((p) => `${p.name}: ${p.type}`).join(", ");
  return `${f.async ? "suspend " : ""}fun ${f.name}(${params}): ${f.returnType}`;
}

export const indent = (lines: string[], depth = 1): string[] =>
  lines.map((l) => (l === "" ? l : "  ".repeat(depth) + l));

function generateStruct(s: IRStruct): GeneratedStruct {
  return {
    name: s.name,
    exported: s.exported,
    fields: s.fields.map((f) => ({ name: f.name, type: kotlinType(f.type) })),
  };
}

function generateFunction(f: IRFunction): GeneratedFunction {
  const emitter = new KotlinEmitter(f);
  return {
    name: f.name,
    exported: f.exported,
    async: f.async,
    params: f.params.map((p) => ({ name: p.name, type: kotlinType(p.type) })),
    returnType: kotlinType(f.returnType),
    body: emitter.block(f.body),
  };
}

class KotlinEmitter {
  private readonly mutable: ReadonlySet<string>;
  private readonly types: ReadonlyMap<string, NativeType>;

  constructor(f: IRFunction) {
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
    return wrapped && text.startsWith("(") && text.endsWith(")") ? text.slice(1, -1) : text;
  }

  private stmt(s: IRStmt): string[] {
    switch (s.op) {
      case "let":
        return [
          `${this.mutable.has(s.id) ? "var" : "val"} ${localName(s.id)}: ${kotlinType(this.types.get(s.id)!)} = ${this.expr(s.value)}`,
        ];
      case "assign":
        return [`${this.place(s.target)} = ${this.expr(s.value)}`];
      case "if": {
        const lines = [`if (${this.condition(s.cond)}) {`, ...indent(this.block(s.consequent))];
        if (s.alternate.length) lines.push("} else {", ...indent(this.block(s.alternate)));
        lines.push("}");
        return lines;
      }
      case "while":
        return [`while (${this.condition(s.cond)}) {`, ...indent(this.block(s.body)), "}"];
      case "forEach":
        return [`for (${localName(s.id)} in ${this.expr(s.iterable)}) {`, ...indent(this.block(s.body)), "}"];
      case "break":
      case "continue":
        return [s.op];
      case "return":
        return [s.value ? `return ${this.expr(s.value)}` : "return"];
      case "throw":
        return [`throw LucentError(${str(s.code)}${s.message ? `, ${this.expr(s.message)}` : ""})`];
      case "expr":
        return [this.expr(s.value)];
      case "push":
        return [`${this.expr(s.array)}.add(${this.expr(s.value)})`];
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
    return e.type.kind === "int" && e.type.bits === 32 && e.type.signed ? this.expr(e) : `${this.expr(e)}.toInt()`;
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
        return `${this.expr(e.value)}!!`;
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
        return `${e.callee}(${e.args.map((a) => this.expr(a)).join(", ")})`;
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
      case "array": {
        const element = e.type.kind === "array" ? kotlinType(e.type.element) : "Any";
        return e.elements.length
          ? `mutableListOf(${e.elements.map((x) => this.expr(x)).join(", ")})`
          : `mutableListOf<${element}>()`;
      }
      case "struct":
        return `${e.name}(${e.fields.map((f) => `${f.name} = ${this.expr(f.value)}`).join(", ")})`;
    }
  }

  private length(object: IRExpr): string {
    const inner = this.expr(object);
    switch (object.type.kind) {
      case "string":
        return `${inner}.length.toDouble()`;
      case "bytes":
        return `LucentBytes.length(${inner})`;
      default:
        return `${inner}.size.toDouble()`;
    }
  }

  private binary(e: Extract<IRExpr, { op: "binary" }>): string {
    const l = this.expr(e.left);
    const r = this.expr(e.right);
    const OPS: Record<typeof e.operator, string> = {
      add: "+",
      sub: "-",
      mul: "*",
      div: "/",
      rem: "%",
      lt: "<",
      le: "<=",
      gt: ">",
      ge: ">=",
      eq: "==",
      ne: "!=",
    };
    return `(${l} ${OPS[e.operator]} ${r})`;
  }
}

/** Kotlin numeric literals carry their type; the IR type decides the suffix. */
function constant(value: number | string | boolean | null, type: NativeType): string {
  if (value === null) return "null";
  if (typeof value === "string") return str(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  const t = type.kind === "optional" ? type.value : type;
  if (t.kind === "float") {
    const text = Number.isInteger(value) ? `${value}.0` : String(value);
    return t.bits === 32 ? `${text}f` : text;
  }
  if (t.kind === "int") {
    const suffix = `${t.signed ? "" : "u"}${t.bits === 64 ? "L" : ""}`;
    const text = `${value}${suffix}`;
    // Byte and Short have no literal suffix; they need a conversion.
    return t.bits === 8 || t.bits === 16 ? `(${text}).to${kotlinType(t)}()` : text;
  }
  return String(value);
}

/** Kotlin string literal: JSON escaping plus `$`, which would start a template. */
export function str(s: string): string {
  return JSON.stringify(s).replace(/\$/g, "\\$");
}
