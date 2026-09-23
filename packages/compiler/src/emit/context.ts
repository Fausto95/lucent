import ts from "typescript";
import type { Platform } from "../sdk/schema.ts";
import { CompileError, type Diagnostic, toDiagnostic } from "../diagnostics.ts";
import type { LucentModule } from "../program.ts";
import { type ClassInfo, type LType, TypeRegistry } from "../types.ts";
import { CaptureAnalysis } from "./analysis.ts";

/** Integer registers a number can live in (see integers.ts). */
export type IntKind = "i32" | "u32" | "i64";

/** A C++ expression and the Lucent type of the value it produces. */
export interface E {
  c: string;
  t: LType;
  /** The same number as an exact integer expression, when one is known. */
  int?: { c: string; kind: IntKind };
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
  | { kind: "function"; cpp: string; module: LucentModule; decl: ts.FunctionDeclaration; type: LType & { k: "fn" }; async: boolean; params: ParamInfo[]; generic: boolean }
  | { kind: "var"; cpp: string; module: LucentModule; decl: ts.VariableDeclaration; type: LType; isConst: boolean }
  | { kind: "class"; cpp: string; module: LucentModule; info: ClassInfo };

/** Program-wide state shared by every emitter. */
/** Abandons code that uses a declaration whose own diagnostic was already reported. */
export class AlreadyReported extends Error {}

export class Ctx {
  readonly reg: TypeRegistry;
  readonly capture: CaptureAnalysis;
  readonly globals = new Map<ts.Symbol, Global>();
  readonly diagnostics: Diagnostic[] = [];
  /** The platform of the program being emitted (platform files only exist there). */
  platform?: Platform;
  /** Per module: includes and checks its platform glue needs. */
  readonly frameworks = new Set<string>();
  /** Java classes the Android glue names (JNI), which the app's shrinker must keep. */
  readonly javaClasses = new Set<string>();
  readonly nativeUnits = new Map<LucentModule, { includes: Set<string>; lines: Set<string> }>();
  /** Target types of JSON.parse, which get generated readers. */
  readonly jsonReads = new Map<string, LType>();
  private tmp = 0;

  constructor(
    readonly checker: ts.TypeChecker,
    readonly modules: LucentModule[],
  ) {
    const files = new Set(modules.map((m) => m.sourceFile));
    this.reg = new TypeRegistry(checker, (sf) => files.has(sf));
    this.capture = new CaptureAnalysis(checker, modules.map((m) => m.sourceFile));
  }

  nativeUnit(m: LucentModule): { includes: Set<string>; lines: Set<string> } {
    let u = this.nativeUnits.get(m);
    if (!u) {
      u = { includes: new Set(), lines: new Set() };
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

  /** Resolves import aliases to the declaring symbol. */
  resolve(sym: ts.Symbol): ts.Symbol {
    if (sym.flags & ts.SymbolFlags.Alias) return this.checker.getAliasedSymbol(sym);
    return sym;
  }

  lowerAt(node: ts.Node): LType {
    return this.reg.lower(this.checker.getTypeAtLocation(node), node);
  }
}
