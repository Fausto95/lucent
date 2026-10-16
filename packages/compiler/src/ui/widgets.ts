/**
 * Widget bodies (decision 0124): the function a widget extension's `body`
 * names (lucent.json's `ios.appExtensions`), an exported function of an
 * iOS JSX file that draws the widget's entry, `(entry: E) => View`. It is
 * neither a component nor a module function: each program leaves it out,
 * and the widget's own build compiles it into the values its view shows
 * (emit/widgets.ts).
 */
import ts from "typescript";
import { Codes } from "../codes.ts";
import { type AppExtensionCode, currentCompile } from "../compile-context.ts";
import { CompileError, type Diagnostic, toDiagnostic } from "../diagnostics.ts";
import type { LucentModule, LucentProgram } from "../program.ts";
import type { FunctionLike } from "./roots.ts";

/** A widget's body, in the program of its extension's build. */
export interface WidgetBody {
  /** The widget's extension: its target's name. */
  readonly extension: string;
  readonly module: LucentModule;
  /** The function's name, as its module exports it. */
  readonly name: string;
  readonly fn: FunctionLike;
  /** The statement declaring it, which the program's module functions leave out. */
  readonly statement: ts.Statement;
  /** Its one parameter: the entry it draws. */
  readonly entry: ts.ParameterDeclaration;
  /** The widget's provider: the class its `provider` names, which gives the entries. */
  readonly provider: { readonly module: LucentModule; readonly decl: ts.ClassDeclaration };
  /** Its name, description and families in the widget gallery. */
  readonly gallery: NonNullable<AppExtensionCode["gallery"]>;
}

/** Whether a module of the program has a widget's body: its programs leave it out. */
export function hasWidgetBodies(lp: LucentProgram): boolean {
  const names = new Set(lp.modules.map((m) => m.name));

  return [...(currentCompile()?.appExtensions.values() ?? [])].some(
    (c) => c.kind === "widget" && c.body !== undefined && names.has(c.body.split("#")[0]!),
  );
}

/** An exported function of a module, as the view analysis finds them. */
interface Exported {
  readonly name: string;
  readonly fn: FunctionLike;
  readonly statement: ts.Statement;
}

/**
 * The widget bodies of the program's modules: the statements each program
 * leaves out, and, in a widget's own build, its body. An iOS program checks
 * each (LUCENT3019 for a body that isn't one).
 */
export function widgetBodies(
  lp: LucentProgram,
  exported: (m: LucentModule) => readonly Exported[],
): { statements: Set<ts.Statement>; bodies: WidgetBody[]; diagnostics: Diagnostic[] } {
  const statements = new Set<ts.Statement>();
  const bodies: WidgetBody[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const [extension, code] of currentCompile()?.appExtensions ?? []) {
    if (code.kind !== "widget" || !code.body) continue;

    const [moduleName, name] = code.body.split("#") as [string, string];
    const m = lp.modules.find((x) => x.name === moduleName);
    // A module that is none of its package's: LUCENT3019 already (index.ts).
    if (!m) continue;

    const found = exported(m).find((e) => e.name === name);
    if (found) statements.add(found.statement);
    // The iOS programs check it (the app's, before the widget's build); the others leave it out.
    if (lp.platform !== "ios") continue;

    const problem = found ? bodyProblem(lp.checker, found) : undefined;
    if (!found || problem) {
      diagnostics.push(
        toDiagnostic(
          new CompileError(
            found?.fn ?? m.sourceFile,
            Codes.UnknownExtensionCode,
            `the widget ${extension}'s body, ${code.body}, ${problem ?? `is no function ${moduleName} exports`}: a widget's body is an exported function of an iOS JSX file (\`.ios.lucent.tsx\`) that draws its entry, \`(entry: E) => View\``,
          ),
        ),
      );
      continue;
    }

    const entry = found.fn.parameters[0]!;
    const provider = code.provider && providerOf(lp, code.provider);
    const providerProblem =
      provider === undefined
        ? undefined
        : provider
          ? classProblem(lp.checker, provider.decl, lp.checker.getTypeAtLocation(entry))
          : `is no class ${code.provider!.split("#")[0]} exports`;
    if (providerProblem || !provider) {
      if (providerProblem)
        diagnostics.push(
          toDiagnostic(
            new CompileError(
              provider ? provider.decl : found.fn,
              Codes.UnknownExtensionCode,
              `the widget ${extension}'s provider, ${code.provider}, ${providerProblem}: a widget's provider is an exported class whose constructor takes nothing, with \`placeholder(): E\`, \`snapshot(): Promise<E>\` and \`timeline(): Promise<{ entries: E[]; reloadAfter?: Date }>\`, \`E\` its body's entry`,
            ),
          ),
        );
      continue;
    }

    if (lp.appExtension === extension)
      bodies.push({
        extension,
        module: m,
        ...found,
        entry,
        provider,
        gallery: code.gallery ?? {},
      });
  }

  return { statements, bodies, diagnostics };
}

/**
 * The class `<module>#<Class>` names, exported by its module (with its
 * code, on the program's platform); null without one, undefined for a
 * module that is none of the program's (LUCENT3019 already, index.ts).
 */
function providerOf(
  lp: LucentProgram,
  code: string,
): { module: LucentModule; decl: ts.ClassDeclaration } | null | undefined {
  const [moduleName, name] = code.split("#") as [string, string];
  const m = lp.modules.find((x) => x.name === moduleName);
  if (!m) return undefined;

  const decl = m.sourceFile.statements.find(
    (s): s is ts.ClassDeclaration =>
      ts.isClassDeclaration(s) &&
      s.name?.text === name &&
      !!ts.getModifiers(s)?.some((x) => x.kind === ts.SyntaxKind.ExportKeyword) &&
      !ts.getModifiers(s)?.some((x) => x.kind === ts.SyntaxKind.DeclareKeyword),
  );
  return decl ? { module: m, decl } : null;
}

/**
 * What keeps class `cls` from being the provider of a widget whose entry
 * is `entry`, as the rest of a sentence about it; or nothing. Its
 * methods mirror TimelineProvider's requirements, without their context.
 */
function classProblem(
  checker: ts.TypeChecker,
  cls: ts.ClassDeclaration,
  entry: ts.Type,
): string | undefined {
  if (cls.typeParameters?.length) return "has type parameters";
  if (cls.members.find(ts.isConstructorDeclaration)?.parameters.length)
    return "has a constructor that takes parameters";

  const instance = checker.getTypeAtLocation(cls);
  const same = (t: ts.Type | undefined) =>
    !!t && checker.isTypeAssignableTo(t, entry) && checker.isTypeAssignableTo(entry, t);
  // What method `name` returns, when it takes nothing.
  const returns = (name: string) => {
    const symbol = instance.getProperty(name);
    const signatures = symbol
      ? checker.getTypeOfSymbolAtLocation(symbol, cls).getCallSignatures()
      : [];
    const [only] = signatures;
    return signatures.length === 1 && !only!.parameters.length
      ? checker.getReturnTypeOfSignature(only!)
      : undefined;
  };
  const promised = (t: ts.Type | undefined) =>
    t?.getSymbol()?.name === "Promise" ? checker.getAwaitedType(t) : undefined;

  if (!same(returns("placeholder"))) return "has no `placeholder(): E`";
  if (!same(promised(returns("snapshot")))) return "has no `snapshot(): Promise<E>`";

  const timeline = promised(returns("timeline"));
  const field = (name: string) => {
    const symbol = timeline?.getProperty(name);
    return symbol && checker.getTypeOfSymbolAtLocation(symbol, cls);
  };
  const entries = field("entries");
  const element =
    entries && checker.isArrayType(entries)
      ? checker.getTypeArguments(entries as ts.TypeReference)[0]
      : undefined;
  const reload = field("reloadAfter");
  if (
    !timeline ||
    !same(element) ||
    (reload && checker.typeToString(checker.getNonNullableType(reload)) !== "Date") ||
    timeline.getProperties().length !== (reload ? 2 : 1)
  )
    return "has no `timeline(): Promise<{ entries: E[]; reloadAfter?: Date }>`";

  return undefined;
}

/** What keeps `e` from being a widget's body, as the rest of a sentence about it; or nothing. */
function bodyProblem(checker: ts.TypeChecker, e: Exported): string | undefined {
  if (!e.fn.getSourceFile().fileName.endsWith(".tsx")) return "is in a file of no JSX";
  if (e.fn.typeParameters?.length) return "has type parameters";
  if (e.fn.parameters.length !== 1)
    return `takes ${e.fn.parameters.length} parameters, not its entry alone`;

  const entry = e.fn.parameters[0]!;
  if (!ts.isIdentifier(entry.name)) return "destructures its entry";

  const type = checker.getTypeAtLocation(entry);
  const date = type.getProperty("date");
  const dateType = date && checker.getTypeOfSymbolAtLocation(date, entry);
  if (
    !(type.flags & ts.TypeFlags.Object) ||
    checker.isArrayType(type) ||
    !dateType ||
    checker.typeToString(dateType) !== "Date"
  )
    return `takes \`${checker.typeToString(type)}\`, where an entry is a record with a \`date: Date\``;

  return undefined;
}
