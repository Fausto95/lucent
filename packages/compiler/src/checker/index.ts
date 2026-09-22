import type { NativeBinding } from "../libraries.ts";
import { checkBoundaries } from "./boundaries.ts";
import { UI_PRIMITIVES } from "../ui.ts";
import { diagnostic, type Diagnostic, type Span } from "../diagnostics/index.ts";
import type { Expr, Stmt, SurfaceFunction, SurfaceModule, SurfaceType } from "../parser/surface.ts";
import {
  isNumeric,
  T,
  typeEquals,
  typeToString,
  type NativeEnumBinding,
  type NativeType,
} from "../types/native-type.ts";
import { resolveType, type TypeScope } from "../types/resolve.ts";
import type { StructDef, TExpr, TStmt, TypedFunction, TypedModule, TypedParam } from "./typed.ts";

export type * from "./typed.ts";

export interface CheckResult {
  module: TypedModule | null;
  diagnostics: Diagnostic[];
}

export const MAX_PARAMETERS = 8;

interface Signature {
  binding?: NativeBinding;
  params: TypedParam[];
  returnType: NativeType;
  async: boolean;
}

interface Binding {
  type: NativeType;
  mutable: boolean;
  /** The declaration already failed to type; uses of it must not cascade. */
  poisoned: boolean;
  borrowed?: boolean;
  /** View-owned scalar cell. Reads are live; writes go through `set`. */
  state?: true;
}

const MISMATCH = (expected: NativeType, actual: NativeType) =>
  `Expected \`${typeToString(expected)}\`, got \`${typeToString(actual)}\`.`;

const isOptional = (t: NativeType): t is Extract<NativeType, { kind: "optional" }> => t.kind === "optional";
const isPrimitive = (t: NativeType) => t.kind === "string" || t.kind === "bool" || isNumeric(t);

/** `from` may be stored where `to` is expected. */
function assignable(from: NativeType, to: NativeType): boolean {
  if (typeEquals(from, to)) return true;
  if (isOptional(to)) return assignable(from, to.value);
  return false;
}

export function checkModule(module: SurfaceModule): CheckResult {
  return new ModuleChecker(module).check();
}

class ModuleChecker {
  readonly diagnostics: Diagnostic[] = [];
  get overloads() {
    return this.module.overloads ?? {};
  }
  get views() {
    return this.module.views ?? {};
  }
  readonly structs = new Map<string, StructDef>();
  readonly enums = new Map<string, NativeEnumBinding>();
  /** Prefixed alias name → public enum name. */
  readonly enumAliases = new Map<string, string>();
  readonly signatures = new Map<string, Signature>();
  readonly typeScope: TypeScope;

  constructor(private readonly module: SurfaceModule) {
    const sized = new Set<string>();
    for (const imp of module.imports) for (const name of imp.names) sized.add(name);
    for (const alias of module.typeAliases) {
      if (!alias.enumeration) continue;
      const previous = this.enums.get(alias.enumeration.name);
      if (previous && JSON.stringify(previous) !== JSON.stringify(alias.enumeration.binding))
        this.report(
          diagnostic("LC1006", alias.span, `Two packages declare a different native enum ${alias.enumeration.name}.`),
        );
      this.enums.set(alias.enumeration.name, alias.enumeration.binding);
      this.enumAliases.set(alias.name, alias.enumeration.name);
    }
    this.typeScope = {
      structs: new Set(module.typeAliases.filter((a) => !a.enumeration).map((a) => a.name)),
      sized,
      enums: this.enums,
      enumAliases: this.enumAliases,
    };
  }

  report(d: Diagnostic): void {
    this.diagnostics.push(d);
  }

  resolve(type: SurfaceType): NativeType | null {
    const result = resolveType(type, this.typeScope);
    if (result.ok) return result.type;
    this.report(result.diagnostic);
    return null;
  }

  /** Resolves a type that is stored somewhere (field, local, param): promises are not storable. */
  resolveStorable(type: SurfaceType, what: string): NativeType | null {
    const resolved = this.resolve(type);
    if (resolved && resolved.kind === "promise") {
      this.report(
        diagnostic(
          "LC1003",
          type.span,
          `\`Promise\` is only supported as the return type of an async function, not as ${what}.`,
        ),
      );
      return null;
    }
    return resolved;
  }

  check(): CheckResult {
    this.collectStructs();
    this.collectSignatures();
    const functions: TypedFunction[] = [];
    for (const fn of this.module.functions) {
      const signature = this.signatures.get(fn.name);
      if (!signature) continue;
      const body = fn.binding || fn.event ? [] : new FunctionChecker(this, fn, signature).check();
      functions.push({
        name: fn.name,
        ...(fn.classOp ? { classOp: fn.classOp } : {}),
        ...(fn.thread ? { thread: fn.thread } : {}),
        ...(fn.event ? { event: fn.event } : {}),
        ...(fn.binding ? { binding: fn.binding } : {}),
        exported: fn.exported,
        async: fn.async,
        params: signature.params,
        returnType: signature.returnType,
        body,
        span: fn.span,
      });
    }
    this.diagnostics.push(...checkBoundaries(this.module, this.structs, functions));
    const name = this.module.fileName
      .replace(/^.*[\\/]/, "")
      .replace(/\.lucent\.tsx?$/, "")
      .replace(/\.ts$/, "");
    const typed: TypedModule = {
      ...(this.enums.size ? { enums: Object.fromEntries(this.enums) } : {}),
      ...(this.module.nativePackages ? { nativePackages: this.module.nativePackages } : {}),
      ...(this.module.views ? { views: this.module.views } : {}),
      name,
      fileName: this.module.fileName,
      structs: [...this.structs.values()],
      functions,
    };
    return { module: this.diagnostics.length ? null : typed, diagnostics: this.diagnostics };
  }

  private collectStructs(): void {
    const seen = new Set<string>();
    for (const alias of this.module.typeAliases) {
      if (seen.has(alias.name)) {
        this.report(diagnostic("LC1001", alias.span, `Duplicate type \`${alias.name}\`.`));
        continue;
      }
      seen.add(alias.name);
      if (alias.enumeration) continue;
      if (alias.type.kind === "union") {
        this.collectUnion(alias.name, alias.exported, alias.type);
        continue;
      }
      if (alias.type.kind !== "object") {
        this.report(
          diagnostic(
            "LC1003",
            alias.type.span,
            "Type aliases must be object types (structs).",
            "Only `type Name = { … }` has a native representation.",
          ),
        );
        continue;
      }
      if (alias.type.fields.some((f) => f.type.kind === "literal")) {
        this.collectUnion(alias.name, alias.exported, { kind: "union", members: [alias.type], span: alias.type.span });
        continue;
      }
      const fields: StructDef["fields"] = [];
      for (const field of alias.type.fields) {
        const type = this.resolveStorable(field.type, "a struct field");
        if (!type) continue;
        fields.push({ name: field.name, type: field.optional ? T.optional(type) : type });
      }
      this.structs.set(alias.name, {
        name: alias.name,
        exported: alias.exported,
        fields,
        ...(alias.reference ? { reference: alias.reference } : {}),
      });
    }
  }

  private collectUnion(name: string, exported: boolean, type: Extract<SurfaceType, { kind: "union" }>): void {
    const members = type.members.map((t) =>
      t.kind === "reference" ? this.module.typeAliases.find((a) => a.name === t.name)?.type : t,
    );
    if (members.some((m) => m?.kind !== "object")) {
      this.report(diagnostic("LC1003", type.span, "A discriminated union must contain record types."));
      return;
    }
    const records = members as Extract<SurfaceType, { kind: "object" }>[];
    const tag = records[0]?.fields.find(
      (f) =>
        !f.optional &&
        f.type.kind === "literal" &&
        records.every((r) => r.fields.some((g) => g.name === f.name && !g.optional && g.type.kind === "literal")),
    )?.name;
    if (!tag) {
      this.report(
        diagnostic("LC1003", type.span, "Union variants need a common required string-literal discriminant."),
      );
      return;
    }
    const variants: NonNullable<StructDef["union"]>["variants"] = [];
    const storage = new Map<string, NativeType>();
    for (const record of records) {
      const discriminator = record.fields.find((f) => f.name === tag)!.type as Extract<
        SurfaceType,
        { kind: "literal" }
      >;
      if (variants.some((v) => v.tag === discriminator.value))
        this.report(diagnostic("LC1011", discriminator.span, "Union tags must be unique."));
      const fields: StructDef["fields"] = [];
      for (const field of record.fields.filter((f) => f.name !== tag)) {
        const t = this.resolveStorable(field.type, "a union field");
        if (!t) continue;
        const value = field.optional ? T.optional(t) : t;
        const previous = storage.get(field.name);
        if (previous && !typeEquals(previous, value))
          this.report(diagnostic("LC1003", field.span, "Fields shared by variants must have the same type."));
        storage.set(field.name, value);
        fields.push({ name: field.name, type: value });
      }
      variants.push({ tag: discriminator.value, fields });
    }
    this.structs.set(name, {
      name,
      exported,
      union: { tag, variants },
      fields: [
        { name: tag, type: T.string },
        ...[...storage].map(([fieldName, t]) => ({ name: fieldName, type: T.optional(t) })),
      ],
    });
  }

  private collectSignatures(): void {
    for (const fn of this.module.functions) {
      if (fn.thread && fn.thread !== "caller" && !fn.async)
        this.report(diagnostic("LC1011", fn.span, "A thread hop requires an async function."));
      if (this.signatures.has(fn.name)) {
        this.report(diagnostic("LC1001", fn.span, `Duplicate function \`${fn.name}\`.`));
        continue;
      }
      if (fn.params.length > MAX_PARAMETERS) {
        this.report(
          diagnostic(
            "LC1007",
            fn.span,
            `\`${fn.name}\` has ${fn.params.length} parameters; native functions take at most ${MAX_PARAMETERS}.`,
            "Group related parameters into a struct.",
          ),
        );
      }
      const params: TypedParam[] = [];
      let valid = fn.params.length <= MAX_PARAMETERS;
      for (const param of fn.params) {
        if (!param.type) {
          this.report(
            diagnostic(
              "LC1014",
              param.span,
              `Parameter \`${param.name}\` needs a type annotation.`,
              "Every value crossing the native boundary must have a declared type.",
            ),
          );
          valid = false;
          continue;
        }
        const type = this.resolveStorable(param.type, "a parameter");
        if (!type) {
          valid = false;
          continue;
        }
        params.push({ name: param.name, type: param.optional ? T.optional(type) : type });
      }
      const returnType = this.returnTypeOf(fn);
      if (!returnType) valid = false;
      if (
        returnType?.kind === "view" &&
        (fn.async || params.length > 1 || (params.length === 1 && params[0]!.type.kind !== "struct"))
      ) {
        this.report(
          diagnostic("LC1011", fn.span, "A native view is synchronous and accepts one props record or no parameters."),
        );
      }
      if (returnType?.kind === "view" && params[0]?.type.kind === "struct") {
        const props = this.structs.get(params[0].type.name)!;
        if (
          props.union ||
          props.fields.some((p) => {
            const t = p.type.kind === "optional" ? p.type.value : p.type;
            return !(
              (p.type.kind === "event" &&
                t.kind === "event" &&
                ["void", "string", "bool", "float"].includes(t.payload.kind)) ||
              t.kind === "string" ||
              t.kind === "bool" ||
              (t.kind === "float" && t.bits === 64) ||
              (t.kind === "array" &&
                (t.element.kind === "string" ||
                  t.element.kind === "bool" ||
                  (t.element.kind === "float" && t.element.bits === 64)))
            );
          })
        )
          this.report(
            diagnostic(
              "LC1011",
              fn.span,
              "Native view props support string, number, boolean, arrays of those, and nullable values.",
            ),
          );
      }
      if (valid && returnType)
        this.signatures.set(fn.name, {
          ...(fn.binding ? { binding: fn.binding } : {}),
          params,
          returnType,
          async: fn.async,
        });
    }
  }

  private returnTypeOf(fn: SurfaceFunction): NativeType | null {
    if (!fn.returnType) {
      this.report(
        diagnostic(
          "LC1014",
          fn.span,
          `\`${fn.name}\` needs a return type annotation.`,
          fn.async ? "Declare `Promise<T>` (or `Promise<void>`)." : "Declare the return type, or `void`.",
        ),
      );
      return null;
    }
    const resolved = this.resolve(fn.returnType);
    if (!resolved) return null;
    if (fn.async && resolved.kind !== "promise") {
      this.report(
        diagnostic(
          "LC1011",
          fn.returnType.span,
          `Async function \`${fn.name}\` must return \`Promise<${typeToString(resolved)}>\`.`,
        ),
      );
      return null;
    }
    if (!fn.async && resolved.kind === "promise") {
      this.report(
        diagnostic(
          "LC1011",
          fn.returnType.span,
          `\`${fn.name}\` returns a Promise but is not \`async\`.`,
          "Mark the function `async`.",
        ),
      );
      return null;
    }
    return resolved.kind === "promise" ? resolved.value : resolved;
  }
}

class FunctionChecker {
  private readonly scopes: Map<string, Binding>[] = [];
  private readonly narrowings: Map<string, NativeType>[] = [];
  private loopDepth = 0;
  private suspended = false;
  private closed = new Set<string>();
  private readonly captures: Map<string, Binding>[] = [];
  private readonly recordedCaptures: { name: string; kind: "value" | "retained" | "borrowed" | "weak" }[][] = [];
  /** True unless the closure being typed is a direct `retention: "call"` argument. */
  private nextCallbackEscaping = true;
  private readonly closureEscaping: boolean[] = [];
  private expectedReturn: NativeType;
  /** Nested statements cannot introduce view state; only the component body can. */
  private depth = 0;

  constructor(
    private readonly mod: ModuleChecker,
    private readonly fn: SurfaceFunction,
    private readonly signature: Signature,
  ) {
    this.expectedReturn = signature.returnType;
  }

  check(): TStmt[] {
    this.push();
    for (const p of this.signature.params)
      this.declare(
        p.name,
        p.type,
        true,
        false,
        this.fn.binding?.contract?.parameters?.[p.name]?.ownership === "borrowed",
      );
    const body = this.fn.body.map((s) => this.stmt(s));
    this.pop();
    if (this.signature.returnType.kind !== "void" && !alwaysExits(body)) {
      this.mod.report(
        diagnostic(
          "LC1015",
          this.fn.span,
          `\`${this.fn.name}\` must return a \`${typeToString(this.signature.returnType)}\` on every path.`,
        ),
      );
    }
    if (this.signature.returnType.kind === "view") {
      const visit = (node: unknown): void => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          node.forEach(visit);
          return;
        }
        const item = node as Record<string, unknown>;
        if (item.kind === "closure") return;
        if (
          [
            "assign",
            "update",
            "throw",
            "await",
            "invoke",
            "methodCall",
            "stateWrite",
            "while",
            "for",
            "forOf",
          ].includes(String(item.kind)) ||
          (item.kind === "call" && (item as unknown as TExpr).type.kind !== "view")
        ) {
          this.report(
            diagnostic(
              "LC1011",
              this.fn.span,
              "Native rendering must be pure: move effects and native operations to event handlers.",
            ),
          );
          return;
        }
        for (const [key, value] of Object.entries(item)) if (key !== "type" && key !== "span") visit(value);
      };
      visit(body);
    }
    return body;
  }

  // ---- scopes ----------------------------------------------------------------

  private push(): void {
    this.scopes.push(new Map());
    this.narrowings.push(new Map());
  }

  private pop(): void {
    this.scopes.pop();
    this.narrowings.pop();
  }

  private declare(name: string, type: NativeType, mutable: boolean, poisoned = false, borrowed = false): void {
    this.scopes[this.scopes.length - 1]!.set(name, { type, mutable, poisoned, ...(borrowed ? { borrowed } : {}) });
  }

  private rejectBorrow(value: TExpr, span: Span, reason: string): void {
    if (value.borrowed) this.mod.report(diagnostic("LC1018", span, `A borrowed value cannot ${reason}.`));
  }

  /** Run a branch without leaking its close/suspension effects, then return those effects. */
  private isolate(run: () => TStmt[]): { stmts: TStmt[]; closed: string[]; suspended: boolean } {
    const closedBefore = new Set(this.closed);
    const suspendedBefore = this.suspended;
    const stmts = run();
    const closed = [...this.closed].filter((name) => !closedBefore.has(name));
    const suspended = this.suspended;
    this.closed = closedBefore;
    this.suspended = suspendedBefore;
    return { stmts, closed, suspended };
  }

  private enforceExecutor(signature: Signature, span: Span, receiver?: TExpr): void {
    const declared = signature.binding?.contract?.executor;
    const object =
      receiver?.type.kind === "struct"
        ? this.mod.structs.get(receiver.type.name)?.reference?.native?.contract?.executor
        : undefined;
    const required = declared && declared !== "caller" ? declared : object;
    if (!required || required === "caller") return;
    const actual = this.fn.thread ?? "caller";
    if (required === "serial") {
      if (actual !== "caller")
        this.mod.report(diagnostic("LC1019", span, "A serial object cannot move to another executor."));
      return;
    }
    if (required !== actual)
      this.mod.report(diagnostic("LC1019", span, `This call must run on the ${required} executor.`));
  }

  private lookup(name: string): Binding | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const b = this.scopes[i]!.get(name);
      if (b) return b;
    }
    return undefined;
  }

  private narrowed(name: string): NativeType | undefined {
    for (let i = this.narrowings.length - 1; i >= 0; i--) {
      const t = this.narrowings[i]!.get(name);
      if (t) return t;
    }
    return undefined;
  }

  private clearNarrowing(name: string): void {
    for (const layer of this.narrowings) layer.delete(name);
  }

  private report(d: Diagnostic): void {
    this.mod.report(d);
  }

  /** A placeholder for an expression that failed to type; keeps checking going without cascades. */
  private poison(span: Span, type: NativeType = T.float64): TExpr {
    return { kind: "number", value: 0, type, span, poisoned: true };
  }

  /** `assignable`, but a poisoned expression always fits (its error was already reported). */
  private fits(expr: TExpr, expected: NativeType): boolean {
    return expr.poisoned === true || assignable(expr.type, expected);
  }

  private mismatch(span: Span, expected: NativeType, actual: NativeType, help?: string): TExpr {
    this.report(diagnostic("LC1011", span, MISMATCH(expected, actual), help));
    return this.poison(span, expected);
  }

  // ---- statements ------------------------------------------------------------

  private block(stmts: Stmt[]): TStmt[] {
    return this.nest(() => {
      this.push();
      const out = stmts.map((s) => this.stmt(s));
      this.pop();
      return out;
    });
  }

  private nest<T>(run: () => T): T {
    this.depth++;
    const result = run();
    this.depth--;
    return result;
  }

  private stmt(s: Stmt): TStmt {
    switch (s.kind) {
      case "variable":
        return this.variable(s);
      case "if":
        return this.ifStmt(s);
      case "while": {
        const test = this.condition(s.test);
        this.loopDepth++;
        const body = this.block(s.body);
        this.loopDepth--;
        return { kind: "while", test, body, span: s.span };
      }
      case "for":
        return this.nest(() => {
          this.push();
          const init = s.init ? this.stmt(s.init) : null;
          const test = s.test ? this.condition(s.test) : null;
          const update = s.update ? this.expr(s.update) : null;
          this.loopDepth++;
          const body = this.block(s.body);
          this.loopDepth--;
          this.pop();
          return { kind: "for" as const, init, test, update, body, span: s.span };
        });
      case "forOf": {
        const iterable = this.expr(s.iterable);
        const elementType = iterable.type.kind === "array" ? iterable.type.element : null;
        if (!elementType && !iterable.poisoned)
          this.report(
            diagnostic("LC1011", s.iterable.span, `\`for…of\` needs an array, got \`${typeToString(iterable.type)}\`.`),
          );
        this.push();
        this.declare(s.variable, elementType ?? T.float64, false);
        this.loopDepth++;
        const body = this.block(s.body);
        this.loopDepth--;
        this.pop();
        return {
          kind: "forOf",
          variable: s.variable,
          elementType: elementType ?? T.float64,
          iterable,
          body,
          span: s.span,
        };
      }
      case "return":
        return this.returnStmt(s);
      case "break":
      case "continue":
        if (this.loopDepth === 0) this.report(diagnostic("LC1001", s.span, `\`${s.kind}\` outside a loop.`));
        return { kind: s.kind, span: s.span };
      case "throw": {
        const message = s.message ? this.expr(s.message, T.string) : null;
        if (message && !this.fits(message, T.string))
          this.report(
            diagnostic(
              "LC1011",
              s.message!.span,
              `LucentError message must be a string, got \`${typeToString(message.type)}\`.`,
            ),
          );
        const metadata = s.metadata?.map((field) => ({
          name: field.name,
          value: this.expr(field.value, field.value.kind === "null" ? T.optional(T.string) : undefined),
        }));
        for (const field of metadata ?? []) {
          if (field.value.kind !== "null" && !["string", "bool", "float", "int"].includes(field.value.type.kind))
            this.report(diagnostic("LC1011", field.value.span, "Error metadata must contain scalar values."));
        }
        return { kind: "throw", code: s.code, message, ...(metadata ? { metadata } : {}), span: s.span };
      }
      case "expression":
        return { kind: "expression", expression: this.expr(s.expression), span: s.span };
      case "block":
        return { kind: "block", body: this.block(s.body), span: s.span };
      case "unsupported":
        return { kind: "block", body: [], span: s.span };
    }
  }

  private variable(s: Extract<Stmt, { kind: "variable" }>): TStmt {
    if (s.init?.kind === "call" && s.init.callee === "state") return this.stateVariable(s);
    const declared = s.type ? this.mod.resolveStorable(s.type, "a local variable") : null;
    let init: TExpr;
    let type: NativeType;
    if (!s.init) {
      this.report(
        diagnostic(
          "LC1014",
          s.span,
          `\`${s.name}\` must be initialized so its type is known.`,
          "Write `let x: T = …` or give it a value.",
        ),
      );
      type = declared ?? T.float64;
      init = this.poison(s.span, type);
    } else if (declared) {
      init = this.expr(s.init, declared);
      if (!this.fits(init, declared)) init = this.mismatch(s.init.span, declared, init.type);
      type = declared;
    } else {
      init = this.expr(s.init);
      type = init.type;
      if (!init.poisoned && init.type.kind === "promise")
        this.report(diagnostic("LC1003", s.init.span, "A Promise cannot be stored; `await` it instead."));
    }
    this.declare(s.name, type, s.declaration === "let", init.poisoned === true, init.borrowed === true);
    return { kind: "variable", declaration: s.declaration, name: s.name, type, init, span: s.span };
  }

  private stateVariable(s: Extract<Stmt, { kind: "variable" }>): TStmt {
    const initExpr = s.init;
    const arg = initExpr?.kind === "call" ? initExpr.args[0] : undefined;
    const invalid =
      this.signature.returnType.kind !== "view" ||
      this.depth !== 0 ||
      s.declaration !== "const" ||
      s.type !== null ||
      !arg ||
      initExpr?.kind !== "call" ||
      initExpr.args.length !== 1;
    if (invalid || !arg) {
      this.report(diagnostic("LC1001", s.span, "`state()` declares one const scalar at the top of a native view."));
      this.declare(s.name, T.float64, false, true);
      return {
        kind: "variable",
        declaration: s.declaration,
        name: s.name,
        type: T.float64,
        init: this.poison(s.span),
        span: s.span,
      };
    }
    const value = this.expr(arg);
    const literal = value.kind === "number" || value.kind === "string" || value.kind === "boolean";
    if (!literal || value.poisoned) {
      this.report(diagnostic("LC1001", arg.span, "`state()` requires a number, string, or boolean literal."));
      this.declare(s.name, T.float64, false, true);
      return {
        kind: "variable",
        declaration: "const",
        name: s.name,
        type: T.float64,
        init: this.poison(s.span),
        span: s.span,
      };
    }
    this.declare(s.name, value.type, false);
    const binding = this.lookup(s.name);
    if (binding) binding.state = true;
    return {
      kind: "variable",
      declaration: "const",
      name: s.name,
      type: value.type,
      init: { kind: "stateInit", value, type: value.type, span: s.span },
      span: s.span,
    };
  }

  private returnStmt(s: Extract<Stmt, { kind: "return" }>): TStmt {
    const expected = this.expectedReturn;
    if (!s.argument) {
      if (expected.kind !== "void")
        this.report(diagnostic("LC1011", s.span, `\`${this.fn.name}\` must return a \`${typeToString(expected)}\`.`));
      return { kind: "return", argument: null, span: s.span };
    }
    if (expected.kind === "void") {
      this.report(
        diagnostic("LC1011", s.argument.span, `\`${this.fn.name}\` returns \`void\` and cannot return a value.`),
      );
      return { kind: "return", argument: null, span: s.span };
    }
    let argument = this.expr(s.argument, expected);
    if (!this.fits(argument, expected))
      argument = this.mismatch(s.argument.span, expected, argument.type, narrowingHint(argument.type));
    this.rejectBorrow(argument, s.argument.span, "be returned");
    return { kind: "return", argument, span: s.span };
  }

  private condition(e: Expr): TExpr {
    const test = this.expr(e, T.bool);
    if (!test.poisoned && test.type.kind !== "bool")
      return this.mismatch(
        e.span,
        T.bool,
        test.type,
        "Lucent has no truthiness: compare explicitly, e.g. `x !== 0` or `s.length > 0`.",
      );
    return test;
  }

  private ifStmt(s: Extract<Stmt, { kind: "if" }>): TStmt {
    const test = this.condition(s.test);
    const narrowing = narrowingOf(test, this.mod.structs);
    const consequent = this.isolate(() => this.nest(() => this.branch(s.consequent, narrowing?.whenTrue)));
    const alternateSource = s.alternate;
    const alternate = alternateSource
      ? this.isolate(() => this.nest(() => this.branch(alternateSource, narrowing?.whenFalse)))
      : null;
    for (const name of consequent.closed) this.closed.add(name);
    for (const name of alternate?.closed ?? []) this.closed.add(name);
    if (consequent.suspended || alternate?.suspended) this.suspended = true;
    // `if (x === null) return …;` narrows the rest of the enclosing block.
    if (narrowing) {
      const rest = alwaysExits(consequent.stmts)
        ? narrowing.whenFalse
        : alternate && alwaysExits(alternate.stmts)
          ? narrowing.whenTrue
          : undefined;
      if (rest) this.narrowings[this.narrowings.length - 1]!.set(narrowing.name, rest.type);
    }
    return { kind: "if", test, consequent: consequent.stmts, alternate: alternate?.stmts ?? null, span: s.span };
  }

  private branch(stmts: Stmt[], narrowing: { name: string; type: NativeType } | undefined): TStmt[] {
    this.push();
    if (narrowing) this.narrowings[this.narrowings.length - 1]!.set(narrowing.name, narrowing.type);
    const out = stmts.map((s) => this.stmt(s));
    this.pop();
    return out;
  }

  // ---- expressions -----------------------------------------------------------

  /** Types an expression; `expected` lets literals, `null`, `[]` and `{}` adopt their context. */
  private expr(e: Expr, expected?: NativeType): TExpr {
    const span = e.span;
    switch (e.kind) {
      case "closure": {
        const escaping = this.nextCallbackEscaping;
        this.nextCallbackEscaping = true;
        this.closureEscaping.push(escaping);
        const context = expected?.kind === "callback" ? expected : undefined;
        const params = e.params.map((p, i) => ({
          name: p.name,
          type: p.type
            ? (this.mod.resolveStorable(p.type, "a callback parameter") ?? T.float64)
            : (context?.params[i] ?? T.float64),
          span: p.span,
        }));
        if (e.params.some((p, i) => !p.type && !context?.params[i]))
          this.report(
            diagnostic("LC1014", e.span, "Native callback parameters need a type annotation or callback context."),
          );
        const result = e.returnType ? this.mod.resolve(e.returnType) : context?.result;
        const outer = new Map<string, Binding>();
        for (const scope of this.scopes) for (const [name, binding] of scope) outer.set(name, binding);
        for (const param of params) outer.delete(param.name);
        this.recordedCaptures.push([]);
        this.captures.push(outer);
        this.depth++;
        this.push();
        for (const param of params) this.declare(param.name, param.type, false);
        const statements = Array.isArray(e.body);
        if (statements && !result)
          this.report(diagnostic("LC1014", e.span, "A native callback with a statement body needs a return type."));
        const savedReturn = this.expectedReturn;
        if (statements) this.expectedReturn = result ?? T.void;
        let body: TExpr | TStmt[];
        if (Array.isArray(e.body)) body = e.body.map((statement) => this.stmt(statement));
        else body = this.expr(e.body, result ?? undefined);
        this.expectedReturn = savedReturn;
        this.pop();
        this.depth--;
        this.captures.pop();
        this.closureEscaping.pop();
        const captures = this.recordedCaptures.pop() ?? [];
        const returnType = result ?? (Array.isArray(body) ? T.void : body.type);
        const type = T.callback(
          params.map((p) => p.type),
          returnType,
        );
        if (!Array.isArray(body)) {
          if (result && !this.fits(body, result)) this.mismatch(e.span, result, body.type);
          if (body.type.kind === "promise" || body.type.kind === "callback")
            this.report(diagnostic("LC1005", e.span, "Native closures must return synchronous non-callback values."));
        } else if (returnType.kind !== "void" && !alwaysExits(body)) {
          this.report(diagnostic("LC1015", e.span, "A native callback must return on every path."));
        }
        return { kind: "closure", params, captures, body, type, span: e.span };
      }
      case "view":
        return this.view(e);
      case "number":
        return this.numberLiteral(e, expected);
      case "string": {
        const context = expected && isOptional(expected) ? expected.value : expected;
        if (context?.kind === "enum") {
          if (!context.binding.cases.includes(e.value))
            return this.mismatch(
              span,
              context,
              T.string,
              `\`${e.value}\` is not a case of ${context.name}. Cases: ${context.binding.cases.map((c) => `"${c}"`).join(", ")}.`,
            );
          return { kind: "string", value: e.value, type: context, span };
        }
        return { kind: "string", value: e.value, type: T.string, span };
      }
      case "boolean":
        return { kind: "boolean", value: e.value, type: T.bool, span };
      case "null":
      case "undefined": {
        if (!expected || !isOptional(expected)) {
          this.report(
            diagnostic(
              "LC1014",
              span,
              `Cannot infer the type of \`${e.kind}\` here.`,
              "Annotate the variable: `let x: T | null = null`.",
            ),
          );
          return this.poison(span);
        }
        return { kind: "null", type: expected, span };
      }
      case "template": {
        const expressions = e.expressions.map((x) => {
          const t = this.expr(x);
          if (!t.poisoned && !isPrimitive(t.type))
            this.report(
              diagnostic(
                "LC1011",
                x.span,
                `Only strings, numbers and booleans can be interpolated, got \`${typeToString(t.type)}\`.`,
              ),
            );
          return t;
        });
        return { kind: "template", quasis: e.quasis, expressions, type: T.string, span };
      }
      case "array":
        return this.arrayLiteral(e, expected);
      case "object":
        return this.objectLiteral(e, expected);
      case "identifier":
        return this.identifier(e.name, span);
      case "binary":
        return this.binary(e);
      case "conditional": {
        const test = this.condition(e.test);
        const consequent = this.expr(e.consequent);
        const alternate = this.expr(e.alternate);
        if (consequent.poisoned || alternate.poisoned) return this.poison(span, T.view);
        if (consequent.type.kind === "view" || alternate.type.kind === "view") {
          if (consequent.type.kind !== "view" || alternate.type.kind !== "view")
            return this.mismatch(e.span, T.view, consequent.type.kind === "view" ? alternate.type : consequent.type);
          return { kind: "conditional", test, consequent, alternate, type: T.view, span };
        }
        if (!typeEquals(consequent.type, alternate.type))
          return this.mismatch(e.alternate.span, consequent.type, alternate.type);
        return { kind: "conditional", test, consequent, alternate, type: consequent.type, span };
      }
      case "logical": {
        const left = this.expr(e.left, T.bool);
        const right = this.expr(e.right, T.bool);
        if (!left.poisoned && left.type.kind !== "bool") return this.mismatch(e.left.span, T.bool, left.type);
        if (!right.poisoned && right.type.kind !== "bool") return this.mismatch(e.right.span, T.bool, right.type);
        return { kind: "logical", operator: e.operator, left, right, type: T.bool, span };
      }
      case "unary": {
        const argument = this.expr(e.argument, e.operator === "!" ? T.bool : expected);
        if (argument.poisoned) return this.poison(span, argument.type);
        if (e.operator === "!" && argument.type.kind !== "bool")
          return this.mismatch(e.argument.span, T.bool, argument.type);
        if (e.operator === "-" && !isNumeric(argument.type))
          return this.mismatch(e.argument.span, T.float64, argument.type);
        return { kind: "unary", operator: e.operator, argument, type: argument.type, span };
      }
      case "assign":
        return this.assign(e);
      case "update": {
        const target = this.target(e.target);
        if (!target.poisoned && !isNumeric(target.type)) return this.mismatch(e.target.span, T.float64, target.type);
        return { kind: "update", operator: e.operator, target, type: target.type, span };
      }
      case "call":
        return this.call(e);
      case "member":
        return this.member(e);
      case "index":
        return this.index(e);
      case "methodCall":
        return this.methodCall(e);
      case "await": {
        if (!this.fn.async)
          this.report(diagnostic("LC1013", span, "`await` is only allowed inside an `async` function."));
        const argument = this.expr(e.argument);
        this.suspended = true;
        if (argument.poisoned) return this.poison(span, expected);
        if (argument.type.kind !== "promise") {
          this.report(
            diagnostic(
              "LC1011",
              e.argument.span,
              `Cannot await \`${typeToString(argument.type)}\`.`,
              "Only the result of calling an async function can be awaited.",
            ),
          );
          return this.poison(span, expected);
        }
        return { kind: "await", argument, type: argument.type.value, span };
      }
      case "unsupported":
        return this.poison(span, expected);
    }
  }

  private view(e: Extract<Expr, { kind: "view" }>): TExpr {
    if (e.name === "__ui_For") return this.forView(e);
    const native = this.mod.views[e.name];
    const primitive = native ?? (e.name.startsWith("__ui_") ? UI_PRIMITIVES[e.name.slice(5)] : undefined);
    if (!primitive) {
      const signature = this.mod.signatures.get(e.name);
      if (!signature || signature.returnType.kind !== "view") {
        this.report(diagnostic("LC1010", e.span, `Unknown native view ${e.name}.`));
        return this.poison(e.span, T.view);
      }
      if (e.children.length)
        this.report(diagnostic("LC1001", e.span, "Custom native view children are not supported; use typed props."));
      return this.call({
        kind: "call",
        callee: e.name,
        args: signature.params.length ? [{ kind: "object", properties: e.properties, span: e.span }] : [],
        span: e.span,
      });
    }
    const seen = new Set<string>();
    const properties = e.properties.map((p) => {
      const type = primitive.props[p.name];
      if (!type || seen.has(p.name))
        this.report(diagnostic("LC1011", p.span, `Unknown or duplicate ${e.name} prop ${p.name}.`));
      seen.add(p.name);
      const value = this.expr(p.value, type);
      const eventHandler =
        type?.kind === "event" &&
        value.type.kind === "callback" &&
        value.type.result.kind === "void" &&
        (type.payload.kind === "void"
          ? value.type.params.length === 0
          : value.type.params.length === 1 && typeEquals(value.type.params[0]!, type.payload));
      if (type && !this.fits(value, type) && !eventHandler) this.mismatch(p.span, type, value.type);
      return { name: p.name, value };
    });
    for (const name of primitive.required ?? [])
      if (!seen.has(name)) this.report(diagnostic("LC1011", e.span, `Missing ${name} prop.`));
    const children = e.children.map((c) => {
      const child = this.expr(c);
      if (primitive.children === "text" && isPrimitive(child.type))
        return { kind: "template" as const, quasis: ["", ""], expressions: [child], type: T.string, span: c.span };
      if (primitive.children !== "views" || child.type.kind !== "view")
        this.report(diagnostic("LC1011", c.span, `Invalid child for ${e.name}.`));
      return child;
    });
    return {
      kind: "view",
      ...(native ? { native } : {}),
      name: native ? e.name : e.name.slice(5),
      properties,
      children,
      type: T.view,
      span: e.span,
    };
  }

  private numberLiteral(e: Extract<Expr, { kind: "number" }>, expected: NativeType | undefined): TExpr {
    const context = expected && isOptional(expected) ? expected.value : expected;
    let type: NativeType = T.float64;
    if (context?.kind === "int") {
      if (!Number.isInteger(e.value))
        return this.mismatch(e.span, context, T.float64, `\`${e.value}\` is not an integer.`);
      type = context;
    } else if (context?.kind === "float") {
      type = context;
    }
    return { kind: "number", value: e.value, type, span: e.span };
  }

  private arrayLiteral(e: Extract<Expr, { kind: "array" }>, expected: NativeType | undefined): TExpr {
    const context = expected && isOptional(expected) ? expected.value : expected;
    const elementContext = context?.kind === "array" ? context.element : undefined;
    if (e.elements.length === 0 && !elementContext) {
      this.report(
        diagnostic(
          "LC1014",
          e.span,
          "Cannot infer the element type of an empty array.",
          "Annotate the variable: `const xs: number[] = []`.",
        ),
      );
      return this.poison(e.span, T.array(T.float64));
    }
    const elements: TExpr[] = [];
    let elementType = elementContext;
    for (const el of e.elements) {
      const t = this.expr(el, elementType);
      if (!elementType) elementType = t.type;
      else if (!this.fits(t, elementType)) this.report(diagnostic("LC1011", el.span, MISMATCH(elementType, t.type)));
      this.rejectBorrow(t, el.span, "be stored in an array");
      elements.push(t);
    }
    return { kind: "array", elements, type: T.array(elementType!), span: e.span };
  }

  private objectLiteral(e: Extract<Expr, { kind: "object" }>, expected: NativeType | undefined): TExpr {
    const context = expected && isOptional(expected) ? expected.value : expected;
    const struct = context?.kind === "struct" ? this.mod.structs.get(context.name) : undefined;
    if (!struct) {
      this.report(
        diagnostic(
          "LC1014",
          e.span,
          "An object literal needs a struct type from its context.",
          "Annotate the variable: `const u: User = { … }`.",
        ),
      );
      return this.poison(e.span, context);
    }
    const union = struct.union;
    const tag = union ? e.properties.find((p) => p.name === union.tag)?.value : undefined;
    const variant = union?.variants.find((v) => tag?.kind === "string" && v.tag === tag.value);
    if (union && !variant) {
      this.report(diagnostic("LC1011", e.span, "Union construction needs a known literal tag."));
      return this.poison(e.span, context);
    }
    const expectedFields = variant ? [{ name: union!.tag, type: T.string }, ...variant.fields] : struct.fields;
    const properties: { name: string; value: TExpr }[] = [];
    const seen = new Set<string>();
    for (const prop of e.properties) {
      const field = expectedFields.find((f) => f.name === prop.name);
      if (!field) {
        this.report(diagnostic("LC1011", prop.span, `\`${struct.name}\` has no field \`${prop.name}\`.`));
        continue;
      }
      seen.add(prop.name);
      let value = this.expr(prop.value, field.type);
      if (!this.fits(value, field.type)) value = this.mismatch(prop.value.span, field.type, value.type);
      this.rejectBorrow(value, prop.span, "be stored in a record");
      properties.push({ name: prop.name, value });
    }
    for (const field of expectedFields) {
      if (!seen.has(field.name))
        this.report(diagnostic("LC1011", e.span, `Missing field \`${field.name}\` of \`${struct.name}\`.`));
    }
    if (union)
      for (const field of struct.fields) {
        if (!expectedFields.some((f) => f.name === field.name))
          properties.push({ name: field.name, value: { kind: "null", type: field.type, span: e.span } });
      }
    // Emit fields in declaration order so backends can use positional constructors.
    properties.sort(
      (a, b) => struct.fields.findIndex((f) => f.name === a.name) - struct.fields.findIndex((f) => f.name === b.name),
    );
    return { kind: "object", properties, type: T.struct(struct.name), span: e.span };
  }

  private identifier(name: string, span: Span): TExpr {
    const binding = this.lookup(name);
    if (binding?.state) return { kind: "stateRead", name, type: binding.type, span };
    if (binding && this.closed.has(name))
      this.report(diagnostic("LC1018", span, `Cannot use \`${name}\` after it was closed.`));
    if (binding && this.suspended && binding.borrowed)
      this.report(diagnostic("LC1018", span, "A borrowed value cannot be used after suspension."));
    if (binding && this.captures.some((scope) => scope.get(name) === binding)) {
      const reference = binding.type.kind === "struct" ? this.mod.structs.get(binding.type.name)?.reference : undefined;
      const value =
        isPrimitive(binding.type) || binding.type.kind === "enum" || (binding.type.kind === "struct" && !reference);
      const retained = reference?.native?.contract?.ownership === "owned" && !binding.mutable && !binding.borrowed;
      const borrowed =
        this.closureEscaping.at(-1) === false &&
        binding.borrowed &&
        !binding.mutable &&
        reference?.native?.contract?.ownership === "owned";
      if (!borrowed && (binding.mutable || binding.borrowed || (!value && !retained)))
        this.report(
          diagnostic(
            "LC1005",
            span,
            "Native closures may only capture immutable scalar locals; resource and mutable captures require explicit ownership.",
          ),
        );
      else this.recordCapture(name, borrowed ? "borrowed" : retained ? "retained" : "value", span);
    }
    const signature = this.mod.signatures.get(name);
    if (!binding && signature) {
      if (signature.async) {
        this.report(diagnostic("LC1005", span, "Native callbacks must be synchronous."));
        return this.poison(span);
      }
      return {
        kind: "functionRef",
        name,
        type: T.callback(
          signature.params.map((p) => p.type),
          signature.returnType,
        ),
        span,
      };
    }
    if (!binding) {
      this.report(diagnostic("LC1010", span, `Unknown identifier \`${name}\`.`));
      return this.poison(span);
    }
    if (binding.poisoned) return this.poison(span, binding.type);
    const id: TExpr = {
      kind: "identifier",
      name,
      type: binding.type,
      span,
      ...(binding.borrowed ? { borrowed: true as const } : {}),
    };
    const narrowed = this.narrowed(name);
    return narrowed
      ? narrowed.kind === "struct" && binding.type.kind === "struct"
        ? { ...id, type: narrowed }
        : {
            kind: "unwrap",
            argument: id,
            type: narrowed,
            span,
            ...(id.borrowed && !isPrimitive(narrowed) ? { borrowed: true as const } : {}),
          }
      : id;
  }

  private binary(e: Extract<Expr, { kind: "binary" }>): TExpr {
    const span = e.span;
    // Let a literal on either side adopt the other side's type (`b + 2`, `2 + b`).
    const literalLeft = e.left.kind === "number" || e.left.kind === "null" || e.left.kind === "undefined";
    let left: TExpr;
    let right: TExpr;
    if (literalLeft) {
      right = this.expr(e.right);
      left = this.expr(e.left, right.type);
    } else {
      left = this.expr(e.left);
      right = this.expr(e.right, left.type);
    }
    const op = e.operator;
    if (left.poisoned || right.poisoned)
      return this.poison(span, op === "+" || op === "-" || op === "*" || op === "/" || op === "%" ? left.type : T.bool);
    if (op === "===" || op === "!==") {
      const comparable =
        left.poisoned ||
        right.poisoned ||
        typeEquals(left.type, right.type) ||
        assignable(right.type, left.type) ||
        assignable(left.type, right.type);
      if (!comparable) return this.mismatch(e.right.span, left.type, right.type);
      const base = isOptional(left.type) ? left.type.value : left.type;
      const nullCheck = left.kind === "null" || right.kind === "null";
      if (!nullCheck && !isPrimitive(base) && base.kind !== "enum") {
        this.report(
          diagnostic(
            "LC1011",
            span,
            `\`${op}\` is only supported on strings, numbers, booleans and their optionals, not \`${typeToString(left.type)}\`.`,
            "Compare a field instead.",
          ),
        );
        return this.poison(span, T.bool);
      }
      return { kind: "binary", operator: op, left, right, type: T.bool, span };
    }
    if (op === "+" && left.type.kind === "string" && right.type.kind === "string") {
      return { kind: "binary", operator: op, left, right, type: T.string, span };
    }
    if (!isNumeric(left.type)) return this.mismatch(e.left.span, T.float64, left.type, narrowingHint(left.type));
    if (!typeEquals(left.type, right.type)) {
      return this.mismatch(
        e.right.span,
        left.type,
        right.type,
        isNumeric(right.type) ? "Lucent does not convert between numeric types implicitly." : narrowingHint(right.type),
      );
    }
    const isComparison = op === "<" || op === "<=" || op === ">" || op === ">=";
    return { kind: "binary", operator: op, left, right, type: isComparison ? T.bool : left.type, span };
  }

  /** An assignable place: identifier, struct field, or array element. */
  private target(e: Expr): TExpr {
    if (e.kind === "identifier") {
      const binding = this.lookup(e.name);
      if (!binding) {
        this.report(diagnostic("LC1010", e.span, `Unknown identifier \`${e.name}\`.`));
        return this.poison(e.span);
      }
      if (!binding.mutable)
        this.report(
          diagnostic(
            "LC1016",
            e.span,
            `Cannot assign to \`${e.name}\` because it is a constant.`,
            "Declare it with `let`.",
          ),
        );
      this.clearNarrowing(e.name);
      if (binding.poisoned) return this.poison(e.span, binding.type);
      return { kind: "identifier", name: e.name, type: binding.type, span: e.span };
    }
    if (e.kind === "member") {
      const object = this.expr(e.object);
      if (object.type.kind === "struct" && this.mod.structs.get(object.type.name)?.union) {
        this.report(diagnostic("LC1001", e.span, "Union values are immutable; replace the whole value."));
        return this.poison(e.span);
      }
      if (object.type.kind === "struct" && this.mod.structs.get(object.type.name)?.reference?.native) {
        this.report(diagnostic("LC1011", e.span, "Native properties require simple assignment through a setter."));
        return this.poison(e.span);
      }
      return this.member(e);
    }
    if (e.kind === "index") {
      const indexed = this.index(e);
      if (indexed.kind === "index" && indexed.object.type.kind === "map")
        this.report(diagnostic("LC1001", e.span, "Assigning into a map is not supported yet."));
      return indexed;
    }
    this.report(diagnostic("LC1001", e.span, "Unsupported assignment target."));
    return this.poison(e.span);
  }

  private assign(e: Extract<Expr, { kind: "assign" }>): TExpr {
    if (e.target.kind === "member") {
      const object = this.expr(e.target.object);
      if (object.type.kind === "struct" && this.mod.structs.get(object.type.name)?.reference?.native) {
        const callee = `${object.type.name}__set_${e.target.property}`;
        if (!this.mod.signatures.has(callee) || e.operator !== "=") {
          this.report(diagnostic("LC1011", e.span, "Native properties require a setter and simple assignment."));
          return this.poison(e.span);
        }
        return this.call({ kind: "call", callee, args: [e.target.object, e.value], span: e.span });
      }
    }
    const target = this.target(e.target);
    let value = this.expr(e.value, target.type);
    if (target.poisoned || value.poisoned) return this.poison(e.span, target.type);
    if (e.operator === "=") {
      if (!this.fits(value, target.type))
        value = this.mismatch(e.value.span, target.type, value.type, narrowingHint(value.type));
      if (e.target.kind === "identifier") {
        const binding = this.lookup(e.target.name);
        if (binding) binding.borrowed = value.borrowed === true;
      } else this.rejectBorrow(value, e.value.span, "be stored in a field or element");
    } else {
      const stringConcat = e.operator === "+=" && target.type.kind === "string";
      if (!stringConcat && !isNumeric(target.type)) return this.mismatch(e.target.span, T.float64, target.type);
      if (!typeEquals(value.type, target.type)) value = this.mismatch(e.value.span, target.type, value.type);
    }
    return { kind: "assign", operator: e.operator, target, value, type: target.type, span: e.span };
  }

  private recordCapture(name: string, kind: "value" | "retained" | "borrowed" | "weak", span: Span): void {
    const list = this.recordedCaptures.at(-1);
    if (!list) return;
    const existing = list.find((capture) => capture.name === name);
    if (!existing) {
      list.push({ name, kind });
      return;
    }
    if (existing.kind !== kind)
      this.report(diagnostic("LC1005", span, `Capture \`${name}\` cannot be both ${existing.kind} and ${kind}.`));
  }

  private weakCapture(e: Extract<Expr, { kind: "call" }>): TExpr {
    const arg = e.args[0];
    if (e.args.length !== 1 || arg?.kind !== "identifier") {
      this.report(diagnostic("LC1005", e.span, "`weak()` captures exactly one local."));
      return this.poison(e.span);
    }
    const binding = this.lookup(arg.name);
    const reference = binding?.type.kind === "struct" ? this.mod.structs.get(binding.type.name)?.reference : undefined;
    const owned =
      !!binding &&
      !binding.mutable &&
      !binding.borrowed &&
      reference?.native?.contract?.ownership === "owned" &&
      this.captures.some((scope) => scope.get(arg.name) === binding);
    if (!owned || !binding) {
      this.report(
        diagnostic("LC1005", e.span, "`weak()` requires an immutable owned reference from an enclosing scope."),
      );
      return this.poison(e.span);
    }
    this.recordCapture(arg.name, "weak", e.span);
    return { kind: "weak", name: arg.name, type: T.optional(binding.type), span: e.span };
  }

  private call(e: Extract<Expr, { kind: "call" }>): TExpr {
    if (e.callee === "weak") return this.weakCapture(e);
    if (e.callee === "state") {
      this.report(diagnostic("LC1001", e.span, "`state()` is a view declaration: `const name = state(literal)`."));
      return this.poison(e.span);
    }
    const local = this.lookup(e.callee);
    if (local?.type.kind === "callback") {
      const signature = local.type;
      if (e.args.length !== signature.params.length)
        this.report(diagnostic("LC1012", e.span, "Incorrect native callback argument count."));
      const args = e.args.map((arg, i) => {
        const expected = signature.params[i];
        const value = this.expr(arg, expected);
        return expected && !this.fits(value, expected) ? this.mismatch(arg.span, expected, value.type) : value;
      });
      return {
        kind: "invoke",
        callback: this.identifier(e.callee, e.span),
        args,
        type: signature.result,
        span: e.span,
      };
    }
    let callee = e.callee;
    const candidates = this.mod.overloads[callee];
    if (candidates) {
      const inferred = e.args.map((arg) => (arg.kind === "object" || arg.kind === "array" ? null : this.expr(arg)));
      const matches = candidates
        .flatMap((name) => {
          const signature = this.mod.signatures.get(name);
          if (!signature || signature.params.length !== e.args.length) return [];
          let score = 0;
          for (let i = 0; i < e.args.length; i++) {
            const arg = e.args[i]!,
              expected = signature.params[i]!.type,
              actual = inferred[i];
            if (actual && typeEquals(actual.type, expected)) continue;
            if (actual && assignable(actual.type, expected)) {
              score += 1;
              continue;
            }
            if (
              arg.kind === "number" &&
              isNumeric(expected) &&
              (expected.kind !== "int" || Number.isInteger(arg.value))
            ) {
              score += 2;
              continue;
            }
            if (arg.kind === "object" && expected.kind === "struct") {
              score += 3;
              continue;
            }
            if (arg.kind === "array" && expected.kind === "array") {
              score += 3;
              continue;
            }
            return [];
          }
          return [{ name, score }];
        })
        .toSorted((a, b) => a.score - b.score);
      if (!matches.length || matches[1]?.score === matches[0]?.score) {
        this.report(
          diagnostic(
            "LC1012",
            e.span,
            `${matches.length ? "Ambiguous" : "No matching"} overload for ${e.callee}.`,
            candidates
              .map((name) => {
                const signature = this.mod.signatures.get(name)!;
                return `${name}(${signature.params.map((p) => typeToString(p.type)).join(", ")})`;
              })
              .join("; "),
          ),
        );
        return this.poison(e.span);
      }
      callee = matches[0]!.name;
    }
    const signature = this.mod.signatures.get(callee);
    if (!signature) {
      this.report(
        diagnostic(
          "LC1010",
          e.span,
          `Unknown function \`${e.callee}\`.`,
          "Only functions declared in this module can be called.",
        ),
      );
      return this.poison(e.span);
    }
    if (e.args.length !== signature.params.length) {
      this.report(
        diagnostic(
          "LC1012",
          e.span,
          `\`${e.callee}\` takes ${signature.params.length} argument${signature.params.length === 1 ? "" : "s"}, got ${e.args.length}.`,
        ),
      );
    }
    const args = e.args.map((arg, i) => {
      const param = signature.params[i];
      const retention = signature.binding?.contract?.parameters?.[param?.name ?? ""]?.callback?.retention;
      const savedEscaping = this.nextCallbackEscaping;
      if (arg.kind === "closure") this.nextCallbackEscaping = retention !== "call";
      const typed = this.expr(arg, param?.type);
      if (arg.kind === "closure") this.nextCallbackEscaping = savedEscaping;
      if (param && !this.fits(typed, param.type))
        return this.mismatch(arg.span, param.type, typed.type, narrowingHint(typed.type));
      const ownership = signature.binding?.contract?.parameters?.[param?.name ?? ""]?.ownership;
      const receiver = i === 0 && /__(method|get|set)_/.test(callee);
      if (typed.borrowed && ownership !== "borrowed" && !(ownership === undefined && receiver))
        this.rejectBorrow(typed, arg.span, "be passed out of its scope");
      return typed;
    });
    this.enforceExecutor(signature, e.span, args[0]);
    if (signature.async && signature.binding?.contract?.result === "borrowed")
      this.report(diagnostic("LC1018", e.span, "A borrowed value cannot survive suspension."));
    const type = signature.async ? T.promise(signature.returnType) : signature.returnType;
    return {
      kind: "call",
      callee,
      args,
      type,
      span: e.span,
      ...(signature.binding?.contract?.result === "borrowed" ? { borrowed: true as const } : {}),
    };
  }

  private member(e: Extract<Expr, { kind: "member" }>): TExpr {
    if (
      e.object.kind === "identifier" &&
      e.property === "OS" &&
      this.mod.signatures.get(e.object.name)?.binding?.platformQuery
    ) {
      return { kind: "call", callee: e.object.name, args: [], type: T.string, span: e.span };
    }
    const object = this.expr(e.object);
    const span = e.span;
    const t = object.type;
    if (object.poisoned) return this.poison(span);
    if (e.property === "length" && (t.kind === "array" || t.kind === "string" || t.kind === "bytes")) {
      return { kind: "length", object, type: T.float64, span };
    }
    if (t.kind === "struct") {
      const field = this.mod.structs.get(t.name)?.fields.find((f) => f.name === e.property);
      if (!field) {
        this.report(diagnostic("LC1010", span, `\`${t.name}\` has no field \`${e.property}\`.`));
        return this.poison(span);
      }
      if (
        this.mod.structs.get(t.name)?.reference?.privateFields?.includes(e.property) &&
        this.fn.classOp?.className !== t.name
      ) {
        this.report(diagnostic("LC1011", span, `Field ${e.property} is private to ${t.name}.`));
        return this.poison(span);
      }
      if (this.mod.structs.get(t.name)?.reference?.native) {
        return this.call({ kind: "call", callee: `${t.name}__get_${e.property}`, args: [e.object], span });
      }
      const union = this.mod.structs.get(t.name)?.union;
      if (union && e.property !== union.tag) {
        const variant =
          union.variants.length === 1 ? union.variants[0] : union.variants.find((v) => v.tag === t.variant);
        const payload = variant?.fields.find((f) => f.name === e.property);
        if (!payload) {
          this.report(diagnostic("LC1011", span, "Narrow the union discriminant before reading this field."));
          return this.poison(span);
        }
        const member: TExpr = { kind: "member", object, property: e.property, type: field.type, span };
        return payload.type.kind === "optional"
          ? member
          : { kind: "unwrap", argument: member, type: payload.type, span };
      }
      return { kind: "member", object, property: e.property, type: field.type, span };
    }
    this.report(
      diagnostic("LC1011", span, `Cannot read \`${e.property}\` of \`${typeToString(t)}\`.`, narrowingHint(t)),
    );
    return this.poison(span);
  }

  private index(e: Extract<Expr, { kind: "index" }>): TExpr {
    const object = this.expr(e.object);
    const span = e.span;
    const t = object.type;
    if (object.poisoned) return this.poison(span);
    if (t.kind === "struct") {
      this.report(
        diagnostic(
          "LC1002",
          span,
          `Dynamic property access on \`${t.name}\` is not supported.`,
          "Struct fields are laid out at compile time; use `value.field`.",
        ),
      );
      return this.poison(span);
    }
    if (t.kind === "array" || t.kind === "bytes") {
      const index = this.expr(e.index);
      if (!index.poisoned && !isNumeric(index.type)) return this.mismatch(e.index.span, T.float64, index.type);
      return { kind: "index", object, index, type: t.kind === "array" ? t.element : T.float64, span };
    }
    if (t.kind === "map") {
      const index = this.expr(e.index, T.string);
      if (!index.poisoned && index.type.kind !== "string") return this.mismatch(e.index.span, T.string, index.type);
      return { kind: "index", object, index, type: T.optional(t.value), span };
    }
    this.report(diagnostic("LC1011", span, `Cannot index into \`${typeToString(t)}\`.`, narrowingHint(t)));
    return this.poison(span);
  }

  private forView(e: Extract<Expr, { kind: "view" }>): TExpr {
    const eachProps = e.properties.filter((p) => p.name === "each");
    const keyProps = e.properties.filter((p) => p.name === "key");
    const each = eachProps[0];
    if (eachProps.length !== 1 || keyProps.length > 1 || e.properties.length !== eachProps.length + keyProps.length) {
      this.report(diagnostic("LC1011", e.span, "`For` takes an `each` array and an optional `key`."));
      return this.poison(e.span, T.view);
    }
    if (!each) return this.poison(e.span, T.view);
    const data = this.expr(each.value);
    if (data.type.kind !== "array") {
      this.report(diagnostic("LC1011", each.span, "`For` iterates an array."));
      return this.poison(e.span, T.view);
    }
    const row = e.children[0];
    if (e.children.length !== 1 || row?.kind !== "closure" || row.params.length !== 1) {
      this.report(diagnostic("LC1011", e.span, "`For` expects one row closure with the element parameter."));
      return this.poison(e.span, T.view);
    }
    const child = this.expr(row, T.callback([data.type.element], T.view));
    if (child.kind !== "closure" || child.type.kind !== "callback" || child.type.result.kind !== "view") {
      this.report(diagnostic("LC1011", row.span, "A `For` row must return a native view."));
      return this.poison(e.span, T.view);
    }
    const keyProp = keyProps[0];
    const properties = [{ name: "each", value: data }];
    if (keyProp) {
      const expected = T.callback([data.type.element], T.string);
      const key = this.expr(keyProp.value, expected);
      if (key.kind !== "closure" || !typeEquals(key.type, expected)) {
        this.report(
          diagnostic(
            "LC1011",
            keyProp.span,
            "`For` keys are a closure from the row value to a string.",
            "Write `key={(item: T) => item}`; use a template literal for a numeric identity.",
          ),
        );
        return this.poison(e.span, T.view);
      }
      properties.push({ name: "key", value: key });
    }
    return {
      kind: "view",
      name: "For",
      properties,
      children: [child],
      type: T.view,
      span: e.span,
    };
  }

  private methodCall(e: Extract<Expr, { kind: "methodCall" }>): TExpr {
    if (e.object.kind === "identifier") {
      const binding = this.lookup(e.object.name);
      if (binding?.state) {
        if (e.method !== "set" || e.args.length !== 1) {
          this.report(diagnostic("LC1012", e.span, "`set` takes the next state value."));
          return this.poison(e.span, T.void);
        }
        const arg = e.args[0]!;
        let value = this.expr(arg, binding.type);
        if (!this.fits(value, binding.type)) value = this.mismatch(arg.span, binding.type, value.type);
        return { kind: "stateWrite", name: e.object.name, value, type: T.void, span: e.span };
      }
    }
    const object = this.expr(e.object);
    const span = e.span;
    if (object.poisoned) return this.poison(span, T.void);
    if (object.type.kind === "struct" && this.mod.structs.get(object.type.name)?.reference) {
      const call = this.call({
        kind: "call",
        callee: `${object.type.name}__method_${e.method}`,
        args: [e.object, ...e.args],
        span,
      });
      const close = this.mod.structs.get(object.type.name)?.reference?.native?.contract?.close;
      if (close === e.method && e.object.kind === "identifier") this.closed.add(e.object.name);
      return call;
    }
    if (object.type.kind === "array" && e.method === "push") {
      const element = object.type.element;
      const args = e.args.map((arg) => {
        const typed = this.expr(arg, element);
        this.rejectBorrow(typed, arg.span, "be stored in an array");
        return this.fits(typed, element) ? typed : this.mismatch(arg.span, element, typed.type);
      });
      if (args.length !== 1) this.report(diagnostic("LC1012", span, "`push` takes exactly one argument."));
      return { kind: "methodCall", object, method: "push", args, type: T.void, span };
    }
    this.report(
      diagnostic("LC1001", span, `Method \`${e.method}\` is not supported on \`${typeToString(object.type)}\`.`),
    );
    return this.poison(span);
  }
}

function narrowingHint(t: NativeType): string | undefined {
  return isOptional(t)
    ? "The value may be null. Narrow it first: `if (x === null) { … }` or `if (x !== null) { … }`."
    : undefined;
}

/** Recognises `x === null`, `x !== null`, `x === undefined`, `x !== undefined` on an optional identifier. */
function narrowingOf(
  test: TExpr,
  structs: Map<string, StructDef>,
): {
  name: string;
  whenTrue?: { name: string; type: NativeType };
  whenFalse?: { name: string; type: NativeType };
} | null {
  if (test.kind !== "binary" || (test.operator !== "===" && test.operator !== "!==")) return null;
  const [field, tag] = test.left.kind === "member" ? [test.left, test.right] : [test.right, test.left];
  if (
    field.kind === "member" &&
    field.object.kind === "identifier" &&
    field.object.type.kind === "struct" &&
    tag.kind === "string"
  ) {
    const union = structs.get(field.object.type.name)?.union;
    if (union && field.property === union.tag && union.variants.some((v) => v.tag === tag.value)) {
      const name = field.object.name;
      const equal = { name, type: { ...field.object.type, variant: tag.value } };
      const remaining = union.variants.filter((v) => v.tag !== tag.value);
      const different =
        remaining.length === 1 ? { name, type: { ...field.object.type, variant: remaining[0]!.tag } } : undefined;
      return {
        name,
        ...(test.operator === "==="
          ? { whenTrue: equal, ...(different ? { whenFalse: different } : {}) }
          : { whenFalse: equal, ...(different ? { whenTrue: different } : {}) }),
      };
    }
  }
  const [id, lit] =
    test.left.kind === "identifier"
      ? [test.left, test.right]
      : test.right.kind === "identifier"
        ? [test.right, test.left]
        : [null, null];
  if (!id || !lit || lit.kind !== "null" || !isOptional(id.type)) return null;
  const inner = { name: id.name, type: id.type.value };
  return test.operator === "===" ? { name: id.name, whenFalse: inner } : { name: id.name, whenTrue: inner };
}

export function alwaysExits(stmts: readonly TStmt[]): boolean {
  const last = stmts[stmts.length - 1];
  if (!last) return false;
  switch (last.kind) {
    case "return":
    case "throw":
    case "break":
    case "continue":
      return true;
    case "if":
      return alwaysExits(last.consequent) && last.alternate !== null && alwaysExits(last.alternate);
    case "block":
      return alwaysExits(last.body);
    default:
      return false;
  }
}
