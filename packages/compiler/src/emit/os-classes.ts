/**
 * Android classes the OS makes (decision 0097). An exported Lucent class
 * extending an Android class has a Java class the OS makes by name
 * (java.ts's osClassName), whose constructor asks NativeProxy.adopt for
 * its Lucent side. This is that side's factory, registered by the Java
 * class's name: through the native root, module state starts if none
 * lasts and the instance holds it while Java keeps the object; the Lucent
 * constructor runs with the OS's arguments, holding the module's actor;
 * and the instance's Java object is the one the OS made.
 */
import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes } from "../codes.ts";
import type { LucentModule } from "../program.ts";
import type { ClassInfo, LType } from "../types.ts";
import { constructorOf } from "./classes.ts";
import type { Ctx } from "./context.ts";
import { FnEmitter } from "./function.ts";
import { javaSubclassName, osClassName, osMade, refuseOsName } from "./java.ts";
import { fromJavaObject, javaSubclassOf } from "./native.ts";

/**
 * Of `classes` the OS would make, those whose Java names come out the same
 * keep a name of the build's, and LUCENT3016 warns, naming them.
 */
export function settleOsNames(ctx: Ctx, classes: readonly ClassInfo[]): void {
  const byName = new Map<string, ClassInfo[]>();
  for (const info of classes.filter(osMade))
    byName.set(osClassName(info), [...(byName.get(osClassName(info)) ?? []), info]);

  for (const [name, same] of byName) {
    if (same.length < 2) continue;
    for (const info of same) refuseOsName(info);
    ctx.warn(
      same.at(-1)!.decl.name ?? same.at(-1)!.decl,
      Codes.EntryNameClash,
      `${same.map((i) => `${i.module}.${i.decl.name?.text}`).join(" and ")} would have the same Java class, ${name.replace(/\//g, ".")}: the OS can make neither by name`,
    );
  }
}

/** The Lucent constructor's parameters, as the Java constructor takes them. */
export function osConstructorParams(ctx: Ctx, info: ClassInfo): LType[] {
  return constructorOf(ctx, { k: "class", id: info.id, args: [] }).map((p) => p.type);
}

/** The factory of `info`'s Lucent side, and its registration: none unless the OS makes it. */
export function osFactory(ctx: Ctx, module: LucentModule, info: ClassInfo): cpp.Decl[] | undefined {
  if (ctx.platform !== "android" || !osMade(info)) return undefined;

  const em = new FnEmitter(ctx, { module, async: false });
  const self: LType & { k: "class" } = { k: "class", id: info.id, args: [] };
  const ctor = info.decl.members.find(ts.isConstructorDeclaration) ?? info.decl;
  const params = constructorOf(ctx, self);
  const args = params.map((p, i) =>
    em.coerce(
      fromJavaObject(
        cpp.call("lucent::jni::arg", [cpp.id("env"), cpp.id("args_"), cpp.num(i)]),
        p.type,
        `${info.decl.name?.text}'s argument ${i + 1}`,
        ctor,
      ),
      p.cppType,
      ctor,
    ),
  );

  const cls = javaSubclassName(info);
  const name = `os_${info.cppName}`;
  const java = javaSubclassOf(em, { c: cpp.id("made_"), t: self }, info);
  ctx.nativeUnit(module).include("lucent/entries.h");
  ctx.nativeUnit(module).include("lucent/platform/android.h");

  const factory = cpp.fn(
    name,
    cpp.type("jlong"),
    [
      cpp.param(cpp.type("JNIEnv*"), "env"),
      cpp.param(cpp.type("jobject"), "self_"),
      cpp.param(cpp.type("jobjectArray"), "args_"),
    ],
    [
      // The native root: state starts if none lasts, and the instance holds it.
      cpp.exprStmt(
        cpp.call("lucent::ensureModuleState", [cpp.addressOf(cpp.id("lucent_app::initModules"))]),
      ),
      cpp.varDecl(
        cpp.auto,
        "hold_",
        cpp.call("std::make_shared", [], [cpp.type("lucent::ModuleStateHold")]),
      ),
      cpp.varDecl(cpp.type("lucent::entries::detail::EntryScope"), "scope_", ctx.actorAt(module), {
        style: "construct",
      }),
      cpp.varDecl(cpp.auto, "made_", cpp.call(`lucent_app::${info.cppName}::create`, args)),
      cpp.ret(
        cpp.call("lucent::jni::adoptSubclass", [
          cpp.id("env"),
          cpp.id("self_"),
          cpp.str(cls),
          cpp.id("hold_"),
          cpp.lambda(["&"], [], [cpp.ret(java)], {
            ret: cpp.type("jobject"),
          }),
        ]),
      ),
    ],
    { static: true },
  );
  const registered: cpp.Decl = {
    k: "var",
    stmt: cpp.varDecl(
      cpp.type("const bool"),
      `${name}_registered`,
      cpp.call("lucent::jni::registerOsClass", [cpp.str(cls), cpp.addressOf(cpp.id(name))]),
      { static: true },
    ),
  };

  return [factory, registered];
}
