import path from "node:path";
import ts from "typescript";
import { Codes, type Diagnostic } from "./diagnostics.ts";
import { type LucentProgram, moduleNameOf, platformOf } from "./program.ts";
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

function at(node: ts.Node, message: string): Diagnostic {
  const sf = node.getSourceFile();
  const start = node.getStart(sf);
  const { line, character } = sf.getLineAndCharacterOfPosition(start);
  return { code: Codes.PlatformConformance, message, file: sf.fileName, line: line + 1, column: character + 1, start, length: node.getEnd() - start };
}
