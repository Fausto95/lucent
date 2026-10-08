import { cpp, ts as js } from "@lucent-lang/codegen";
import path from "node:path";
import ts from "typescript";
import { literalConstant, programFacts } from "../analysis/index.ts";
import { Codes, fail } from "../diagnostics.ts";
import type { CppFunction } from "../ir/cpp.ts";
import { LUCENT_EXTENSION, lucentPackageOf } from "../packages.ts";
import { platformScopes } from "../platforms.ts";
import { coreTypesPath, type LucentModule, type LucentProgram, platformOf } from "../program.ts";
import { type ClassInfo, cppIdent, type LType, T, typeKey, unionOf } from "../types.ts";
import { actorDecls, actorsOf } from "./actors.ts";
import { BindingsEmitter, type ModuleExports } from "./bindings.ts";
import {
  type ClassOutput,
  emitClass,
  initialValue,
  jsonMemberParams,
  memberName,
  parameterProperties,
} from "./classes.ts";
import { bindCompute, emitTaskVariants, taskHeader } from "./compute.ts";
import { checkRequirementNames } from "./requirement-names.ts";
import { objcDelegate } from "./delegates.ts";
import { iosSubclass } from "./objc-subclass.ts";
import {
  apiHash,
  type BuildIdentity,
  IDENTITY_UNIT,
  identityUnit,
  programHash,
  RUNTIME_ABI,
} from "./identity.ts";
import { javaSubclass } from "./java.ts";
import { kotlinFiles } from "./kotlin.ts";
import { Ctx, type Global } from "./context.ts";
import { initThroughIr, type IrMode, type IrUnit, throughIr } from "./through-ir.ts";
import type { Initializer } from "../ir/lower.ts";
import { FnEmitter } from "./function.ts";
import { emitIface } from "./interfaces.ts";
import { declaredNames, withoutMacros } from "./macros.ts";
import { stringExpr } from "../lowering/literals.ts";
import { shimsFile } from "./swift.ts";
import { proxyParts, swiftDelegate } from "./swift-proxy.ts";
import type { ComponentDescription } from "../ui/contract.ts";
import { fabricSources } from "../ui/fabric.ts";
import { componentExports } from "../ui/proxy.ts";
import { androidComponentHosts, iosComponentViews } from "./views.ts";
import type { FunctionLike } from "../ui/roots.ts";
import { emitSetup, mountUnit, planSetup } from "./setups.ts";
import { type ToolkitName, toolkitOfPlatform } from "../ui/toolkits.ts";
import { helperStatement } from "../ui/view-helpers.ts";

export interface EmitResult {
  /** Generated C++ sources, keyed by file name. */
  files: Map<string, string>;
  /** JavaScript proxy for each module, keyed by module name. */
  proxies: Map<string, string>;
  diagnostics: import("../diagnostics.ts").Diagnostic[];
  /** Warnings (severity "warning"): reported, but the code compiles. */
  warnings?: import("../diagnostics.ts").Diagnostic[];
  /** Apple frameworks the iOS platform code uses. */
  frameworks?: string[];
  /** Pods whose modules the iOS platform code imports. */
  pods?: string[];
  /** The app's Swift packages whose modules the iOS platform code imports (`identity@version`). */
  swiftPackages?: string[];
  /** Java the Android platform code needs (subclasses of SDK classes), keyed by path under src/main/java. */
  java?: Map<string, string>;
  /** Java classes the Android glue names (JNI names), for the app's shrinker to keep. */
  javaKeep?: string[];
  /** Kotlin shims the Android glue calls, keyed by path under src/main/java. */
  kotlin?: Map<string, string>;
  /** Components' content is Compose (Kotlin the Compose compiler builds). */
  compose?: boolean;
  /** Android permissions the SDK methods the program calls require (declared in the library's manifest). */
  androidPermissions?: string[];
  /** The components the modules export (`.lucent.tsx` functions returning views): not module functions. */
  components?: ComponentDescription[];
  /**
   * The React-facing declarations of each module's
   * components (`ui/proxy.ts` componentDeclarations), by module name.
   */
  componentTypes?: Map<string, string>;
  /**
   * The file JavaScript imports for each of those modules (the shared one,
   * not a platform file), by module name: what `lucent:views/<module>` is.
   */
  componentModules?: Map<string, string>;
  /**
   * Declarations of the lucent:* modules the platform modules use
   * (`ios/UIKit.d.ts`, `thread.d.ts`…), for the app's own TypeScript:
   * map `lucent:*` to them in tsconfig paths.
   */
  types?: Map<string, string>;
  /** What the native code was built from, which the proxies check it against. Absent when the compile failed. */
  identity?: BuildIdentity;
}

/**
 * `target` names the program in its build identity: its platform's, or `all`
 * for code every target shares. `components` are the declarations of
 * component exports, left out; `views`, the components whose Fabric sources
 * and React exports to generate.
 */
export function emitProgram(
  lp: LucentProgram,
  target = lp.platform ?? "all",
  components: ReadonlySet<ts.Node> = new Set(),
  views: readonly ComponentDescription[] = [],
  setups: ReadonlyMap<string, FunctionLike> = new Map(),
  mainState: ReadonlySet<ts.Symbol> = new Set(),
): EmitResult {
  const ctx = new Ctx(lp.checker, lp.modules);
  ctx.platform = lp.platform;
  if (lp.platform) ctx.reg.platform = lp.platform;
  bindCompute(ctx, lp);
  const byFile = new Map(lp.modules.map((m) => [path.resolve(m.sourceFile.fileName), m]));
  // Importers of a platform module see its shared declaration file.
  for (const m of lp.modules)
    if (m.declaration) byFile.set(path.resolve(m.declaration.fileName), m);
  ctx.actors = actorsOf(lp.checker, lp.modules, byFile);
  const exportsOf = new Map<LucentModule, ModuleExports>();
  const imports = new Map<LucentModule, LucentModule[]>();
  // A shared module's declarations of another platform (all of them, on the host) are left out.
  const scoped = new Map(
    lp.modules
      .filter((m) => !platformOf(m.file))
      .flatMap((m) => [...platformScopes(lp.checker, m.sourceFile).platforms]),
  );
  // Components are not module functions: generating views, each setup is compiled apart (setups.ts).
  // Helper views are their toolkit's code (ui/view-helpers.ts): no C++.
  const here = (s: ts.Statement) =>
    !components.has(s) &&
    !helperStatement(lp.checker, s) &&
    !untypedStub(s) &&
    (!scoped.has(s) || scoped.get(s) === ctx.platform);
  // A split module's declaration, stubbed on the host, of a component whose views' SDKs are
  // missing: it returns an untyped view, which no host code can make. Each platform builds it.
  const stubs = new Set(lp.modules.filter((m) => m.stub).map((m) => m.sourceFile));
  function untypedStub(s: ts.Statement): boolean {
    if (!ts.isFunctionDeclaration(s) || s.body || !stubs.has(s.getSourceFile())) return false;
    const signature = lp.checker.getSignatureFromDeclaration(s);
    return !!(signature && lp.checker.getReturnTypeOfSignature(signature).flags & ts.TypeFlags.Any);
  }

  // Pass 1: classes, then functions and variables, so every body can refer to
  // any top-level declaration.
  for (const m of lp.modules) {
    exportsOf.set(m, { module: m, functions: [], classes: [], consts: [], enums: [] });
    imports.set(m, []);
    for (const s of m.sourceFile.statements) {
      if (ts.isClassDeclaration(s) && here(s)) {
        if (isDefaultExport(s)) ctx.guard(() => fail(s, Codes.UnsupportedExport, defaultExport));
        // Only `export default class {}` has no name: reported above.
        if (!s.name) continue;
        const info = ctx.reg.registerClass(s, m.name, isExported(s));
        const sym = lp.checker.getSymbolAtLocation(s.name)!;
        ctx.globals.set(sym, {
          kind: "class",
          cpp: `lucent_app::${info.cppName}`,
          module: m,
          info,
        });
        if (info.exported) exportsOf.get(m)!.classes.push(info);
        ctx.guard(() => ctx.reg.registerImplements(info));
      }
    }
  }
  for (const info of ctx.reg.classes.values()) ctx.guard(() => ctx.reg.resolveBase(info));
  ctx.guard(() => ctx.reg.resolveImplements());
  ctx.reg.propagateErrors();
  for (const m of lp.modules) {
    for (const s of m.sourceFile.statements) {
      if (here(s)) ctx.guard(() => collect(ctx, m, s, exportsOf.get(m)!, imports.get(m)!, byFile));
    }
  }
  // Calls from other modules resolve to the declarations; route them to the
  // platform implementation.
  for (const m of lp.modules) {
    if (!m.declaration) continue;
    const exportsOfFile = (sf: ts.SourceFile) => {
      const sym = lp.checker.getSymbolAtLocation(sf);
      return sym ? lp.checker.getExportsOfModule(sym) : [];
    };
    const impl = new Map(exportsOfFile(m.sourceFile).map((s) => [s.name, s]));
    for (const d of exportsOfFile(m.declaration)) {
      const g = impl.get(d.name) && ctx.globals.get(impl.get(d.name)!);
      if (g) ctx.globals.set(d, g);
    }
  }

  // Pass 2: code.
  // The IR's effect records come from the program's analysis.
  const ir: IrMode = { facts: programFacts(lp) };
  const structDecls: cpp.Decl[] = [];
  const classDefs: cpp.Decl[] = [];
  const genericClassDefs: cpp.Decl[] = [];
  const moduleDecls = new Map<LucentModule, cpp.Decl[]>();
  const moduleDefs = new Map<LucentModule, cpp.Decl[]>();
  const genericFns = new Map<LucentModule, cpp.Decl[]>();
  const statics = new Map<LucentModule, ClassOutput["statics"]>();
  const nativeDecls: cpp.Decl[] = [];
  const java = new Map<string, string>();
  for (const m of lp.modules) {
    moduleDecls.set(m, []);
    genericFns.set(m, []);
    moduleDefs.set(m, []);
    statics.set(m, []);
  }

  // Base classes first: a C++ base must be complete where it is derived from.
  const byDepth = [...ctx.reg.classes.values()].sort(
    (a, b) => ctx.reg.ancestors(a).length - ctx.reg.ancestors(b).length,
  );
  for (const info of byDepth) {
    const m = lp.modules.find((x) => x.name === info.module)!;
    const out = ctx.guard(() => emitClass(ctx, m, info, ir));
    if (!out) continue;
    (info.typeParams.length ||
    byDepth.some((c) => c.typeParams.length && ctx.reg.derives(info.id, c.id))
      ? genericClassDefs
      : classDefs
    ).push(out.definition);
    moduleDefs.get(m)!.push(...out.members);
    statics.get(m)!.push(...out.statics);
    // Methods named like a requirement of its SDK protocols that match none (a typo).
    ctx.guard(() => checkRequirementNames(ctx, info));
    // Classes implementing SDK protocols: an Objective-C object per instance.
    const objc = ctx.guard(() => objcDelegate(ctx, m, info));
    if (objc) {
      ctx.nativeUnit(m).add(`delegate ${info.id}`, objc.native);
      nativeDecls.push(objc.decl);
    }
    // Classes implementing Swift-only protocols: a Swift object per instance.
    const proxy = ctx.guard(() => swiftDelegate(ctx, m, info));
    if (proxy) {
      ctx.nativeUnit(m).add(`swift delegate ${info.id}`, proxy.native);
      nativeDecls.push(proxy.decl);
    }
    // Classes extending iOS classes: an Objective-C subclass.
    const subclass = ctx.guard(() => iosSubclass(ctx, m, info));
    if (subclass) {
      ctx.nativeUnit(m).add(`subclass ${info.id}`, subclass.native);
      nativeDecls.push(...subclass.decls);
    }
    // Classes extending Android SDK classes: a Java subclass.
    const sub =
      ctx.platform === "android" && info.sdkBase ? ctx.guard(() => javaSubclass(info)) : undefined;
    if (sub) java.set(sub.path, sub.source);
  }

  // Platform modules' declarations alias their implementations: emit each once.
  for (const g of new Set(ctx.globals.values())) {
    if (g.kind === "function")
      ctx.guard(() =>
        emitFunction(
          ctx,
          g,
          moduleDecls.get(g.module)!,
          moduleDefs.get(g.module)!,
          genericFns.get(g.module)!,
          ir,
        ),
      );
  }

  // Components' setups (setups.ts): each module's, on a platform target.
  const planned = lp.platform
    ? views.flatMap((c) => {
        const fn = setups.get(c.id);
        const m = fn && lp.modules.find((x) => x.sourceFile === fn.getSourceFile());

        return fn && m ? (ctx.guard(() => planSetup(ctx, c, fn, m)) ?? []) : [];
      })
    : [];
  for (const s of planned) {
    const out = ctx.guard(() => emitSetup(ctx, s, (unit) => throughIr(ctx, unit, ir)));
    if (!out) continue;
    moduleDecls.get(s.module)!.push(...out.decls);
    moduleDefs.get(s.module)!.push(...out.defs);
  }

  // Module state and init().
  for (const m of lp.modules) {
    const decls = moduleDecls.get(m)!;
    const vars = [...new Set(ctx.globals.values())].filter(
      (g): g is Extract<Global, { kind: "var" }> => g.kind === "var" && g.module === m,
    );
    const mains = vars.filter((g) => mainState.has(lp.checker.getSymbolAtLocation(g.decl.name)!));

    for (const g of vars)
      decls.unshift({
        k: "var",
        inline: true,
        stmt: cpp.varDecl(ctx.reg.cppType(g.type), g.cpp.split("::").pop()!, undefined, {
          style: "brace",
        }),
      });

    decls.push(cpp.fn("init", cpp.voidType, []));

    // Its classes' static fields and its variables, in source order (a type's default without a value).
    const initializers: Initializer[] = [
      ...statics.get(m)!,
      ...vars
        .filter((g) => !mains.includes(g))
        .map((g) => ({
          decl: g.decl,
          init: {
            value: initialValue(ctx, g.decl.initializer, g.type),
            type: g.type,
            into: {
              variable: {
                kind: "var" as const,
                id: g.cpp,
                name: g.decl.name.getText(),
                type: g.type,
                mutable: true,
              },
            },
          },
        })),
    ]
      .sort((a, b) => a.decl.getStart() - b.decl.getStart())
      .map((s) => s.init);
    const body = [
      ...(ctx.guard(() => initThroughIr(ctx, m, initializers, ir).body) ?? []),
      ...(ctx.guard(() => mainInitialization(ctx, m, mains)) ?? []),
    ];

    moduleDefs.get(m)!.push(cpp.fn("init", cpp.voidType, [], body, { scope: cpp.type(m.ns) }));
  }

  // What compute tasks run, with their safepoints (after all code that may compute).
  emitTaskVariants(ctx, moduleDecls, moduleDefs, ir);

  // Structs (after everything has been lowered, so the registry is complete).
  const bindings = new BindingsEmitter(ctx);
  const mods = lp.modules.map((m) => exportsOf.get(m)!);
  const initOrder = topoSort(lp.modules, imports);
  const bindingsDecls = bindings.generate(mods, initOrder);

  const templateOf = (ps: string[]) => (ps.length ? { template: ps.map(cppIdent) } : {});
  for (const s of ctx.reg.structs.values())
    structDecls.push(cpp.struct(s.cppName, [], { forward: true }));
  const structDefs = [...ctx.reg.structs.values()].map((s) =>
    cpp.struct(
      s.cppName,
      s.fields.map((f) => cpp.field(ctx.reg.cppType(f.type), cppIdent(f.name))),
      { bases: [{ type: cpp.type("lucent::Object") }] },
    ),
  );
  const classFwd = [...ctx.reg.classes.values()].map((c) =>
    cpp.struct(c.cppName, [], { ...templateOf(c.typeParams), forward: true }),
  );
  const ifaceFwd = [...ctx.reg.ifaces.values()].map((i) =>
    cpp.struct(i.cppName, [], { ...templateOf(i.typeParams), forward: true }),
  );
  // Base interfaces first: a C++ base must be complete where it is derived from.
  const ifaceDepth = (id: string): number => {
    const i = ctx.reg.iface(id);
    const self = {
      k: "iface" as const,
      id,
      args: i.typeParams.map((p) => ({ k: "tparam", name: p }) as LType),
    };
    return ctx.reg.ifaceChain(self).length;
  };
  const ifaceDefs = [...ctx.reg.ifaces.values()]
    .sort((a, b) => ifaceDepth(a.id) - ifaceDepth(b.id))
    .map((i) => ctx.guard(() => emitIface(ctx, i)))
    .filter((d): d is cpp.Decl => d !== undefined);
  const json = jsonWriters(ctx);
  const readers = ctx.guard(() => jsonReaders(ctx)) ?? { decls: [], defs: [] };

  const app = (body: cpp.Decl[]) => cpp.namespace("lucent_app", body);
  const types = [
    ...actorDecls(ctx.actors),
    ...structDecls,
    ...ifaceFwd,
    ...classFwd,
    ...structDefs,
  ];
  const defined = [
    ...ifaceDefs,
    ...classDefs,
    ...genericClassDefs,
    ...nativeDecls,
    ...json.decls,
    ...json.defs,
  ];
  const files = new Map<string, string>();
  // A platform module's exports may declare names (fields, parameters) only in its shared file.
  const declared = declaredNames(
    lp.modules.flatMap((m) => (m.declaration ? [m.sourceFile, m.declaration] : [m.sourceFile])),
  );
  const shielded = (decls: cpp.Decl[]) => withoutMacros(decls, declared);
  files.set(
    "lucent_app.h",
    cpp.printUnit({
      banner: "Generated by Lucent. Do not edit.",
      file: "lucent_app.h",
      decls: [
        { k: "pragmaOnce" },
        cpp.include("lucent/lucent.h", true),
        // lucent:ui's types (signals, component props) in any declaration, and any component's
        // (a setup of native view JSX may import nothing of lucent:ui).
        ...(setups.size || lp.modules.some((m) => /["']lucent:ui["']/.test(m.sourceFile.text))
          ? [cpp.include("lucent/view.h", true)]
          : []),
        ...shielded([
          // The JSON readers' declarations come before the classes that use them.
          ...(readers.decls.length
            ? [app(types), cpp.namespace("lucent", readers.decls), app(defined)]
            : [app([...types, ...defined])]),
          ...(readers.defs.length ? [cpp.namespace("lucent", readers.defs)] : []),
        ]),
      ],
    }),
  );
  // One header per module, including only the modules it imports: changing a
  // module's exports recompiles its importers, not every module.
  for (const m of lp.modules) {
    const banner = `Generated by Lucent from ${path.basename(m.file)}. Do not edit.`;
    const deps = [...new Set(imports.get(m)!)]
      .filter((d) => d !== m)
      .map((d) => cpp.include(`${d.ns}.h`));
    files.set(
      `${m.ns}.h`,
      cpp.printUnit({
        banner,
        file: `${m.ns}.h`,
        decls: [
          { k: "pragmaOnce" },
          cpp.include("lucent_app.h"),
          ...deps,
          ...taskHeader(ctx, m),
          ...shielded([app([cpp.namespace(m.ns, moduleDecls.get(m)!), ...genericFns.get(m)!])]),
        ],
      }),
    );
    // iOS platform code sends Objective-C messages: an Objective-C++ unit
    // (platform files, and shared modules with iOS code: the SDK's, or SwiftUI's).
    const unit = ctx.nativeUnits.get(m);
    const iosToolkit = toolkitOfPlatform("ios");
    const objc =
      lp.platform === "ios" &&
      (!!m.declaration ||
        /["']lucent:ios(\/[\w.]+)?["']/.test(m.sourceFile.text) ||
        (!!iosToolkit && m.sourceFile.text.includes(`"lucent:${iosToolkit}"`)));
    files.set(
      `${m.ns}.${objc ? "mm" : "cpp"}`,
      cpp.printUnit({
        banner,
        file: `${m.ns}.${objc ? "mm" : "cpp"}`,
        decls: [
          ...(unit?.includes() ?? []),
          cpp.include(`${m.ns}.h`),
          ...shielded([...[...(unit?.decls.values() ?? [])].flat(), app(moduleDefs.get(m)!)]),
        ],
      }),
    );
  }
  // The Swift-only members the iOS glue calls.
  if (ctx.swiftShims.size || ctx.swiftProxies.length || ctx.swiftSequences)
    files.set(
      "LucentShims.swift",
      shimsFile(ctx.swiftShims.values(), proxyParts(ctx.swiftProxies), {
        sequences: ctx.swiftSequences,
      }),
    );
  files.set(
    "lucent_bindings.cpp",
    cpp.printUnit({
      banner: "Generated by Lucent. Do not edit.",
      decls: [
        ...(lp.modules.length
          ? lp.modules.map((m) => cpp.include(`${m.ns}.h`))
          : [cpp.include("lucent_app.h")]),
        // The bindings' own headers (JSI's) come before the names are undefined.
        ...bindingsDecls.filter((d) => d.k === "include"),
        ...shielded(bindingsDecls.filter((d) => d.k !== "include")),
      ],
    }),
  );

  if (views.length) for (const [name, text] of fabricSources(views)) files.set(name, text);
  // Each component's Mount, and on iOS the view class React Native's renderer creates, which drives it.
  for (const s of planned) {
    const unit = ctx.guard(() => mountUnit(ctx, s));
    if (unit) files.set(unit.name, unit.text);
  }
  if (ctx.platform === "ios")
    for (const [name, text] of iosComponentViews(ctx, planned)) files.set(name, text);
  // SwiftUI bodies, written out in Swift.
  for (const [name, text] of toolkitFiles(ctx, "swiftui")) files.set(name, text);
  if (ctx.platform === "android")
    for (const [name, text] of androidComponentHosts(ctx, planned)) files.set(name, text);

  const proxies = new Map<string, string>();
  for (const m of mods) {
    const own = views.filter((c) => c.jsModule === m.module.name);

    proxies.set(m.module.name, jsProxy(m, own));
  }

  // What this program is, for JavaScript to check the app's native code against.
  const apis = Object.fromEntries(
    mods.map((m) => [
      m.module.name,
      apiHash(
        ctx,
        m,
        views.filter((c) => c.jsModule === m.module.name),
      ),
    ]),
  );
  const compose = toolkitFiles(ctx, "compose");
  const kotlin = new Map([...kotlinFiles(ctx), ...compose]);
  const program = programHash([
    ...files,
    ...[...java].map(([k, v]) => [`java/${k}`, v] as [string, string]),
    ...[...kotlin].map(([k, v]) => [`kotlin/${k}`, v] as [string, string]),
  ]);
  files.set(IDENTITY_UNIT, identityUnit(target, program, apis));

  return {
    files,
    proxies,
    identity: {
      runtimeAbi: RUNTIME_ABI,
      programs: { [target]: program },
      apis: { [target]: apis },
    },
    diagnostics: ctx.diagnostics,
    warnings: ctx.warnings,
    frameworks: [...ctx.frameworks].sort(),
    pods: [...ctx.pods].sort(),
    swiftPackages: [...ctx.swiftPackages].sort(),
    java,
    javaKeep: [...ctx.javaClasses].sort(),
    kotlin,
    compose: compose.length > 0,
    androidPermissions: [...ctx.androidPermissions].sort(),
  };
}

function isExported(n: ts.Node): boolean {
  return hasModifier(n, ts.SyntaxKind.ExportKeyword);
}

// JavaScript would see a default-exported declaration as `default`; the proxy exports by name.
function isDefaultExport(n: ts.Node): boolean {
  return hasModifier(n, ts.SyntaxKind.DefaultKeyword);
}

const defaultExport = "default exports are not supported; export the declaration by name";

/**
 * Fails an import of a Lucent file the build leaves out: a module of a
 * Lucent package the app does not depend on, or a file outside the app's
 * modules (findOwnFiles).
 */
function notCompiled(node: ts.Node, spec: string, file: string): never {
  const pkg = lucentPackageOf(file);
  if (pkg && !path.relative(pkg.sources, file).startsWith(".."))
    fail(
      node,
      Codes.UnsupportedImport,
      `"${spec}" is a module of ${pkg.name}, a Lucent package the app does not depend on`,
      `add ${pkg.name} to the app's dependencies in package.json`,
    );
  fail(
    node,
    Codes.UnsupportedImport,
    `"${spec}" is not among the modules compiled with the app`,
    "import a module of the app (outside node_modules, ios, android and dot directories) or of a Lucent package it depends on",
  );
}

function collect(
  ctx: Ctx,
  m: LucentModule,
  s: ts.Statement,
  exp: ModuleExports,
  deps: LucentModule[],
  byFile: Map<string, LucentModule>,
): void {
  const checker = ctx.checker;
  if (ts.isImportDeclaration(s)) {
    const spec = (s.moduleSpecifier as ts.StringLiteral).text;
    if (s.importClause?.isTypeOnly) return;
    const resolved = ts.resolveModuleName(
      spec,
      m.sourceFile.fileName,
      ctx.checker ? {} : {},
      ts.sys,
    );
    void resolved;
    const sym = checker.getSymbolAtLocation(s.moduleSpecifier);
    const target = sym?.valueDeclaration ?? sym?.declarations?.[0];
    const file = target && ts.isSourceFile(target) ? path.resolve(target.fileName) : undefined;
    if (file && path.resolve(coreTypesPath()) === file) return;
    // Platform SDKs, lucent:thread and lucent:platform (checked by createLucentProgram).
    if (spec.startsWith("lucent:")) return;
    const dep = file ? byFile.get(file) : undefined;
    if (!dep) {
      if (file && LUCENT_EXTENSION.test(file)) notCompiled(s.moduleSpecifier, spec, file);
      fail(
        s.moduleSpecifier,
        Codes.UnsupportedImport,
        `Lucent modules can only import other *.lucent.ts files and lucent: modules (got "${spec}")`,
      );
    }
    deps.push(dep);
    return;
  }
  if (ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isClassDeclaration(s))
    return;
  if (ts.isEnumDeclaration(s)) {
    const members = s.members.map((mem) => {
      const v = checker.getConstantValue(mem);
      if (v === undefined) fail(mem, Codes.UnsupportedTopLevel, "enum members must be constants");
      return { name: mem.name.getText(), value: v };
    });
    if (isExported(s)) exp.enums.push({ name: s.name.text, members });
    return;
  }
  if (ts.isFunctionDeclaration(s)) {
    if (isDefaultExport(s)) fail(s, Codes.UnsupportedExport, defaultExport);
    if (!s.name) fail(s, Codes.UnsupportedTopLevel, "functions need a name");
    const declared = !!ts.getModifiers(s)?.some((x) => x.kind === ts.SyntaxKind.DeclareKeyword);
    if (!s.body && !(m.stub && declared)) {
      // Overload signature or declaration.
      fail(
        s,
        Codes.UnsupportedTopLevel,
        "function overloads and declarations without a body are not supported",
      );
    }
    const sym = checker.getSymbolAtLocation(s.name)!;
    const sig = checker.getSignatureFromDeclaration(s)!;
    const type = ctx.reg.lowerSignature(sig, s) as LType & { k: "fn" };
    const isAsync = !!ts.getModifiers(s)?.some((x) => x.kind === ts.SyntaxKind.AsyncKeyword);
    const em = new FnEmitter(ctx, { module: m, async: isAsync });
    const params = em.paramInfos(s, type);
    const g: Global = {
      kind: "function",
      cpp: `lucent_app::${m.ns}::${cppIdent(s.name.text)}`,
      module: m,
      decl: s,
      type,
      async: isAsync,
      params,
      generic: !!s.typeParameters?.length,
    };
    ctx.globals.set(sym, g);
    if (isExported(s)) exp.functions.push(g as Extract<Global, { kind: "function" }>);
    return;
  }
  if (ts.isVariableStatement(s)) {
    const list = s.declarationList;
    if (!(list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) {
      for (const d of list.declarations) ctx.markFailed(d.name);
      fail(s, Codes.UnsupportedTopLevel, "use `let` or `const` instead of `var`");
    }
    for (const d of list.declarations) {
      if (!ts.isIdentifier(d.name)) {
        ctx.markFailed(d.name);
        fail(d, Codes.UnsupportedTopLevel, "destructuring at the top level is not supported");
      }
      const sym = checker.getSymbolAtLocation(d.name)!;
      let type: LType;
      try {
        type = ctx.reg.lower(checker.getTypeOfSymbolAtLocation(sym, d.name), d.name);
      } catch (e) {
        ctx.failed.add(sym);
        throw e;
      }
      const literal = literalConstant(d);
      const g: Global = {
        kind: "var",
        cpp: `lucent_app::${m.ns}::${cppIdent(d.name.text)}`,
        module: m,
        decl: d,
        type,
        isConst: !!(list.flags & ts.NodeFlags.Const),
        ...(literal ? { literal } : {}),
      };
      ctx.globals.set(sym, g);
      if (isExported(s)) exp.consts.push(g as Extract<Global, { kind: "var" }>);
    }
    return;
  }
  if (ts.isExportDeclaration(s))
    fail(
      s,
      Codes.UnsupportedExport,
      "export lists and re-exports are not supported; export declarations directly",
    );
  if (ts.isExportAssignment(s)) fail(s, Codes.UnsupportedExport, defaultExport);
  if (ts.isEmptyStatement(s)) return;
  fail(
    s,
    Codes.UnsupportedTopLevel,
    "only declarations are allowed at the top level of a Lucent module",
  );
}

function emitFunction(
  ctx: Ctx,
  g: Extract<Global, { kind: "function" }>,
  decls: cpp.Decl[],
  defs: cpp.Decl[],
  genericFns: cpp.Decl[],
  ir: IrMode,
): void {
  const s = g.decl;
  const name = cppIdent(s.name!.text);

  if (!s.body) {
    platformStub(ctx, g, decls, defs);
    return;
  }

  const lowered = functionThroughIr(ctx, g, ir);

  // A generic function is a C++ template, which its callers instantiate.
  if (g.generic) {
    const template = s.typeParameters!.map((p) => cppIdent(p.name.text));

    genericFns.push(
      cpp.namespace(g.module.ns, [
        cpp.fn(name, lowered.ret, lowered.params, lowered.body, { template }),
      ]),
    );
    decls.push(cpp.fn(name, lowered.ret, lowered.params, undefined, { template }));
    return;
  }

  decls.push(cpp.fn(name, lowered.ret, lowered.params));
  defs.push(
    cpp.fn(name, lowered.ret, lowered.params, lowered.body, { scope: cpp.type(g.module.ns) }),
  );
}

/** A platform module's export on a target without an implementation: it throws, or rejects. */
function platformStub(
  ctx: Ctx,
  g: Extract<Global, { kind: "function" }>,
  decls: cpp.Decl[],
  defs: cpp.Decl[],
): void {
  const name = cppIdent(g.decl.name!.text);
  const ret = g.type.ret;
  const params = g.params.map((p, i) => cpp.param(ctx.reg.cppType(p.cppType), `p${i}_`));
  const error = cpp.call("lucent::makeError", [
    stringExpr("Error"),
    stringExpr(`${g.module.name}.${name} is not available on this platform`),
  ]);
  const promised = ret.k === "promise" ? ctx.reg.cppRetType(ret.inner) : undefined;
  const body: cpp.Stmt = promised
    ? cpp.ret(cpp.call(cpp.scoped(cpp.type("lucent::Promise", promised), "rejected"), [error]))
    : { k: "throw", value: cpp.construct(cpp.type("lucent::Exception"), [error]) };
  const retType = promised ? cpp.type("lucent::Promise", promised) : ctx.reg.cppRetType(ret);

  decls.push(cpp.fn(name, retType, params));
  defs.push(cpp.fn(name, retType, params, [body], { scope: cpp.type(g.module.ns) }));
}

/** A module's function, through the semantic IR (ir/). */
function functionThroughIr(
  ctx: Ctx,
  g: Extract<Global, { kind: "function" }>,
  ir: IrMode,
): CppFunction {
  const ret = g.type.ret;
  const generator = g.decl.asteriskToken && ret.k === "iter" ? ret.e : undefined;
  // An async function's body returns what its promise fulfils with; a generator's, nothing.
  const result = g.async && ret.k === "promise" ? ret.inner : generator ? T.void : ret;
  const unit: IrUnit = {
    decl: g.decl,
    id: g.cpp,
    params: g.params,
    result,
    async: g.async,
    ...(generator ? { generator } : {}),
    generic: g.generic,
    opts: { module: g.module, async: g.async },
    site: g.decl.name!.text,
  };

  return throughIr(ctx, unit, ir);
}

function topoSort(
  modules: LucentModule[],
  deps: Map<LucentModule, LucentModule[]>,
): LucentModule[] {
  const out: LucentModule[] = [];
  const state = new Map<LucentModule, number>();
  const visit = (m: LucentModule) => {
    if (state.get(m) === 2) return;
    if (state.get(m) === 1) return; // cycle: keep file order
    state.set(m, 1);
    for (const d of deps.get(m) ?? []) visit(d);
    state.set(m, 2);
    out.push(m);
  };
  modules.forEach(visit);
  return out;
}

function jsonWriters(ctx: Ctx): { decls: cpp.Decl[]; defs: cpp.Decl[] } {
  const decls: cpp.Decl[] = [];
  const defs: cpp.Decl[] = [];
  const [w, v, first, toJson] = [cpp.id("w"), cpp.id("v"), cpp.id("first"), cpp.id("toJson")];
  const raw = (text: string) => cpp.exprStmt(cpp.call(cpp.dot(w, "raw"), [cpp.str(text)]));
  /** A free function taking a struct's Ref, found by ADL. */
  const structFn = (name: string, ret: cpp.Type, s: string, body: cpp.Stmt[]) => {
    const params = [
      jsonMemberParams[0]!,
      cpp.param(cpp.reference(cpp.constType(cpp.type("lucent::Ref", cpp.type(s)))), "v"),
    ];
    decls.push(cpp.fn(name, ret, params));
    defs.push(cpp.fn(name, ret, params, body, { inline: true }));
  };
  const object = (self: cpp.Expr, fields: string[]): cpp.Stmt[] => [
    raw("{"),
    cpp.varDecl(cpp.type("bool"), "first", cpp.bool(true)),
    ...fields.map((f) =>
      cpp.exprStmt(
        cpp.call("lucent::jsonField", [w, first, cpp.str(f), cpp.arrow(self, cppIdent(f))]),
      ),
    ),
    cpp.exprStmt(cpp.cast("c", cpp.voidType, first)),
    raw("}"),
  ];
  /** `return lucent::jsonResult(w, self->toJSON());` */
  const result = (self: cpp.Expr) =>
    cpp.ret(cpp.call("lucent::jsonResult", [w, cpp.call(cpp.arrow(self, cppIdent("toJSON")))]));

  for (const s of ctx.reg.structs.values()) {
    const fields = s.fields.map((f) => f.name);
    structFn("jsonWrite", cpp.voidType, s.cppName, [
      cpp.ifStmt(cpp.not(v), [raw("null"), cpp.ret()]),
      ...object(v, fields),
    ]);

    // A toJSON function property: JavaScript writes its value instead (JSON.stringify passes
    // the key, which a function without parameters ignores).
    const fn = s.fields.find((f) => f.name === "toJSON" && !f.optional)?.type;
    if (fn?.k === "fn" && !fn.params.length)
      structFn("jsonValue", cpp.type("bool"), s.cppName, [
        cpp.ifStmt(cpp.not(v), [raw("null"), cpp.ret(cpp.bool(true))]),
        result(v),
      ]);
  }
  for (const c of ctx.reg.classes.values()) {
    const own = ctx.guard(() => classJson(c));
    if (!own) continue;

    const self = cpp.type(c.cppName, ...c.typeParams.map((p) => cpp.type(cppIdent(p))));
    defs.push(
      cpp.fn("lucentJson_", cpp.type("bool"), jsonMemberParams, own, {
        scope: self,
        inline: true,
        ...(c.typeParams.length ? { template: c.typeParams.map(cppIdent) } : {}),
      }),
    );
  }
  return { decls, defs };

  /**
   * The body of a class's lucentJson_: toJSON's value, or every own enumerable
   * field (TypeScript visibility does not hide one).
   */
  function classJson(c: ClassInfo): cpp.Stmt[] {
    const chain = ctx.reg.chain({ k: "class", id: c.id, args: [] });
    const fields = new Set<string>();
    // Base fields first, as super() creates them; parameter properties before declared fields.
    for (const { info } of chain.toReversed()) {
      const ctor = info.decl.members.find(ts.isConstructorDeclaration);
      for (const p of parameterProperties(ctor)) fields.add(memberName(p));
      for (const m of info.decl.members)
        if (ts.isPropertyDeclaration(m) && !ts.isPrivateIdentifier(m.name) && !declaredOnly(m))
          fields.add(memberName(m));
    }
    const body = [...object(cpp.self, [...fields]), cpp.ret(cpp.bool(true))];
    const called = [cpp.ifStmt(toJson, [result(cpp.self)]), ...body];

    // A toJSON field is an own property, which shadows any toJSON method on the prototype.
    const field = chain.flatMap(({ info }) => toJsonFields(info))[0];
    if (field) {
      const t = ctx.reg.lower(ctx.checker.getTypeAtLocation(field), field);
      const fn = t.k === "opt" ? t.inner : t.k === "union" ? t.ms.find((m) => m.k === "fn") : t;
      if (fn?.k !== "fn") return body;
      if (t !== fn || fn.params.length || fn.ret.k === "promise")
        fail(
          field,
          Codes.UnsupportedClassFeature,
          "a toJSON field always holds a function without parameters that is not async: JSON.stringify writes its value",
        );
      return called;
    }

    for (const { info } of chain) {
      const method = info.decl.members.find(
        (m): m is ts.MethodDeclaration =>
          ts.isMethodDeclaration(m) &&
          !isStatic(m) &&
          ts.isIdentifier(m.name) &&
          m.name.text === "toJSON",
      );
      if (!method) continue;
      if (method.parameters.length || method.typeParameters?.length || isAsync(method))
        fail(
          method,
          Codes.UnsupportedClassFeature,
          "toJSON takes no parameters and is not async or generic: JSON.stringify writes its value",
        );
      return called;
    }
    return body;
  }
}

/** A class's own fields named toJSON, parameter properties included. */
function toJsonFields(info: ClassInfo): (ts.PropertyDeclaration | ts.ParameterDeclaration)[] {
  const ctor = info.decl.members.find(ts.isConstructorDeclaration);
  const declared = info.decl.members.filter(
    (m): m is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(m) && !ts.isPrivateIdentifier(m.name) && !declaredOnly(m),
  );
  return [...parameterProperties(ctor), ...declared].filter((m) => memberName(m) === "toJSON");
}

const hasModifier = (m: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(m) && !!ts.getModifiers(m)?.some((x) => x.kind === kind);
const isStatic = (m: ts.Node) => hasModifier(m, ts.SyntaxKind.StaticKeyword);
const isAsync = (m: ts.Node) => hasModifier(m, ts.SyntaxKind.AsyncKeyword);
/** A field JavaScript does not create on the instance: static, `declare` or `abstract`. */
const declaredOnly = (m: ts.Node) =>
  [ts.SyntaxKind.StaticKeyword, ts.SyntaxKind.DeclareKeyword, ts.SyntaxKind.AbstractKeyword].some(
    (k) => hasModifier(m, k),
  );

/** JsonRead specializations for the object types and unions JSON.parse builds. */
function jsonReaders(ctx: Ctx): { decls: cpp.Decl[]; defs: cpp.Decl[] } {
  const reg = ctx.reg;
  const structs = new Map<string, LType & { k: "struct" }>();
  const unions = new Map<string, LType & { k: "union" }>();
  const visit = (t: LType): void => {
    switch (t.k) {
      case "struct":
        if (structs.has(t.id)) return;
        structs.set(t.id, t);
        return reg.struct(t.id).fields.forEach((f) => visit(f.type));
      case "union":
        if (unions.has(typeKey(t))) return;
        unions.set(typeKey(t), t);
        return t.ms.forEach(visit);
      case "opt":
        return visit(t.inner);
      case "array":
        return visit(t.e);
      case "dict":
        return visit(t.val);
      case "tuple":
        return t.es.forEach(visit);
    }
  };
  ctx.jsonReads.forEach(visit);
  const decls: cpp.Decl[] = [];
  const defs: cpp.Decl[] = [];
  const [v, p] = [cpp.id("v"), cpp.id("p")];
  const params = [
    cpp.param(cpp.reference(cpp.constType(cpp.type("JsonValue"))), "v"),
    cpp.param(cpp.reference(cpp.constType(cpp.type("std::string"))), "p"),
  ];
  const kind = (k: string) => cpp.id(`JsonValue::Kind::${k}`);
  const shapeError = (path: cpp.Expr, expected: string, got: cpp.Expr) =>
    cpp.exprStmt(cpp.call("jsonShapeError", [path, cpp.str(expected), got]));
  const describe = (x: cpp.Expr) => cpp.call(cpp.arrow(x, "describe"));
  /** `template <> struct JsonRead<T> { static T read(…); };` and its definition. */
  const reader = (t: LType, body: cpp.Stmt[]) => {
    const type = reg.cppType(t);
    decls.push(
      cpp.struct("JsonRead", [cpp.method("read", type, params, undefined, { static: true })], {
        template: [],
        args: [type],
      }),
    );
    defs.push(
      cpp.fn("read", type, params, body, {
        inline: true,
        scope: cpp.type("JsonRead", type),
      }),
    );
  };
  for (const t of structs.values()) {
    const info = reg.struct(t.id);
    const out = cpp.id("out");
    reader(t, [
      cpp.ifStmt(cpp.binary(cpp.dot(v, "kind"), "!=", kind("Object")), [
        shapeError(p, "an object", cpp.call(cpp.dot(v, "describe"))),
      ]),
      cpp.varDecl(
        cpp.auto,
        "out",
        cpp.call("std::make_shared", [], [cpp.type(`lucent_app::${info.cppName}`)]),
      ),
      ...info.fields.map((f) =>
        cpp.exprStmt(
          cpp.assign(
            cpp.arrow(out, cppIdent(f.name)),
            cpp.call("jsonMember", [v, cpp.str(f.name), p], [reg.cppType(f.type)]),
          ),
        ),
      ),
      cpp.ret(out),
    ]);
  }
  for (const u of unions.values()) {
    const type = reg.cppType(u);
    const make = (m: LType) =>
      cpp.ret(
        cpp.construct(type, [
          cpp.templateId("std::in_place_type", [reg.cppType(m)]),
          cpp.call(cpp.scoped(cpp.type("JsonRead", reg.cppType(m)), "read"), [v, p]),
        ]),
      );
    const byKind = (ks: string[]) => u.ms.filter((m) => ks.includes(m.k));
    const cases: { values: cpp.Expr[]; isDefault?: boolean; body: cpp.Stmt[] }[] = [];
    const one = (k: string, ks: string[]) => {
      const ms = byKind(ks);
      if (ms.length > 1 && k !== "Object") throw new Error(`ambiguous ${k}`);
      if (ms.length === 1) cases.push({ values: [kind(k)], body: [make(ms[0]!)] });
    };
    one("Number", ["number"]);
    one("String", ["string"]);
    one("Bool", ["boolean"]);
    try {
      one("Array", ["array", "tuple"]);
    } catch {
      fail(
        undefined,
        Codes.AmbiguousUnion,
        `JSON.parse cannot tell apart the array types in ${typeKey(u)}`,
      );
    }
    const objects = byKind(["struct", "dict"]);
    if (objects.length === 1) cases.push({ values: [kind("Object")], body: [make(objects[0]!)] });
    else if (objects.length > 1) {
      // A field every object type has, with a distinct string literal in each.
      const infos = objects.map((o) => (o.k === "struct" ? reg.struct(o.id) : undefined));
      const first = infos[0];
      const disc = first?.fields.find(
        (f) =>
          f.literal !== undefined &&
          infos.every((i) => i?.fields.some((g) => g.name === f.name && g.literal !== undefined)),
      );
      const literals = disc
        ? infos.map((i) => i!.fields.find((g) => g.name === disc.name)!.literal!)
        : [];
      if (!disc || new Set(literals).size !== literals.length)
        fail(
          undefined,
          Codes.AmbiguousUnion,
          `JSON.parse needs a string-literal discriminant to tell apart the object types in ${typeKey(u)}`,
        );
      const d = cpp.id("d");
      const where = cpp.binary(p, "+", cpp.str(`.${disc.name}`));
      const expected = `one of the ${disc.name} values`;
      cases.push({
        values: [kind("Object")],
        body: [
          cpp.block([
            cpp.varDecl(
              cpp.pointer(cpp.constType(cpp.type("JsonValue"))),
              "d",
              cpp.call(cpp.dot(v, "find"), [stringExpr(disc.name)]),
            ),
            cpp.ifStmt(cpp.or(cpp.not(d), cpp.binary(cpp.arrow(d, "kind"), "!=", kind("String"))), [
              shapeError(where, expected, cpp.conditional(d, describe(d), cpp.str("undefined"))),
            ]),
            ...objects.map((o, i) =>
              cpp.ifStmt(cpp.binary(cpp.arrow(d, "string"), "==", stringExpr(literals[i]!)), [
                make(o),
              ]),
            ),
            shapeError(where, expected, cpp.str("another string")),
          ]),
        ],
      });
    }
    cases.push({
      values: [],
      isDefault: true,
      body: [
        shapeError(
          p,
          `one of ${u.ms.map((m) => typeKey(m)).join(" | ")}`,
          cpp.call(cpp.dot(v, "describe")),
        ),
      ],
    });
    reader(u, [{ k: "switch", on: cpp.dot(v, "kind"), cases }]);
  }
  return { decls, defs };
}

/**
 * The JS loader's path in the native package's js/ directory, next to the
 * proxies. No module name maps there: package names cannot start with "_".
 */
export const LOADER = "_lucent/runtime.js";

/** The build identity the proxies pass the loader, next to it. */
export const IDENTITY = "_lucent/identity.js";

/** The JavaScript that replaces a `*.lucent.ts` module in the app bundle. */
function jsProxy(m: ModuleExports, components: readonly ComponentDescription[]): string {
  // Relative to js/<name>.js; Metro's transformer rebases it onto the source file.
  const up = "../".repeat(m.module.name.split("/").length - 1) || "./";
  const loader = `${up}${LOADER}`;
  const [exports, mod] = [js.name("exports"), js.name("m")];
  const require = (spec: string) => js.call(js.name("require"), [js.str(spec)]);
  const exported = (name: string, value: js.Expr) =>
    js.stmt(js.exprStmt(js.assign(js.member(exports, name), value)));
  const decls: js.Decl[] = [
    js.stmt(js.exprStmt(js.str("use strict"))),
    js.stmt(
      js.exprStmt(
        js.call(js.member(js.name("Object"), "defineProperty"), [
          exports,
          js.str("__esModule"),
          js.objectLit([{ key: "value", value: js.bool(true) }]),
        ]),
      ),
    ),
    js.stmt({ k: "const", name: ["loadModule", "lucentClass"], init: require(loader) }),
    // `react-native` is required from the app's own location, so the app's
    // copy is used even in monorepos with several versions installed.
    js.stmt({
      k: "const",
      name: "m",
      init: js.call(js.name("loadModule"), [
        js.str(m.module.name),
        js.arrow([], js.member(require("react-native"), "TurboModuleRegistry")),
        // What this JavaScript was built with, which the loader checks the app's native code against.
        require(`${up}${IDENTITY}`),
      ]),
    }),
  ];
  for (const f of m.functions) {
    const name = f.decl.name!.text;
    decls.push(exported(name, js.member(mod, name)));
  }
  for (const c of m.classes) {
    const name = c.decl.name!.text;
    decls.push(exported(name, js.call(js.name("lucentClass"), [js.member(mod, name)])));
  }
  for (const c of m.consts) {
    const name = c.decl.name.getText();
    decls.push(
      c.isConst
        ? exported(name, js.member(mod, name))
        : js.stmt(
            js.exprStmt(
              js.call(js.member(js.name("Object"), "defineProperty"), [
                exports,
                js.str(name),
                js.objectLit([
                  { key: "enumerable", value: js.bool(true) },
                  { key: "get", value: js.arrow([], js.member(mod, name)) },
                ]),
              ]),
            ),
          ),
    );
  }
  for (const e of m.enums) {
    const entries: { key: string; value: js.Expr; quoted: true }[] = [];
    for (const mem of e.members) {
      const value = typeof mem.value === "number" ? js.num(mem.value) : js.str(mem.value);
      entries.push({ key: mem.name, value, quoted: true });
      // Numeric enums map back from value to name, as TypeScript's do.
      if (typeof mem.value === "number")
        entries.push({ key: String(mem.value), value: js.str(mem.name), quoted: true });
    }
    decls.push(
      exported(e.name, js.call(js.member(js.name("Object"), "freeze"), [js.objectLit(entries)])),
    );
  }
  decls.push(...componentExports(components, up));
  return js.printUnit({ banner: "Generated by Lucent. Do not edit.", decls });
}

/**
 * Assigns the variables only main-thread code uses (analysis/main-state.ts)
 * on the main thread: a reload of JavaScript initializes the module again
 * while views of the old one may still use them. Each starts from a literal
 * or an empty collection, which reads nothing of the module's.
 */
function mainInitialization(
  ctx: Ctx,
  m: LucentModule,
  mains: readonly Extract<Global, { kind: "var" }>[],
): cpp.Stmt[] {
  if (!mains.length) return [];

  const em = new FnEmitter(ctx, { module: m, async: false });
  const assigned = mains.map((g) =>
    cpp.exprStmt(
      cpp.assign(
        cpp.id(g.cpp),
        g.decl.initializer
          ? em.exprAs(g.decl.initializer, g.type)
          : cpp.construct(ctx.reg.cppType(g.type), []),
      ),
    ),
  );

  return [cpp.exprStmt(cpp.call("lucent::postToMain", [cpp.lambda([], [], assigned)]))];
}

export type { ClassInfo };
export { unionOf };

/** The files of the program's `toolkit` bodies (toolkit.ts), by name. */
function toolkitFiles(ctx: Ctx, toolkit: ToolkitName): [string, string][] {
  return [...ctx.toolkitFiles.values()]
    .filter((f) => f.toolkit === toolkit)
    .map((f) => {
      const { name, text } = f.file();

      return [name, text];
    });
}
