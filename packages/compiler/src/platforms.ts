import path from "node:path";
import ts from "typescript";
import { Codes, type Diagnostic } from "./diagnostics.ts";
import { builtinSdkModuleOf, type LucentProgram, moduleNameOf, platformOf } from "./program.ts";
import { type Platform, PLATFORMS } from "./sdk/schema.ts";

/** What a build targets: a platform, or `host` (tests and tools: platform modules become stubs). */
export type Target = Platform | "host";

/**
 * A platform module: `haptics.lucent.ts` declares its exports,
 * `haptics.ios.lucent.ts` and `haptics.android.lucent.ts` implement them.
 */
export interface PlatformModule {
  name: string;
  declaration?: string;
  implementations: Partial<Record<Platform, string>>;
}

export interface ModulePlan {
  /** Modules compiled the same way on every target. */
  shared: string[];
  platformModules: PlatformModule[];
  diagnostics: Diagnostic[];
}

export function planModules(files: string[]): ModulePlan {
  const byKey = new Map<string, PlatformModule>();
  const key = (f: string) => path.join(path.dirname(path.resolve(f)), moduleNameOf(f));
  for (const f of files) {
    const platform = platformOf(f);
    if (!platform) continue;
    const pm = byKey.get(key(f)) ?? { name: moduleNameOf(f), implementations: {} };
    pm.implementations[platform] = f;
    byKey.set(key(f), pm);
  }
  const shared: string[] = [];
  for (const f of files) {
    if (platformOf(f)) continue;
    const pm = byKey.get(key(f));
    if (pm) pm.declaration = f;
    else shared.push(f);
  }
  const diagnostics: Diagnostic[] = [];
  const platformModules = [...byKey.values()];
  for (const pm of platformModules) {
    if (pm.declaration) continue;
    const impl = Object.values(pm.implementations)[0]!;
    diagnostics.push({ code: Codes.PlatformConformance, message: `${path.basename(impl)} needs ${pm.name}.lucent.ts next to it, declaring the module's exports for every platform`, file: impl });
  }
  return { shared, platformModules: platformModules.filter((pm) => pm.declaration), diagnostics };
}

/** Platform modules without an implementation for `platform`. */
export function missingImplementations(plan: ModulePlan, platform: Platform): Diagnostic[] {
  return plan.platformModules
    .filter((pm) => !pm.implementations[platform])
    .map((pm) => ({ code: Codes.PlatformConformance, message: `${path.basename(pm.declaration!)} declares a platform module: add ${pm.name}.${platform}.lucent.ts`, file: pm.declaration! }));
}

/** A platform module's shared file holds only declarations: `export declare function`, types and imports. */
export function declarationErrors(lp: LucentProgram, declaration: string): Diagnostic[] {
  const sf = lp.program.getSourceFile(path.resolve(declaration));
  if (!sf) return [];
  const out: Diagnostic[] = [];
  for (const s of sf.statements) {
    const declared = ts.canHaveModifiers(s) && !!ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword);
    if (ts.isImportDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s) || (ts.isFunctionDeclaration(s) && declared && !s.body)) continue;
    out.push(at(s, `${path.basename(declaration)} declares a platform module (it has ${PLATFORMS.map((p) => `.${p}`).join("/")} implementations), so it may only contain \`export declare function\`s, types and imports; move shared code to another module`));
  }
  return out;
}

/** The platform file exports exactly the declared values, with assignable types. */
export function conformanceErrors(lp: LucentProgram): Diagnostic[] {
  const checker = lp.checker;
  const out: Diagnostic[] = [];
  const values = (sf: ts.SourceFile) => {
    const sym = checker.getSymbolAtLocation(sf);
    return sym ? checker.getExportsOfModule(sym).filter((s) => s.flags & ts.SymbolFlags.Value) : [];
  };
  for (const m of lp.modules) {
    if (!m.declaration) continue;
    const declName = path.basename(m.declaration.fileName);
    const implName = path.basename(m.file);
    const impl = new Map(values(m.sourceFile).map((s) => [s.name, s]));
    for (const d of values(m.declaration)) {
      const i = impl.get(d.name);
      impl.delete(d.name);
      if (!i) {
        out.push({ code: Codes.PlatformConformance, message: `${implName} does not export ${d.name}, declared in ${declName}`, file: m.file, line: 1, column: 1 });
        continue;
      }
      const decl = i.valueDeclaration ?? i.declarations?.[0];
      const declared = d.valueDeclaration ?? d.declarations?.[0];
      if (!decl || !declared) continue;
      const implType = checker.getTypeOfSymbolAtLocation(i, decl);
      const declType = checker.getTypeOfSymbolAtLocation(d, declared);
      if (!checker.isTypeAssignableTo(implType, declType)) {
        out.push(at(decl, `${d.name} in ${implName} has type ${checker.typeToString(implType)}, which does not match ${checker.typeToString(declType)} declared in ${declName}`));
      }
    }
    for (const extra of impl.values()) {
      const decl = extra.valueDeclaration ?? extra.declarations?.[0];
      out.push(decl ? at(decl, `${implName} exports ${extra.name}, which ${declName} does not declare`) : { code: Codes.PlatformConformance, message: `${implName} exports ${extra.name}, which ${declName} does not declare`, file: m.file });
    }
  }
  return out;
}

function at(node: ts.Node, message: string, code: Diagnostic["code"] = Codes.PlatformConformance): Diagnostic {
  const sf = node.getSourceFile();
  const start = node.getStart(sf);
  const { line, character } = sf.getLineAndCharacterOfPosition(start);
  return { code, message, file: sf.fileName, line: line + 1, column: character + 1, start, length: node.getEnd() - start };
}

// --- platform branches ------------------------------------------------------------

/** `PLATFORM` from lucent:platform. */
export function isPlatformValue(checker: ts.TypeChecker, e: ts.Expression): boolean {
  if (!ts.isIdentifier(e)) return false;
  let sym = checker.getSymbolAtLocation(e);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
  const decl = sym?.declarations?.[0];
  return !!decl && builtinSdkModuleOf(decl.getSourceFile()) === "lucent:platform";
}

/** `PLATFORM === "ios"`, `"android" !== PLATFORM`…: the platform named, and whether the test is equality. */
export function platformTest(checker: ts.TypeChecker, e: ts.Expression): { platform: Platform; equal: boolean } | undefined {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (!ts.isBinaryExpression(e)) return undefined;
  const op = e.operatorToken.kind;
  const equal = op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken;
  if (!equal && op !== ts.SyntaxKind.ExclamationEqualsEqualsToken && op !== ts.SyntaxKind.ExclamationEqualsToken) return undefined;
  const literal = isPlatformValue(checker, e.left) ? e.right : isPlatformValue(checker, e.right) ? e.left : undefined;
  if (!literal || !ts.isStringLiteral(literal) || !(PLATFORMS as readonly string[]).includes(literal.text)) return undefined;
  return { platform: literal.text as Platform, equal };
}

/** The branch of a platform test that runs on `platform` (the other one runs on the other platform). */
export function liveBranch<T>(test: { platform: Platform; equal: boolean }, platform: Platform, whenTrue: T, whenFalse: T): T {
  return (test.platform === platform) === test.equal ? whenTrue : whenFalse;
}

/** The platform the innermost platform branch around `node` runs on. */
export function branchPlatform(checker: ts.TypeChecker, node: ts.Node): Platform | undefined {
  for (let child = node, p = node.parent; p; child = p, p = p.parent) {
    const [cond, whenTrue, whenFalse] = ts.isIfStatement(p) ? [p.expression, p.thenStatement, p.elseStatement] : ts.isConditionalExpression(p) ? [p.condition, p.whenTrue, p.whenFalse] : [];
    if (!cond || (child !== whenTrue && child !== whenFalse)) continue;
    const test = platformTest(checker, cond);
    if (test) return PLATFORMS.find((x) => liveBranch(test, x, whenTrue, whenFalse) === child);
  }
  return undefined;
}

/**
 * A shared module's uses of platform code outside the branch for that
 * platform: another platform's target would compile them. lucent:thread
 * needs a platform too (the host has no main thread).
 */
export function branchErrors(checker: ts.TypeChecker, sf: ts.SourceFile): Diagnostic[] {
  const imported = new Map<ts.Symbol, { spec: string; platform?: Platform }>();
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !s.importClause) continue;
    const spec = s.moduleSpecifier.text;
    const scope = /^lucent:(\w+)/.exec(spec)?.[1];
    if (!scope || scope === "platform") continue;
    const platform = (PLATFORMS as readonly string[]).includes(scope) ? (scope as Platform) : undefined;
    const names = [s.importClause.name, ...(s.importClause.namedBindings && ts.isNamedImports(s.importClause.namedBindings) ? s.importClause.namedBindings.elements.map((e) => e.name) : [])];
    for (const n of names) {
      const sym = n && checker.getSymbolAtLocation(n);
      if (sym) imported.set(sym, { spec, platform });
    }
  }
  const out: Diagnostic[] = [];
  if (!imported.size) return out;
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) return;
    if (ts.isIdentifier(n)) {
      const sym = checker.getSymbolAtLocation(n);
      const from = sym && imported.get(sym);
      const branch = from && branchPlatform(checker, n);
      if (from && (from.platform ? branch !== from.platform : !branch)) {
        const where = from.platform ? `inside \`if (PLATFORM === "${from.platform}")\`` : `inside a platform branch (\`if (PLATFORM === "ios")\`, \`else\`)`;
        out.push(at(n, `${n.text} comes from ${from.spec}: use it ${where}, or in a *.${from.platform ?? "ios"}.lucent.ts file`, Codes.SdkImport));
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
