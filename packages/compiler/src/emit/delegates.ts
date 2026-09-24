import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { parseSdkType, type SdkMethodSchema, type SdkType } from "../sdk/schema.ts";
import { cppIdent, type ClassInfo, type LType, T } from "../types.ts";
import { memberName } from "./classes.ts";
import type { LucentModule } from "../program.ts";
import type { Ctx } from "./context.ts";
import { FnEmitter } from "./function.ts";
import { cppQuoted } from "./literals.ts";
import {
  fromObjc,
  noteFramework,
  objcTypeName,
  type SdkClassRef,
  sdkInterfacesOf,
  toObjcCode,
} from "./native.ts";

/**
 * A Lucent class that implements SDK protocols, as an Objective-C object:
 * a class adopting them whose methods forward the requirements the Lucent
 * class implements (optional ones it leaves out stay unimplemented). The
 * Objective-C object holds the Lucent object; `objcObjectOf` gives one per
 * Lucent object while it is in use.
 */
export function objcDelegate(
  ctx: Ctx,
  module: LucentModule,
  info: ClassInfo,
): { lines: string; decl: string } | undefined {
  if (ctx.platform !== "ios") return undefined;
  const protocols = sdkInterfacesOf(ctx.checker, info.decl);
  if (!protocols.length) return undefined;
  if (info.typeParams.length)
    fail(
      info.decl,
      Codes.UnsupportedClassFeature,
      "generic classes cannot implement SDK protocols",
    );
  const em = new FnEmitter(ctx, { module, async: false, returnType: T.void });
  for (const p of protocols) noteFramework(em, p.module);
  const objc = objcClassName(info);
  const self = `lucent::Ref<lucent_app::${info.cppName}>`;
  const methods: string[] = [];
  for (const p of protocols) {
    for (const m of p.cls.methods ?? []) {
      if (m.static) continue;
      const impl = info.decl.members.find(
        (x): x is ts.MethodDeclaration =>
          ts.isMethodDeclaration(x) && memberName(x) === m.name && !!x.body,
      );
      if (impl) methods.push(forward(em, info, p, m, impl));
    }
  }
  const name = info.decl.name?.text ?? "class";
  const lines = [
    `@interface ${objc} : NSObject <${protocols.map((p) => p.cls.native).join(", ")}> {`,
    "@public",
    `  ${self} self_;`,
    "}",
    "@end",
    `@implementation ${objc}`,
    ...methods,
    "@end",
    "namespace lucent_app {",
    `lucent::NativeRef objcObjectOf(const ${self}& o) {`,
    `  return lucent::objc::wrap(lucent::objc::cachedObject(o.get(), ^id { ${objc}* x = [${objc} new]; x->self_ = o; return x; }), ${cppQuoted(name)});`,
    "}",
    "}  // namespace lucent_app",
  ].join("\n");
  return { lines, decl: `lucent::NativeRef objcObjectOf(const lucent::Ref<${info.cppName}>& o);` };
}

function objcClassName(info: ClassInfo): string {
  return `Lucent${info.cppName.replace(/^C_/, "")}`;
}

/**
 * One requirement: arguments converted to the Lucent method's parameter
 * types (as many as it declares), then the call, queued on the Lucent
 * thread unless the platform waits for it (a result, or the main thread).
 */
function forward(
  em: FnEmitter,
  info: ClassInfo,
  p: SdkClassRef,
  m: SdkMethodSchema,
  impl: ts.MethodDeclaration,
): string {
  const params: SdkType[] = m.params.map((x) => parseSdkType(x.type, p.module));
  const ret = parseSdkType(m.returns, p.module);
  const fn = em.reg.lowerSignature(em.checker.getSignatureFromDeclaration(impl)!, impl) as LType & {
    k: "fn";
  };
  const names = params.map((_, i) => `a${i}_`);
  const what = `${info.decl.name?.text}.${m.name}`;
  const n = Math.min(fn.params.length, params.length);
  const call = `s_->${cppIdent(m.name)}(${names
    .slice(0, n)
    .map((a, i) => fromObjc(em, a, params[i]!, fn.params[i]!, what).c)
    .join(", ")})`;
  const selector = m.selector ?? m.name;
  const parts = selector.split(":").slice(0, -1);
  const head = `- (${objcTypeName(ret)})${parts.length ? parts.map((part, i) => `${part}:(${objcTypeName(params[i]!)})${names[i]}`).join(" ") : selector}`;
  const isVoid = ret.k === "prim" && ret.name === "void";
  if (!isVoid) {
    const r = ret.nullable
      ? `lucent::objc::ifPresent(r_, [&](const auto& x_) { return ${toObjcCode({ ...ret, nullable: false } as SdkType, "x_", false)}; })`
      : toObjcCode(ret, "r_", false);
    return `${head} { auto s_ = self->self_; return lucent::callNow([&]() -> ${objcTypeName(ret)} { auto r_ = ${call}; return ${r}; }); }`;
  }
  if (p.cls.mainActor || m.mainActor)
    return `${head} { auto s_ = self->self_; lucent::callNow([&]() { (void)${call}; }); }`;
  return `${head} { lucent::postCallback([${["s_ = self->self_", ...names.slice(0, n)].join(", ")}]() { (void)${call}; }); }`;
}
