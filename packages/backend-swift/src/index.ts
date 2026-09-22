import { block, render, sections, type Doc } from "@lucent-lang/codegen";
import {
  printExpr as print,
  printStmts,
  type BinaryOp,
  type Effect,
  type SwiftArg,
  type SwiftExpr,
  type SwiftStmt,
} from "./ast.ts";
export * from "./ast.ts";
import { fillNative } from "@lucent-lang/codegen";
import { swiftErrorWire } from "./errors.ts";
import { nativeSwift } from "./native.ts";
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
import { swiftEnumImports, swiftEnums, swiftEnumValue } from "./enums.ts";
export { swiftEnumBridge, swiftEnums, swiftEnumImports } from "./enums.ts";
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
  /** Rendered at whatever depth the host places it. */
  body: Doc;
}

export interface GeneratedUnit {
  /** Standalone source: structs and free functions, compilable against the runtime prelude. */
  code: string;
  imports: string[];
  structs: GeneratedStruct[];
  functions: GeneratedFunction[];
}

/** The plain-Swift LucentError used when no host supplies one (tests, verification). */
export const SWIFT_DEFAULT_ERROR = nativeSwift("LucentDefaultError.swift").trimEnd();

/** Runtime prelude; `bytes` supplies the host's `ArrayBuffer` accessors, `error` its LucentError type. */
export function swiftRuntime(
  bytes: { length: string; get: string; data?: string; fromData?: string },
  error: string = SWIFT_DEFAULT_ERROR,
): string {
  return fillNative(nativeSwift("LucentRuntime.swift"), {
    error,
    errorWire: swiftErrorWire,
    bytesData: bytes.data ?? "return Data(buffer)",
    bytesFromData: bytes.fromData ?? "return Array(data)",
    bytesLength: bytes.length,
    bytesGet: bytes.get,
  });
}

export const localName = (id: string): string => id.replace(/^%/, "").replace(/\./g, "_");

export function generateSwift(module: IRModule, options: SwiftOptions = {}): GeneratedUnit {
  const structs = module.structs.map((s) => generateStruct(s));
  const paramNames = new Map(module.functions.map((f) => [f.name, f.params.map((p) => p.name)]));
  const functions = module.functions.map((f) => generateFunction(f, paramNames, module, options));
  const imports = [
    ...new Set([
      ...Object.values(module.views ?? {}).flatMap((v) => v.swift.imports ?? []),
      ...module.functions.flatMap((f) =>
        f.binding?.platforms && !f.binding.platforms.includes("ios") ? [] : (f.binding?.swiftImports ?? []),
      ),
      ...(module.functions.some((f) => f.returnType.kind === "view") ? ["SwiftUI"] : []),
      ...swiftEnumImports(module),
    ]),
  ];
  const code = render(
    sections([
      imports.map((i) => `import ${i}`),
      ...swiftEnums(module.enums ?? {}),
      ...structs.map((s) =>
        s.reference ? swiftClass(module.structs.find((ir) => ir.name === s.name)!) : structDeclaration(s),
      ),
      ...functions.map((f) => block(`${signature(f)} {`, f.body)),
    ]),
  );
  return { code, structs, functions, imports };
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

export const structDeclaration = (s: GeneratedStruct): Doc =>
  block(
    `struct ${s.name} {`,
    s.fields.map((f) => `var ${f.name}: ${f.type}`),
  );

function generateStruct(s: IRStruct): GeneratedStruct {
  return {
    name: s.name,
    exported: s.exported,
    ...(s.reference ? { reference: true } : {}),
    fields: s.fields.map((f) => ({ name: f.name, type: swiftType(f.type) })),
  };
}

/**
 * `detachedCaptures` lists what a `@Background` hop must capture. Expo puts
 * bodies inside a module class, so its detached task captures `self`.
 */
export interface SwiftOptions {
  detachedCaptures?: readonly string[];
}

function generateFunction(
  f: IRFunction,
  paramNames: ReadonlyMap<string, string[]>,
  module: IRModule,
  options: SwiftOptions,
): GeneratedFunction {
  const detachedCaptures = options.detachedCaptures ?? [];
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
  const body: Doc = f.event
    ? `try LucentEventHub.shared.emit(${JSON.stringify(f.event.id)}, ${swiftEventValue("payload", f.params[0]?.type ?? { kind: "void" }, module)})`
    : f.binding?.swift
      ? [...f.binding.swift]
      : printStmts(emitter.block(f.body));
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
    body:
      f.thread === "worker"
        ? block(
            `return try await Task.detached {${detachedCaptures.length ? ` [${detachedCaptures.join(", ")}] in` : ""}`,
            body,
            "}.value",
          )
        : body,
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

  block(stmts: IRStmt[]): SwiftStmt[] {
    return stmts.map((s) => this.stmt(s));
  }

  private forRows(e: Extract<IRExpr, { op: "view" }>): SwiftExpr {
    const data = e.props.find((prop) => prop.name === "each");
    const key = e.props.find((prop) => prop.name === "key");
    const child = e.children[0];
    if (!data || child?.op !== "closure" || Array.isArray(child.body) || !child.params[0])
      return raw("AnyView(EmptyView())");
    const param = child.params[0].name;
    const rows = key
      ? `lucentKeyedRows(${print(this.expr(data.value))}, ${print(this.expr(key.value))})`
      : `Array(${print(this.expr(data.value))}.enumerated())`;
    const identity = key ? "\\.id" : "\\.offset";
    const bind = key ? `let ${param} = lucentRow.value` : `let ${param} = lucentRow.element`;
    return raw(
      `AnyView(VStack(alignment: .leading, spacing: 0) { ForEach(${rows}, id: ${identity}) { lucentRow in ${bind}; AnyView(${print(this.expr(child.body))}) } })`,
    );
  }

  private stmt(s: IRStmt): SwiftStmt {
    switch (s.op) {
      case "let":
        return {
          k: "let",
          mutable: this.mutable.has(s.id),
          name: localName(s.id),
          type: swiftType(this.types.get(s.id)!),
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
        return { k: "return", ...(s.value ? { value: this.expr(s.value) } : {}) };
      case "throw":
        return {
          k: "throwError",
          args: [
            { label: "code", value: { k: "lit", text: str(s.code) } },
            ...(s.message ? [{ label: "message", value: this.expr(s.message) }] : []),
            ...(s.metadata
              ? [
                  {
                    label: "metadata",
                    value: {
                      k: "dict" as const,
                      entries: s.metadata.map(
                        (f) =>
                          [
                            { k: "lit" as const, text: str(f.name) },
                            f.value.op === "const" && f.value.value === null
                              ? call(ref("lucentNull"), [])
                              : this.expr(f.value),
                          ] as const,
                      ),
                    },
                  },
                ]
              : []),
          ],
        };
      case "stateWrite":
        return { k: "expr", value: call(ref(`lucentSet_${s.name}`), [{ value: this.expr(s.value) }]) };
      case "expr":
        return { k: "discard", value: this.expr(s.value) };
      case "push":
        return {
          k: "expr",
          value: call({ k: "member", target: this.expr(s.array), name: "append" }, [{ value: this.expr(s.value) }]),
        };
    }
  }

  private place(p: IRPlace): SwiftExpr {
    switch (p.kind) {
      case "local":
        return ref(localName(p.id));
      case "field":
        return { k: "member", target: this.expr(p.object), name: p.field };
      case "index":
        return { k: "subscript", target: this.expr(p.object), index: this.index(p.index) };
    }
  }

  /** Swift subscripts want `Int`, while Lucent numbers arrive as `Double`. */
  private index(e: IRExpr): SwiftExpr {
    return call(ref("Int"), [{ value: this.expr(e) }]);
  }

  expr(e: IRExpr): SwiftExpr {
    switch (e.op) {
      case "view":
        return e.name === "For" ? this.forRows(e) : raw(swiftView(e, (x) => print(this.expr(x))));
      case "stateRead":
        return call(ref(`lucentGet_${e.name}`), []);
      case "stateWrite":
        return call(ref(`lucentSet_${e.name}`), [{ value: this.expr(e.value) }]);
      case "ifExpr":
        return e.type.kind === "view"
          ? raw(
              `AnyView(Group { if ${print(this.expr(e.cond))} { ${print(this.expr(e.consequent))} } else { ${print(this.expr(e.alternate))} } })`,
            )
          : {
              k: "ternary",
              cond: this.expr(e.cond),
              consequent: this.expr(e.consequent),
              alternate: this.expr(e.alternate),
            };
      case "const":
        return {
          k: "lit",
          text:
            e.type.kind === "enum" && typeof e.value === "string"
              ? swiftEnumValue(e.type.binding, e.value)
              : constant(e.value, e.type),
        };
      case "param":
        return ref(e.name);
      case "local":
        return ref(localName(e.id));
      case "widen":
        return call(ref(swiftType(e.type)), [{ value: this.expr(e.value) }]);
      case "unwrap":
        return { k: "force", value: this.expr(e.value) };
      case "binary":
        return this.binary(e);
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
        return ref(e.name);
      case "closure": {
        const result = e.type.kind === "callback" ? e.type.result : Array.isArray(e.body) ? e.type : e.body.type;
        return {
          k: "closure",
          closure: {
            captures: e.captures.filter((c) => c.kind === "weak").map((c) => `weak ${c.name}`),
            params: e.params.map((p) => ({ name: p.name, type: swiftType(p.type) })),
            result: swiftType(result),
            throws: true,
            body: Array.isArray(e.body) ? this.block(e.body) : this.expr(e.body),
          },
        };
      }
      case "functionRef":
        return ref(e.name);
      case "invoke":
        return call(
          this.expr(e.callback),
          e.args.map((a) => ({ value: this.expr(a) })),
          "throws",
        );
      case "call":
        return call(
          ref(e.callee),
          e.args.map((a, i) => ({ label: this.paramNames.get(e.callee)?.[i] ?? "_", value: this.expr(a) })),
          e.type.kind === "promise" ? "async" : e.type.kind === "view" ? "none" : "throws",
        );
      case "await":
        return this.expr(e.value);
      case "field":
        return { k: "member", target: this.expr(e.object), name: e.field };
      case "length":
        return this.length(e.object);
      case "index":
        return e.object.type.kind === "bytes"
          ? call(ref("LucentBytes.get"), [{ value: this.expr(e.object) }, { value: this.expr(e.index) }])
          : { k: "subscript", target: this.expr(e.object), index: this.index(e.index) };
      case "mapGet":
        return { k: "subscript", target: this.expr(e.map), index: this.expr(e.key) };
      case "array":
        return { k: "array", elements: e.elements.map((x) => this.expr(x)) };
      case "struct":
        return call(
          ref(e.name),
          e.fields.map((f) => ({ label: f.name, value: this.expr(f.value) })),
        );
    }
  }

  private length(object: IRExpr): SwiftExpr {
    const inner = this.expr(object);
    switch (object.type.kind) {
      case "string":
        return call(ref("Double"), [
          { value: { k: "member", target: { k: "member", target: inner, name: "utf16" }, name: "count" } },
        ]);
      case "bytes":
        return call(ref("LucentBytes.length"), [{ value: inner }]);
      default:
        return call(ref("Double"), [{ value: { k: "member", target: inner, name: "count" } }]);
    }
  }

  private binary(e: Extract<IRExpr, { op: "binary" }>): SwiftExpr {
    const left = this.expr(e.left);
    const right = this.expr(e.right);
    const isInt = e.left.type.kind === "int";
    // Lucent numbers wrap rather than trap, so integer arithmetic uses the `&` operators.
    const op = ARITHMETIC[e.operator];
    if (op) return { k: "binary", op: isInt ? op.int : op.float, left, right };
    if (e.operator === "rem" && !isInt)
      return call({ k: "member", target: left, name: "truncatingRemainder" }, [{ label: "dividingBy", value: right }]);
    return { k: "binary", op: COMPARISON[e.operator as keyof typeof COMPARISON], left, right };
  }
}

const ARITHMETIC: Partial<Record<string, { int: BinaryOp; float: BinaryOp }>> = {
  add: { int: "&+", float: "+" },
  sub: { int: "&-", float: "-" },
  mul: { int: "&*", float: "*" },
  div: { int: "/", float: "/" },
};

const COMPARISON = {
  rem: "%",
  lt: "<",
  le: "<=",
  gt: ">",
  ge: ">=",
  eq: "==",
  ne: "!=",
} as const satisfies Record<string, BinaryOp>;

const ref = (name: string): SwiftExpr => ({ k: "ref", name });
const raw = (text: string): SwiftExpr => ({ k: "raw", text });
const call = (callee: SwiftExpr, args: readonly SwiftArg[], effect: Effect = "none"): SwiftExpr => ({
  k: "call",
  callee,
  args,
  effect,
});

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
    ...unit.structs.filter((s) => !s.reference).map(structDeclaration),
    ...unit.functions.map((f) => block(`${signature(f).replace("func ", "static func ")} {`, f.body)),
  ];
  return render(
    sections([
      unit.imports.map((i) => `import ${i}`),
      ...swiftEnums(module.enums ?? {}),
      block(`enum ${name} {`, sections(members)),
    ]),
  );
}
