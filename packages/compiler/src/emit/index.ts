import path from "node:path";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { platformScopes } from "../platforms.ts";
import { coreTypesPath, type LucentModule, type LucentProgram, platformOf } from "../program.ts";
import { type ClassInfo, cppIdent, type LType, T, typeKey, unionOf } from "../types.ts";
import { BindingsEmitter, type ModuleExports, publicMembers } from "./bindings.ts";
import { emitClass } from "./classes.ts";
import { objcDelegate } from "./delegates.ts";
import { javaSubclass } from "./java.ts";
import { Ctx, type Global } from "./context.ts";
import { FnEmitter } from "./function.ts";
import { emitIface } from "./interfaces.ts";
import { cppQuoted } from "./literals.ts";

export interface EmitResult {
  /** Generated C++ sources, keyed by file name. */
  files: Map<string, string>;
  /** JavaScript proxy for each module, keyed by module name. */
  proxies: Map<string, string>;
  diagnostics: import("../diagnostics.ts").Diagnostic[];
  /** Apple frameworks the iOS platform code uses. */
  frameworks?: string[];
  /** Java the Android platform code needs (subclasses of SDK classes), keyed by path under src/main/java. */
  java?: Map<string, string>;
  /** Java classes the Android glue names (JNI names), for the app's shrinker to keep. */
  javaKeep?: string[];
  /** Android permissions the SDK methods the program calls require (declared in the library's manifest). */
  androidPermissions?: string[];
  /**
   * Declarations of the lucent:* modules the platform modules use
   * (`ios/UIKit.d.ts`, `thread.d.ts`…), for the app's own TypeScript:
   * map `lucent:*` to them in tsconfig paths.
   */
  types?: Map<string, string>;
}

export function emitProgram(lp: LucentProgram): EmitResult {
  const ctx = new Ctx(lp.checker, lp.modules);
  ctx.platform = lp.platform;
  const byFile = new Map(lp.modules.map((m) => [path.resolve(m.sourceFile.fileName), m]));
  // Importers of a platform module see its shared declaration file.
  for (const m of lp.modules) if (m.declaration) byFile.set(path.resolve(m.declaration.fileName), m);
  const exportsOf = new Map<LucentModule, ModuleExports>();
  const imports = new Map<LucentModule, LucentModule[]>();
  // A shared module's declarations of another platform (all of them, on the host) are left out.
  const scoped = new Map(lp.modules.filter((m) => !platformOf(m.file)).flatMap((m) => [...platformScopes(lp.checker, m.sourceFile).platforms]));
  const here = (s: ts.Statement) => !scoped.has(s) || scoped.get(s) === ctx.platform;

  // Pass 1: classes, then functions and variables, so every body can refer to
  // any top-level declaration.
  for (const m of lp.modules) {
    exportsOf.set(m, { module: m, functions: [], classes: [], consts: [], enums: [] });
    imports.set(m, []);
    for (const s of m.sourceFile.statements) {
      if (ts.isClassDeclaration(s) && here(s)) {
        if (!s.name) {
          ctx.diagnostics.push({ code: Codes.UnsupportedTopLevel, message: "classes need a name", file: m.file });
          continue;
        }
        const info = ctx.reg.registerClass(s, m.name, isExported(s));
        const sym = lp.checker.getSymbolAtLocation(s.name)!;
        ctx.globals.set(sym, { kind: "class", cpp: `lucent_app::${info.cppName}`, module: m, info });
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
  const header: string[] = [];
  const structDecls: string[] = [];
  const classDefs: string[] = [];
  const genericClassDefs: string[] = [];
  const moduleDecls = new Map<LucentModule, string[]>();
  const moduleDefs = new Map<LucentModule, string[]>();
  const genericFns = new Map<LucentModule, string[]>();
  const staticInits = new Map<LucentModule, string[]>();
  const nativeDecls: string[] = [];
  const java = new Map<string, string>();
  for (const m of lp.modules) {
    moduleDecls.set(m, []);
    genericFns.set(m, []);
    moduleDefs.set(m, []);
    staticInits.set(m, []);
  }

  // Base classes first: a C++ base must be complete where it is derived from.
  const byDepth = [...ctx.reg.classes.values()].sort((a, b) => ctx.reg.ancestors(a).length - ctx.reg.ancestors(b).length);
  for (const info of byDepth) {
    const m = lp.modules.find((x) => x.name === info.module)!;
    const out = ctx.guard(() => emitClass(ctx, m, info));
    if (!out) continue;
    (info.typeParams.length || byDepth.some((c) => c.typeParams.length && ctx.reg.derives(info.id, c.id)) ? genericClassDefs : classDefs).push(out.definition);
    if (out.members) moduleDefs.get(m)!.push(out.members);
    staticInits.get(m)!.push(...out.staticInits);
    // Classes implementing SDK protocols: an Objective-C object per instance.
    const objc = ctx.guard(() => objcDelegate(ctx, m, info));
    if (objc) {
      ctx.nativeUnit(m).lines.add(objc.lines);
      nativeDecls.push(objc.decl);
    }
    // Classes extending Android SDK classes: a Java subclass.
    const sub = ctx.platform === "android" && info.sdkBase ? ctx.guard(() => javaSubclass(info)) : undefined;
    if (sub) java.set(sub.path, sub.source);
  }

  // Platform modules' declarations alias their implementations: emit each once.
  for (const g of new Set(ctx.globals.values())) {
    if (g.kind === "function") ctx.guard(() => emitFunction(ctx, g, moduleDecls.get(g.module)!, moduleDefs.get(g.module)!, genericFns.get(g.module)!));
  }

  // Module state and init().
  for (const m of lp.modules) {
    const decls = moduleDecls.get(m)!;
    const em = new FnEmitter(ctx, { module: m, async: false, returnType: T.void });
    for (const g of new Set(ctx.globals.values())) {
      if (g.kind !== "var" || g.module !== m) continue;
      decls.unshift(`inline ${ctx.reg.cpp(g.type)} ${g.cpp.split("::").pop()}{};`);
      if (g.decl.initializer) {
        const v = ctx.guard(() => em.exprAs(g.decl.initializer!, g.type));
        if (v !== undefined) em.line(`${g.cpp} = ${v};`);
      } else {
        em.line(`${g.cpp} = ${ctx.reg.cpp(g.type)}{};`);
      }
    }
    decls.push("void init();");
    moduleDefs.get(m)!.push(`void ${m.ns}::init() {\n${[...staticInits.get(m)!, ...em.body()].join("\n")}\n}`);
  }

  // Structs (after everything has been lowered, so the registry is complete).
  const bindings = new BindingsEmitter(ctx);
  const mods = lp.modules.map((m) => exportsOf.get(m)!);
  const initOrder = topoSort(lp.modules, imports);
  const bindingsCpp = bindings.generate(mods, initOrder);

  for (const s of ctx.reg.structs.values()) structDecls.push(`struct ${s.cppName};`);
  const structDefs = [...ctx.reg.structs.values()].map((s) => {
    const fields = s.fields.map((f) => `  ${ctx.reg.cpp(f.type)} ${cppIdent(f.name)}{};`);
    return `struct ${s.cppName} : lucent::Object {\n${fields.join("\n")}\n};`;
  });
  const classFwd = [...ctx.reg.classes.values()].map((c) =>
    c.typeParams.length ? `template <${c.typeParams.map((p) => `class ${cppIdent(p)}`).join(", ")}>\nstruct ${c.cppName};` : `struct ${c.cppName};`,
  );
  const tmplOf = (ps: string[]) => (ps.length ? `template <${ps.map((p) => `class ${cppIdent(p)}`).join(", ")}>\n` : "");
  const ifaceFwd = [...ctx.reg.ifaces.values()].map((i) => `${tmplOf(i.typeParams)}struct ${i.cppName};`);
  // Base interfaces first: a C++ base must be complete where it is derived from.
  const ifaceDepth = (id: string): number => {
    const i = ctx.reg.iface(id);
    const self = { k: "iface" as const, id, args: i.typeParams.map((p) => ({ k: "tparam", name: p }) as LType) };
    return ctx.reg.ifaceChain(self).length;
  };
  const ifaceDefs = [...ctx.reg.ifaces.values()]
    .sort((a, b) => ifaceDepth(a.id) - ifaceDepth(b.id))
    .map((i) => ctx.guard(() => emitIface(ctx, i)))
    .filter((d): d is string => d !== undefined);
  const json = jsonWriters(ctx);
  const readers = ctx.guard(() => jsonReaders(ctx)) ?? { decls: [], defs: [] };

  header.push("// Generated by Lucent. Do not edit.");
  header.push("#pragma once");
  header.push("#include <lucent/lucent.h>");
  header.push("");
  header.push("namespace lucent_app {");
  header.push(...structDecls, ...ifaceFwd, ...classFwd, "");
  header.push(...structDefs, "");
  if (readers.decls.length) header.push("}  // namespace lucent_app", "namespace lucent {", ...readers.decls, "}  // namespace lucent", "namespace lucent_app {", "");
  header.push(...ifaceDefs, "");
  header.push(...classDefs, "");
  header.push(...genericClassDefs, "");
  header.push(...nativeDecls, "");
  header.push(...json.decls, "");
  header.push(...json.defs);
  header.push("}  // namespace lucent_app", "");
  if (readers.defs.length) header.push("namespace lucent {", ...readers.defs, "}  // namespace lucent", "");

  const files = new Map<string, string>();
  files.set("lucent_app.h", header.join("\n"));
  // One header per module, including only the modules it imports: changing a
  // module's exports recompiles its importers, not every module.
  for (const m of lp.modules) {
    const deps = [...new Set(imports.get(m)!)].filter((d) => d !== m).map((d) => `#include "${d.ns}.h"`);
    files.set(
      `${m.ns}.h`,
      [`// Generated by Lucent from ${path.basename(m.file)}. Do not edit.`, "#pragma once", '#include "lucent_app.h"', ...deps, "", "namespace lucent_app {", `namespace ${m.ns} {`, ...moduleDecls.get(m)!, `}  // namespace ${m.ns}`, ...genericFns.get(m)!, "}  // namespace lucent_app", ""].join("\n"),
    );
    // iOS platform code sends Objective-C messages: an Objective-C++ unit
    // (platform files, and shared modules with iOS branches).
    const unit = ctx.nativeUnits.get(m);
    const objc = lp.platform === "ios" && (!!m.declaration || /["']lucent:ios(\/[\w.]+)?["']/.test(m.sourceFile.text));
    const nativeHead = unit ? `${[...unit.includes].sort().join("\n")}\n` : "";
    const nativeChecks = unit?.lines.size ? `\n${[...unit.lines].join("\n")}\n` : "";
    files.set(`${m.ns}.${objc ? "mm" : "cpp"}`, `// Generated by Lucent from ${path.basename(m.file)}. Do not edit.\n${nativeHead}#include "${m.ns}.h"\n${nativeChecks}\nnamespace lucent_app {\n\n${moduleDefs.get(m)!.join("\n\n")}\n\n}  // namespace lucent_app\n`);
  }
  files.set("lucent_bindings.cpp", bindingsCpp.replace('#include "lucent_app.h"', lp.modules.map((m) => `#include "${m.ns}.h"`).join("\n") || '#include "lucent_app.h"'));

  const proxies = new Map<string, string>();
  for (const m of mods) proxies.set(m.module.name, jsProxy(m));
  return { files, proxies, diagnostics: ctx.diagnostics, frameworks: [...ctx.frameworks].sort(), java, javaKeep: [...ctx.javaClasses].sort(), androidPermissions: [...ctx.androidPermissions].sort() };
}

function isExported(n: ts.Node): boolean {
  return ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function collect(ctx: Ctx, m: LucentModule, s: ts.Statement, exp: ModuleExports, deps: LucentModule[], byFile: Map<string, LucentModule>): void {
  const checker = ctx.checker;
  if (ts.isImportDeclaration(s)) {
    const spec = (s.moduleSpecifier as ts.StringLiteral).text;
    if (s.importClause?.isTypeOnly) return;
    const resolved = ts.resolveModuleName(spec, m.sourceFile.fileName, ctx.checker ? {} : {}, ts.sys);
    void resolved;
    const sym = checker.getSymbolAtLocation(s.moduleSpecifier);
    const target = sym?.valueDeclaration ?? sym?.declarations?.[0];
    const file = target && ts.isSourceFile(target) ? path.resolve(target.fileName) : undefined;
    if (file && path.resolve(coreTypesPath()) === file) return;
    // Platform SDKs, lucent:thread and lucent:platform (checked by createLucentProgram).
    if (spec.startsWith("lucent:")) return;
    const dep = file ? byFile.get(file) : undefined;
    if (!dep) fail(s.moduleSpecifier, Codes.UnsupportedImport, `Lucent modules can only import other *.lucent.ts files and lucent: modules (got "${spec}")`);
    deps.push(dep);
    return;
  }
  if (ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isClassDeclaration(s)) return;
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
    if (!s.name) fail(s, Codes.UnsupportedTopLevel, "functions need a name");
    const declared = !!ts.getModifiers(s)?.some((x) => x.kind === ts.SyntaxKind.DeclareKeyword);
    if (!s.body && !(m.stub && declared)) {
      // Overload signature or declaration.
      fail(s, Codes.UnsupportedTopLevel, "function overloads and declarations without a body are not supported");
    }
    const sym = checker.getSymbolAtLocation(s.name)!;
    const sig = checker.getSignatureFromDeclaration(s)!;
    const type = ctx.reg.lowerSignature(sig, s) as LType & { k: "fn" };
    const isAsync = !!ts.getModifiers(s)?.some((x) => x.kind === ts.SyntaxKind.AsyncKeyword);
    const em = new FnEmitter(ctx, { module: m, async: isAsync, returnType: T.void });
    const params = em.paramInfos(s, type);
    const g: Global = { kind: "function", cpp: `lucent_app::${m.ns}::${cppIdent(s.name.text)}`, module: m, decl: s, type, async: isAsync, params, generic: !!s.typeParameters?.length };
    ctx.globals.set(sym, g);
    if (isExported(s)) exp.functions.push(g as Extract<Global, { kind: "function" }>);
    return;
  }
  if (ts.isVariableStatement(s)) {
    const list = s.declarationList;
    if (!(list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) fail(s, Codes.UnsupportedTopLevel, "use `let` or `const` instead of `var`");
    for (const d of list.declarations) {
      if (!ts.isIdentifier(d.name)) fail(d, Codes.UnsupportedTopLevel, "destructuring at the top level is not supported");
      const sym = checker.getSymbolAtLocation(d.name)!;
      const type = ctx.reg.lower(checker.getTypeOfSymbolAtLocation(sym, d.name), d.name);
      const g: Global = { kind: "var", cpp: `lucent_app::${m.ns}::${cppIdent(d.name.text)}`, module: m, decl: d, type, isConst: !!(list.flags & ts.NodeFlags.Const) };
      ctx.globals.set(sym, g);
      if (isExported(s)) exp.consts.push(g as Extract<Global, { kind: "var" }>);
    }
    return;
  }
  if (ts.isExportDeclaration(s)) fail(s, Codes.UnsupportedExport, "export lists and re-exports are not supported; export declarations directly");
  if (ts.isExportAssignment(s)) fail(s, Codes.UnsupportedExport, "default exports are not supported");
  if (ts.isEmptyStatement(s)) return;
  fail(s, Codes.UnsupportedTopLevel, "only declarations are allowed at the top level of a Lucent module");
}

function emitFunction(ctx: Ctx, g: Extract<Global, { kind: "function" }>, decls: string[], defs: string[], genericFns: string[]): void {
  const s = g.decl;
  const generator = !!g.decl.asteriskToken;
  if (generator && g.async) fail(g.decl, Codes.UnsupportedSyntax, "async generators are not supported");
  const ret = g.async ? (g.type.ret.k === "promise" ? g.type.ret.inner : g.type.ret) : g.type.ret;
  const em = new FnEmitter(ctx, { module: g.module, async: g.async, generator, returnType: generator ? T.void : ret });
  let params: string[] = [];
  ctx.guard(() => {
    params = em.emitParams(s, g.params);
    if (s.body) em.emitFunctionBody(s);
    else {
      // A platform module's export on a target without an implementation.
      const error = `lucent::makeError(LUCENT_STR("Error"), LUCENT_STR(${cppQuoted(`${g.module.name}.${s.name!.text} is not available on this platform`)}))`;
      em.line(g.type.ret.k === "promise" ? `return lucent::Promise<${ctx.reg.cppRet(g.type.ret.inner)}>::rejected(${error});` : `throw lucent::Exception(${error});`);
    }
  });
  const retCpp = g.async ? `lucent::Promise<${ctx.reg.cppRet(ret)}>` : ctx.reg.cppRet(ret);
  const name = cppIdent(s.name!.text);
  if (g.generic) {
    const tmpl = `template <${s.typeParameters!.map((p) => `class ${cppIdent(p.name.text)}`).join(", ")}>`;
    genericFns.push(`namespace ${g.module.ns} {\n${tmpl}\n${retCpp} ${name}(${params.join(", ")}) {\n${em.body().join("\n")}\n}\n}  // namespace ${g.module.ns}`);
    decls.push(`${tmpl}\n${retCpp} ${name}(${params.join(", ")});`);
    return;
  }
  decls.push(`${retCpp} ${name}(${params.join(", ")});`);
  defs.push(`${retCpp} ${g.module.ns}::${name}(${params.join(", ")}) {\n${em.body().join("\n")}\n}`);
}

function topoSort(modules: LucentModule[], deps: Map<LucentModule, LucentModule[]>): LucentModule[] {
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

function jsonWriters(ctx: Ctx): { decls: string[]; defs: string[] } {
  const decls: string[] = [];
  const defs: string[] = [];
  for (const s of ctx.reg.structs.values()) {
    const t = `lucent::Ref<${s.cppName}>`;
    decls.push(`void jsonWrite(lucent::JsonWriter& w, const ${t}& v);`);
    const fields = s.fields.map((f) => `  lucent::jsonField(w, first, ${cppQuoted(f.name)}, v->${cppIdent(f.name)});`);
    defs.push(`inline void jsonWrite(lucent::JsonWriter& w, const ${t}& v) {\n  if (!v) { w.raw("null"); return; }\n  w.raw("{");\n  bool first = true;\n${fields.join("\n")}\n  (void)first;\n  w.raw("}");\n}`);
  }
  for (const c of ctx.reg.classes.values()) {
    if (c.typeParams.length) continue;
    const t = `lucent::Ref<${c.cppName}>`;
    decls.push(`void jsonWrite(lucent::JsonWriter& w, const ${t}& v);`);
    const fields: string[] = [];
    ctx.guard(() => {
      for (const m of publicMembers(ctx, c)) if (m.kind === "field") fields.push(`  lucent::jsonField(w, first, ${cppQuoted(m.name)}, v->${cppIdent(m.name)});`);
    });
    defs.push(`inline void jsonWrite(lucent::JsonWriter& w, const ${t}& v) {\n  if (!v) { w.raw("null"); return; }\n  w.raw("{");\n  bool first = true;\n${fields.join("\n")}\n  (void)first;\n  w.raw("}");\n}`);
  }
  return { decls, defs };
}

/** JsonRead specializations for the object types and unions JSON.parse builds. */
function jsonReaders(ctx: Ctx): { decls: string[]; defs: string[] } {
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
  const decls: string[] = [];
  const defs: string[] = [];
  const header = (cpp: string) => `template <>\nstruct JsonRead<${cpp}> {\n  static ${cpp} read(const JsonValue& v, const std::string& p);\n};`;
  for (const t of structs.values()) {
    const info = reg.struct(t.id);
    const cpp = reg.cpp(t);
    decls.push(header(cpp));
    const fields = info.fields.map((f) => `  out->${cppIdent(f.name)} = jsonMember<${reg.cpp(f.type)}>(v, ${cppQuoted(f.name)}, p);`);
    defs.push(
      `inline ${cpp} JsonRead<${cpp}>::read(const JsonValue& v, const std::string& p) {\n  if (v.kind != JsonValue::Kind::Object) jsonShapeError(p, "an object", v.describe());\n  auto out = std::make_shared<lucent_app::${info.cppName}>();\n${fields.join("\n")}\n  return out;\n}`,
    );
  }
  for (const u of unions.values()) {
    const cpp = reg.cpp(u);
    decls.push(header(cpp));
    const make = (m: LType) => `return ${cpp}(std::in_place_type<${reg.cpp(m)}>, JsonRead<${reg.cpp(m)}>::read(v, p));`;
    const byKind = (ks: string[]) => u.ms.filter((m) => ks.includes(m.k));
    const cases: string[] = [];
    const one = (kind: string, ks: string[]) => {
      const ms = byKind(ks);
      if (ms.length > 1 && kind !== "Object") throw new Error(`ambiguous ${kind}`);
      if (ms.length === 1) cases.push(`    case JsonValue::Kind::${kind}:\n      ${make(ms[0]!)}`);
    };
    one("Number", ["number"]);
    one("String", ["string"]);
    one("Bool", ["boolean"]);
    try {
      one("Array", ["array", "tuple"]);
    } catch {
      fail(undefined, Codes.AmbiguousUnion, `JSON.parse cannot tell apart the array types in ${typeKey(u)}`);
    }
    const objects = byKind(["struct", "dict"]);
    if (objects.length === 1) cases.push(`    case JsonValue::Kind::Object:\n      ${make(objects[0]!)}`);
    else if (objects.length > 1) {
      // A field every object type has, with a distinct string literal in each.
      const infos = objects.map((o) => (o.k === "struct" ? reg.struct(o.id) : undefined));
      const first = infos[0];
      const disc = first?.fields.find((f) => f.literal !== undefined && infos.every((i) => i?.fields.some((g) => g.name === f.name && g.literal !== undefined)));
      const literals = disc ? infos.map((i) => i!.fields.find((g) => g.name === disc.name)!.literal!) : [];
      if (!disc || new Set(literals).size !== literals.length) fail(undefined, Codes.AmbiguousUnion, `JSON.parse needs a string-literal discriminant to tell apart the object types in ${typeKey(u)}`);
      const branches = objects.map((o, i) => `      if (d->string == LUCENT_STR(${cppQuoted(literals[i]!)})) ${make(o)}`);
      cases.push(
        `    case JsonValue::Kind::Object: {\n      const JsonValue* d = v.find(LUCENT_STR(${cppQuoted(disc.name)}));\n      if (!d || d->kind != JsonValue::Kind::String) jsonShapeError(p + ".${disc.name}", "one of the ${disc.name} values", d ? d->describe() : "undefined");\n${branches.join("\n")}\n      jsonShapeError(p + ".${disc.name}", "one of the ${disc.name} values", "another string");\n    }`,
      );
    }
    defs.push(
      `inline ${cpp} JsonRead<${cpp}>::read(const JsonValue& v, const std::string& p) {\n  switch (v.kind) {\n${cases.join("\n")}\n    default:\n      jsonShapeError(p, ${cppQuoted(`one of ${u.ms.map((m) => typeKey(m)).join(" | ")}`)}, v.describe());\n  }\n}`,
    );
  }
  return { decls, defs };
}

/** The JavaScript that replaces a `*.lucent.ts` module in the app bundle. */
function jsProxy(m: ModuleExports): string {
  const lines = [
    "// Generated by Lucent. Do not edit.",
    '"use strict";',
    'Object.defineProperty(exports, "__esModule", { value: true });',
    'const { loadModule, lucentClass } = require("@lucent-lang/runtime");',
    // `react-native` is required from the app's own location, so the app's
    // copy is used even in monorepos with several versions installed.
    `const m = loadModule(${JSON.stringify(m.module.name)}, () => require("react-native").TurboModuleRegistry);`,
  ];
  for (const f of m.functions) lines.push(`exports.${f.decl.name!.text} = m.${f.decl.name!.text};`);
  for (const c of m.classes) lines.push(`exports.${c.decl.name!.text} = lucentClass(m.${c.decl.name!.text});`);
  for (const c of m.consts) lines.push(`exports.${c.decl.name.getText()} = m.${c.decl.name.getText()};`);
  for (const e of m.enums) {
    const entries: string[] = [];
    for (const mem of e.members) {
      entries.push(`${JSON.stringify(mem.name)}: ${JSON.stringify(mem.value)}`);
      if (typeof mem.value === "number") entries.push(`${JSON.stringify(String(mem.value))}: ${JSON.stringify(mem.name)}`);
    }
    lines.push(`exports.${e.name} = Object.freeze({ ${entries.join(", ")} });`);
  }
  return lines.join("\n") + "\n";
}

export type { ClassInfo };
export { unionOf };
