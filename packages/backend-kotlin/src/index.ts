import { block, render, sections, type Doc } from "@lucent-lang/codegen";
import {
  printExpr as print,
  printStmts,
  type BinaryOp as KotlinBinaryOp,
  type KotlinArg,
  type KotlinExpr,
  type KotlinStmt,
} from "./ast.ts";
export * from "./ast.ts";
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
  /** Rendered at whatever depth the host places it. */
  body: Doc;
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
  // A binding body is verbatim Kotlin, so its `return` still needs the label rewritten.
  const hop = f.thread && f.thread !== "caller";
  const body: Doc = f.event
    ? `LucentEventHub.emit(${JSON.stringify(f.event.id)}, ${kotlinEventValue("payload", f.params[0]?.type ?? { kind: "void" }, module)})`
    : f.binding?.kotlin
      ? f.binding.kotlin.map((line) => (hop ? line.replace(/^(\s*)return\b/, "$1return@withContext") : line))
      : printStmts(emitter.block(f.body));
  return {
    name: f.name,
    ...(f.returnType.kind === "view" ? { view: true } : {}),
    exported: f.exported,
    async: f.async,
    params: f.params.map((p) => ({ name: p.name, type: kotlinType(p.type) })),
    ...(f.state?.length ? { state: f.state.map((slot) => ({ name: slot.name, type: kotlinType(slot.type) })) } : {}),
    returnType: f.returnType.kind === "view" ? "Unit" : kotlinType(f.returnType),
    body: hop
      ? block(
          `return kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.${f.thread === "main" ? "Main" : "Default"}) {`,
          body,
        )
      : body,
  };
}

class KotlinEmitter {
  private readonly mutable: ReadonlySet<string>;
  private readonly types: ReadonlyMap<string, NativeType>;
  /** A thread hop puts the body in a `withContext` lambda, so `return` needs its label. */
  private readonly returnLabel: string | undefined;

  constructor(
    f: IRFunction,
    private readonly views: KotlinViewImports,
  ) {
    this.returnLabel = f.thread && f.thread !== "caller" ? "@withContext" : undefined;
    this.mutable = new Set(f.locals.filter((l) => l.mutable).map((l) => l.id));
    this.types = new Map(f.locals.map((l) => [l.id, l.type]));
  }

  block(stmts: IRStmt[]): KotlinStmt[] {
    return stmts.map((s) => this.stmt(s));
  }

  private stmt(s: IRStmt): KotlinStmt {
    switch (s.op) {
      case "let":
        return {
          k: "let",
          mutable: this.mutable.has(s.id),
          name: localName(s.id),
          type: kotlinType(this.types.get(s.id)!),
          value: this.expr(s.value),
        };
      case "assign":
        return { k: "assign", target: this.place(s.target), value: this.expr(s.value) };
      case "if":
        return {
          k: "if",
          cond: this.expr(s.cond),
          consequent: this.block(s.consequent),
          alternate: this.block(s.alternate),
        };
      case "while":
        return { k: "while", cond: this.expr(s.cond), body: this.block(s.body) };
      case "forEach":
        return { k: "forIn", name: localName(s.id), seq: this.expr(s.iterable), body: this.block(s.body) };
      case "break":
        return { k: "break" };
      case "continue":
        return { k: "continue" };
      case "return":
        return {
          k: "return",
          ...(s.value ? { value: this.expr(s.value) } : {}),
          ...(this.returnLabel ? { label: this.returnLabel } : {}),
        };
      case "throw":
        return {
          k: "throwError",
          args: [
            { value: { k: "lit", text: str(s.code) } },
            ...(s.message ? [{ name: "message", value: this.expr(s.message) }] : []),
            ...(s.metadata
              ? [
                  {
                    name: "metadata",
                    value: call(ref("mapOf"), [
                      {
                        value: raw(s.metadata.map((f) => `${str(f.name)} to ${print(this.expr(f.value))}`).join(", ")),
                      },
                    ]),
                  },
                ]
              : []),
          ],
        };
      case "stateWrite":
        return { k: "expr", value: call(ref(`lucentSet_${s.name}`), [{ value: this.expr(s.value) }]) };
      case "expr":
        return { k: "expr", value: this.expr(s.value) };
      case "push":
        return {
          k: "expr",
          value: call({ k: "member", target: this.expr(s.array), name: "add" }, [{ value: this.expr(s.value) }]),
        };
    }
  }

  private place(p: IRPlace): KotlinExpr {
    switch (p.kind) {
      case "local":
        return ref(localName(p.id));
      case "field":
        return { k: "member", target: this.expr(p.object), name: p.field };
      case "index":
        return { k: "index", target: this.expr(p.object), key: this.index(p.index) };
    }
  }

  private forRows(e: Extract<IRExpr, { op: "view" }>): KotlinExpr {
    this.views.record(...FOR_IMPORTS);
    const data = e.props.find((prop) => prop.name === "each");
    const key = e.props.find((prop) => prop.name === "key");
    const child = e.children[0];
    if (!data || child?.op !== "closure" || Array.isArray(child.body) || !child.params[0])
      return raw("Spacer(modifier = Modifier)");
    const param = child.params[0].name;
    const source = print(this.expr(data.value));
    if (!key)
      return raw(
        `Column { for (lucentIndex in ${source}.indices) { val ${param} = ${source}[lucentIndex]; ${print(this.expr(child.body))} } }`,
      );
    return raw(
      `Column { for (lucentRow in lucentKeyedRows(${source}, ${print(this.expr(key.value))})) { key(lucentRow.first) { val ${param} = lucentRow.second; ${print(this.expr(child.body))} } } }`,
    );
  }

  /** Kotlin indexes with `Int`; only an `Int32` local already is one. */
  private index(e: IRExpr): KotlinExpr {
    return e.type.kind === "int" && e.type.bits === 32 && e.type.signed
      ? this.expr(e)
      : call({ k: "member", target: this.expr(e), name: "toInt" }, []);
  }

  expr(e: IRExpr): KotlinExpr {
    switch (e.op) {
      case "view":
        return e.name === "For" ? this.forRows(e) : raw(kotlinView(e, (x) => print(this.expr(x)), this.views));
      case "stateRead":
        return call(ref(`lucentGet_${e.name}`), []);
      case "stateWrite":
        return call(ref(`lucentSet_${e.name}`), [{ value: this.expr(e.value) }]);
      case "ifExpr":
        return {
          k: "ifExpr",
          cond: this.expr(e.cond),
          consequent: this.expr(e.consequent),
          alternate: this.expr(e.alternate),
        };
      case "const":
        return {
          k: "lit",
          text:
            e.type.kind === "enum" && typeof e.value === "string"
              ? kotlinEnumValue(e.type.binding, e.value)
              : constant(e.value, e.type),
        };
      case "param":
        return ref(e.name);
      case "local":
        return ref(localName(e.id));
      case "widen":
        return call({ k: "member", target: this.expr(e.value), name: `to${kotlinType(e.type)}` }, []);
      case "unwrap":
        return { k: "notNull", value: this.expr(e.value) };
      case "binary":
        return { k: "binary", op: BINARY[e.operator], left: this.expr(e.left), right: this.expr(e.right) };
      case "concat":
        return e.parts.map((p) => this.expr(p)).reduce((left, right) => ({ k: "binary", op: "+", left, right }));
      case "str":
        return call(ref("lucentStr"), [{ value: this.expr(e.value) }]);
      case "and":
        return { k: "binary", op: "&&", left: this.expr(e.left), right: this.expr(e.right) };
      case "or":
        return { k: "binary", op: "||", left: this.expr(e.left), right: this.expr(e.right) };
      case "not":
        return { k: "unary", op: "!", value: this.expr(e.value) };
      case "neg":
        return { k: "unary", op: "-", value: this.expr(e.value) };
      case "weak":
        return call({ k: "member", target: ref(`${e.name}_weak`), name: "get" }, []);
      case "closure": {
        const closure: KotlinExpr = Array.isArray(e.body)
          ? {
              k: "anonFun",
              fn: {
                params: e.params.map((p) => ({ name: p.name, type: kotlinType(p.type) })),
                result: e.type.kind === "callback" ? kotlinType(e.type.result) : "Unit",
                body: this.block(e.body),
              },
            }
          : {
              k: "lambda",
              lambda: {
                params: e.params.map((p) => `${p.name}: ${kotlinType(p.type)}`),
                body: this.expr(e.body),
              },
            };
        const weaks = e.captures.filter((capture) => capture.kind === "weak");
        if (!weaks.length) return closure;
        // A weak capture has to be materialised before the lambda closes over it.
        return {
          k: "run",
          body: [
            ...weaks.map((capture): KotlinStmt => ({
              k: "let",
              mutable: false,
              name: `${capture.name}_weak`,
              value: call(ref("java.lang.ref.WeakReference"), [{ value: ref(capture.name) }]),
            })),
            { k: "expr", value: closure },
          ],
        };
      }
      case "functionRef":
        return ref(`::${e.name}`);
      case "invoke":
        return call(
          this.expr(e.callback),
          e.args.map((a) => ({ value: this.expr(a) })),
        );
      case "call":
        return call(
          ref(e.callee),
          e.args.map((a) => ({ value: this.expr(a) })),
        );
      case "await":
        return this.expr(e.value);
      case "field":
        return e.type.kind === "view"
          ? call({ k: "member", target: this.expr(e.object), name: e.field }, [])
          : { k: "member", target: this.expr(e.object), name: e.field };
      case "length":
        return this.length(e.object);
      case "index":
        return e.object.type.kind === "bytes"
          ? call(ref("LucentBytes.get"), [{ value: this.expr(e.object) }, { value: this.expr(e.index) }])
          : { k: "index", target: this.expr(e.object), key: this.index(e.index) };
      case "mapGet":
        return { k: "index", target: this.expr(e.map), key: this.expr(e.key) };
      case "array": {
        const element = e.type.kind === "array" ? kotlinType(e.type.element) : "Any";
        return e.elements.length
          ? call(
              ref("mutableListOf"),
              e.elements.map((x) => ({ value: this.expr(x) })),
            )
          : call(ref(`mutableListOf<${element}>`), []);
      }
      case "struct":
        return call(
          ref(e.name),
          e.fields.map((f) => ({
            name: f.name,
            value:
              f.value.type.kind === "view"
                ? ({ k: "lambda", lambda: { params: [], body: this.expr(f.value) } } as KotlinExpr)
                : this.expr(f.value),
          })),
        );
    }
  }

  private length(object: IRExpr): KotlinExpr {
    const inner = this.expr(object);
    switch (object.type.kind) {
      case "string":
        return call({ k: "member", target: { k: "member", target: inner, name: "length" }, name: "toDouble" }, []);
      case "bytes":
        return call(ref("LucentBytes.length"), [{ value: inner }]);
      default:
        return call({ k: "member", target: { k: "member", target: inner, name: "size" }, name: "toDouble" }, []);
    }
  }
}

const BINARY = {
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
} as const satisfies Record<string, KotlinBinaryOp>;

const ref = (name: string): KotlinExpr => ({ k: "ref", name });
const raw = (text: string): KotlinExpr => ({ k: "raw", text });
const call = (callee: KotlinExpr, args: readonly KotlinArg[]): KotlinExpr => ({ k: "call", callee, args });

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
