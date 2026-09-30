import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import type { Platform } from "../sdk/schema.ts";
import { CompileError, type Diagnostic, toDiagnostic } from "../diagnostics.ts";
import type { LucentModule } from "../program.ts";
import { type ClassInfo, type LType, TypeRegistry } from "../types.ts";
import { CaptureAnalysis } from "../analysis/scopes.ts";
import type { KotlinShim } from "./kotlin.ts";
import type { SwiftShim } from "./swift.ts";
import type { SwiftProxy } from "./swift-proxy.ts";
import type { ToolkitName } from "../ui/toolkits.ts";
import type { Setup } from "./setups.ts";

/** Integer registers a number can live in (see integers.ts). */
export type IntKind = "i32" | "u32" | "i64";

/** A C++ expression and the Lucent type of the value it produces. */
export interface E {
  c: cpp.Expr;
  t: LType;
  /** The same number as an exact integer expression, when one is known. */
  int?: { c: cpp.Expr; kind: IntKind };
}

/**
 * An assignable place: `direct` is a C++ lvalue when one exists; otherwise
 * `get` and `set` read and write it (array elements, setters…). `set`
 * gives the assigned value.
 */
export interface Lvalue {
  direct?: cpp.Expr;
  get: cpp.Expr;
  set?: (v: cpp.Expr) => cpp.Expr;
  type: LType;
}

export interface ParamInfo {
  name: string;
  type: LType;
  /** C++ parameter type (Opt<T> for optional or defaulted params). */
  cppType: LType;
  optional: boolean;
  rest: boolean;
}

export type Global =
  | {
      kind: "function";
      cpp: string;
      module: LucentModule;
      decl: ts.FunctionDeclaration;
      type: LType & { k: "fn" };
      async: boolean;
      params: ParamInfo[];
      generic: boolean;
    }
  | {
      kind: "var";
      cpp: string;
      module: LucentModule;
      decl: ts.VariableDeclaration;
      type: LType;
      isConst: boolean;
      /** A constant's literal, which code reads instead of the storage `init()` assigns. */
      literal?: ts.Expression;
    }
  | { kind: "class"; cpp: string; module: LucentModule; info: ClassInfo };

/** Program-wide state shared by every emitter. */
/** Abandons code that uses a declaration whose own diagnostic was already reported. */
export class AlreadyReported extends Error {}

export class Ctx {
  readonly reg: TypeRegistry;
  readonly capture: CaptureAnalysis;
  readonly globals = new Map<ts.Symbol, Global>();
  /** Declarations whose diagnostic was reported; their uses are not reported again. */
  readonly failed = new Set<ts.Symbol>();
  readonly diagnostics: Diagnostic[] = [];
  /** Problems that do not stop the build (severity "warning"). */
  readonly warnings: Diagnostic[] = [];
  /** The platform of the program being emitted (platform files only exist there). */
  platform?: Platform;
  /** Per module: includes and checks its platform glue needs. */
  readonly frameworks = new Set<string>();
  /** Per program: the pods whose modules the iOS platform code imports (LucentNative depends on them). */
  readonly pods = new Set<string>();
  /** Java classes the Android glue names (JNI), which the app's shrinker must keep. */
  readonly javaClasses = new Set<string>();
  /** Android permissions the SDK methods the program calls require. */
  readonly androidPermissions = new Set<string>();
  readonly nativeUnits = new Map<LucentModule, NativeUnit>();
  /** The Swift-only members the iOS glue calls, by shim symbol. */
  readonly swiftShims = new Map<string, SwiftShim>();
  /** Lucent classes conforming to Swift-only protocols. */
  readonly swiftProxies: SwiftProxy[] = [];
  /** The Kotlin shims the Android glue calls, per SDK module, by name. */
  readonly kotlinShims = new Map<string, Map<string, KotlinShim>>();
  /** Target types of JSON.parse, which get generated readers. */
  readonly jsonReads = new Map<string, LType>();
  /** Components' setups compiled into this program (setups.ts), by their function. */
  readonly setups = new Map<ts.Node, Setup>();
  /** Components' toolkit bodies (toolkit.ts): each setup's file, in its toolkit's language. */
  readonly toolkitFiles = new Map<
    Setup,
    { toolkit: ToolkitName; file: () => { name: string; text: string } }
  >();
  private tmp = 0;
  readonly checker: ts.TypeChecker;
  readonly modules: LucentModule[];

  /** Reports a warning at `node`: the code still compiles. */
  warn(node: ts.Node, code: string, message: string): void {
    this.warnings.push({
      ...toDiagnostic(new CompileError(node, code, message)),
      severity: "warning",
    });
  }

  constructor(checker: ts.TypeChecker, modules: LucentModule[]) {
    this.checker = checker;
    this.modules = modules;
    const files = new Set(modules.map((m) => m.sourceFile));
    this.reg = new TypeRegistry(checker, (sf) => files.has(sf));
    this.capture = new CaptureAnalysis(
      checker,
      modules.map((m) => m.sourceFile),
    );
  }

  nativeUnit(m: LucentModule): NativeUnit {
    let u = this.nativeUnits.get(m);
    if (!u) {
      u = new NativeUnit();
      this.nativeUnits.set(m, u);
    }
    return u;
  }

  fresh(prefix = "t"): string {
    return `${prefix}_${++this.tmp}`;
  }

  /** Runs `f`, recording a diagnostic instead of throwing on compile errors. */
  guard<R>(f: () => R): R | undefined {
    try {
      return f();
    } catch (e) {
      if (e instanceof CompileError) {
        this.diagnostics.push(toDiagnostic(e));
        return undefined;
      }
      if (e instanceof AlreadyReported) return undefined;
      throw e;
    }
  }

  /** Records the names a rejected declaration binds. */
  markFailed(name: ts.BindingName): void {
    if (ts.isIdentifier(name)) {
      const sym = this.checker.getSymbolAtLocation(name);
      if (sym) this.failed.add(sym);
      return;
    }
    for (const e of name.elements) if (!ts.isOmittedExpression(e)) this.markFailed(e.name);
  }

  /** Resolves import aliases to the declaring symbol. */
  resolve(sym: ts.Symbol): ts.Symbol {
    if (sym.flags & ts.SymbolFlags.Alias) return this.checker.getAliasedSymbol(sym);
    return sym;
  }

  lowerAt(node: ts.Node): LType {
    return this.reg.lower(this.checker.getTypeAtLocation(node), node);
  }
}

/** A module's platform glue: the headers it includes, and declarations ahead of its code. */
export class NativeUnit {
  private readonly headers = new Map<string, cpp.Decl & { k: "include" }>();
  /** Keyed, so what several uses need is declared once. */
  readonly decls = new Map<string, cpp.Decl[]>();

  include(path: string, opts: { objc?: boolean } = {}): void {
    this.headers.set(`${opts.objc ? "import" : "include"} ${path}`, {
      k: "include",
      path,
      system: true,
      ...opts,
    });
  }
  /** The headers: Objective-C imports first, then by path. */
  includes(): cpp.Decl[] {
    return [...this.headers.keys()].sort().map((k) => this.headers.get(k)!);
  }
  add(key: string, decls: cpp.Decl[]): void {
    if (!this.decls.has(key)) this.decls.set(key, decls);
  }
}
