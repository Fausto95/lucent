import { block, render, sections, type Doc } from "@lucent-lang/codegen";
import { fillNative } from "@lucent-lang/codegen";
import { kotlinErrorWire } from "./errors.ts";
import { nativeKotlin } from "./native.ts";
import { kotlinType } from "./types.ts";
export { kotlinType } from "./types.ts";
import { kotlinClass } from "./objects.ts";
export { kotlinClass, kotlinObjectRuntime } from "./objects.ts";
import { kotlinEventValue } from "./events.ts";
export { kotlinEventRuntime } from "./events.ts";
/**
 * IR → Kotlin. Emits data classes and function bodies only; hosts wrap them.
 * Generated code relies on a small runtime prelude (`LucentError`,
 * `LucentBytes`, `lucentStr`) that each host provides via `kotlinRuntime`.
 */
import { kotlinEnumImports, kotlinEnums, kotlinEnumValue } from "./enums.ts";
export { kotlinEnumBridge, kotlinEnums, kotlinEnumImports } from "./enums.ts";
import { COMPOSE_SCAFFOLDING, FOR_IMPORTS, KotlinViewImports, kotlinView } from "./views.ts";
export { KotlinViewImports, kotlinViewRuntime } from "./views.ts";
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
  /** Standalone source: data classes and top-level functions, compilable against the runtime prelude. */
  code: string;
  imports: string[];
  structs: GeneratedStruct[];
  functions: GeneratedFunction[];
}

/** The plain-Kotlin LucentError used when no host supplies one (tests, verification). */
export const KOTLIN_DEFAULT_ERROR = nativeKotlin("LucentDefaultError.kt").trimEnd();

/** Runtime prelude; `bytes` supplies the host's `ArrayBuffer` accessors and import lines, `error` its LucentError type. */
export function kotlinRuntime(
  bytes: { imports: string[]; length: string; get: string; toByteArray?: string; fromByteArray?: string },
  packageName?: string,
  error: string = KOTLIN_DEFAULT_ERROR,
): string {
  const prelude = `${packageName ? `package ${packageName}\n\n` : ""}${bytes.imports.join("\n")}${bytes.imports.length ? "\n\n" : ""}`;
  return (
    prelude +
    fillNative(nativeKotlin("LucentRuntime.kt"), {
      error,
      errorWire: kotlinErrorWire,
      bytesToByteArray: bytes.toByteArray ?? "return buffer.copyOf()",
      bytesFromByteArray: bytes.fromByteArray ?? "return bytes.copyOf()",
      bytesLength: bytes.length,
      bytesGet: bytes.get,
    })
  );
}

export const localName = (id: string): string => id.replace(/^%/, "").replace(/\./g, "_");

export function generateKotlin(module: IRModule): GeneratedUnit {
  const structs = module.structs.map((s) => generateStruct(s));
  const views = new KotlinViewImports();
  const functions = module.functions.map((f) => generateFunction(f, module, views));
  const imports = [
    ...new Set([
      ...Object.values(module.views ?? {}).flatMap((v) => v.kotlin.imports ?? []),
      ...module.structs.flatMap((s) => s.reference?.native?.kotlinImports ?? []),
      ...module.functions.flatMap((f) =>
        f.binding?.platforms && !f.binding.platforms.includes("android") ? [] : (f.binding?.kotlinImports ?? []),
      ),
      ...(module.functions.some((f) => f.returnType.kind === "view") ? COMPOSE_SCAFFOLDING : []),
      ...views.toSorted(),
      ...kotlinEnumImports(module),
    ]),
  ];
  const code = render(
    sections([
      imports.map((i) => `import ${i}`),
      ...kotlinEnums(module.enums ?? {}),
      ...structs.map((s) =>
        s.reference
          ? kotlinClass(
              module.structs.find((ir) => ir.name === s.name)!,
              false,
            )
          : dataClass(s),
      ),
      ...functions.map((f) => block(`${signature(f)} {`, f.body)),
    ]),
  );
  return { code, structs, functions, imports };
}

export function signature(f: GeneratedFunction): string {
  const params = f.params.map((p) => `${p.name}: ${p.type}`).join(", ");
  const state = (f.state ?? [])
    .map((slot) => `lucentGet_${slot.name}: () -> ${slot.type}, lucentSet_${slot.name}: (${slot.type}) -> Unit`)
    .join(", ");
  return `${f.view ? "@Composable " : ""}${f.async ? "suspend " : ""}fun ${f.name}(${[params, state].filter(Boolean).join(", ")}): ${f.returnType}`;
}

/** Statement bodies are still text; the Kotlin AST replaces this. Not exported: assembly uses `block`. */
const indent = (lines: string[], depth = 1): string[] => lines.map((l) => (l === "" ? l : "  ".repeat(depth) + l));

/** A data class with one field per line, so a wide record stays readable. */
export const dataClass = (s: GeneratedStruct): Doc =>
  block(
    `data class ${s.name}(`,
    s.fields.map((f, i) => `var ${f.name}: ${f.type}${i < s.fields.length - 1 ? "," : ""}`),
    ")",
  );

function generateStruct(s: IRStruct): GeneratedStruct {
  return {
    name: s.name,
    exported: s.exported,
    ...(s.reference ? { reference: true } : {}),
    fields: s.fields.map((f) => ({ name: f.name, type: kotlinType(f.type) })),
  };
}

function generateFunction(f: IRFunction, module: IRModule, views: KotlinViewImports): GeneratedFunction {
  if (f.binding?.platforms && !f.binding.platforms.includes("android")) {
    f = {
      ...f,
      binding: { ...f.binding, kotlin: ['throw LucentError("PLATFORM_UNAVAILABLE", "API unavailable on Android")'] },
    };
  }
  const emitter = new KotlinEmitter(f, views);
  const body = f.event
    ? [
        `LucentEventHub.emit(${JSON.stringify(f.event.id)}, ${kotlinEventValue("payload", f.params[0]?.type ?? { kind: "void" }, module)})`,
      ]
    : (f.binding?.kotlin.map((line) =>
        f.thread && f.thread !== "caller" ? line.replace(/^(\s*)return\b/, "$1return@withContext") : line,
      ) ?? emitter.block(f.body));
  return {
    name: f.name,
    ...(f.returnType.kind === "view" ? { view: true } : {}),
    exported: f.exported,
    async: f.async,
    params: f.params.map((p) => ({ name: p.name, type: kotlinType(p.type) })),
    ...(f.state?.length ? { state: f.state.map((slot) => ({ name: slot.name, type: kotlinType(slot.type) })) } : {}),
    returnType: f.returnType.kind === "view" ? "Unit" : kotlinType(f.returnType),
    body:
      f.thread && f.thread !== "caller"
        ? [
            `return kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.${f.thread === "main" ? "Main" : "Default"}) {`,
            ...indent(body),
            "}",
          ]
        : body,
  };
}

class KotlinEmitter {
  private readonly mutable: ReadonlySet<string>;
  private readonly types: ReadonlyMap<string, NativeType>;
  private readonly returnKeyword: string;

  constructor(
    f: IRFunction,
    private readonly views: KotlinViewImports,
  ) {
    this.returnKeyword = f.thread && f.thread !== "caller" ? "return@withContext" : "return";
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
        return [s.value ? `${this.returnKeyword} ${this.expr(s.value)}` : this.returnKeyword];
      case "throw":
        return [
          `throw LucentError(${str(s.code)}${s.message ? `, message = ${this.expr(s.message)}` : ""}${s.metadata ? `, metadata = mapOf(${s.metadata.map((f) => `${str(f.name)} to ${this.expr(f.value)}`).join(", ")})` : ""})`,
        ];
      case "stateWrite":
        return [`lucentSet_${s.name}(${this.expr(s.value)})`];
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

  private forRows(e: Extract<IRExpr, { op: "view" }>): string {
    this.views.record(...FOR_IMPORTS);
    const data = e.props.find((prop) => prop.name === "each");
    const key = e.props.find((prop) => prop.name === "key");
    const child = e.children[0];
    if (!data || child?.op !== "closure" || Array.isArray(child.body) || !child.params[0])
      return "Spacer(modifier = Modifier)";
    const param = child.params[0].name;
    const source = this.expr(data.value);
    if (!key)
      return `Column { for (lucentIndex in ${source}.indices) { val ${param} = ${source}[lucentIndex]; ${this.expr(child.body)} } }`;
    return `Column { for (lucentRow in lucentKeyedRows(${source}, ${this.expr(key.value)})) { key(lucentRow.first) { val ${param} = lucentRow.second; ${this.expr(child.body)} } } }`;
  }

  private index(e: IRExpr): string {
    return e.type.kind === "int" && e.type.bits === 32 && e.type.signed ? this.expr(e) : `${this.expr(e)}.toInt()`;
  }

  expr(e: IRExpr): string {
    switch (e.op) {
      case "view":
        return e.name === "For" ? this.forRows(e) : kotlinView(e, (x) => this.expr(x), this.views);
      case "stateRead":
        return `lucentGet_${e.name}()`;
      case "stateWrite":
        return `lucentSet_${e.name}(${this.expr(e.value)})`;
      case "ifExpr":
        return `if (${this.expr(e.cond)}) ${this.expr(e.consequent)} else ${this.expr(e.alternate)}`;
      case "const":
        return e.type.kind === "enum" && typeof e.value === "string"
          ? kotlinEnumValue(e.type.binding, e.value)
          : constant(e.value, e.type);
      case "param":
        return e.name;
      case "local":
        return localName(e.id);
      case "widen":
        return `(${this.expr(e.value)}).to${kotlinType(e.type)}()`;
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
      case "weak":
        return `${e.name}_weak.get()`;
      case "closure": {
        const params = e.params.map((p) => `${p.name}: ${kotlinType(p.type)}`).join(", ");
        const closure = Array.isArray(e.body)
          ? `fun(${params}): ${e.type.kind === "callback" ? kotlinType(e.type.result) : "Unit"} {\n${indent(this.block(e.body)).join("\n")}\n}`
          : `{ ${params ? params + " -> " : ""}${this.expr(e.body)} }`;
        const weaks = e.captures.filter((capture) => capture.kind === "weak");
        if (!weaks.length) return closure;
        const refs = weaks
          .map((capture) => `val ${capture.name}_weak = java.lang.ref.WeakReference(${capture.name})`)
          .join("\n");
        return `run {\n${indent(`${refs}\n${closure}`.split("\n")).join("\n")}\n}`;
      }
      case "functionRef":
        return `::${e.name}`;
      case "invoke":
        return `${this.expr(e.callback)}(${e.args.map((a) => this.expr(a)).join(", ")})`;
      case "call":
        return `${e.callee}(${e.args.map((a) => this.expr(a)).join(", ")})`;
      case "await":
        return this.expr(e.value);
      case "field":
        return e.type.kind === "view" ? `${this.expr(e.object)}.${e.field}()` : `${this.expr(e.object)}.${e.field}`;
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
        return `${e.name}(${e.fields
          .map((f) => `${f.name} = ${f.value.type.kind === "view" ? `{ ${this.expr(f.value)} }` : this.expr(f.value)}`)
          .join(", ")})`;
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

/** Native namespace used by host view wrappers, independent of bridge types. */
export function generateKotlinNamespace(module: IRModule, name: string): string {
  const unit = generateKotlin(module);
  const members = [
    ...unit.structs
      .filter((s) => !s.reference)
      .map((s) => `data class ${s.name}(${s.fields.map((f) => `var ${f.name}: ${f.type}`).join(", ")})`),
    ...unit.functions.map((f) => block(`${signature(f)} {`, f.body)),
  ];
  return render(
    sections([
      unit.imports.map((i) => `import ${i}`),
      ...kotlinEnums(module.enums ?? {}),
      block(`object ${name} {`, sections(members)),
    ]),
  );
}
