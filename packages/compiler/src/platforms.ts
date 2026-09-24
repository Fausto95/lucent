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
    diagnostics.push({
      code: Codes.PlatformConformance,
      message: `${path.basename(impl)} needs ${pm.name}.lucent.ts next to it, declaring the module's exports for every platform`,
      file: impl,
    });
  }
  return { shared, platformModules: platformModules.filter((pm) => pm.declaration), diagnostics };
}

/** Platform modules without an implementation for `platform`. */
export function missingImplementations(plan: ModulePlan, platform: Platform): Diagnostic[] {
  return plan.platformModules
    .filter((pm) => !pm.implementations[platform])
    .map((pm) => ({
      code: Codes.PlatformConformance,
      message: `${path.basename(pm.declaration!)} declares a platform module: add ${pm.name}.${platform}.lucent.ts`,
      file: pm.declaration!,
    }));
}

/** A platform module's shared file holds only declarations: `export declare function`, types and imports. */
export function declarationErrors(lp: LucentProgram, declaration: string): Diagnostic[] {
  const sf = lp.program.getSourceFile(path.resolve(declaration));
  if (!sf) return [];
  const out: Diagnostic[] = [];
  for (const s of sf.statements) {
    const declared =
      ts.canHaveModifiers(s) &&
      !!ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword);
    if (
      ts.isImportDeclaration(s) ||
      ts.isTypeAliasDeclaration(s) ||
      ts.isInterfaceDeclaration(s) ||
      (ts.isFunctionDeclaration(s) && declared && !s.body)
    )
      continue;
    out.push(
      at(
        s,
        `${path.basename(declaration)} declares a platform module (it has ${PLATFORMS.map((p) => `.${p}`).join("/")} implementations), so it may only contain \`export declare function\`s, types and imports; move shared code to another module`,
      ),
    );
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
        out.push({
          code: Codes.PlatformConformance,
          message: `${implName} does not export ${d.name}, declared in ${declName}`,
          file: m.file,
          line: 1,
          column: 1,
        });
        continue;
      }
      const decl = i.valueDeclaration ?? i.declarations?.[0];
      const declared = d.valueDeclaration ?? d.declarations?.[0];
      if (!decl || !declared) continue;
      const implType = checker.getTypeOfSymbolAtLocation(i, decl);
      const declType = checker.getTypeOfSymbolAtLocation(d, declared);
      if (!checker.isTypeAssignableTo(implType, declType)) {
        out.push(
          at(
            decl,
            `${d.name} in ${implName} has type ${checker.typeToString(implType)}, which does not match ${checker.typeToString(declType)} declared in ${declName}`,
          ),
        );
      }
    }
    for (const extra of impl.values()) {
      const decl = extra.valueDeclaration ?? extra.declarations?.[0];
      out.push(
        decl
          ? at(decl, `${implName} exports ${extra.name}, which ${declName} does not declare`)
          : {
              code: Codes.PlatformConformance,
              message: `${implName} exports ${extra.name}, which ${declName} does not declare`,
              file: m.file,
            },
      );
    }
  }
  return out;
}

function at(
  node: ts.Node,
  message: string,
  code: Diagnostic["code"] = Codes.PlatformConformance,
): Diagnostic {
  const sf = node.getSourceFile();
  const start = node.getStart(sf);
  const { line, character } = sf.getLineAndCharacterOfPosition(start);
  return {
    code,
    message,
    file: sf.fileName,
    line: line + 1,
    column: character + 1,
    start,
    length: node.getEnd() - start,
  };
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
export function platformTest(
  checker: ts.TypeChecker,
  e: ts.Expression,
): { platform: Platform; equal: boolean } | undefined {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (!ts.isBinaryExpression(e)) return undefined;
  const op = e.operatorToken.kind;
  const equal =
    op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken;
  if (
    !equal &&
    op !== ts.SyntaxKind.ExclamationEqualsEqualsToken &&
    op !== ts.SyntaxKind.ExclamationEqualsToken
  )
    return undefined;
  const literal = isPlatformValue(checker, e.left)
    ? e.right
    : isPlatformValue(checker, e.right)
      ? e.left
      : undefined;
  if (
    !literal ||
    !ts.isStringLiteral(literal) ||
    !(PLATFORMS as readonly string[]).includes(literal.text)
  )
    return undefined;
  return { platform: literal.text as Platform, equal };
}

/**
 * A condition that holds on one platform only: a platform test, alone or
 * leading `&&`s (`PLATFORM === "ios" && ready`). `platform` is where its true
 * side runs; `rest` are the other conditions, and its false side runs on both
 * platforms when there are any.
 */
export interface PlatformGuard {
  platform: Platform;
  rest: ts.Expression[];
}

export function platformGuard(
  checker: ts.TypeChecker,
  e: ts.Expression,
): PlatformGuard | undefined {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  const test = platformTest(checker, e);
  if (test)
    return { platform: test.equal ? test.platform : otherPlatform(test.platform), rest: [] };
  if (!ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken)
    return undefined;
  const left = platformGuard(checker, e.left);
  return left && { platform: left.platform, rest: [...left.rest, e.right] };
}

function otherPlatform(p: Platform): Platform {
  return PLATFORMS.find((x) => x !== p)!;
}

/**
 * The platforms that run each clause of `switch (PLATFORM)`: those its case
 * names (`default`: those no case names), and those falling through from the
 * clause before.
 */
export function switchPlatforms(
  checker: ts.TypeChecker,
  s: ts.SwitchStatement,
): Platform[][] | undefined {
  let d = s.expression;
  while (ts.isParenthesizedExpression(d)) d = d.expression;
  if (!isPlatformValue(checker, d)) return undefined;
  const named = (c: ts.CaseOrDefaultClause) =>
    ts.isCaseClause(c) && ts.isStringLiteral(c.expression) ? c.expression.text : undefined;
  const cased = new Set(s.caseBlock.clauses.map(named));
  const out: Platform[][] = [];
  let falling: Platform[] = [];
  for (const c of s.caseBlock.clauses) {
    const own = ts.isCaseClause(c)
      ? PLATFORMS.filter((p) => named(c) === p)
      : PLATFORMS.filter((p) => !cased.has(p));
    const runs = PLATFORMS.filter((p) => own.includes(p) || falling.includes(p));
    out.push(runs);
    const last = c.statements[c.statements.length - 1];
    const exits =
      !!last &&
      (ts.isBreakStatement(last) ||
        ts.isReturnStatement(last) ||
        ts.isThrowStatement(last) ||
        ts.isContinueStatement(last));
    falling = exits ? [] : runs;
  }
  return out;
}

/** The platform the innermost platform branch or case around `node` runs on; code both platforms reach has none. */
export function branchPlatform(checker: ts.TypeChecker, node: ts.Node): Platform | undefined {
  for (let child = node, p = node.parent; p; child = p, p = p.parent) {
    if (ts.isCaseClause(p) || ts.isDefaultClause(p)) {
      const s = p.parent.parent;
      const runs = switchPlatforms(checker, s)?.[s.caseBlock.clauses.indexOf(p)];
      if (runs?.length === 1) return runs[0];
      continue;
    }
    const [cond, whenTrue, whenFalse] = ts.isIfStatement(p)
      ? [p.expression, p.thenStatement, p.elseStatement]
      : ts.isConditionalExpression(p)
        ? [p.condition, p.whenTrue, p.whenFalse]
        : [];
    if (!cond || (child !== whenTrue && child !== whenFalse)) continue;
    const guard = platformGuard(checker, cond);
    if (!guard) continue;
    if (child === whenTrue) return guard.platform;
    if (!guard.rest.length) return otherPlatform(guard.platform);
  }
  return undefined;
}

const PLATFORM_NAMES: Record<Platform, string> = { ios: "iOS", android: "Android" };

/** What a shared module's platform code is: which platform each top-level declaration belongs to, and misuses. */
export interface PlatformScopes {
  /** Top-level statements that use a platform's SDK (or such a statement) outside a platform branch: they compile on that target only. */
  platforms: Map<ts.Statement, Platform>;
  errors: Diagnostic[];
}

/**
 * A top-level declaration that uses a platform's SDK outside a platform
 * branch, directly or through another such declaration, belongs to that
 * platform. Every use of platform code must then be in that platform's
 * branch or declarations; lucent:thread needs one of either platform (the
 * host has no main thread). Exports run on both platforms, so they branch.
 */
export function platformScopes(checker: ts.TypeChecker, sf: ts.SourceFile): PlatformScopes {
  const imported = new Map<ts.Symbol, { spec: string; platform?: Platform }>();
  // By local name too: an untyped platform's imports (its SDK not installed) resolve to no symbol as types.
  const importedNames = new Map<string, { spec: string; platform?: Platform }>();
  const declared = new Map<ts.Symbol, ts.Statement>();
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s)) {
      if (!ts.isStringLiteral(s.moduleSpecifier) || !s.importClause) continue;
      const spec = s.moduleSpecifier.text;
      const scope = /^lucent:(\w+)/.exec(spec)?.[1];
      // lucent:core and lucent:platform run on every platform.
      if (!scope || scope === "core" || scope === "platform") continue;
      const platform = (PLATFORMS as readonly string[]).includes(scope)
        ? (scope as Platform)
        : undefined;
      const names = [
        s.importClause.name,
        ...(s.importClause.namedBindings && ts.isNamedImports(s.importClause.namedBindings)
          ? s.importClause.namedBindings.elements.map((e) => e.name)
          : []),
      ];
      for (const n of names) {
        const sym = n && checker.getSymbolAtLocation(n);
        if (sym) imported.set(sym, { spec, platform });
        if (n) importedNames.set(n.text, { spec, platform });
      }
      continue;
    }
    for (const n of declaredNames(s)) {
      const sym = checker.getSymbolAtLocation(n);
      if (sym) declared.set(sym, s);
    }
  }
  const platforms = new Map<ts.Statement, Platform>();
  const errors: Diagnostic[] = [];
  if (!imported.size) return { platforms, errors };

  // Each statement's references to platform code, and the branch they sit in.
  type Ref = {
    id: ts.Identifier;
    stmt: ts.Statement;
    branch?: Platform;
    spec?: string;
    platform?: Platform;
    target?: ts.Statement;
  };
  const refs: Ref[] = [];
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) continue;
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) {
        const sym = checker.getSymbolAtLocation(n);
        const untyped =
          !sym ||
          !!(
            sym.flags &
            (ts.SymbolFlags.Alias |
              ts.SymbolFlags.ValueModule |
              ts.SymbolFlags.NamespaceModule |
              ts.SymbolFlags.Transient)
          );
        const from =
          (sym && imported.get(sym)) ??
          (untyped && !ts.isPropertyAccessExpression(n.parent)
            ? importedNames.get(n.text)
            : undefined);
        const target = sym && declared.get(sym);
        if (from)
          refs.push({
            id: n,
            stmt,
            branch: branchPlatform(checker, n),
            spec: from.spec,
            platform: from.platform,
          });
        else if (target && target !== stmt)
          refs.push({ id: n, stmt, branch: branchPlatform(checker, n), target });
      }
      ts.forEachChild(n, visit);
    };
    visit(stmt);
  }
  // Platforms of statements, to a fixed point through the declarations they use.
  const uses = new Map<ts.Statement, Set<Platform>>();
  const add = (stmt: ts.Statement, p: Platform) => {
    const set = uses.get(stmt) ?? new Set<Platform>();
    const grew = !set.has(p);
    set.add(p);
    uses.set(stmt, set);
    return grew;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const r of refs) {
      if (r.branch) continue;
      const p = r.platform ?? (r.target ? only(uses.get(r.target)) : undefined);
      if (p && add(r.stmt, p)) changed = true;
    }
  }
  const blamed = new Set<ts.Statement>();
  for (const [stmt, set] of uses) {
    const name = declaredNames(stmt)[0] ?? stmt;
    const what = ts.isIdentifier(name) ? name.text : "this statement";
    if (set.size > 1) {
      errors.push(
        at(
          name,
          `${what} uses lucent:ios and lucent:android outside a platform branch: branch with PLATFORM, or split it`,
          Codes.SdkImport,
        ),
      );
      blamed.add(stmt);
    } else if (!isExported(stmt)) platforms.set(stmt, only(set)!);
    // Exports run on both platforms: their uses of platform code are reported below, where they are.
  }
  for (const r of refs) {
    if (blamed.has(r.stmt)) continue;
    const home = r.branch ?? platforms.get(r.stmt);
    const needed = r.platform ?? (r.target ? platforms.get(r.target) : undefined);
    if (r.spec && !r.platform) {
      // lucent:thread: in either platform's code.
      if (!home)
        errors.push(
          at(
            r.id,
            `${r.id.text} comes from ${r.spec}: use it in platform code, inside \`if (PLATFORM === "ios")\` or its \`else\``,
            Codes.SdkImport,
          ),
        );
      continue;
    }
    if (!needed || home === needed) continue;
    const source = r.spec ? `comes from ${r.spec}` : `uses lucent:${needed}`;
    errors.push(
      at(
        r.id,
        `${r.id.text} ${source} (${PLATFORM_NAMES[needed]} code): use it inside \`if (PLATFORM === "${needed}")\`, or in other ${PLATFORM_NAMES[needed]} code`,
        Codes.SdkImport,
      ),
    );
  }
  return { platforms, errors };
}

function only<T>(set: Set<T> | undefined): T | undefined {
  return set?.size === 1 ? [...set][0] : undefined;
}

/** The names a top-level statement declares. */
function declaredNames(s: ts.Statement): ts.Identifier[] {
  if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name) return [s.name];
  if (ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isEnumDeclaration(s))
    return [s.name];
  if (!ts.isVariableStatement(s)) return [];
  const out: ts.Identifier[] = [];
  const bind = (n: ts.BindingName) => {
    if (ts.isIdentifier(n)) out.push(n);
    else for (const e of n.elements) if (!ts.isOmittedExpression(e)) bind(e.name);
  };
  for (const d of s.declarationList.declarations) bind(d.name);
  return out;
}

function isExported(s: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(s) &&
    !!ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/**
 * TypeScript errors in a shared module's code for a platform whose SDK is
 * untyped in this program (not installed, and not the target): that code is
 * never emitted here, and its SDK types do not resolve.
 */
export function inUntypedPlatformCode(
  lp: LucentProgram,
  d: Diagnostic,
  untyped: readonly Platform[],
): boolean {
  if (
    d.code !== Codes.TypeScript ||
    !d.file ||
    d.start === undefined ||
    !untyped.length ||
    platformOf(d.file)
  )
    return false;
  const sf = lp.program.getSourceFile(path.resolve(d.file));
  if (!sf) return false;
  let node: ts.Node = sf;
  for (let inner: ts.Node | undefined = sf; inner;) {
    node = inner;
    inner = ts.forEachChild(node, (c) =>
      c.getStart(sf) <= d.start! && d.start! < c.getEnd() ? c : undefined,
    );
  }
  const stmt = sf.statements.find((s) => s.getStart(sf) <= d.start! && d.start! < s.getEnd());
  const p =
    branchPlatform(lp.checker, node) ??
    (stmt ? platformScopes(lp.checker, sf).platforms.get(stmt) : undefined);
  return !!p && untyped.includes(p);
}
