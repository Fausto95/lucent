import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import type { LucentModule } from "../program.ts";
import { type ClassInfo, cppIdent, isVoidish, type LType, sameType, stripOpt, substitute, T, typeKey, unionOf } from "../types.ts";
import { containsAwait, freeVariables, type FunctionLike, symbolOf } from "./analysis.ts";
import * as builtins from "./builtins.ts";
import * as native from "./native.ts";
import { AlreadyReported, type Ctx, type E, type IntKind, type ParamInfo } from "./context.ts";
import { inferIntegers } from "./integers.ts";
export { substitute } from "../types.ts";
import { numberLiteral, stringLiteral } from "./literals.ts";

interface Local {
  cpp: string;
  type: LType;
  boxed: boolean;
  /** Set when the number lives in an integer register. */
  int?: IntKind;
}

const INT_CPP: Record<IntKind, string> = { i32: "int32_t", u32: "uint32_t", i64: "int64_t" };

interface ControlEntry {
  kind: "loop" | "switch" | "block" | "finally";
  labels: string[];
  breakLabel?: string;
  continueLabel?: string;
  usedBreakLabel?: boolean;
  usedContinueLabel?: boolean;
  // finally
  finLabel?: string;
  finVar?: string;
  pending?: Map<number, () => void>;
}

export interface FnOptions {
  module: LucentModule;
  async: boolean;
  /** Lucent return type (the promised type for async functions). */
  returnType: LType;
  cls?: ClassInfo;
  /** How `this` is spelled in the current context. */
  thisExpr?: string;
  /** How `this` is spelled as a Ref (for passing it as a value). */
  thisRef?: string;
  isConstructor?: boolean;
  /** A generator body: `yield` becomes co_yield and `return` co_return. */
  generator?: boolean;
  /** In a subclass constructor: the base construct() call and what follows super(). */
  superCtor?: { call: string; params: LType[]; after: (em: FnEmitter) => void };
}

const ASSIGN_OPS = new Map<ts.SyntaxKind, string>([
  [ts.SyntaxKind.PlusEqualsToken, "+"],
  [ts.SyntaxKind.MinusEqualsToken, "-"],
  [ts.SyntaxKind.AsteriskEqualsToken, "*"],
  [ts.SyntaxKind.SlashEqualsToken, "/"],
  [ts.SyntaxKind.PercentEqualsToken, "%"],
  [ts.SyntaxKind.AsteriskAsteriskEqualsToken, "**"],
  [ts.SyntaxKind.AmpersandEqualsToken, "&"],
  [ts.SyntaxKind.BarEqualsToken, "|"],
  [ts.SyntaxKind.CaretEqualsToken, "^"],
  [ts.SyntaxKind.LessThanLessThanEqualsToken, "<<"],
  [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken, ">>"],
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, ">>>"],
]);

/** Emits the body of one function (or method, or closure) as C++. */
export class FnEmitter {
  readonly lines: string[] = [];
  private depth = 1;
  private scopes: Map<ts.Symbol, Local>[] = [new Map()];
  private ctl: ControlEntry[] = [];
  private retVar?: string;
  private readonly prologue: string[] = [];
  /** Nodes replaced during optional-chain lowering. */
  private readonly subst = new Map<ts.Node, E>();
  /** Locals and loop counters that live in integer registers (integers.ts). */
  private ints = new Map<ts.Symbol, IntKind>();
  private readonly counters = new Set<ts.Symbol>();
  /** Locals whose type could not be lowered; their diagnostic is reported once, at the declaration. */
  private readonly failed = new Set<ts.Symbol>();

  constructor(
    readonly ctx: Ctx,
    readonly opts: FnOptions,
    private readonly parentScopes: Map<ts.Symbol, Local>[] = [],
  ) {}

  get checker(): ts.TypeChecker {
    return this.ctx.checker;
  }
  get reg() {
    return this.ctx.reg;
  }
  cpp(t: LType): string {
    return this.ctx.reg.cpp(t);
  }

  // --- output ---------------------------------------------------------------

  line(s: string): void {
    this.lines.push("  ".repeat(this.depth) + s);
  }
  open(s: string): void {
    this.line(s);
    this.depth++;
  }
  close(s = "}"): void {
    this.depth--;
    this.line(s);
  }
  /** The finished body: prologue declarations first. */
  body(): string[] {
    return [...this.prologue.map((l) => "  " + l), ...this.lines];
  }

  // --- scopes ------------------------------------------------------------------

  pushScope(): void {
    this.scopes.push(new Map());
  }
  popScope(): void {
    this.scopes.pop();
  }
  declare(sym: ts.Symbol, name: string, type: LType): Local {
    const boxed = this.ctx.capture.isBoxed(sym);
    const local: Local = { cpp: cppIdent(name), type, boxed };
    this.scopes[this.scopes.length - 1]!.set(sym, local);
    return local;
  }
  private findLocal(sym: ts.Symbol): Local | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const l = this.scopes[i]!.get(sym);
      if (l) return l;
    }
    for (let i = this.parentScopes.length - 1; i >= 0; i--) {
      const l = this.parentScopes[i]!.get(sym);
      if (l) return l;
    }
    return undefined;
  }
  allScopes(): Map<ts.Symbol, Local>[] {
    return [...this.parentScopes, ...this.scopes];
  }

  /** `T name = init;`, boxing when a closure captures and mutates it. */
  declareVar(sym: ts.Symbol, name: string, type: LType, init: string | undefined): Local {
    const l = this.declare(sym, name, type);
    const ct = this.cpp(type);
    if (l.boxed) this.line(init !== undefined ? `lucent::Box<${ct}> ${l.cpp}(${init});` : `lucent::Box<${ct}> ${l.cpp};`);
    else this.line(init !== undefined ? `${ct} ${l.cpp} = ${init};` : `${ct} ${l.cpp}{};`);
    return l;
  }

  // --- integers --------------------------------------------------------------------

  private isNumberLocal(d: ts.VariableDeclaration, sym: ts.Symbol): boolean {
    try {
      return this.reg.lower(this.checker.getTypeOfSymbolAtLocation(sym, d.name), d.name).k === "number";
    } catch {
      return false;
    }
  }

  /** A number known to equal the exact integer expression `c`. */
  intE(c: string, kind: IntKind): E {
    return { c: `static_cast<double>(${c})`, t: T.number, int: { c, kind } };
  }

  /** ToInt32 as a C++ int32_t. */
  i32(e: E, node: ts.Node): string {
    if (e.int) return e.int.kind === "i32" ? e.int.c : `static_cast<int32_t>(${e.int.c})`;
    return `lucent::toInt32(${this.num(e, node)})`;
  }

  /** ToUint32 as a C++ uint32_t. */
  u32(e: E, node: ts.Node): string {
    if (e.int) return e.int.kind === "u32" ? e.int.c : `static_cast<uint32_t>(${e.int.c})`;
    return `lucent::toUint32(${this.num(e, node)})`;
  }

  /** A value the analysis proved fits `kind`, as that register type. */
  private toKind(e: E, kind: IntKind, node: ts.Node): string {
    if (e.int?.kind === kind) return e.int.c;
    if (kind === "i32") return this.i32(e, node);
    if (kind === "u32") return this.u32(e, node);
    return `static_cast<int64_t>(${e.int ? e.int.c : this.num(e, node)})`;
  }

  /** `a op b` for the int32 operators, on integer registers. */
  bitwise(op: string, a: E, b: E, node: ts.Node): E {
    switch (op) {
      case "&":
      case "|":
      case "^":
        return this.intE(`(${this.i32(a, node)} ${op} ${this.i32(b, node)})`, "i32");
      case "<<":
        return this.intE(`static_cast<int32_t>(${this.u32(a, node)} << (${this.u32(b, node)} & 31u))`, "i32");
      case ">>":
        return this.intE(`(${this.i32(a, node)} >> (${this.u32(b, node)} & 31u))`, "i32");
      case ">>>":
        return this.intE(`(${this.u32(a, node)} >> (${this.u32(b, node)} & 31u))`, "u32");
    }
    fail(node, Codes.UnsupportedOperator, `unsupported operator ${op}`);
  }

  private intLocal(target: ts.Expression): Local | undefined {
    if (!ts.isIdentifier(target)) return undefined;
    const sym = symbolOf(this.checker, target);
    const local = sym ? this.findLocal(this.ctx.resolve(sym)) : undefined;
    return local?.int ? local : undefined;
  }

  // --- types ---------------------------------------------------------------------

  lt(node: ts.Node): LType {
    return this.ctx.lowerAt(node);
  }

  /** Converts a value to another representation the checker proved compatible. */
  coerce(e: E, to: LType, node?: ts.Node): string {
    const from = e.t;
    if (sameType(from, to)) return e.c;
    // Different Lucent types with one native representation (platform objects).
    if (from.k !== "union" && to.k !== "union" && this.cpp(from) === this.cpp(to)) return e.c;
    if (from.k === "never") return e.c;
    if (to.k === "void" || to.k === "never") return e.c;
    if (to.k === "undefined" && (from.k === "void" || from.k === "undefined")) return "lucent::undefined";
    if (to.k === "opt") {
      if (from.k === "undefined" || from.k === "void") return `${this.cpp(to)}(lucent::undefined)`;
      if (from.k === "null") return `${this.cpp(to)}(lucent::null)`;
      if (from.k === "opt") {
        if (sameType(from.inner, to.inner)) return e.c;
        return `lucent::convert<${this.cpp(to)}>(${e.c})`;
      }
      return `${this.cpp(to)}(${this.coerce(e, to.inner, node)})`;
    }
    if (from.k === "opt") {
      return this.coerce({ c: `(${e.c}).value()`, t: from.inner }, to, node);
    }
    if (to.k === "union") {
      if (from.k === "union") return `lucent::convert<${this.cpp(to)}>(${e.c})`;
      const member = to.ms.find((m) => sameType(m, from)) ?? to.ms.find((m) => this.compatible(from, m));
      if (!member) fail(node, Codes.UnsupportedType, `cannot convert ${typeKey(from)} to ${typeKey(to)}`);
      return `${this.cpp(to)}(${this.coerce(e, member, node)})`;
    }
    if (from.k === "union") {
      if (from.ms.some((m) => sameType(m, to))) return `lucent::narrow<${this.cpp(to)}>(${e.c})`;
      return `lucent::convert<${this.cpp(to)}>(${e.c})`;
    }
    if (to.k === "fn" && from.k === "fn") return this.adaptFn(e, to, node);
    if (this.cpp(from) === this.cpp(to)) return e.c;
    // Error subclasses: upcast freely, downcast (after instanceof) with a check.
    if (to.k === "error" && from.k === "class" && this.reg.cls(from.id).isError) return `lucent::Error(${e.c})`;
    if (from.k === "error" && to.k === "class" && this.reg.cls(to.id).isError) return `lucent::downcast<${this.reg.cppClass(to)}>(${e.c})`;
    if (to.k === "iface") return this.toIface(e, to, node);
    if (to.k === "iter") {
      const src = this.iterExpr(e, node ?? ts.factory.createIdentifier("value"));
      if (this.cpp(src.e) !== this.cpp(to.e)) fail(node, Codes.ArrayVariance, `iterable element types must match exactly (${typeKey(src.e)} vs ${typeKey(to.e)})`);
      return src.c;
    }
    // Date.prototype.valueOf: relational operators and unary plus.
    if (from.k === "date" && to.k === "number") return `(${e.c})->getTime()`;
    if (from.k === "iface" && to.k === "class") return `lucent::downcast<${this.reg.cppClass(to)}>(${e.c})`;
    if (from.k === "class" && to.k === "class") {
      // Upcasts are implicit; downcasts follow instanceof narrowing and are checked.
      if (this.reg.derives(from.id, to.id)) return `std::static_pointer_cast<${this.reg.cppClass(to)}>(${e.c})`;
      if (this.reg.derives(to.id, from.id)) return `lucent::downcast<${this.reg.cppClass(to)}>(${e.c})`;
    }
    if (from.k === "struct" && to.k === "struct") {
      fail(node, Codes.InexactObject, `object types must match exactly to share a native representation (${this.describe(from)} vs ${this.describe(to)})`);
    }
    if ((from.k === "array" && to.k === "array") || (from.k === "map" && to.k === "map")) {
      fail(node, Codes.ArrayVariance, `collection element types must match exactly (${typeKey(from)} vs ${typeKey(to)}); annotate the value with the target type`);
    }
    fail(node, Codes.UnsupportedType, `cannot convert ${typeKey(from)} to ${typeKey(to)}`);
  }

  /** `JSON.parse(text) as T`: a typed parse into the target type. */
  private jsonParse(node: ts.CallExpression, hint?: LType): E {
    if (!hint || hint.k === "void") fail(node, Codes.UnsupportedBuiltin, "JSON.parse needs a target type: write `JSON.parse(text) as T` or annotate the variable");
    if (node.arguments.length !== 1) fail(node, Codes.UnsupportedBuiltin, "JSON.parse reviver functions are not supported");
    this.jsonReadable(hint, node, new Set());
    this.ctx.jsonReads.set(typeKey(hint), hint);
    return { c: `lucent::jsonParse<${this.cpp(hint)}>(${this.exprAs(node.arguments[0]!, T.string)})`, t: hint };
  }

  /** Types JSON.parse can build: plain data, like JSON itself. */
  private jsonReadable(t: LType, node: ts.Node, seen: Set<string>): void {
    if (seen.has(typeKey(t))) return;
    seen.add(typeKey(t));
    switch (t.k) {
      case "number":
      case "boolean":
      case "string":
      case "null":
        return;
      case "opt":
        return this.jsonReadable(t.inner, node, seen);
      case "array":
        return this.jsonReadable(t.e, node, seen);
      case "dict":
        return this.jsonReadable(t.val, node, seen);
      case "tuple":
        return t.es.forEach((e) => this.jsonReadable(e, node, seen));
      case "struct":
        return this.reg.struct(t.id).fields.forEach((f) => this.jsonReadable(f.type, node, seen));
      case "union":
        return t.ms.forEach((m) => this.jsonReadable(m, node, seen));
      default:
        fail(node, Codes.UnsupportedBuiltin, `JSON.parse cannot create ${t.k === "class" ? "class instances" : typeKey(t)}; parse into plain data types`);
    }
  }

  /** Upcasts a class instance to an interface it declares with `implements`. */
  private toIface(e: E, to: LType & { k: "iface" }, node?: ts.Node): string {
    const info = this.reg.iface(to.id);
    const name = info.decl.name.text;
    if (e.t.k === "class") {
      const cls = this.reg.cls(e.t.id);
      if (!this.reg.implementsIface(e.t, to)) {
        fail(node, Codes.InterfaceNotImplemented, `class ${cls.decl.name!.text} must declare \`implements ${name}\` (with these type arguments) to be used as ${name}`);
      }
      return `std::static_pointer_cast<${this.reg.cppIface(to)}>(${e.c})`;
    }
    if (e.t.k === "iface") {
      // An interface that extends the target: an upcast to a virtual base.
      if (this.reg.ifaceChain(e.t).some((x) => typeKey(x) === typeKey(to))) return `std::static_pointer_cast<${this.reg.cppIface(to)}>(${e.c})`;
      fail(node, Codes.InterfaceNotImplemented, `${this.reg.iface(e.t.id).decl.name.text} does not extend ${name}`);
    }
    this.notAnImplementation(e.t.k === "struct" ? "an object" : typeKey(e.t), to, node);
  }

  private notAnImplementation(what: string, to: LType & { k: "iface" }, node?: ts.Node): never {
    const name = this.reg.iface(to.id).decl.name.text;
    fail(node, Codes.InterfaceNotImplemented, `${what} cannot be used as ${name}; ${name} is implemented by classes that declare \`implements ${name}\``);
  }

  private compatible(from: LType, to: LType): boolean {
    if (sameType(from, to)) return true;
    if (from.k === "fn" && to.k === "fn") return true;
    return this.cpp(from) === this.cpp(to);
  }

  private describe(t: LType): string {
    if (t.k === "struct") return `{ ${this.reg.struct(t.id).fields.map((f) => f.name).join(", ")} }`;
    return typeKey(t);
  }

  /** Adapts a function value to a function type with more parameters. */
  private adaptFn(e: E, to: LType & { k: "fn" }, node?: ts.Node): string {
    const from = e.t as LType & { k: "fn" };
    if (this.cpp(from) === this.cpp(to)) return e.c;
    const f = this.ctx.fresh("fn");
    const params = to.params.map((p, i) => `${this.cpp(p)} a${i}`).join(", ");
    const args = from.params.map((p, i) => this.coerce({ c: `a${i}`, t: to.params[i] ?? T.undefined }, p, node)).join(", ");
    const call = `${f}(${args})`;
    const body = isVoidish(to.ret) ? `${call};` : `return ${this.coerce({ c: call, t: from.ret }, to.ret, node)};`;
    return `${this.cpp(to)}([${f} = ${e.c}](${params}) { ${body} })`;
  }

  exprAs(node: ts.Expression, to: LType): string {
    return this.coerce(this.expr(node, to), to, node);
  }

  /** A condition: a C++ bool. */
  cond(node: ts.Expression): string {
    const e = this.expr(node);
    if (e.t.k === "boolean") return e.c;
    return `lucent::truthy(${e.c})`;
  }

  // --- functions -------------------------------------------------------------------

  /** Emits parameter defaults, destructuring and boxing at the top of a body. */
  emitParams(decl: FunctionLike, params: ParamInfo[]): string[] {
    const out: string[] = [];
    decl.parameters.forEach((p, i) => {
      const info = params[i]!;
      const incoming = `p${i}_${ts.isIdentifier(p.name) ? cppIdent(p.name.text) : "arg"}`;
      out.push(`${this.cpp(info.cppType)} ${incoming}`);
      let value: string = incoming;
      let type = info.cppType;
      if (p.initializer) {
        const inner = stripOpt(info.cppType);
        const dflt = this.exprAs(p.initializer, info.type);
        value = `(${incoming}.isUndefined() ? ${dflt} : ${this.coerce({ c: `${incoming}.get()`, t: inner }, info.type, p)})`;
        type = info.type;
      }
      if (ts.isIdentifier(p.name)) {
        const sym = this.checker.getSymbolAtLocation(p.name)!;
        this.declareVar(sym, p.name.text, type, value);
      } else {
        const tmp = this.ctx.fresh("param");
        this.line(`${this.cpp(type)} ${tmp} = ${value};`);
        this.bindPattern(p.name, { c: tmp, t: type }, true);
      }
    });
    return out;
  }

  /** Lowers a nested function or arrow to a C++ lambda wrapped in lucent::Fn. */
  closure(node: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration, target?: LType): E {
    const sig = this.checker.getTypeAtLocation(node).getCallSignatures()[0];
    if (!sig) fail(node, Codes.UnsupportedType, "expected a function type");
    let fnType: LType & { k: "fn" };
    if (target && target.k === "fn" && target.params.length >= node.parameters.length) {
      // Use the contextual parameter list so the lambda matches Fn<...> exactly.
      fnType = { k: "fn", params: target.params, ret: this.reg.lower(this.checker.getReturnTypeOfSignature(sig), node) };
    } else {
      fnType = this.reg.lowerSignature(sig, node) as LType & { k: "fn" };
    }
    const isAsync = !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
    const isGen = !ts.isArrowFunction(node) && !!node.asteriskToken;
    if (isAsync && isGen) fail(node, Codes.UnsupportedSyntax, "async generators are not supported");
    const ret = isAsync ? (fnType.ret.k === "promise" ? fnType.ret.inner : fnType.ret) : isGen ? T.void : fnType.ret;
    const params = this.paramInfos(node, fnType);
    const inner = new FnEmitter(this.ctx, { ...this.opts, async: isAsync, generator: isGen, returnType: ret, thisExpr: this.opts.thisExpr ? "self" : undefined, thisRef: this.opts.thisRef ? "self" : undefined, isConstructor: false }, this.allScopes());
    const free = freeVariables(this.checker, node);
    const captures: string[] = [];
    for (const sym of free) {
      const l = this.findLocal(sym);
      if (l) captures.push(l.cpp);
    }
    const usesThisVal = this.opts.thisExpr && usesThisIn(node);
    if (usesThisVal) captures.push(`self = ${this.selfRef()}`);
    const decls = inner.emitParams(node, params);
    // Callbacks may be called with more arguments than they declare.
    for (let i = node.parameters.length; i < fnType.params.length; i++) decls.push(`${this.cpp(fnType.params[i]!)} unused${i}`);
    inner.emitFunctionBody(node);
    const retCpp = isAsync ? `lucent::Promise<${this.reg.cppRet(ret)}>` : isGen ? this.cpp(fnType.ret) : this.reg.cppRet(ret);
    const body = inner.body().map((l) => "  ".repeat(this.depth) + l);
    let code: string;
    if (isAsync || isGen) {
      // Coroutine frames must not reference the lambda's captures: pass them
      // as coroutine parameters instead.
      const capNames = captures.map((c) => c.split(" = ")[0]!);
      const capParams = capNames.map((c) => `auto ${c}`).join(", ");
      const incoming = decls.map((d) => d.split(" ").pop()!);
      code =
        `${this.cpp(fnType)}([${captures.join(", ")}](${decls.join(", ")}) -> ${retCpp} {\n` +
        `${"  ".repeat(this.depth + 1)}return [](${[capParams, ...decls].filter(Boolean).join(", ")}) -> ${retCpp} {\n` +
        body.map((l) => "    " + l).join("\n") +
        `\n${"  ".repeat(this.depth + 1)}}(${[...capNames, ...incoming].join(", ")});\n${"  ".repeat(this.depth)}})`;
    } else {
      code = `${this.cpp(fnType)}([${captures.join(", ")}](${decls.join(", ")}) mutable -> ${retCpp} {\n${body.join("\n")}\n${"  ".repeat(this.depth)}})`;
    }
    return { c: code, t: fnType };
  }

  /** Parameter infos for a function-like node with a known function type. */
  paramInfos(node: FunctionLike, fnType: LType & { k: "fn" }): ParamInfo[] {
    return node.parameters.map((p, i) => {
      const declared = fnType.params[i] ?? this.lt(p);
      const optional = !!p.questionToken || !!p.initializer;
      const rest = !!p.dotDotDotToken;
      let type = declared;
      let cppType = declared;
      if (p.initializer) {
        // Default parameter: callers pass Opt<T>; the body sees the declared type.
        const sym = ts.isIdentifier(p.name) ? this.checker.getSymbolAtLocation(p.name) : undefined;
        const bodyType = p.type ? this.checker.getTypeFromTypeNode(p.type) : sym ? this.checker.getTypeOfSymbolAtLocation(sym, p.name) : this.checker.getTypeAtLocation(p);
        type = this.reg.lower(bodyType, p);
        cppType = unionOf([type, T.undefined]);
      } else if (optional && declared.k !== "opt") {
        cppType = type = unionOf([declared, T.undefined]);
      }
      return { name: ts.isIdentifier(p.name) ? p.name.text : `p${i}`, type, cppType, optional, rest };
    });
  }

  /** Statements of a function body, plus the implicit return at the end. */
  emitFunctionBody(node: FunctionLike): void {
    const body = node.body;
    if (!body) return;
    const facts = inferIntegers(body, {
      checker: this.checker,
      candidate: (d, sym) => !this.ctx.capture.isBoxed(sym) && this.isNumberLocal(d, sym),
      isBoxed: (sym) => this.ctx.capture.isBoxed(sym),
      isMath: (id) => builtins.isMathGlobal(this, id),
    });
    this.ints = facts.locals;
    for (const c of facts.counters) this.counters.add(c);
    const ret = this.opts.returnType;
    if (ts.isBlock(body)) {
      this.hoistFunctions(body.statements);
      for (const s of body.statements) this.stmt(s);
      const last = body.statements[body.statements.length - 1];
      const endsInReturn = last && (ts.isReturnStatement(last) || ts.isThrowStatement(last));
      if (!endsInReturn && !this.opts.generator) {
        if (this.opts.async) {
          if (isVoidish(ret)) this.line("co_return;");
          else if (ret.k === "opt") this.line("co_return lucent::undefined;");
          else this.line("lucent::unreachable();");
        } else if (ret.k === "opt") {
          this.line("return lucent::undefined;");
        } else if (!isVoidish(ret) && !this.opts.isConstructor) {
          this.line("lucent::unreachable();");
        }
      }
    } else {
      // Expression body.
      if (isVoidish(ret)) {
        const e = this.expr(body);
        this.line(`${e.c};`);
        if (this.opts.async) this.line("co_return;");
      } else {
        let e = this.expr(body, ret);
        if (this.opts.async && e.t.k === "promise" && ret.k !== "promise") e = { c: `(co_await ${e.c})`, t: e.t.inner };
        this.line(`${this.opts.async ? "co_return" : "return"} ${this.coerce(e, ret, body)};`);
      }
    }
  }

  private hoistFunctions(stmts: ts.NodeArray<ts.Statement>): void {
    // Nested function declarations are hoisted: declare them all first.
    const fns = stmts.filter(ts.isFunctionDeclaration);
    for (const f of fns) {
      const sym = this.checker.getSymbolAtLocation(f.name!)!;
      const t = this.lt(f);
      const l = this.declare(sym, f.name!.text, t);
      l.boxed = true;
      this.line(`lucent::Box<${this.cpp(t)}> ${l.cpp};`);
    }
    // A function that captures a variable declared later in this block is
    // defined where it is written (the variable is in its temporal dead zone
    // before that anyway); the others are available from the block's start.
    const laterDecls = new Set<ts.Symbol>();
    for (const st of stmts) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        const names: ts.Identifier[] = [];
        const collect = (n: ts.Node): void => {
          if (ts.isIdentifier(n) && (ts.isVariableDeclaration(n.parent) || ts.isBindingElement(n.parent))) names.push(n);
          ts.forEachChild(n, collect);
        };
        collect(d.name);
        for (const id of names) {
          const sym = this.checker.getSymbolAtLocation(id);
          if (sym) laterDecls.add(sym);
        }
      }
    }
    for (const f of fns) {
      if (freeVariables(this.checker, f).some((v) => laterDecls.has(v))) {
        this.deferredFns.add(f);
        continue;
      }
      this.defineFunction(f);
    }
  }

  private readonly deferredFns = new Set<ts.FunctionDeclaration>();

  private defineFunction(f: ts.FunctionDeclaration): void {
    const sym = this.checker.getSymbolAtLocation(f.name!)!;
    const l = this.findLocal(sym)!;
    const e = this.closure(f);
    this.line(`*${l.cpp} = ${e.c};`);
  }

  selfRef(): string {
    if (this.opts.thisRef) return this.opts.thisRef;
    return `lucent::selfRef(this)`;
  }

  // --- statements --------------------------------------------------------------------

  stmt(s: ts.Statement): void {
    this.ctx.guard(() => this.stmtInner(s));
  }

  private lineDirective(node: ts.Node): void {
    const sf = node.getSourceFile();
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    // Absolute, so debuggers and crash symbolication open the source file.
    this.lines.push(`#line ${line + 1} "${sourcePath(sf.fileName)}"`);
  }

  private stmtInner(s: ts.Statement): void {
    if (!ts.isBlock(s) && !ts.isFunctionDeclaration(s)) this.lineDirective(s);
    switch (s.kind) {
      case ts.SyntaxKind.Block: {
        const b = s as ts.Block;
        this.open("{");
        this.pushScope();
        this.hoistFunctions(b.statements);
        for (const x of b.statements) this.stmt(x);
        this.popScope();
        this.close();
        return;
      }
      case ts.SyntaxKind.EmptyStatement:
        return;
      case ts.SyntaxKind.FunctionDeclaration:
        if (this.deferredFns.has(s as ts.FunctionDeclaration)) this.defineFunction(s as ts.FunctionDeclaration);
        return; // otherwise hoisted
      case ts.SyntaxKind.VariableStatement:
        return this.varStatement((s as ts.VariableStatement).declarationList);
      case ts.SyntaxKind.ExpressionStatement: {
        const x = (s as ts.ExpressionStatement).expression;
        if (ts.isYieldExpression(x)) return this.yieldStmt(x);
        const sc = this.opts.superCtor;
        if (sc && ts.isCallExpression(x) && x.expression.kind === ts.SyntaxKind.SuperKeyword) {
          this.line(`${sc.call}(${this.args(x.arguments, sc.params, x).join(", ")});`);
          sc.after(this);
          return;
        }
        const e = this.expr(ts.isVoidExpression(x) ? x.expression : x);
        this.line(`(void)(${e.c});`);
        return;
      }
      case ts.SyntaxKind.ReturnStatement:
        return this.returnStmt(s as ts.ReturnStatement);
      case ts.SyntaxKind.IfStatement:
        return this.ifStmt(s as ts.IfStatement);
      case ts.SyntaxKind.WhileStatement:
        return this.whileStmt(s as ts.WhileStatement, []);
      case ts.SyntaxKind.DoStatement:
        return this.doStmt(s as ts.DoStatement, []);
      case ts.SyntaxKind.ForStatement:
        return this.forStmt(s as ts.ForStatement, []);
      case ts.SyntaxKind.ForOfStatement:
        return this.forOfStmt(s as ts.ForOfStatement, []);
      case ts.SyntaxKind.ForInStatement:
        return this.forInStmt(s as ts.ForInStatement, []);
      case ts.SyntaxKind.SwitchStatement:
        return this.switchStmt(s as ts.SwitchStatement, []);
      case ts.SyntaxKind.LabeledStatement:
        return this.labeled(s as ts.LabeledStatement);
      case ts.SyntaxKind.BreakStatement:
        return this.jump("break", (s as ts.BreakStatement).label?.text, s);
      case ts.SyntaxKind.ContinueStatement:
        return this.jump("continue", (s as ts.ContinueStatement).label?.text, s);
      case ts.SyntaxKind.ThrowStatement:
        return this.throwStmt(s as ts.ThrowStatement);
      case ts.SyntaxKind.TryStatement:
        return this.tryStmt(s as ts.TryStatement);
      case ts.SyntaxKind.TypeAliasDeclaration:
      case ts.SyntaxKind.InterfaceDeclaration:
        return;
      case ts.SyntaxKind.ClassDeclaration:
        fail(s, Codes.UnsupportedSyntax, "classes must be declared at the top level of a module");
      default:
        fail(s, Codes.UnsupportedSyntax, `unsupported statement: ${ts.SyntaxKind[s.kind]}`);
    }
  }

  private varStatement(list: ts.VariableDeclarationList): void {
    if (!(list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) fail(list, Codes.UnsupportedSyntax, "use `let` or `const` instead of `var`");
    for (const d of list.declarations) {
      if (ts.isIdentifier(d.name)) {
        const sym = this.checker.getSymbolAtLocation(d.name)!;
        let declared: LType;
        try {
          declared = this.reg.lower(this.checker.getTypeOfSymbolAtLocation(sym, d.name), d.name);
        } catch (e) {
          this.failed.add(sym);
          throw e;
        }
        const type = declared.k === "never" ? T.undefined : declared;
        if (this.ctx.capture.isBoxed(sym)) {
          // Declare the box first so a closure in the initializer can refer
          // to the variable itself (recursive arrows).
          const l = this.declareVar(sym, d.name.text, type, undefined);
          if (d.initializer) this.line(`*${l.cpp} = ${this.exprAs(d.initializer, type)};`);
        } else {
          const kind = this.counters.has(sym) ? "i64" : type.k === "number" ? this.ints.get(sym) : undefined;
          if (kind && d.initializer) {
            const init = this.toKind(this.expr(d.initializer, T.number), kind, d);
            const l = this.declare(sym, d.name.text, type);
            l.int = kind;
            this.line(`${INT_CPP[kind]} ${l.cpp} = ${init};`);
            continue;
          }
          let init: string | undefined;
          try {
            init = d.initializer ? this.exprAs(d.initializer, type) : undefined;
          } catch (e) {
            // Declared anyway, so later uses do not also report it as unknown.
            this.declareVar(sym, d.name.text, type, undefined);
            throw e;
          }
          this.declareVar(sym, d.name.text, type, init);
        }
      } else {
        if (!d.initializer) fail(d, Codes.UnsupportedDestructuring, "destructuring requires an initializer");
        const e = this.expr(d.initializer);
        const tmp = this.ctx.fresh("d");
        this.line(`${this.cpp(e.t)} ${tmp} = ${e.c};`);
        this.bindPattern(d.name, { c: tmp, t: e.t }, !!(list.flags & ts.NodeFlags.Const));
      }
    }
  }

  /** Declares the variables of a destructuring pattern from `source`. */
  bindPattern(pattern: ts.BindingName, source: E, _isConst: boolean): void {
    if (ts.isIdentifier(pattern)) {
      const sym = this.checker.getSymbolAtLocation(pattern)!;
      const type = this.reg.lower(this.checker.getTypeOfSymbolAtLocation(sym, pattern), pattern);
      this.declareVar(sym, pattern.text, type, this.coerce(source, type, pattern));
      return;
    }
    if (ts.isObjectBindingPattern(pattern)) {
      for (const el of pattern.elements) {
        if (el.dotDotDotToken) fail(el, Codes.UnsupportedDestructuring, "object rest in destructuring is not supported");
        const key = el.propertyName ?? (el.name as ts.Identifier);
        if (!ts.isIdentifier(key) && !ts.isStringLiteral(key)) fail(el, Codes.UnsupportedDestructuring, "computed keys in destructuring are not supported");
        const name = key.text;
        let v = this.member(source, name, el);
        if (el.initializer) v = this.withDefault(v, el.initializer, el);
        this.bindPattern(el.name, v, _isConst);
      }
      return;
    }
    // Array pattern
    pattern.elements.forEach((el, i) => {
      if (ts.isOmittedExpression(el)) return;
      if (el.dotDotDotToken) {
        if (source.t.k !== "array") fail(el, Codes.UnsupportedDestructuring, "rest elements need an array");
        this.bindPattern(el.name, { c: `(${source.c}).slice(${i}.0)`, t: source.t }, _isConst);
        return;
      }
      let v: E;
      const st = stripOpt(source.t);
      if (st.k === "tuple") v = { c: `std::get<${i}>(${source.c})`, t: st.es[i]! };
      else if (st.k === "array") v = { c: `(${source.c}).get(${i}.0)`, t: unionOf([st.e, T.undefined]) };
      else fail(el, Codes.UnsupportedDestructuring, `cannot destructure ${typeKey(source.t)}`);
      if (el.initializer) v = this.withDefault(v, el.initializer, el);
      this.bindPattern(el.name, v, _isConst);
    });
  }

  private withDefault(v: E, init: ts.Expression, node: ts.Node): E {
    if (v.t.k !== "opt") return v;
    const target = this.lt(node);
    const tmp = this.ctx.fresh("dv");
    return { c: `({ auto ${tmp} = ${v.c}; ${tmp}.isUndefined() ? ${this.exprAs(init, target)} : ${this.coerce({ c: `${tmp}`, t: v.t }, target, node)}; })`, t: target };
  }

  private returnStmt(s: ts.ReturnStatement): void {
    const ret = this.opts.returnType;
    const kw = this.opts.async || this.opts.generator ? "co_return" : "return";
    if (this.opts.generator && s.expression) fail(s, Codes.UnsupportedSyntax, "generators cannot return a value; use `return;`");
    let value: string | undefined;
    if (s.expression) {
      let e = this.expr(s.expression, ret);
      // `return promise` in an async function returns the promised value.
      if (this.opts.async && e.t.k === "promise" && ret.k !== "promise") e = { c: `(co_await ${e.c})`, t: isVoidish(e.t.inner) ? T.undefined : e.t.inner };
      if (isVoidish(ret)) {
        if (e.c !== "lucent::undefined") this.line(`${e.c};`);
      } else value = this.coerce(e, ret, s.expression);
    } else if (!isVoidish(ret)) {
      value = this.coerce({ c: "lucent::undefined", t: T.undefined }, ret, s);
    }
    if (this.opts.isConstructor) {
      this.line("return;");
      return;
    }
    // Route through enclosing finally blocks.
    const fin = this.ctl.findLast((c) => c.kind === "finally");
    if (fin) {
      if (value !== undefined) {
        if (!this.retVar) {
          this.retVar = this.ctx.fresh("ret");
          this.prologue.push(`${this.cpp(ret)} ${this.retVar}{};`);
        }
        this.line(`${this.retVar} = ${value};`);
      }
      this.routeThroughFinally(fin, 1, () => this.emitReturnAfterFinally(fin));
      return;
    }
    this.line(value !== undefined ? `${kw} ${value};` : `${kw};`);
  }

  /** `yield x;` and `yield* iterable;` (a yield's own value is not supported). */
  private yieldStmt(y: ts.YieldExpression): void {
    if (!this.opts.generator) fail(y, Codes.UnsupportedSyntax, "`yield` outside a generator");
    const elem = this.generatorElement(y);
    if (!y.asteriskToken) {
      this.line(y.expression ? `co_yield ${this.exprAs(y.expression, elem)};` : `co_yield ${this.coerce({ c: "lucent::undefined", t: T.undefined }, elem, y)};`);
      return;
    }
    // Delegation: forward each value; closing the outer generator closes the inner one.
    const src = this.iterExpr(this.expr(y.expression!), y.expression!);
    const it = this.ctx.fresh("deleg");
    this.open("{");
    this.line(`auto ${it} = ${src.c};`);
    this.line(`lucent::IterCloser<${this.cpp(src.e)}> ${it}_close(${it});`);
    this.open("for (;;) {");
    this.line(`auto ${it}_v = ${it}->next();`);
    this.line(`if (!${it}_v) { ${it}_close.exhausted(); break; }`);
    this.line(`co_yield ${this.coerce({ c: `std::move(*${it}_v)`, t: src.e }, elem, y)};`);
    this.close();
    this.close();
  }

  /** The element type the current generator yields. */
  private generatorElement(node: ts.Node): LType {
    let fn: ts.Node | undefined = node.parent;
    while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
    const sig = fn ? this.checker.getSignatureFromDeclaration(fn as ts.SignatureDeclaration) : undefined;
    const ret = sig ? this.reg.lower(this.checker.getReturnTypeOfSignature(sig), node) : undefined;
    if (!ret || ret.k !== "iter") fail(node, Codes.UnsupportedSyntax, "annotate generators with Generator<T> or Iterable<T>");
    return ret.e;
  }

  /** Any iterable as an Iter<T>. */
  iterExpr(e: E, node: ts.Node): { c: string; e: LType } {
    const t = stripOpt(e.t);
    const v = e.t.k === "opt" ? this.coerce(e, t, node) : e.c;
    switch (t.k) {
      case "iter":
        return { c: v, e: t.e };
      case "array":
      case "set":
        return { c: `lucent::iterOf(${v})`, e: t.e };
      case "map":
        return { c: `lucent::iterOf(${v})`, e: { k: "tuple", es: [t.key, t.val] } };
      case "string":
        return { c: `lucent::iterOf(${v})`, e: T.string };
      case "bytes":
        return { c: `lucent::iterOf(${v})`, e: T.number };
    }
    fail(node, Codes.UnsupportedLoop, `${typeKey(e.t)} is not iterable`);
  }

  private emitReturnAfterFinally(fin: ControlEntry): void {
    const idx = this.ctl.indexOf(fin);
    const outer = this.ctl.slice(0, idx).findLast((c) => c.kind === "finally");
    const kw = this.opts.async || this.opts.generator ? "co_return" : "return";
    if (outer) {
      this.routeThroughFinally(outer, 1, () => this.emitReturnAfterFinally(outer));
      return;
    }
    if (this.retVar) this.line(`${kw} ${this.retVar};`);
    else this.line(`${kw};`);
  }

  /** Sets the finally completion code and jumps to the finally block. */
  private routeThroughFinally(fin: ControlEntry, code: number, after: () => void): void {
    if (!fin.pending!.has(code)) fin.pending!.set(code, after);
    this.line(`{ ${fin.finVar} = ${code}; goto ${fin.finLabel}; }`);
  }

  private ifStmt(s: ts.IfStatement): void {
    this.open(`if (${this.cond(s.expression)}) {`);
    this.nested(s.thenStatement);
    if (s.elseStatement) {
      this.depth--;
      this.open("} else {");
      this.nested(s.elseStatement);
    }
    this.close();
  }

  /** A statement as a block body (without extra braces for blocks). */
  private nested(s: ts.Statement): void {
    this.pushScope();
    if (ts.isBlock(s)) {
      this.hoistFunctions(s.statements);
      for (const x of s.statements) this.stmt(x);
    } else this.stmt(s);
    this.popScope();
  }

  private loopEntry(labels: string[]): ControlEntry {
    const e: ControlEntry = { kind: "loop", labels, breakLabel: this.ctx.fresh("brk"), continueLabel: this.ctx.fresh("cont") };
    this.ctl.push(e);
    return e;
  }

  /** Loop body with a continue label after it when needed. */
  private loopBody(body: ts.Statement, entry: ControlEntry, before?: () => void): void {
    this.open("{");
    this.pushScope();
    before?.();
    if (ts.isBlock(body)) {
      this.hoistFunctions(body.statements);
      for (const x of body.statements) this.stmt(x);
    } else this.stmt(body);
    this.popScope();
    this.close();
    if (entry.usedContinueLabel) this.line(`${entry.continueLabel}:;`);
  }

  private endLoop(entry: ControlEntry): void {
    this.ctl.pop();
    if (entry.usedBreakLabel) this.line(`${entry.breakLabel}:;`);
  }

  private whileStmt(s: ts.WhileStatement, labels: string[]): void {
    const entry = this.loopEntry(labels);
    this.open(`while (${this.cond(s.expression)}) {`);
    this.loopBody(s.statement, entry);
    this.close();
    this.endLoop(entry);
  }

  private doStmt(s: ts.DoStatement, labels: string[]): void {
    const entry = this.loopEntry(labels);
    this.open("do {");
    this.loopBody(s.statement, entry);
    this.close(`} while (${this.cond(s.expression)});`);
    this.endLoop(entry);
  }

  private forStmt(s: ts.ForStatement, labels: string[]): void {
    this.open("{");
    this.pushScope();
    const perIteration: { sym: ts.Symbol; name: string; local: Local }[] = [];
    if (s.initializer) {
      if (ts.isVariableDeclarationList(s.initializer)) {
        this.varStatement(s.initializer);
        // `let` loop variables captured by closures get a per-iteration copy.
        for (const d of s.initializer.declarations) {
          if (ts.isIdentifier(d.name)) {
            const sym = this.checker.getSymbolAtLocation(d.name)!;
            const l = this.findLocal(sym)!;
            if (l.boxed && !assignedWithin(this.checker, s.statement, sym)) perIteration.push({ sym, name: d.name.text, local: l });
          }
        }
      } else this.line(`${this.expr(s.initializer).c};`);
    }
    const entry = this.loopEntry(labels);
    const cond = s.condition ? this.cond(s.condition) : "true";
    const inc = s.incrementor ? `(void)(${this.expr(s.incrementor).c})` : "";
    this.open(`for (; ${cond}; ${inc}) {`);
    this.loopBody(s.statement, entry, () => {
      for (const p of perIteration) {
        const copy: Local = { cpp: `${p.local.cpp}_it`, type: p.local.type, boxed: true };
        this.line(`lucent::Box<${this.cpp(p.local.type)}> ${copy.cpp}(*${p.local.cpp});`);
        this.scopes[this.scopes.length - 1]!.set(p.sym, copy);
      }
    });
    this.close();
    this.endLoop(entry);
    this.popScope();
    this.close();
  }

  private forOfStmt(s: ts.ForOfStatement, labels: string[]): void {
    if (s.awaitModifier) fail(s, Codes.UnsupportedLoop, "`for await` is not supported");
    const iterable = this.expr(s.expression);
    const it = stripOpt(iterable.t);
    const coll = this.ctx.fresh("coll");
    const idx = this.ctx.fresh("i");
    this.open("{");
    this.line(`auto ${coll} = ${iterable.c};`);
    const entry = this.loopEntry(labels);
    let elem: E;
    const bindElem = (value: E) => {
      const init = s.initializer;
      if (ts.isVariableDeclarationList(init)) {
        const d = init.declarations[0]!;
        this.bindPattern(d.name, value, true);
      } else {
        this.assignTo(init, value, init);
        this.line(";");
      }
    };
    if (it.k === "array" || it.k === "regexMatch") {
      const items = it.k === "regexMatch" ? `${coll}->items` : coll;
      this.open(`for (size_t ${idx} = 0; ${idx} < ${items}.size(); ${idx}++) {`);
      elem = it.k === "regexMatch" ? { c: `${items}.at(${idx})`, t: unionOf([T.string, T.undefined]) } : { c: `${coll}.at(${idx})`, t: it.e };
    } else if (it.k === "string") {
      this.line(`auto ${coll}_cps = lucent::splitCodePoints(${coll});`);
      this.open(`for (size_t ${idx} = 0; ${idx} < ${coll}_cps.size(); ${idx}++) {`);
      elem = { c: `${coll}_cps.at(${idx})`, t: T.string };
    } else if (it.k === "bytes") {
      this.open(`for (size_t ${idx} = 0; ${idx} < ${coll}.size(); ${idx}++) {`);
      elem = { c: `${coll}.at(${idx})`, t: T.number };
    } else if (it.k === "map" || it.k === "set" || it.k === "dict") {
      this.line(`typename std::decay_t<decltype(${coll}.table())>::Iterating ${coll}_guard(${coll}.table());`);
      this.open(`for (size_t ${idx} = 0; ${idx} < ${coll}.table().slotCount(); ${idx}++) {`);
      this.line(`if (!${coll}.table().slotLive(${idx})) continue;`);
      if (it.k === "set") elem = { c: `${coll}.table().slot(${idx}).key`, t: it.e };
      else if (it.k === "map") elem = { c: `std::tuple<${this.cpp(it.key)}, ${this.cpp(it.val)}>(${coll}.table().slot(${idx}).key, ${coll}.table().slot(${idx}).value)`, t: { k: "tuple", es: [it.key, it.val] } };
      else elem = { c: `std::tuple<lucent::String, ${this.cpp(it.val)}>(${coll}.table().slot(${idx}).key, ${coll}.table().slot(${idx}).value)`, t: { k: "tuple", es: [T.string, it.val] } };
    } else if (it.k === "iter") {
      // Leaving early (break, return, throw) closes the iterator, which runs
      // a generator's finally blocks; running out does not.
      this.line(`lucent::IterCloser<${this.cpp(it.e)}> ${coll}_close(${coll});`);
      this.open("for (;;) {");
      this.line(`auto ${coll}_v = ${coll}->next();`);
      this.line(`if (!${coll}_v) { ${coll}_close.exhausted(); break; }`);
      elem = { c: `std::move(*${coll}_v)`, t: it.e };
    } else {
      fail(s.expression, Codes.UnsupportedLoop, `cannot iterate over ${typeKey(iterable.t)}`);
    }
    this.loopBody(s.statement, entry, () => bindElem(elem));
    this.close();
    this.endLoop(entry);
    this.close();
  }

  private forInStmt(s: ts.ForInStatement, labels: string[]): void {
    const obj = this.expr(s.expression);
    const t = stripOpt(obj.t);
    const keys = this.ctx.fresh("keys");
    const idx = this.ctx.fresh("i");
    this.open("{");
    if (t.k === "dict") this.line(`auto ${keys} = (${obj.c}).keys();`);
    else if (t.k === "struct") {
      const names = this.reg.struct(t.id).fields.map((f) => stringLiteral(f.name));
      this.line(`lucent::Array<lucent::String> ${keys}{${names.join(", ")}};`);
    } else if (t.k === "array") {
      this.line(`lucent::Array<lucent::String> ${keys}; for (size_t k = 0; k < (${obj.c}).size(); k++) ${keys}.push(lucent::numberToString(static_cast<double>(k)));`);
    } else fail(s.expression, Codes.UnsupportedLoop, `cannot use for-in over ${typeKey(obj.t)}`);
    const entry = this.loopEntry(labels);
    this.open(`for (size_t ${idx} = 0; ${idx} < ${keys}.size(); ${idx}++) {`);
    this.loopBody(s.statement, entry, () => {
      const init = s.initializer;
      const value: E = { c: `${keys}.at(${idx})`, t: T.string };
      if (ts.isVariableDeclarationList(init)) this.bindPattern(init.declarations[0]!.name, value, true);
      else this.line(`${this.assignTo(init, value, init)};`);
    });
    this.close();
    this.endLoop(entry);
    this.close();
  }

  private switchStmt(s: ts.SwitchStatement, labels: string[]): void {
    const disc = this.expr(s.expression);
    const d = this.ctx.fresh("sw");
    const m = this.ctx.fresh("case");
    this.open("{");
    this.line(`auto ${d} = ${disc.c};`);
    this.line(`int ${m} = -1;`);
    const clauses = s.caseBlock.clauses;
    let first = true;
    let defaultIndex = -1;
    clauses.forEach((c, i) => {
      if (ts.isDefaultClause(c)) {
        defaultIndex = i;
        return;
      }
      const v = this.expr(c.expression);
      const test = this.equality({ c: d, t: disc.t }, v, true);
      this.line(`${first ? "" : "else "}if (${test}) ${m} = ${i};`);
      first = false;
    });
    if (defaultIndex >= 0) this.line(`${first ? "" : "else "}${m} = ${defaultIndex};`);
    const entry: ControlEntry = { kind: "switch", labels, breakLabel: this.ctx.fresh("brk") };
    this.ctl.push(entry);
    this.open(`switch (${m}) {`);
    clauses.forEach((c, i) => {
      this.line(`case ${i}:`);
      this.open("{");
      this.pushScope();
      for (const x of c.statements) this.stmt(x);
      this.popScope();
      this.close();
    });
    this.line("default: break;");
    this.close();
    this.ctl.pop();
    if (entry.usedBreakLabel) this.line(`${entry.breakLabel}:;`);
    this.close();
  }

  private labeled(s: ts.LabeledStatement): void {
    const labels = [s.label.text];
    let inner: ts.Statement = s.statement;
    while (ts.isLabeledStatement(inner)) {
      labels.push(inner.label.text);
      inner = inner.statement;
    }
    switch (inner.kind) {
      case ts.SyntaxKind.WhileStatement:
        return this.whileStmt(inner as ts.WhileStatement, labels);
      case ts.SyntaxKind.DoStatement:
        return this.doStmt(inner as ts.DoStatement, labels);
      case ts.SyntaxKind.ForStatement:
        return this.forStmt(inner as ts.ForStatement, labels);
      case ts.SyntaxKind.ForOfStatement:
        return this.forOfStmt(inner as ts.ForOfStatement, labels);
      case ts.SyntaxKind.ForInStatement:
        return this.forInStmt(inner as ts.ForInStatement, labels);
      case ts.SyntaxKind.SwitchStatement:
        return this.switchStmt(inner as ts.SwitchStatement, labels);
      default: {
        const entry: ControlEntry = { kind: "block", labels, breakLabel: this.ctx.fresh("brk") };
        this.ctl.push(entry);
        this.open("{");
        this.nested(inner);
        this.close();
        this.ctl.pop();
        if (entry.usedBreakLabel) this.line(`${entry.breakLabel}:;`);
      }
    }
  }

  private jump(kind: "break" | "continue", label: string | undefined, node: ts.Node): void {
    // Find the target.
    let targetIndex = -1;
    for (let i = this.ctl.length - 1; i >= 0; i--) {
      const c = this.ctl[i]!;
      if (c.kind === "finally") continue;
      if (label) {
        if (c.labels.includes(label)) {
          targetIndex = i;
          break;
        }
      } else if (c.kind === "loop" || (kind === "break" && c.kind === "switch")) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex < 0) fail(node, Codes.UnsupportedSyntax, `no target for ${kind}`);
    this.emitJump(kind, targetIndex);
  }

  private emitJump(kind: "break" | "continue", targetIndex: number): void {
    const target = this.ctl[targetIndex]!;
    const between = this.ctl.slice(targetIndex + 1);
    const fin = between.findLast((c) => c.kind === "finally");
    if (fin) {
      const code = (kind === "break" ? 100 : 200) + targetIndex;
      this.routeThroughFinally(fin, code, () => this.emitJump(kind, targetIndex));
      return;
    }
    // Plain C++ break/continue reach the innermost loop/switch.
    const innermostLoopOrSwitch = between.filter((c) => c.kind === "loop" || c.kind === "switch");
    if (kind === "break" && target.kind !== "block" && innermostLoopOrSwitch.length === 0) {
      this.line("break;");
      return;
    }
    const loopsBetween = between.filter((c) => c.kind === "loop");
    if (kind === "continue" && loopsBetween.length === 0) {
      this.line("continue;");
      return;
    }
    if (kind === "break") {
      target.usedBreakLabel = true;
      this.line(`goto ${target.breakLabel};`);
    } else {
      target.usedContinueLabel = true;
      this.line(`goto ${target.continueLabel};`);
    }
  }

  private throwStmt(s: ts.ThrowStatement): void {
    const e = this.expr(s.expression);
    const t = stripOpt(e.t);
    if (t.k === "error") this.line(`lucent::throwError(${e.c});`);
    else if (t.k === "class" && this.reg.cls(t.id).isError) this.line(`lucent::throwError(${e.c});`);
    else fail(s.expression, Codes.UnsupportedThrow, "only Error values can be thrown; use `throw new Error(...)`");
  }

  private tryStmt(s: ts.TryStatement): void {
    this.open("{");
    let fin: ControlEntry | undefined;
    if (s.finallyBlock) {
      fin = { kind: "finally", labels: [], finLabel: this.ctx.fresh("fin"), finVar: this.ctx.fresh("fc"), pending: new Map() };
      this.line(`int ${fin.finVar} = 0;`);
      this.line(`std::exception_ptr ${fin.finVar}_ex;`);
      this.ctl.push(fin);
      this.open("try {");
    }
    // try + catch
    const ex = this.ctx.fresh("ex");
    if (s.catchClause) {
      this.line(`std::exception_ptr ${ex};`);
      this.open("try {");
      this.nested(s.tryBlock);
      // iterator.return() unwinds a generator through finally blocks only.
      this.close("} catch (const lucent::GeneratorReturn&) {");
      this.depth++;
      this.line("throw;");
      this.close("} catch (...) {");
      this.depth++;
      this.line(`${ex} = std::current_exception();`);
      this.close();
      this.open(`if (${ex}) {`);
      this.pushScope();
      const v = s.catchClause.variableDeclaration;
      if (v) {
        if (!ts.isIdentifier(v.name)) fail(v, Codes.UnsupportedDestructuring, "destructuring in catch is not supported");
        const sym = this.checker.getSymbolAtLocation(v.name)!;
        this.declareVar(sym, v.name.text, T.error, `lucent::currentError(${ex})`);
      }
      for (const x of s.catchClause.block.statements) this.stmt(x);
      this.popScope();
      this.close();
    } else {
      this.nested(s.tryBlock);
    }
    if (fin) {
      this.close("} catch (...) {");
      this.depth++;
      this.line(`${fin.finVar}_ex = std::current_exception();`);
      this.close();
      this.ctl.pop();
      this.line(`${fin.finLabel}:;`);
      this.open("{");
      this.nested(s.finallyBlock!);
      this.close();
      this.line(`if (${fin.finVar}_ex) std::rethrow_exception(${fin.finVar}_ex);`);
      for (const [code, after] of fin.pending!) {
        this.open(`if (${fin.finVar} == ${code}) {`);
        after();
        this.close();
      }
    }
    this.close();
  }

  // --- expressions --------------------------------------------------------------------------

  expr(node: ts.Expression, hint?: LType): E {
    const s = this.subst.get(node);
    if (s) return s;
    switch (node.kind) {
      case ts.SyntaxKind.NumericLiteral: {
        const v = Number((node as ts.NumericLiteral).text.replace(/_/g, ""));
        const c = numberLiteral(v);
        if (Number.isInteger(v) && v >= 0 && v <= 2147483647) return { c, t: T.number, int: { c: String(v), kind: "i32" } };
        if (Number.isInteger(v) && v > 2147483647 && v <= 4294967295) return { c, t: T.number, int: { c: `${v}u`, kind: "u32" } };
        return { c, t: T.number };
      }
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
        return { c: stringLiteral((node as ts.StringLiteral).text), t: T.string };
      case ts.SyntaxKind.TemplateExpression:
        return this.template(node as ts.TemplateExpression);
      case ts.SyntaxKind.TrueKeyword:
        return { c: "true", t: T.boolean };
      case ts.SyntaxKind.FalseKeyword:
        return { c: "false", t: T.boolean };
      case ts.SyntaxKind.NullKeyword:
        return { c: "lucent::null", t: T.null };
      case ts.SyntaxKind.Identifier:
        return this.identifier(node as ts.Identifier);
      case ts.SyntaxKind.ThisKeyword:
        return this.thisValue(node);
      case ts.SyntaxKind.ParenthesizedExpression: {
        const e = this.expr((node as ts.ParenthesizedExpression).expression, hint);
        return { c: `(${e.c})`, t: e.t, int: e.int && { c: `(${e.int.c})`, kind: e.int.kind } };
      }
      case ts.SyntaxKind.AsExpression:
      case ts.SyntaxKind.TypeAssertionExpression:
      case ts.SyntaxKind.SatisfiesExpression: {
        const inner = (node as ts.AsExpression).expression;
        if (ts.isAsExpression(node) && ts.isTypeReferenceNode(node.type) && node.type.typeName.getText() === "const") return this.expr(inner, hint);
        const target = this.lt(node);
        const e = this.expr(inner, target);
        return { c: this.coerce(e, target, node), t: target };
      }
      case ts.SyntaxKind.NonNullExpression: {
        const e = this.expr((node as ts.NonNullExpression).expression);
        if (e.t.k === "opt") return { c: `(${e.c}).value()`, t: e.t.inner };
        return e;
      }
      case ts.SyntaxKind.PrefixUnaryExpression:
        return this.prefix(node as ts.PrefixUnaryExpression);
      case ts.SyntaxKind.PostfixUnaryExpression:
        return this.postfix(node as ts.PostfixUnaryExpression);
      case ts.SyntaxKind.BinaryExpression:
        return this.binary(node as ts.BinaryExpression);
      case ts.SyntaxKind.ConditionalExpression:
        return this.conditional(node as ts.ConditionalExpression);
      case ts.SyntaxKind.RegularExpressionLiteral: {
        const text = (node as ts.RegularExpressionLiteral).text;
        const end = text.lastIndexOf("/");
        return { c: `lucent::makeRegExp(${stringLiteral(text.slice(1, end))}, lucent::Opt<lucent::String>(${stringLiteral(text.slice(end + 1))}))`, t: T.regexp };
      }
      case ts.SyntaxKind.YieldExpression:
        fail(node, Codes.UnsupportedSyntax, "`yield` can only be used as a statement; its value is not supported");
      case ts.SyntaxKind.CallExpression:
        if (builtins.isJsonParse(this, node as ts.CallExpression)) return this.jsonParse(node as ts.CallExpression, hint);
        return this.narrowed(node, this.call(node as ts.CallExpression));
      case ts.SyntaxKind.NewExpression:
        return this.newExpr(node as ts.NewExpression);
      case ts.SyntaxKind.PropertyAccessExpression:
        return this.narrowed(node, this.propertyAccess(node as ts.PropertyAccessExpression));
      case ts.SyntaxKind.ElementAccessExpression:
        return this.narrowed(node, this.elementAccess(node as ts.ElementAccessExpression));
      case ts.SyntaxKind.ArrayLiteralExpression:
        return this.arrayLiteral(node as ts.ArrayLiteralExpression, hint);
      case ts.SyntaxKind.ObjectLiteralExpression:
        return this.objectLiteral(node as ts.ObjectLiteralExpression, hint);
      case ts.SyntaxKind.ArrowFunction:
      case ts.SyntaxKind.FunctionExpression:
        return this.closure(node as ts.ArrowFunction, hint);
      case ts.SyntaxKind.AwaitExpression:
        return this.awaitExpr(node as ts.AwaitExpression);
      case ts.SyntaxKind.TypeOfExpression:
        return { c: `lucent::typeOf(${this.expr((node as ts.TypeOfExpression).expression).c})`, t: T.string };
      case ts.SyntaxKind.VoidExpression: {
        const e = this.expr((node as ts.VoidExpression).expression);
        return { c: `((void)(${e.c}), lucent::undefined)`, t: T.undefined };
      }
      case ts.SyntaxKind.DeleteExpression:
        return this.deleteExpr(node as ts.DeleteExpression);
      default:
        fail(node, Codes.UnsupportedSyntax, `unsupported expression: ${ts.SyntaxKind[node.kind]}`);
    }
  }

  /** Applies the checker's narrowing at `node` to a value read. */
  narrowed(node: ts.Node, e: E): E {
    if (isOptionalChain(node)) return e;
    let t: LType;
    try {
      t = this.lt(node);
    } catch {
      return e;
    }
    if (t.k === "never" || sameType(t, e.t)) return e;
    // Only narrow (never widen) based on the checker.
    const toSubclass = e.t.k === "class" && t.k === "class" && e.t.id !== t.id && this.reg.derives(t.id, e.t.id);
    if (e.t.k === "opt" || e.t.k === "union" || ((e.t.k === "error" || e.t.k === "iface") && t.k === "class") || toSubclass) {
      return { c: this.coerce(e, t, node), t };
    }
    return e;
  }

  private template(node: ts.TemplateExpression): E {
    return this.inOrder(
      node.templateSpans.map((s) => s.expression),
      () => this.templateInner(node),
    );
  }

  private templateInner(node: ts.TemplateExpression): E {
    // Numbers go to lucent::concat unformatted (exact integers as such), so
    // the result is built with one allocation.
    const parts: string[] = [];
    if (node.head.text) parts.push(stringLiteral(node.head.text));
    for (const span of node.templateSpans) {
      const e = this.expr(span.expression);
      parts.push(e.int ? e.int.c : e.t.k === "number" ? e.c : this.toStringCode(e));
      if (span.literal.text) parts.push(stringLiteral(span.literal.text));
    }
    if (parts.length === 0) return { c: "lucent::String()", t: T.string };
    return { c: `lucent::concat(${parts.join(", ")})`, t: T.string };
  }

  toStringCode(e: E): string {
    if (e.t.k === "string") return e.c;
    return `lucent::toJsString(${e.c})`;
  }

  private identifier(id: ts.Identifier): E {
    const text = id.text;
    const sym0 = symbolOf(this.checker, id);
    if (!sym0) {
      if (text === "undefined") return { c: "lucent::undefined", t: T.undefined };
      fail(id, Codes.UnsupportedSyntax, `unknown identifier ${text}`);
    }
    const sym = this.ctx.resolve(sym0);
    if (this.failed.has(sym)) throw new AlreadyReported();
    const local = this.findLocal(sym);
    if (local?.int) return this.intE(local.cpp, local.int);
    if (local) {
      const e: E = { c: local.boxed ? `(*${local.cpp})` : local.cpp, t: local.type };
      return this.narrowed(id, e);
    }
    const g = this.ctx.globals.get(sym);
    if (g) {
      if (g.kind === "var") return this.narrowed(id, { c: g.cpp, t: g.type });
      if (g.kind === "function") {
        if (g.generic) fail(id, Codes.UnsupportedSyntax, "generic functions cannot be used as values");
        const fnType = g.type;
        const params = g.params.map((p, i) => `${this.cpp(p.cppType)} a${i}`).join(", ");
        const args = g.params.map((_, i) => `a${i}`).join(", ");
        const ret = g.async ? `lucent::Promise<${this.reg.cppRet(fnType.ret.k === "promise" ? fnType.ret.inner : fnType.ret)}>` : this.reg.cppRet(fnType.ret);
        const t: LType = { k: "fn", params: g.params.map((p) => p.cppType), ret: fnType.ret };
        return { c: `${this.cpp(t)}([](${params}) -> ${ret} { return ${g.cpp}(${args}); })`, t };
      }
      fail(id, Codes.UnsupportedSyntax, `a class cannot be used as a value here`);
    }
    const sdkConstant = native.nativeConstant(this, id);
    if (sdkConstant) return sdkConstant;
    switch (text) {
      case "undefined":
        return { c: "lucent::undefined", t: T.undefined };
      case "NaN":
        return { c: "lucent::kNaN", t: T.number };
      case "Infinity":
        return { c: "lucent::kInfinity", t: T.number };
    }
    fail(id, Codes.UnsupportedSyntax, `unsupported reference to \`${text}\``);
  }

  private thisValue(node: ts.Node): E {
    if (!this.opts.cls) fail(node, Codes.UnsupportedSyntax, "`this` is only supported inside class members");
    const t = this.lt(node);
    return { c: this.selfRef(), t };
  }

  /** `this->` or `self->` for member access. */
  thisAccess(): string {
    return this.opts.thisExpr === "self" ? "self->" : "this->";
  }

  private prefix(node: ts.PrefixUnaryExpression): E {
    const op = node.operator;
    if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) {
      return this.increment(node.operand, op === ts.SyntaxKind.PlusPlusToken ? "+" : "-", false, node);
    }
    const e = this.expr(node.operand);
    switch (op) {
      case ts.SyntaxKind.ExclamationToken:
        return { c: e.t.k === "boolean" ? `(!${e.c})` : `(!lucent::truthy(${e.c}))`, t: T.boolean };
      case ts.SyntaxKind.MinusToken:
        return { c: `(-${this.coerce(e, T.number, node)})`, t: T.number };
      case ts.SyntaxKind.PlusToken:
        if (stripOpt(e.t).k === "string") return { c: `lucent::stringToNumber(${this.coerce(e, T.string, node)})`, t: T.number };
        return { c: this.coerce(e, T.number, node), t: T.number };
      case ts.SyntaxKind.TildeToken:
        return this.intE(`(~${this.i32(e, node)})`, "i32");
    }
    fail(node, Codes.UnsupportedOperator, "unsupported prefix operator");
  }

  private postfix(node: ts.PostfixUnaryExpression): E {
    return this.increment(node.operand, node.operator === ts.SyntaxKind.PlusPlusToken ? "+" : "-", true, node);
  }

  /** ++x, x++, --x, x-- on locals, fields and elements. */
  private increment(target: ts.Expression, sign: "+" | "-", postfix: boolean, _node: ts.Node): E {
    const op = sign === "+" ? "++" : "--";
    const il = this.intLocal(target);
    if (il) return { c: `static_cast<double>(${postfix ? `${il.cpp}${op}` : `${op}${il.cpp}`})`, t: T.number };
    const lv = this.lvalue(target);
    if (lv.direct) return { c: postfix ? `(${lv.direct}${op})` : `(${op}${lv.direct})`, t: T.number };
    const tmp = this.ctx.fresh("v");
    const set = lv.set!(`(${tmp} ${sign} 1)`);
    return {
      c: postfix ? `({ double ${tmp} = ${lv.get}; ${set}; ${tmp}; })` : `({ double ${tmp} = ${lv.get}; ${set}; ${tmp} ${sign} 1; })`,
      t: T.number,
    };
  }

  /**
   * An assignable place. `direct` is a C++ lvalue when one exists; otherwise
   * `get`/`set` read and write it (for array elements, setters…).
   */
  lvalue(target: ts.Expression): { direct?: string; get: string; set?: (v: string) => string; type: LType; setup?: string } {
    if (ts.isParenthesizedExpression(target)) return this.lvalue(target.expression);
    if (ts.isIdentifier(target)) {
      const sym = this.ctx.resolve(symbolOf(this.checker, target)!);
      const local = this.findLocal(sym);
      if (local?.int) {
        const kind = local.int;
        const x = local.cpp;
        return { get: `static_cast<double>(${x})`, set: (v) => `(${x} = ${this.toKind({ c: v, t: T.number }, kind, target)})`, type: T.number };
      }
      if (local) {
        const c = local.boxed ? `(*${local.cpp})` : local.cpp;
        return { direct: c, get: c, type: local.type };
      }
      const g = this.ctx.globals.get(sym);
      if (g && g.kind === "var") return { direct: g.cpp, get: g.cpp, type: g.type };
      fail(target, Codes.UnsupportedAssignmentTarget, `cannot assign to ${target.text}`);
    }
    if (ts.isPropertyAccessExpression(target)) {
      const name = target.name.text;
      if (ts.isIdentifier(target.expression)) {
        const nativeStatic = native.nativeLvalue(this, target, undefined);
        if (nativeStatic) return nativeStatic;
        const staticLv = builtins.staticMemberLvalue(this, target);
        if (staticLv) return staticLv;
      }
      const obj = this.receiver(target.expression);
      const ot = stripOpt(obj.t);
      if (ot.k === "native") {
        const lv = native.nativeLvalue(this, target, obj);
        if (lv) return lv;
      }
      if (ot.k === "struct") {
        const f = this.reg.struct(ot.id).fields.find((x) => x.name === name);
        if (!f) fail(target, Codes.UnsupportedAssignmentTarget, `unknown field ${name}`);
        const c = `${this.coerce(obj, ot, target)}->${cppIdent(name)}`;
        return { direct: c, get: c, type: f.type };
      }
      if (ot.k === "class") return builtins.classMemberLvalue(this, obj, ot, name, target);
      if (ot.k === "iface") return builtins.ifaceMemberLvalue(this, obj, ot, name, target);
      if (ot.k === "regexp" && name === "lastIndex") {
      const c = `${obj.c}->lastIndex`;
      return { direct: c, get: c, type: T.number };
    }
    if (ot.k === "array" && name === "length") {
        const tmp = this.ctx.fresh("arr");
        return { get: `${obj.c}.length()`, set: (v) => `${obj.c}.setLength(${v})`, type: T.number, setup: tmp };
      }
      fail(target, Codes.UnsupportedAssignmentTarget, `cannot assign to .${name} of ${typeKey(obj.t)}`);
    }
    if (ts.isElementAccessExpression(target)) {
      const obj = this.expr(target.expression);
      const ot = stripOpt(obj.t);
      const o = this.ctx.fresh("o");
      const k = this.ctx.fresh("k");
      if (ot.k === "array" || ot.k === "bytes") {
        const elemT = ot.k === "array" ? ot.e : T.number;
        const idx = this.exprAs(target.argumentExpression, T.number);
        return {
          get: `lucent::elementAt(${obj.c}, ${idx})`,
          set: (v) => `lucent::setElement(${obj.c}, ${idx}, ${v})`,
          type: elemT,
        };
      }
      if (ot.k === "dict") {
        const key = this.exprAs(target.argumentExpression, T.string);
        return { get: `lucent::entryAt(${obj.c}, ${key})`, set: (v) => `lucent::setEntry(${obj.c}, ${key}, ${v})`, type: ot.val };
      }
      void o;
      void k;
      fail(target, Codes.UnsupportedAssignmentTarget, `cannot assign to an element of ${typeKey(obj.t)}`);
    }
    fail(target, Codes.UnsupportedAssignmentTarget, "unsupported assignment target");
  }

  /** `target = value` as an expression. */
  assignTo(target: ts.Expression, value: E, node: ts.Node): string {
    if (ts.isArrayLiteralExpression(target)) {
      const tmp = this.ctx.fresh("da");
      const parts: string[] = [`auto ${tmp} = ${value.c};`];
      const vt = stripOpt(value.t);
      target.elements.forEach((el, i) => {
        if (ts.isOmittedExpression(el)) return;
        if (ts.isSpreadElement(el)) fail(el, Codes.UnsupportedDestructuring, "rest elements in destructuring assignments are not supported");
        const v: E = vt.k === "tuple" ? { c: `std::get<${i}>(${tmp})`, t: vt.es[i]! } : vt.k === "array" ? { c: `${tmp}.get(${i}.0)`, t: unionOf([vt.e, T.undefined]) } : fail(el, Codes.UnsupportedDestructuring, "cannot destructure this value");
        parts.push(`(void)(${this.assignElement(el, v)});`);
      });
      return `({ ${parts.join(" ")} ${tmp}; })`;
    }
    if (ts.isObjectLiteralExpression(target)) {
      const tmp = this.ctx.fresh("do");
      const parts: string[] = [`auto ${tmp} = ${value.c};`];
      const src: E = { c: tmp, t: value.t };
      for (const p of target.properties) {
        if (ts.isShorthandPropertyAssignment(p)) {
          let v = this.member(src, p.name.text, p);
          if (p.objectAssignmentInitializer) v = this.withDefault(v, p.objectAssignmentInitializer, p);
          parts.push(`(void)(${this.assignTo(p.name, v, p)});`);
        } else if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
          parts.push(`(void)(${this.assignElement(p.initializer, this.member(src, p.name.text, p))});`);
        } else {
          fail(p, Codes.UnsupportedDestructuring, "only named properties can be destructured in assignments");
        }
      }
      return `({ ${parts.join(" ")} ${tmp}; })`;
    }
    const il = this.intLocal(target);
    if (il) return `static_cast<double>(${il.cpp} = ${this.toKind(value, il.int!, node)})`;
    const lv = this.lvalue(target);
    const v = this.coerce(value, lv.type, node);
    if (lv.direct) return `(${lv.direct} = ${v})`;
    return lv.set!(v);
  }

  /** One element of a destructuring assignment: `x`, `x = default`, or a nested pattern. */
  private assignElement(el: ts.Expression, v: E): string {
    if (ts.isBinaryExpression(el) && el.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return this.assignTo(el.left, this.withDefault(v, el.right, el), el);
    }
    return this.assignTo(el, v, el);
  }

  private binary(node: ts.BinaryExpression): E {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.EqualsToken) {
      const lvType = this.lvalueType(node.left);
      const value = this.expr(node.right, lvType);
      return { c: this.assignTo(node.left, value, node), t: lvType ?? value.t };
    }
    const compound = ASSIGN_OPS.get(op);
    if (compound) return this.compoundAssign(node, compound);
    if (op === ts.SyntaxKind.QuestionQuestionEqualsToken || op === ts.SyntaxKind.BarBarEqualsToken || op === ts.SyntaxKind.AmpersandAmpersandEqualsToken) {
      const lv = this.lvalue(node.left);
      const cur: E = { c: lv.get, t: lv.type };
      const test = op === ts.SyntaxKind.QuestionQuestionEqualsToken ? `!(${lv.get}).has()` : op === ts.SyntaxKind.BarBarEqualsToken ? `!lucent::truthy(${lv.get})` : `lucent::truthy(${lv.get})`;
      const assign = this.assignTo(node.left, this.expr(node.right, lv.type), node);
      return { c: `({ if (${test}) ${assign}; ${this.coerce(cur, lv.type, node)}; })`, t: lv.type };
    }
    switch (op) {
      case ts.SyntaxKind.AmpersandAmpersandToken:
      case ts.SyntaxKind.BarBarToken:
        return this.logical(node, op === ts.SyntaxKind.AmpersandAmpersandToken);
      case ts.SyntaxKind.QuestionQuestionToken:
        return this.nullish(node);
      case ts.SyntaxKind.CommaToken: {
        const a = this.expr(node.left);
        const b = this.expr(node.right);
        return { c: `((void)(${a.c}), ${b.c})`, t: b.t };
      }
      case ts.SyntaxKind.InstanceOfKeyword:
        return builtins.instanceOf(this, node);
      case ts.SyntaxKind.InKeyword: {
        const obj = this.expr(node.right);
        const ot = stripOpt(obj.t);
        const key = this.exprAs(node.left, T.string);
        if (ot.k === "dict") return { c: `(${obj.c}).has(${key})`, t: T.boolean };
        if (ot.k === "struct") {
          const names = this.reg.struct(ot.id).fields.map((f) => `${key} == ${stringLiteral(f.name)}`);
          return { c: `(${names.join(" || ") || "false"})`, t: T.boolean };
        }
        fail(node, Codes.UnsupportedOperator, "`in` is only supported on records");
      }
    }
    return this.inOrder([node.left, node.right], () => this.binaryOp(node, op));
  }

  private binaryOp(node: ts.BinaryExpression, op: ts.SyntaxKind): E {
    const a = this.expr(node.left);
    const b = this.expr(node.right);
    switch (op) {
      case ts.SyntaxKind.EqualsEqualsEqualsToken:
        return { c: this.equality(a, b, true), t: T.boolean };
      case ts.SyntaxKind.ExclamationEqualsEqualsToken:
        return { c: `(!${this.equality(a, b, true)})`, t: T.boolean };
      case ts.SyntaxKind.EqualsEqualsToken:
        return { c: this.equality(a, b, false), t: T.boolean };
      case ts.SyntaxKind.ExclamationEqualsToken:
        return { c: `(!${this.equality(a, b, false)})`, t: T.boolean };
      case ts.SyntaxKind.PlusToken: {
        const at = stripOpt(a.t), bt = stripOpt(b.t);
        if (at.k === "string" || bt.k === "string") {
          return { c: `(${at.k === "string" && a.t.k !== "opt" ? `lucent::String(${a.c})` : this.toStringCode(a)} + ${this.toStringCode(b)})`, t: T.string };
        }
        return this.arith(a, b, "+", node);
      }
      case ts.SyntaxKind.MinusToken:
        return this.arith(a, b, "-", node);
      case ts.SyntaxKind.AsteriskToken:
        return this.arith(a, b, "*", node);
      case ts.SyntaxKind.SlashToken:
        return this.arith(a, b, "/", node);
      case ts.SyntaxKind.PercentToken:
        return { c: `lucent::jsMod(${this.num(a, node)}, ${this.num(b, node)})`, t: T.number };
      case ts.SyntaxKind.AsteriskAsteriskToken:
        return { c: `lucent::jsPow(${this.num(a, node)}, ${this.num(b, node)})`, t: T.number };
      case ts.SyntaxKind.AmpersandToken:
        return this.bitwise("&", a, b, node);
      case ts.SyntaxKind.BarToken:
        return this.bitwise("|", a, b, node);
      case ts.SyntaxKind.CaretToken:
        return this.bitwise("^", a, b, node);
      case ts.SyntaxKind.LessThanLessThanToken:
        return this.bitwise("<<", a, b, node);
      case ts.SyntaxKind.GreaterThanGreaterThanToken:
        return this.bitwise(">>", a, b, node);
      case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
        return this.bitwise(">>>", a, b, node);
      case ts.SyntaxKind.LessThanToken:
      case ts.SyntaxKind.GreaterThanToken:
      case ts.SyntaxKind.LessThanEqualsToken:
      case ts.SyntaxKind.GreaterThanEqualsToken: {
        const sym = node.operatorToken.getText();
        const at = stripOpt(a.t);
        if (at.k === "string") return { c: `(${this.coerce(a, T.string, node)} ${sym} ${this.coerce(b, T.string, node)})`, t: T.boolean };
        return { c: `(${this.num(a, node)} ${sym} ${this.num(b, node)})`, t: T.boolean };
      }
    }
    fail(node, Codes.UnsupportedOperator, `unsupported operator ${node.operatorToken.getText()}`);
  }

  private lvalueType(target: ts.Expression): LType | undefined {
    try {
      if (ts.isArrayLiteralExpression(target)) return undefined;
      return this.lvalue(target).type;
    } catch {
      return undefined;
    }
  }

  num(e: E, node: ts.Node): string {
    return this.coerce(e, T.number, node);
  }

  private arith(a: E, b: E, op: string, node: ts.Node): E {
    return { c: `(${this.num(a, node)} ${op} ${this.num(b, node)})`, t: T.number };
  }

  /** `===` (strict) or `==` between two values. */
  equality(a: E, b: E, strict: boolean): string {
    const at = a.t, bt = b.t;
    const absent = (t: LType) => t.k === "undefined" || t.k === "null";
    // Types that can hold null or undefined: a template parameter may be
    // instantiated with an optional type.
    const mayBeAbsent = (t: LType): boolean => t.k === "opt" || t.k === "void" || t.k === "tparam" || t.k === "never" || absent(t) || (t.k === "union" && t.ms.some(mayBeAbsent));
    // A present value is never null or undefined; it is still evaluated.
    const never = (e: E) => `((void)(${e.c}), false)`;
    if (!strict && (absent(bt) || absent(at))) {
      const other = absent(bt) ? a : b;
      if (other.t.k === "opt") return `(!(${other.c}).has())`;
      if (absent(other.t)) return "true";
      return never(other);
    }
    if (absent(at) !== absent(bt)) {
      const other = absent(bt) ? a : b;
      if (!mayBeAbsent(other.t)) return never(other);
    }
    if (at.k === "number" && bt.k === "number") return `(${a.c} == ${b.c})`;
    if (at.k === "boolean" && bt.k === "boolean") return `(${a.c} == ${b.c})`;
    if (at.k === "string" && bt.k === "string") return `(${a.c} == ${b.c})`;
    return `lucent::strictEquals(${a.c}, ${b.c})`;
  }

  private compoundAssign(node: ts.BinaryExpression, op: string): E {
    const BITWISE = ["&", "|", "^", "<<", ">>", ">>>"];
    const il = this.intLocal(node.left);
    if (il?.int === "i64" && (op === "+" || op === "-")) {
      return { c: `static_cast<double>(${il.cpp} ${op}= ${this.toKind(this.expr(node.right), "i64", node)})`, t: T.number };
    }
    if (il && BITWISE.includes(op)) {
      const r = this.bitwise(op, this.intE(il.cpp, il.int!), this.expr(node.right), node);
      return { c: `static_cast<double>(${il.cpp} = ${this.toKind(r, il.int!, node)})`, t: T.number };
    }
    const lv = this.lvalue(node.left);
    const rhs = this.expr(node.right);
    const lt = stripOpt(lv.type);
    let combine: (cur: string) => string;
    if (op === "+" && lt.k === "string") {
      const r = this.toStringCode(rhs);
      if (lv.direct && lv.type.k === "string") return { c: `(${lv.direct} += ${r})`, t: T.string };
      combine = (cur) => `(lucent::String(${cur}) + ${r})`;
    } else {
      const r = this.num(rhs, node);
      const fnOps: Record<string, string> = { "%": "jsMod", "**": "jsPow", "&": "jsAnd", "|": "jsOr", "^": "jsXor", "<<": "jsShl", ">>": "jsSar", ">>>": "jsShr" };
      if (["+", "-", "*", "/"].includes(op)) {
        if (lv.direct && lv.type.k === "number") return { c: `(${lv.direct} ${op}= ${r})`, t: T.number };
        combine = (cur) => `(${cur} ${op} ${r})`;
      } else if (BITWISE.includes(op)) combine = (cur) => this.bitwise(op, { c: cur, t: T.number }, rhs, node).c;
      else combine = (cur) => `lucent::${fnOps[op]}(${cur}, ${r})`;
    }
    const cur = this.coerce({ c: lv.get, t: lv.type }, lt, node);
    if (lv.direct) return { c: `(${lv.direct} = ${combine(cur)})`, t: lt };
    const tmp = this.ctx.fresh("v");
    return { c: `({ auto ${tmp} = ${combine(cur)}; ${lv.set!(tmp)}; ${tmp}; })`, t: lt };
  }

  private logical(node: ts.BinaryExpression, isAnd: boolean): E {
    const a = this.expr(node.left);
    const b = this.expr(node.right);
    if (a.t.k === "boolean" && b.t.k === "boolean") return { c: `(${a.c} ${isAnd ? "&&" : "||"} ${b.c})`, t: T.boolean };
    const t = this.lt(node);
    const tmp = this.ctx.fresh("l");
    const test = a.t.k === "boolean" ? tmp : `lucent::truthy(${tmp})`;
    const pick = isAnd ? `${test} ? ${this.coerce(b, t, node)} : ${this.coerceNarrowed({ c: tmp, t: a.t }, t, node)}` : `${test} ? ${this.coerceNarrowed({ c: tmp, t: a.t }, t, node)} : ${this.coerce(b, t, node)}`;
    return { c: `({ auto ${tmp} = ${a.c}; ${pick}; })`, t };
  }

  /** Coerces a value whose runtime value is known (by a branch) to fit `to`. */
  private coerceNarrowed(e: E, to: LType, node: ts.Node): string {
    try {
      return this.coerce(e, to, node);
    } catch {
      return `lucent::convert<${this.cpp(to)}>(${e.c})`;
    }
  }

  private nullish(node: ts.BinaryExpression): E {
    const a = this.expr(node.left);
    const t = this.lt(node);
    const b = this.expr(node.right, t);
    if (a.t.k !== "opt") return a.t.k === "undefined" || a.t.k === "null" ? { c: this.coerce(b, t, node), t } : { c: this.coerce(a, t, node), t };
    const tmp = this.ctx.fresh("n");
    return { c: `({ auto ${tmp} = ${a.c}; ${tmp}.has() ? ${this.coerce({ c: `${tmp}.get()`, t: a.t.inner }, t, node)} : ${this.coerce(b, t, node)}; })`, t };
  }

  private conditional(node: ts.ConditionalExpression): E {
    const t = this.lt(node);
    const c = this.cond(node.condition);
    const a = this.expr(node.whenTrue, t);
    const b = this.expr(node.whenFalse, t);
    return { c: `(${c} ? ${this.coerce(a, t, node.whenTrue)} : ${this.coerce(b, t, node.whenFalse)})`, t };
  }

  private awaitExpr(node: ts.AwaitExpression): E {
    if (!this.opts.async) fail(node, Codes.UnsupportedSyntax, "`await` outside an async function");
    const e = this.expr(node.expression);
    const t = stripOpt(e.t);
    if (e.t.k === "promise") {
      const inner = e.t.inner;
      return { c: `(co_await ${e.c})`, t: isVoidish(inner) ? T.undefined : inner };
    }
    if (t.k === "promise") fail(node, Codes.UnsupportedSyntax, "awaiting an optional promise is not supported");
    return e;
  }

  private deleteExpr(node: ts.DeleteExpression): E {
    const target = node.expression;
    if (ts.isElementAccessExpression(target)) {
      const obj = this.expr(target.expression);
      if (stripOpt(obj.t).k === "dict") return { c: `(${obj.c}).remove(${this.exprAs(target.argumentExpression, T.string)})`, t: T.boolean };
    }
    fail(node, Codes.UnsupportedOperator, "`delete` is only supported on record entries (`delete record[key]`)");
  }

  // --- member access ---------------------------------------------------------------

  /** Reads `name` from a value (struct field, class member, builtin property). */
  member(obj: E, name: string, node: ts.Node): E {
    const t = obj.t;
    if (t.k === "opt") fail(node, Codes.UnsupportedSyntax, `value may be undefined; check it before reading .${name}`);
    if (t.k === "struct") {
      const f = this.reg.struct(t.id).fields.find((x) => x.name === name);
      if (!f) fail(node, Codes.UnsupportedSyntax, `unknown field ${name}`);
      return { c: `${obj.c}->${cppIdent(name)}`, t: f.type };
    }
    if (t.k === "union") {
      // A field every member has: read it with std::visit.
      const types = t.ms.map((m) => (m.k === "struct" || m.k === "class" ? this.member({ c: "v", t: m }, name, node) : fail(node, Codes.UnsupportedSyntax, `cannot read .${name} of ${typeKey(t)}`)));
      const rt = unionOf(types.map((x) => x.t));
      return { c: `std::visit([&](const auto& v) -> ${this.cpp(rt)} { return v->${cppIdent(name)}; }, ${obj.c})`, t: rt };
    }
    if (t.k === "class") return builtins.classMember(this, obj, t, name, node);
    if (t.k === "native") return native.nativeMember(this, obj, node);
    if (t.k === "iface") return builtins.ifaceMember(this, obj, t, name, node);
    return builtins.property(this, obj, name, node);
  }

  private propertyAccess(node: ts.PropertyAccessExpression): E {
    if (isOptionalChain(node)) return this.chainPart(node).e;
    const nativeE = native.nativeStaticProperty(this, node);
    if (nativeE) return nativeE;
    const staticE = builtins.staticProperty(this, node);
    if (staticE) return staticE;
    if (node.expression.kind === ts.SyntaxKind.SuperKeyword) return builtins.superMember(this, node.name.text, node);
    const obj = this.receiver(node.expression);
    return this.member(obj, node.name.text, node);
  }

  /** The object of a member access; `this` stays a raw pointer. */
  receiver(node: ts.Expression): E {
    if (node.kind === ts.SyntaxKind.ThisKeyword && this.opts.cls) {
      return { c: this.opts.thisExpr === "self" ? "self" : "this", t: this.lt(node) };
    }
    return this.expr(node);
  }

  private elementAccess(node: ts.ElementAccessExpression): E {
    if (isOptionalChain(node)) return this.chainPart(node).e;
    return this.elementOf(this.expr(node.expression), node.argumentExpression, node);
  }

  /** `obj[arg]` on an already-evaluated object. */
  elementOf(obj: E, arg: ts.Expression, node: ts.Node): E {
    const t = obj.t;
    switch (t.k) {
      case "array": {
        const i = this.expr(arg, T.number);
        const index = i.int ? `static_cast<int64_t>(${i.int.c})` : this.coerce(i, T.number, arg);
        return { c: i.int ? `(${obj.c}).getIndex(${index})` : `(${obj.c}).get(${index})`, t: unionOf([t.e, T.undefined]) };
      }
      case "regexMatch":
        return { c: `lucent::matchItem(${obj.c}, ${this.exprAs(arg, T.number)})`, t: unionOf([T.string, T.undefined]) };
      case "tuple": {
        if (!ts.isNumericLiteral(arg)) fail(arg, Codes.UnsupportedSyntax, "tuple elements need a literal index");
        const i = Number(arg.text);
        return { c: `std::get<${i}>(${obj.c})`, t: t.es[i]! };
      }
      case "dict":
        return { c: `(${obj.c}).get(${this.exprAs(arg, T.string)})`, t: unionOf([t.val, T.undefined]) };
      case "string":
        return { c: `lucent::stringIndex(${obj.c}, ${this.exprAs(arg, T.number)})`, t: unionOf([T.string, T.undefined]) };
      case "bytes":
        return { c: `(${obj.c}).get(${this.exprAs(arg, T.number)})`, t: unionOf([T.number, T.undefined]) };
      case "struct": {
        if (ts.isStringLiteral(arg)) return this.member(obj, arg.text, node);
        break;
      }
    }
    fail(node, Codes.UnsupportedSyntax, `cannot index ${typeKey(t)}`);
  }

  /**
   * One link of an optional chain (`a?.b.c`, `a?.[i]`, `a?.m()`, `f?.()`).
   * `sc` is true when the value may be undefined because the chain
   * short-circuited; later links then short-circuit too.
   */
  private chainPart(n: ts.Expression): { e: E; sc: boolean } {
    if (!(n.flags & ts.NodeFlags.OptionalChain)) return { e: this.expr(n), sc: false };
    if (ts.isNonNullExpression(n)) {
      const b = this.chainPart(n.expression);
      return b;
    }
    if (ts.isPropertyAccessExpression(n)) {
      const recv = this.chainPart(n.expression);
      return this.guarded(recv, !!n.questionDotToken, (x) => this.member(x, n.name.text, n), n);
    }
    if (ts.isElementAccessExpression(n)) {
      const recv = this.chainPart(n.expression);
      return this.guarded(recv, !!n.questionDotToken, (x) => this.elementOf(x, n.argumentExpression, n), n);
    }
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isPropertyAccessExpression(callee) && !n.questionDotToken) {
        const recv = this.chainPart(callee.expression);
        return this.guarded(recv, !!callee.questionDotToken, (x) => builtins.methodCall(this, x, callee.name.text, n), n);
      }
      const f = this.chainPart(callee);
      return this.guarded(f, !!n.questionDotToken, (x) => this.callValue(x, n), n);
    }
    return { e: this.expr(n), sc: false };
  }

  private guarded(b: { e: E; sc: boolean }, q: boolean, apply: (x: E) => E, node: ts.Node): { e: E; sc: boolean } {
    if (b.e.t.k !== "opt" || (!q && !b.sc)) {
      if (b.e.t.k === "opt" && !q) fail(node, Codes.UnsupportedSyntax, "value may be undefined here; use ?. or check it first");
      return { e: apply(b.e), sc: b.sc };
    }
    const tmp = this.ctx.fresh("oc");
    const r = apply({ c: `${tmp}.get()`, t: b.e.t.inner });
    const rt = unionOf([r.t, T.undefined]);
    return {
      e: { c: `({ auto ${tmp} = ${b.e.c}; ${tmp}.has() ? ${this.coerce(r, rt, node)} : ${this.cpp(rt)}(lucent::undefined); })`, t: rt },
      sc: true,
    };
  }

  /** Calls a function value with the arguments of `node`. */
  private callValue(f: E, node: ts.CallExpression): E {
    const ft = stripOpt(f.t);
    if (ft.k !== "fn") fail(node.expression, Codes.UnsupportedCall, `cannot call a value of type ${typeKey(f.t)}`);
    const args = this.args(node.arguments, ft.params, node);
    return { c: `${this.coerce(f, ft, node.expression)}(${args.join(", ")})`, t: isVoidish(ft.ret) ? T.undefined : ft.ret };
  }

  // --- calls ------------------------------------------------------------------------------

  /**
   * C++ leaves the evaluation order of function arguments (and of `a + b`)
   * unspecified; JavaScript evaluates left to right. When the order could be
   * observed, arguments are evaluated into temporaries first.
   */
  private inOrder(args: readonly ts.Expression[], build: () => E): E {
    const candidates = args.filter((a) => !isLiteral(a) && !ts.isArrowFunction(a) && !ts.isFunctionExpression(a));
    if (candidates.length < 2 || candidates.every(isSimple)) return build();
    const temps: string[] = [];
    const saved: ts.Expression[] = [];
    try {
      for (const a of candidates) {
        const target = ts.isSpreadElement(a) ? a.expression : a;
        const e = this.expr(target);
        const tmp = this.ctx.fresh("arg");
        // Integer operands stay integers in their temporaries.
        temps.push(`auto ${tmp} = ${e.int ? e.int.c : e.c};`);
        this.subst.set(target, e.int ? this.intE(tmp, e.int.kind) : { c: tmp, t: e.t });
        saved.push(target);
      }
      const r = build();
      const pre = temps.join(" ");
      return { c: `({ ${pre} ${r.c}; })`, t: r.t, int: r.int && { c: `({ ${pre} ${r.int.c}; })`, kind: r.int.kind } };
    } finally {
      for (const s of saved) this.subst.delete(s);
    }
  }

  private call(node: ts.CallExpression): E {
    if (isOptionalChain(node)) return this.chainPart(node).e;
    if (node.arguments.length >= 2) return this.inOrder(node.arguments, () => this.callInner(node));
    return this.callInner(node);
  }

  private callInner(node: ts.CallExpression): E {
    const callee = node.expression;
    if (callee.kind === ts.SyntaxKind.SuperKeyword) return builtins.superCall(this, node);
    if (ts.isPropertyAccessExpression(callee) && callee.expression.kind === ts.SyntaxKind.SuperKeyword) return builtins.superMember(this, callee.name.text, callee, node);
    if (ts.isPropertyAccessExpression(callee)) {
      const n = native.nativeCall(this, node, undefined);
      if (n) return n;
      const s = builtins.staticCall(this, node, callee);
      if (s) return s;
      const obj = this.receiver(callee.expression);
      return builtins.methodCall(this, obj, callee.name.text, node);
    }
    if (ts.isIdentifier(callee)) {
      const sym0 = symbolOf(this.checker, callee);
      const sym = sym0 ? this.ctx.resolve(sym0) : undefined;
      if (sym && !this.findLocal(sym)) {
        const g = this.ctx.globals.get(sym);
        if (g && g.kind === "function") return this.callUserFunction(g, node);
        const n = native.nativeBuiltinCall(this, node) ?? native.nativeFunctionCall(this, node);
        if (n) return n;
        // By the imported name: `import { errorCode as codeOf }` calls errorCode.
        const b = builtins.globalCall(this, node, sym.name, sym);
        if (b) return b;
      }
    }
    // A function value.
    return this.callValue(this.expr(callee), node);
  }

  /** Arguments coerced to parameter types, with missing optionals as undefined. */
  args(args: ts.NodeArray<ts.Expression>, params: LType[], node: ts.Node, rest?: LType): string[] {
    const out: string[] = [];
    const fixed = rest ? params.length - 1 : params.length;
    for (let i = 0; i < fixed; i++) {
      const p = params[i]!;
      const a = args[i];
      if (a && ts.isSpreadElement(a)) fail(a, Codes.UnsupportedCall, "spread arguments are only supported for rest parameters");
      if (a) out.push(this.exprAs(a, p));
      else if (p.k === "opt") out.push(`${this.cpp(p)}(lucent::undefined)`);
      else if (p.k === "undefined") out.push("lucent::undefined");
      else fail(node, Codes.UnsupportedCall, "missing argument");
    }
    if (rest) {
      const restT = rest as LType & { k: "array" };
      const tmp = this.ctx.fresh("rest");
      const parts: string[] = [`${this.cpp(restT)} ${tmp};`];
      for (const a of args.slice(fixed)) {
        if (ts.isSpreadElement(a)) parts.push(`${tmp}.append(${this.exprAs(a.expression, restT)});`);
        else parts.push(`${tmp}.push(${this.exprAs(a, restT.e)});`);
      }
      out.push(`({ ${parts.join(" ")} ${tmp}; })`);
    }
    return out;
  }

  private callUserFunction(g: Extract<import("./context.ts").Global, { kind: "function" }>, node: ts.CallExpression): E {
    const params = g.params;
    const restParam = params.length && params[params.length - 1]!.rest ? params[params.length - 1]!.cppType : undefined;
    let callee = g.cpp;
    let paramTypes = params.map((p) => p.cppType);
    let ret = g.type.ret;
    if (g.generic) {
      // Instantiate: C++ template arguments from the checker's inference.
      const sig = this.checker.getResolvedSignature(node);
      const decl = g.decl;
      const targs = inferTypeArguments(this, decl, sig, node);
      callee = `${g.cpp}<${targs.map((t) => this.cpp(t)).join(", ")}>`;
      const map = new Map(decl.typeParameters!.map((p, i) => [p.name.text, targs[i]!]));
      paramTypes = paramTypes.map((p) => substitute(p, map));
      ret = substitute(ret, map);
    }
    const args = this.args(node.arguments, paramTypes, node, restParam);
    const rt = g.async ? { k: "promise", inner: ret.k === "promise" ? ret.inner : ret } as LType : ret;
    return { c: `${callee}(${args.join(", ")})`, t: isVoidish(rt) ? T.undefined : rt };
  }

  private newExpr(node: ts.NewExpression): E {
    const args = node.arguments ?? [];
    if (args.length >= 2) return this.inOrder(args, () => this.newInner(node));
    return this.newInner(node);
  }

  private newInner(node: ts.NewExpression): E {
    const callee = node.expression;
    const t = this.lt(node);
    if (t.k === "native") return native.nativeNew(this, node, t);
    if (t.k === "class") {
      // The nearest constructor in the class chain (subclasses may inherit it).
      const owner = this.reg.chain(t).find((c) => c.info.decl.members.some(ts.isConstructorDeclaration));
      const ctor = owner?.info.decl.members.find(ts.isConstructorDeclaration);
      const fnType: LType = ctor ? (this.reg.lowerSignature(this.checker.getSignatureFromDeclaration(ctor)!, ctor) as LType) : { k: "fn", params: [], ret: T.void };
      const params = ctor ? this.paramInfos(ctor, fnType as LType & { k: "fn" }) : [];
      let paramTypes = params.map((p) => p.cppType);
      if (owner && owner.t.args.length) {
        const oi = owner.info;
        const map = new Map(oi.typeParams.map((p, i) => [p, owner.t.args[i]!]));
        paramTypes = paramTypes.map((p) => substitute(p, map));
      }
      const rest = params.length && params[params.length - 1]!.rest ? paramTypes[paramTypes.length - 1] : undefined;
      const args = this.args(node.arguments ?? ts.factory.createNodeArray(), paramTypes, node, rest);
      return { c: `${this.reg.cppClass(t)}::create(${args.join(", ")})`, t };
    }
    return builtins.newBuiltin(this, node, callee, t);
  }

  // --- literals ---------------------------------------------------------------------------

  private arrayLiteral(node: ts.ArrayLiteralExpression, hint?: LType): E {
    let t = this.lt(node);
    const ctxT = hint ?? this.contextualType(node);
    if (ctxT) {
      const c = stripOpt(ctxT);
      if (c.k === "array" || c.k === "tuple") t = c;
      else if (c.k === "union") {
        const m = c.ms.find((x) => x.k === "array" || x.k === "tuple");
        if (m) t = m;
      }
    }
    if (t.k === "tuple") {
      const parts = node.elements.map((el, i) => this.exprAs(el, t.k === "tuple" ? t.es[i]! : T.never));
      return { c: `${this.cpp(t)}(${parts.join(", ")})`, t };
    }
    if (t.k !== "array") fail(node, Codes.UnsupportedType, `array literal of type ${typeKey(t)}`);
    const elemT = t.e;
    if (!node.elements.some(ts.isSpreadElement)) {
      const parts = node.elements.map((el) => this.exprAs(el, elemT));
      return { c: `${this.cpp(t)}{${parts.join(", ")}}`, t };
    }
    const tmp = this.ctx.fresh("arr");
    const parts: string[] = [`${this.cpp(t)} ${tmp};`];
    for (const el of node.elements) {
      if (ts.isSpreadElement(el)) {
        const s = this.expr(el.expression);
        const st = stripOpt(s.t);
        if (st.k === "string") parts.push(`${tmp}.append(lucent::splitCodePoints(${s.c}));`);
        else if (st.k === "set") parts.push(`${tmp}.append((${s.c}).values());`);
        else if (st.k === "iter" && sameType(st.e, elemT)) parts.push(`${tmp}.append(lucent::iterToArray(${this.coerce(s, st, el)}));`);
        else if (st.k === "array" && sameType(st.e, elemT)) parts.push(`${tmp}.append(${s.c});`);
        else if (st.k === "array") parts.push(`for (const auto& e : (${s.c}).items()) ${tmp}.push(${this.coerce({ c: `static_cast<${this.cpp(st.e)}>(e)`, t: st.e }, elemT, el)});`);
        else fail(el, Codes.UnsupportedSyntax, `cannot spread ${typeKey(s.t)}`);
      } else parts.push(`${tmp}.push(${this.exprAs(el, elemT)});`);
    }
    return { c: `({ ${parts.join(" ")} ${tmp}; })`, t };
  }

  contextualType(node: ts.Expression): LType | undefined {
    const ct = this.checker.getContextualType(node);
    if (!ct) return undefined;
    try {
      return this.reg.lower(ct, node);
    } catch {
      return undefined;
    }
  }

  private objectLiteral(node: ts.ObjectLiteralExpression, hint?: LType): E {
    let t = hint ?? this.contextualType(node) ?? this.lt(node);
    t = stripOpt(t);
    if (t.k === "union") {
      // Pick the member this literal belongs to.
      const own = this.checker.getTypeAtLocation(node);
      const ctxTs = this.checker.getContextualType(node);
      const members = ctxTs && ctxTs.isUnion() ? ctxTs.types : [];
      const match = members.find((m) => this.checker.isTypeAssignableTo(own, m) && !(m.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)));
      t = match ? this.reg.lower(match, node) : this.lt(node);
    }
    if (t.k === "dict") {
      const tmp = this.ctx.fresh("rec");
      const parts: string[] = [`${this.cpp(t)} ${tmp};`];
      for (const p of node.properties) {
        if (ts.isPropertyAssignment(p)) {
          const key = ts.isComputedPropertyName(p.name) ? this.exprAs(p.name.expression, T.string) : stringLiteral(propName(p.name));
          parts.push(`${tmp}.set(${key}, ${this.exprAs(p.initializer, t.val)});`);
        } else if (ts.isShorthandPropertyAssignment(p)) {
          parts.push(`${tmp}.set(${stringLiteral(p.name.text)}, ${this.exprAs(p.name, t.val)});`);
        } else if (ts.isSpreadAssignment(p)) {
          const s = this.expr(p.expression);
          parts.push(`lucent::assignEntries(${tmp}, ${s.c});`);
        } else fail(p, Codes.UnsupportedSyntax, "unsupported property in record literal");
      }
      return { c: `({ ${parts.join(" ")} ${tmp}; })`, t };
    }
    if (t.k === "iface") this.notAnImplementation("an object literal", t, node);
    if (t.k !== "struct") fail(node, Codes.UnsupportedType, `object literal of type ${typeKey(t)}`);
    const info = this.reg.struct(t.id);
    const tmp = this.ctx.fresh("obj");
    const parts: string[] = [`auto ${tmp} = std::make_shared<lucent_app::${info.cppName}>();`];
    for (const p of node.properties) {
      if (ts.isSpreadAssignment(p)) {
        const s = this.expr(p.expression);
        const st = stripOpt(s.t);
        if (st.k !== "struct") fail(p, Codes.UnsupportedSyntax, "only objects can be spread into object literals");
        const src = this.ctx.fresh("src");
        parts.push(`auto ${src} = ${this.coerce(s, st, p)};`);
        const srcFields = this.reg.struct(st.id).fields;
        for (const f of info.fields) {
          const sf = srcFields.find((x) => x.name === f.name);
          if (sf) parts.push(`${tmp}->${cppIdent(f.name)} = ${this.coerce({ c: `${src}->${cppIdent(f.name)}`, t: sf.type }, f.type, p)};`);
        }
        continue;
      }
      let name: string;
      let value: E;
      if (ts.isPropertyAssignment(p)) {
        if (ts.isComputedPropertyName(p.name)) fail(p, Codes.UnsupportedSyntax, "computed keys are only supported in records");
        name = propName(p.name);
        const f = info.fields.find((x) => x.name === name);
        value = this.expr(p.initializer, f?.type);
      } else if (ts.isShorthandPropertyAssignment(p)) {
        name = p.name.text;
        value = this.expr(p.name);
      } else if (ts.isMethodDeclaration(p)) {
        fail(p, Codes.UnsupportedSyntax, "methods in object literals are not supported; use `name: (...) => ...`");
      } else fail(p, Codes.UnsupportedSyntax, "unsupported property in object literal");
      const f = info.fields.find((x) => x.name === name);
      if (!f) fail(p, Codes.InexactObject, `property ${name} is not part of the target type`);
      parts.push(`${tmp}->${cppIdent(name)} = ${this.coerce(value, f.type, p)};`);
    }
    return { c: `({ ${parts.join(" ")} ${tmp}; })`, t };
  }
}

function isLiteral(n: ts.Expression): boolean {
  return (
    ts.isNumericLiteral(n) ||
    ts.isStringLiteral(n) ||
    ts.isNoSubstitutionTemplateLiteral(n) ||
    n.kind === ts.SyntaxKind.TrueKeyword ||
    n.kind === ts.SyntaxKind.FalseKeyword ||
    n.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(n) && n.text === "undefined")
  );
}

/** An expression without side effects (so evaluation order cannot be observed). */
export function isSimple(n: ts.Expression): boolean {
  if (isLiteral(n) || ts.isIdentifier(n) || n.kind === ts.SyntaxKind.ThisKeyword) return true;
  if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return true;
  if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n) || ts.isTypeOfExpression(n)) {
    return isSimple(n.expression);
  }
  if (ts.isPropertyAccessExpression(n)) return isSimple(n.expression);
  if (ts.isElementAccessExpression(n)) return isSimple(n.expression) && isSimple(n.argumentExpression);
  if (ts.isPrefixUnaryExpression(n)) return n.operator !== ts.SyntaxKind.PlusPlusToken && n.operator !== ts.SyntaxKind.MinusMinusToken && isSimple(n.operand);
  if (ts.isBinaryExpression(n)) {
    const k = n.operatorToken.kind;
    if (k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment) return false;
    return isSimple(n.left) && isSimple(n.right);
  }
  if (ts.isConditionalExpression(n)) return isSimple(n.condition) && isSimple(n.whenTrue) && isSimple(n.whenFalse);
  if (ts.isTemplateExpression(n)) return n.templateSpans.every((s) => isSimple(s.expression));
  if (ts.isArrayLiteralExpression(n)) return n.elements.every((e) => !ts.isSpreadElement(e) && isSimple(e));
  return false;
}

function propName(n: ts.PropertyName): string {
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isPrivateIdentifier(n)) return n.text;
  return n.getText();
}

export function isOptionalChain(node: ts.Node): boolean {
  return !!(node.flags & ts.NodeFlags.OptionalChain);
}

function usesThisIn(fn: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (n.kind === ts.SyntaxKind.ThisKeyword) {
      found = true;
      return;
    }
    if (ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) return;
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(fn, visit);
  return found;
}

function assignedWithin(checker: ts.TypeChecker, node: ts.Node, sym: ts.Symbol): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(n.left) && checker.getSymbolAtLocation(n.left) === sym) found = true;
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && ts.isIdentifier(n.operand) && checker.getSymbolAtLocation(n.operand) === sym) found = true;
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Replaces type parameters in `t`. */
/** Type arguments the checker inferred for a call to a generic function. */
function inferTypeArguments(em: FnEmitter, decl: ts.FunctionDeclaration, sig: ts.Signature | undefined, node: ts.CallExpression): LType[] {
  const tps = decl.typeParameters ?? ts.factory.createNodeArray();
  if (node.typeArguments) return node.typeArguments.map((t) => em.ctx.reg.lower(em.checker.getTypeFromTypeNode(t), t));
  if (!sig) fail(node, Codes.UnsupportedCall, "could not resolve this generic call");
  // Unify the declared signature (with type parameters) against the
  // instantiated one the checker resolved.
  const declared = em.checker.getSignatureFromDeclaration(decl)!;
  const map = new Map<string, LType>();
  const pairs: [ts.Type, ts.Type][] = [];
  declared.getParameters().forEach((p, i) => {
    const q = sig.getParameters()[i];
    if (q) pairs.push([em.checker.getTypeOfSymbol(p), em.checker.getTypeOfSymbol(q)]);
  });
  pairs.push([em.checker.getReturnTypeOfSignature(declared), em.checker.getReturnTypeOfSignature(sig)]);
  for (const [d, a] of pairs) {
    try {
      unify(em.ctx.reg.lower(d, node), em.ctx.reg.lower(a, node), map);
    } catch {
      // Parameters we cannot lower (e.g. callbacks) do not constrain.
    }
  }
  return tps.map((tp) => {
    const t = map.get(tp.name.text);
    if (!t) fail(node, Codes.UnsupportedCall, `could not infer type argument ${tp.name.text}; pass it explicitly`);
    return t;
  });
}

function unify(pattern: LType, actual: LType, map: Map<string, LType>): void {
  if (pattern.k === "tparam") {
    if (!map.has(pattern.name)) map.set(pattern.name, actual);
    return;
  }
  if (pattern.k === "iter") {
    // Any iterable matches Iterable<T>.
    const a = stripOpt(actual);
    const e = a.k === "iter" || a.k === "array" || a.k === "set" ? a.e : a.k === "string" ? T.string : a.k === "bytes" ? T.number : a.k === "map" ? ({ k: "tuple", es: [a.key, a.val] } as LType) : undefined;
    if (e) unify(pattern.e, e, map);
    return;
  }
  if (pattern.k !== actual.k) {
    if (pattern.k === "opt") unify(pattern.inner, stripOpt(actual), map);
    return;
  }
  switch (pattern.k) {
    case "array":
    case "set":
      unify(pattern.e, (actual as typeof pattern).e, map);
      return;
    case "dict":
      unify(pattern.val, (actual as typeof pattern).val, map);
      return;
    case "map":
      unify(pattern.key, (actual as typeof pattern).key, map);
      unify(pattern.val, (actual as typeof pattern).val, map);
      return;
    case "opt":
      unify(pattern.inner, (actual as typeof pattern).inner, map);
      return;
    case "promise":
      unify(pattern.inner, (actual as typeof pattern).inner, map);
      return;
    case "tuple":
      pattern.es.forEach((e, i) => {
        const a = (actual as typeof pattern).es[i];
        if (a) unify(e, a, map);
      });
      return;
    case "fn": {
      const a = actual as typeof pattern;
      pattern.params.forEach((p, i) => {
        if (a.params[i]) unify(p, a.params[i]!, map);
      });
      unify(pattern.ret, a.ret, map);
      return;
    }
    case "class":
      pattern.args.forEach((p, i) => {
        const a = (actual as typeof pattern).args[i];
        if (a) unify(p, a, map);
      });
      return;
    default:
      return;
  }
}

export { containsAwait };

const sourcePaths = new Map<string, string>();
/** The canonical absolute path of a source file, as debuggers resolve it. */
function sourcePath(fileName: string): string {
  let p = sourcePaths.get(fileName);
  if (p === undefined) {
    const abs = path.resolve(fileName);
    p = (fs.existsSync(abs) ? fs.realpathSync(abs) : abs).replace(/\\/g, "/");
    sourcePaths.set(fileName, p);
  }
  return p;
}
