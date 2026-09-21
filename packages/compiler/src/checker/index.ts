import { diagnostic, type Diagnostic, type Span } from "../diagnostics/index.ts";
import type { Expr, Stmt, SurfaceFunction, SurfaceModule, SurfaceType } from "../parser/surface.ts";
import { isNumeric, T, typeEquals, typeToString, type NativeType } from "../types/native-type.ts";
import { resolveType, type TypeScope } from "../types/resolve.ts";
import type { StructDef, TExpr, TStmt, TypedFunction, TypedModule, TypedParam } from "./typed.ts";

export type * from "./typed.ts";

export interface CheckResult {
  module: TypedModule | null;
  diagnostics: Diagnostic[];
}

export const MAX_PARAMETERS = 8;

interface Signature {
  params: TypedParam[];
  returnType: NativeType;
  async: boolean;
}

interface Binding {
  type: NativeType;
  mutable: boolean;
  /** The declaration already failed to type; uses of it must not cascade. */
  poisoned: boolean;
}

const MISMATCH = (expected: NativeType, actual: NativeType) => `Expected \`${typeToString(expected)}\`, got \`${typeToString(actual)}\`.`;

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
  readonly structs = new Map<string, StructDef>();
  readonly signatures = new Map<string, Signature>();
  readonly typeScope: TypeScope;

  constructor(private readonly module: SurfaceModule) {
    const sized = new Set<string>();
    for (const imp of module.imports) for (const name of imp.names) sized.add(name);
    this.typeScope = { structs: new Set(module.typeAliases.map((a) => a.name)), sized };
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
      this.report(diagnostic("NT1003", type.span, `\`Promise\` is only supported as the return type of an async function, not as ${what}.`));
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
      const body = new FunctionChecker(this, fn, signature).check();
      functions.push({ name: fn.name, exported: fn.exported, async: fn.async, params: signature.params, returnType: signature.returnType, body, span: fn.span });
    }
    const name = this.module.fileName.replace(/^.*[\\/]/, "").replace(/\.lucent\.ts$/, "").replace(/\.ts$/, "");
    const typed: TypedModule = { name, fileName: this.module.fileName, structs: [...this.structs.values()], functions };
    return { module: this.diagnostics.length ? null : typed, diagnostics: this.diagnostics };
  }

  private collectStructs(): void {
    const seen = new Set<string>();
    for (const alias of this.module.typeAliases) {
      if (seen.has(alias.name)) {
        this.report(diagnostic("NT1001", alias.span, `Duplicate type \`${alias.name}\`.`));
        continue;
      }
      seen.add(alias.name);
      if (alias.type.kind !== "object") {
        this.report(diagnostic("NT1003", alias.type.span, "Type aliases must be object types (structs).", "Only `type Name = { … }` has a native representation."));
        continue;
      }
      const fields: StructDef["fields"] = [];
      for (const field of alias.type.fields) {
        const type = this.resolveStorable(field.type, "a struct field");
        if (!type) continue;
        fields.push({ name: field.name, type: field.optional ? T.optional(type) : type });
      }
      this.structs.set(alias.name, { name: alias.name, exported: alias.exported, fields });
    }
  }

  private collectSignatures(): void {
    for (const fn of this.module.functions) {
      if (this.signatures.has(fn.name)) {
        this.report(diagnostic("NT1001", fn.span, `Duplicate function \`${fn.name}\`.`));
        continue;
      }
      if (fn.params.length > MAX_PARAMETERS) {
        this.report(diagnostic("NT1007", fn.span, `\`${fn.name}\` has ${fn.params.length} parameters; native functions take at most ${MAX_PARAMETERS}.`, "Group related parameters into a struct."));
      }
      const params: TypedParam[] = [];
      let valid = fn.params.length <= MAX_PARAMETERS;
      for (const param of fn.params) {
        if (!param.type) {
          this.report(diagnostic("NT1014", param.span, `Parameter \`${param.name}\` needs a type annotation.`, "Every value crossing the native boundary must have a declared type."));
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
      if (valid && returnType) this.signatures.set(fn.name, { params, returnType, async: fn.async });
    }
  }

  private returnTypeOf(fn: SurfaceFunction): NativeType | null {
    if (!fn.returnType) {
      this.report(diagnostic("NT1014", fn.span, `\`${fn.name}\` needs a return type annotation.`, fn.async ? "Declare `Promise<T>` (or `Promise<void>`)." : "Declare the return type, or `void`."));
      return null;
    }
    const resolved = this.resolve(fn.returnType);
    if (!resolved) return null;
    if (fn.async && resolved.kind !== "promise") {
      this.report(diagnostic("NT1011", fn.returnType.span, `Async function \`${fn.name}\` must return \`Promise<${typeToString(resolved)}>\`.`));
      return null;
    }
    if (!fn.async && resolved.kind === "promise") {
      this.report(diagnostic("NT1011", fn.returnType.span, `\`${fn.name}\` returns a Promise but is not \`async\`.`, "Mark the function `async`."));
      return null;
    }
    return resolved.kind === "promise" ? resolved.value : resolved;
  }
}

class FunctionChecker {
  private readonly scopes: Map<string, Binding>[] = [];
  private readonly narrowings: Map<string, NativeType>[] = [];
  private loopDepth = 0;

  constructor(
    private readonly mod: ModuleChecker,
    private readonly fn: SurfaceFunction,
    private readonly signature: Signature,
  ) {}

  check(): TStmt[] {
    this.push();
    for (const p of this.signature.params) this.declare(p.name, p.type, true);
    const body = this.fn.body.map((s) => this.stmt(s));
    this.pop();
    if (this.signature.returnType.kind !== "void" && !alwaysExits(body)) {
      this.mod.report(diagnostic("NT1015", this.fn.span, `\`${this.fn.name}\` must return a \`${typeToString(this.signature.returnType)}\` on every path.`));
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

  private declare(name: string, type: NativeType, mutable: boolean, poisoned = false): void {
    this.scopes[this.scopes.length - 1]!.set(name, { type, mutable, poisoned });
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
    this.report(diagnostic("NT1011", span, MISMATCH(expected, actual), help));
    return this.poison(span, expected);
  }

  // ---- statements ------------------------------------------------------------

  private block(stmts: Stmt[]): TStmt[] {
    this.push();
    const out = stmts.map((s) => this.stmt(s));
    this.pop();
    return out;
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
      case "for": {
        this.push();
        const init = s.init ? this.stmt(s.init) : null;
        const test = s.test ? this.condition(s.test) : null;
        const update = s.update ? this.expr(s.update) : null;
        this.loopDepth++;
        const body = this.block(s.body);
        this.loopDepth--;
        this.pop();
        return { kind: "for", init, test, update, body, span: s.span };
      }
      case "forOf": {
        const iterable = this.expr(s.iterable);
        const elementType = iterable.type.kind === "array" ? iterable.type.element : null;
        if (!elementType && !iterable.poisoned) this.report(diagnostic("NT1011", s.iterable.span, `\`for…of\` needs an array, got \`${typeToString(iterable.type)}\`.`));
        this.push();
        this.declare(s.variable, elementType ?? T.float64, false);
        this.loopDepth++;
        const body = this.block(s.body);
        this.loopDepth--;
        this.pop();
        return { kind: "forOf", variable: s.variable, elementType: elementType ?? T.float64, iterable, body, span: s.span };
      }
      case "return":
        return this.returnStmt(s);
      case "break":
      case "continue":
        if (this.loopDepth === 0) this.report(diagnostic("NT1001", s.span, `\`${s.kind}\` outside a loop.`));
        return { kind: s.kind, span: s.span };
      case "throw": {
        const message = s.message ? this.expr(s.message, T.string) : null;
        if (message && !this.fits(message, T.string)) this.report(diagnostic("NT1011", s.message!.span, `LucentError message must be a string, got \`${typeToString(message.type)}\`.`));
        return { kind: "throw", code: s.code, message, span: s.span };
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
    const declared = s.type ? this.mod.resolveStorable(s.type, "a local variable") : null;
    let init: TExpr;
    let type: NativeType;
    if (!s.init) {
      this.report(diagnostic("NT1014", s.span, `\`${s.name}\` must be initialized so its type is known.`, "Write `let x: T = …` or give it a value."));
      type = declared ?? T.float64;
      init = this.poison(s.span, type);
    } else if (declared) {
      init = this.expr(s.init, declared);
      if (!this.fits(init, declared)) init = this.mismatch(s.init.span, declared, init.type);
      type = declared;
    } else {
      init = this.expr(s.init);
      type = init.type;
      if (!init.poisoned && init.type.kind === "promise") this.report(diagnostic("NT1003", s.init.span, "A Promise cannot be stored; `await` it instead."));
    }
    this.declare(s.name, type, s.declaration === "let", init.poisoned === true);
    return { kind: "variable", declaration: s.declaration, name: s.name, type, init, span: s.span };
  }

  private returnStmt(s: Extract<Stmt, { kind: "return" }>): TStmt {
    const expected = this.signature.returnType;
    if (!s.argument) {
      if (expected.kind !== "void") this.report(diagnostic("NT1011", s.span, `\`${this.fn.name}\` must return a \`${typeToString(expected)}\`.`));
      return { kind: "return", argument: null, span: s.span };
    }
    if (expected.kind === "void") {
      this.report(diagnostic("NT1011", s.argument.span, `\`${this.fn.name}\` returns \`void\` and cannot return a value.`));
      return { kind: "return", argument: null, span: s.span };
    }
    let argument = this.expr(s.argument, expected);
    if (!this.fits(argument, expected)) argument = this.mismatch(s.argument.span, expected, argument.type, narrowingHint(argument.type));
    return { kind: "return", argument, span: s.span };
  }

  private condition(e: Expr): TExpr {
    const test = this.expr(e, T.bool);
    if (!test.poisoned && test.type.kind !== "bool") return this.mismatch(e.span, T.bool, test.type, "Lucent has no truthiness: compare explicitly, e.g. `x !== 0` or `s.length > 0`.");
    return test;
  }

  private ifStmt(s: Extract<Stmt, { kind: "if" }>): TStmt {
    const test = this.condition(s.test);
    const narrowing = narrowingOf(test);
    const consequent = this.branch(s.consequent, narrowing?.whenTrue);
    const alternate = s.alternate ? this.branch(s.alternate, narrowing?.whenFalse) : null;
    // `if (x === null) return …;` narrows the rest of the enclosing block.
    if (narrowing) {
      const rest = alwaysExits(consequent) ? narrowing.whenFalse : alternate && alwaysExits(alternate) ? narrowing.whenTrue : undefined;
      if (rest) this.narrowings[this.narrowings.length - 1]!.set(narrowing.name, rest.type);
    }
    return { kind: "if", test, consequent, alternate, span: s.span };
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
      case "number":
        return this.numberLiteral(e, expected);
      case "string":
        return { kind: "string", value: e.value, type: T.string, span };
      case "boolean":
        return { kind: "boolean", value: e.value, type: T.bool, span };
      case "null":
      case "undefined": {
        if (!expected || !isOptional(expected)) {
          this.report(diagnostic("NT1014", span, `Cannot infer the type of \`${e.kind}\` here.`, "Annotate the variable: `let x: T | null = null`."));
          return this.poison(span);
        }
        return { kind: "null", type: expected, span };
      }
      case "template": {
        const expressions = e.expressions.map((x) => {
          const t = this.expr(x);
          if (!t.poisoned && !isPrimitive(t.type)) this.report(diagnostic("NT1011", x.span, `Only strings, numbers and booleans can be interpolated, got \`${typeToString(t.type)}\`.`));
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
        if (e.operator === "!" && argument.type.kind !== "bool") return this.mismatch(e.argument.span, T.bool, argument.type);
        if (e.operator === "-" && !isNumeric(argument.type)) return this.mismatch(e.argument.span, T.float64, argument.type);
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
        if (!this.fn.async) this.report(diagnostic("NT1013", span, "`await` is only allowed inside an `async` function."));
        const argument = this.expr(e.argument);
        if (argument.poisoned) return this.poison(span, expected);
        if (argument.type.kind !== "promise") {
          this.report(diagnostic("NT1011", e.argument.span, `Cannot await \`${typeToString(argument.type)}\`.`, "Only the result of calling an async function can be awaited."));
          return this.poison(span, expected);
        }
        return { kind: "await", argument, type: argument.type.value, span };
      }
      case "unsupported":
        return this.poison(span, expected);
    }
  }

  private numberLiteral(e: Extract<Expr, { kind: "number" }>, expected: NativeType | undefined): TExpr {
    const context = expected && isOptional(expected) ? expected.value : expected;
    let type: NativeType = T.float64;
    if (context?.kind === "int") {
      if (!Number.isInteger(e.value)) return this.mismatch(e.span, context, T.float64, `\`${e.value}\` is not an integer.`);
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
      this.report(diagnostic("NT1014", e.span, "Cannot infer the element type of an empty array.", "Annotate the variable: `const xs: number[] = []`."));
      return this.poison(e.span, T.array(T.float64));
    }
    const elements: TExpr[] = [];
    let elementType = elementContext;
    for (const el of e.elements) {
      const t = this.expr(el, elementType);
      if (!elementType) elementType = t.type;
      else if (!this.fits(t, elementType)) this.report(diagnostic("NT1011", el.span, MISMATCH(elementType, t.type)));
      elements.push(t);
    }
    return { kind: "array", elements, type: T.array(elementType!), span: e.span };
  }

  private objectLiteral(e: Extract<Expr, { kind: "object" }>, expected: NativeType | undefined): TExpr {
    const context = expected && isOptional(expected) ? expected.value : expected;
    const struct = context?.kind === "struct" ? this.mod.structs.get(context.name) : undefined;
    if (!struct) {
      this.report(diagnostic("NT1014", e.span, "An object literal needs a struct type from its context.", "Annotate the variable: `const u: User = { … }`."));
      return this.poison(e.span, context);
    }
    const properties: { name: string; value: TExpr }[] = [];
    const seen = new Set<string>();
    for (const prop of e.properties) {
      const field = struct.fields.find((f) => f.name === prop.name);
      if (!field) {
        this.report(diagnostic("NT1011", prop.span, `\`${struct.name}\` has no field \`${prop.name}\`.`));
        continue;
      }
      seen.add(prop.name);
      let value = this.expr(prop.value, field.type);
      if (!this.fits(value, field.type)) value = this.mismatch(prop.value.span, field.type, value.type);
      properties.push({ name: prop.name, value });
    }
    for (const field of struct.fields) {
      if (!seen.has(field.name)) this.report(diagnostic("NT1011", e.span, `Missing field \`${field.name}\` of \`${struct.name}\`.`));
    }
    // Emit fields in declaration order so backends can use positional constructors.
    properties.sort((a, b) => struct.fields.findIndex((f) => f.name === a.name) - struct.fields.findIndex((f) => f.name === b.name));
    return { kind: "object", properties, type: T.struct(struct.name), span: e.span };
  }

  private identifier(name: string, span: Span): TExpr {
    const binding = this.lookup(name);
    if (!binding) {
      this.report(diagnostic("NT1010", span, `Unknown identifier \`${name}\`.`));
      return this.poison(span);
    }
    if (binding.poisoned) return this.poison(span, binding.type);
    const id: TExpr = { kind: "identifier", name, type: binding.type, span };
    const narrowed = this.narrowed(name);
    return narrowed ? { kind: "unwrap", argument: id, type: narrowed, span } : id;
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
    if (left.poisoned || right.poisoned) return this.poison(span, op === "+" || op === "-" || op === "*" || op === "/" || op === "%" ? left.type : T.bool);
    if (op === "===" || op === "!==") {
      const comparable = left.poisoned || right.poisoned || typeEquals(left.type, right.type) || assignable(right.type, left.type) || assignable(left.type, right.type);
      if (!comparable) return this.mismatch(e.right.span, left.type, right.type);
      return { kind: "binary", operator: op, left, right, type: T.bool, span };
    }
    if (op === "+" && left.type.kind === "string" && right.type.kind === "string") {
      return { kind: "binary", operator: op, left, right, type: T.string, span };
    }
    if (!isNumeric(left.type)) return this.mismatch(e.left.span, T.float64, left.type, narrowingHint(left.type));
    if (!typeEquals(left.type, right.type)) {
      return this.mismatch(e.right.span, left.type, right.type, isNumeric(right.type) ? "Lucent does not convert between numeric types implicitly." : narrowingHint(right.type));
    }
    const isComparison = op === "<" || op === "<=" || op === ">" || op === ">=";
    return { kind: "binary", operator: op, left, right, type: isComparison ? T.bool : left.type, span };
  }

  /** An assignable place: identifier, struct field, or array element. */
  private target(e: Expr): TExpr {
    if (e.kind === "identifier") {
      const binding = this.lookup(e.name);
      if (!binding) {
        this.report(diagnostic("NT1010", e.span, `Unknown identifier \`${e.name}\`.`));
        return this.poison(e.span);
      }
      if (!binding.mutable) this.report(diagnostic("NT1016", e.span, `Cannot assign to \`${e.name}\` because it is a constant.`, "Declare it with `let`."));
      this.clearNarrowing(e.name);
      if (binding.poisoned) return this.poison(e.span, binding.type);
      return { kind: "identifier", name: e.name, type: binding.type, span: e.span };
    }
    if (e.kind === "member") return this.member(e);
    if (e.kind === "index") {
      const indexed = this.index(e);
      if (indexed.kind === "index" && indexed.object.type.kind === "map") this.report(diagnostic("NT1001", e.span, "Assigning into a map is not supported yet."));
      return indexed;
    }
    this.report(diagnostic("NT1001", e.span, "Unsupported assignment target."));
    return this.poison(e.span);
  }

  private assign(e: Extract<Expr, { kind: "assign" }>): TExpr {
    const target = this.target(e.target);
    let value = this.expr(e.value, target.type);
    if (target.poisoned || value.poisoned) return this.poison(e.span, target.type);
    if (e.operator === "=") {
      if (!this.fits(value, target.type)) value = this.mismatch(e.value.span, target.type, value.type, narrowingHint(value.type));
    } else {
      const stringConcat = e.operator === "+=" && target.type.kind === "string";
      if (!stringConcat && !isNumeric(target.type)) return this.mismatch(e.target.span, T.float64, target.type);
      if (!typeEquals(value.type, target.type)) value = this.mismatch(e.value.span, target.type, value.type);
    }
    return { kind: "assign", operator: e.operator, target, value, type: target.type, span: e.span };
  }

  private call(e: Extract<Expr, { kind: "call" }>): TExpr {
    const signature = this.mod.signatures.get(e.callee);
    if (!signature) {
      this.report(diagnostic("NT1010", e.span, `Unknown function \`${e.callee}\`.`, "Only functions declared in this module can be called."));
      return this.poison(e.span);
    }
    if (e.args.length !== signature.params.length) {
      this.report(diagnostic("NT1012", e.span, `\`${e.callee}\` takes ${signature.params.length} argument${signature.params.length === 1 ? "" : "s"}, got ${e.args.length}.`));
    }
    const args = e.args.map((arg, i) => {
      const param = signature.params[i];
      const typed = this.expr(arg, param?.type);
      if (param && !this.fits(typed, param.type)) return this.mismatch(arg.span, param.type, typed.type, narrowingHint(typed.type));
      return typed;
    });
    const type = signature.async ? T.promise(signature.returnType) : signature.returnType;
    return { kind: "call", callee: e.callee, args, type, span: e.span };
  }

  private member(e: Extract<Expr, { kind: "member" }>): TExpr {
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
        this.report(diagnostic("NT1010", span, `\`${t.name}\` has no field \`${e.property}\`.`));
        return this.poison(span);
      }
      return { kind: "member", object, property: e.property, type: field.type, span };
    }
    this.report(diagnostic("NT1011", span, `Cannot read \`${e.property}\` of \`${typeToString(t)}\`.`, narrowingHint(t)));
    return this.poison(span);
  }

  private index(e: Extract<Expr, { kind: "index" }>): TExpr {
    const object = this.expr(e.object);
    const span = e.span;
    const t = object.type;
    if (object.poisoned) return this.poison(span);
    if (t.kind === "struct") {
      this.report(diagnostic("NT1002", span, `Dynamic property access on \`${t.name}\` is not supported.`, "Struct fields are laid out at compile time; use `value.field`."));
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
    this.report(diagnostic("NT1011", span, `Cannot index into \`${typeToString(t)}\`.`, narrowingHint(t)));
    return this.poison(span);
  }

  private methodCall(e: Extract<Expr, { kind: "methodCall" }>): TExpr {
    const object = this.expr(e.object);
    const span = e.span;
    if (object.poisoned) return this.poison(span, T.void);
    if (object.type.kind === "array" && e.method === "push") {
      const element = object.type.element;
      const args = e.args.map((arg) => {
        const typed = this.expr(arg, element);
        return this.fits(typed, element) ? typed : this.mismatch(arg.span, element, typed.type);
      });
      if (args.length !== 1) this.report(diagnostic("NT1012", span, "`push` takes exactly one argument."));
      return { kind: "methodCall", object, method: "push", args, type: T.void, span };
    }
    this.report(diagnostic("NT1001", span, `Method \`${e.method}\` is not supported on \`${typeToString(object.type)}\`.`));
    return this.poison(span);
  }
}

function narrowingHint(t: NativeType): string | undefined {
  return isOptional(t) ? "The value may be null. Narrow it first: `if (x === null) { … }` or `if (x !== null) { … }`." : undefined;
}

/** Recognises `x === null`, `x !== null`, `x === undefined`, `x !== undefined` on an optional identifier. */
function narrowingOf(test: TExpr): { name: string; whenTrue?: { name: string; type: NativeType }; whenFalse?: { name: string; type: NativeType } } | null {
  if (test.kind !== "binary" || (test.operator !== "===" && test.operator !== "!==")) return null;
  const [id, lit] = test.left.kind === "identifier" ? [test.left, test.right] : test.right.kind === "identifier" ? [test.right, test.left] : [null, null];
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
