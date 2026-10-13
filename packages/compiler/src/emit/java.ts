import { java } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import {
  findSdkType,
  jniDescriptor,
  parseSdkType,
  type SdkClassSchema,
  type SdkMethodSchema,
  type SdkType,
} from "../sdk/schema.ts";
import { osJavaName } from "../os-names.ts";
import type { ClassInfo, LType } from "../types.ts";

/** An SDK class's instance methods, its SDK superclasses' included, with the module each is typed in. */
export function sdkInstanceMethods(
  base: LType & { k: "native" },
): { module: string; cls: SdkClassSchema; method: SdkMethodSchema }[] {
  const out: { module: string; cls: SdkClassSchema; method: SdkMethodSchema }[] = [];
  const seen = new Set<string>();
  for (let t: { module: string; name: string } | undefined = base; t;) {
    const cls = findSdkType("android", t.module, t.name);
    if (cls?.kind !== "class") break;
    for (const m of cls.methods ?? []) {
      if (m.static) continue;
      const key = javaKey(m);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ module: t.module, cls, method: m });
    }
    const up = cls.extends ? parseSdkType(cls.extends, t.module) : undefined;
    t = up?.k === "ref" ? up : undefined;
  }
  return out;
}

/** A Java method's dispatch key: name and parameter descriptor, as NativeProxy computes it. */
export function javaKey(m: SdkMethodSchema): string {
  const d =
    m.descriptor ??
    jniDescriptor(
      m.params.map((p) => p.type),
      m.returns,
      m.typeParams,
    );
  return `${m.java ?? m.name}${d.slice(0, d.indexOf(")") + 1)}`;
}

/** The generated Java subclass that stands for instances of `info` (JNI name). */
export function javaSubclassName(info: ClassInfo): string {
  return osMade(info)
    ? osClassName(info)
    : `dev/lucent/generated/${info.cppName.replace(/^C_/, "")}`;
}

/** Classes whose Java name another's came out as: they keep a name of the build's (decision 0097). */
const clashing = new WeakSet<ClassInfo>();

/** Gives `info` no name the OS can rely on: another class's came out the same. */
export function refuseOsName(info: ClassInfo): void {
  clashing.add(info);
}

/**
 * Whether the OS can make `info`'s Java class by name (decision 0097): an
 * exported, concrete class extending an Android class.
 */
export function osMade(info: ClassInfo): boolean {
  return (
    info.exported &&
    !info.abstract &&
    !info.typeParams.length &&
    info.sdkBase?.platform === "android" &&
    !clashing.has(info)
  );
}

/**
 * The Java class the OS makes for `info` (JNI name):
 * `dev/lucent/app/<module>/<Class>`, the module's name (`<package>/<path>`)
 * as package segments, each character but letters and digits `_`, and a
 * `_` in front of a segment Java would refuse.
 */
export function osClassName(info: ClassInfo): string {
  return osJavaName(info.module, info.decl.name!.text);
}

/** Whether `base`'s Java class has a public constructor without arguments, which Lucent's own instances use. */
export function constructibleBase(base: LType & { k: "native" }): boolean {
  const cls = findSdkType("android", base.module, base.name);
  return cls?.kind === "class" && (cls.constructors ?? []).some((c) => !c.params.length);
}

/**
 * The base constructor an OS-made class's Java constructor calls: the one
 * taking the Lucent constructor's parameters, in order. Its descriptor.
 */
function osConstructor(info: ClassInfo, baseCls: SdkClassSchema, params: LType[]): string {
  const fits = (sdk: SdkType, lt: LType): boolean => {
    const t = lt.k === "opt" ? lt.inner : lt;
    if (sdk.k === "ref") return t.k === "native" && t.module === sdk.module && t.name === sdk.name;
    if (sdk.k === "string") return t.k === "string";
    if (sdk.k === "prim") return sdk.name === "boolean" ? t.k === "boolean" : t.k === "number";
    return false;
  };
  const found = (baseCls.constructors ?? []).find(
    (c) => c.params.length === params.length && c.params.every((p, i) => fits(p.type, params[i]!)),
  );
  if (!found)
    fail(
      info.decl.members.find(ts.isConstructorDeclaration) ?? info.decl,
      Codes.UnsupportedClassFeature,
      `${info.decl.name?.text}: ${baseCls.name} has no public constructor taking its constructor's parameters, which the OS would call`,
    );
  return (
    found.descriptor ??
    jniDescriptor(
      found.params.map((p) => p.type),
      { k: "prim", name: "void", nullable: false },
    )
  );
}

/**
 * The Java subclass of a Lucent class's SDK base: it overrides the methods
 * the Lucent class defines (and any abstract ones, which then throw
 * AbstractMethodError), each forwarding to C++ with NativeProxy's keys; the
 * others keep the SDK's body. Made with the handle of the C++ side, released
 * when Java collects the object.
 */
export function javaSubclass(
  info: ClassInfo,
  constructorParams: LType[] = [],
): { path: string; source: string } {
  const base = info.sdkBase!;
  const baseCls = findSdkType("android", base.module, base.name);
  if (baseCls?.kind !== "class")
    fail(info.decl, Codes.UnsupportedClassFeature, `${base.name} has no binding`);
  if (baseCls.interface)
    fail(info.decl, Codes.UnsupportedClassFeature, `${base.name} is an interface: implement it`);
  // Lucent's own instances are made with a handle, through the base's constructor without
  // arguments; a class the OS makes may have only the OS's.
  const own = constructibleBase(base);
  if (!own && !osMade(info))
    fail(
      info.decl,
      Codes.UnsupportedClassFeature,
      `${base.name} has no public constructor without arguments to extend`,
      `export the class, so that the OS makes it (decision 0097)`,
    );
  const byOs = osMade(info) ? osConstructor(info, baseCls, constructorParams) : undefined;
  const defined = new Set(
    info.members
      .filter(
        (m): m is ts.MethodDeclaration =>
          ts.isMethodDeclaration(m) && !!m.body && ts.isIdentifier(m.name),
      )
      .map((m) => (m.name as ts.Identifier).text),
  );
  const name = javaSubclassName(info).split("/").pop()!;
  const [handle, proxy] = [java.name("handle"), java.name("NativeProxy")];
  const override = { annotations: [java.annotation("Override")] };
  const methods: java.Member[] = [];
  for (const { method } of sdkInstanceMethods(base)) {
    if (!method.abstract && !defined.has(method.name)) continue;
    const d =
      method.descriptor ??
      jniDescriptor(
        method.params.map((p) => p.type),
        method.returns,
        method.typeParams,
      );
    const { params, ret } = javaTypes(d);
    const ps = params.map((t, i) => java.param(t, `a${i}`));
    // A primitive result has its zero value when the call gives none (a
    // Lucent method that threw: its error is reported), not an NPE.
    const primitive = ret.k === "primitive" && ret.name !== "void";
    const dispatch = java.call(proxy, "dispatch", [
      handle,
      java.str(javaKey(method)),
      java.newArray(
        java.type("Object"),
        ps.map((p) => java.name(p.name)),
      ),
      ...(primitive ? [java.access(java.name(ret.name), "class")] : []),
    ]);
    const body =
      ret.k === "primitive" && ret.name === "void"
        ? java.exprStmt(dispatch)
        : java.ret(unboxed(ret, dispatch));
    methods.push(java.method(["public"], ret, method.java ?? method.name, ps, [body], override));
  }
  const source = java.printUnit({
    banner: "Generated by Lucent. Do not edit.",
    package: javaSubclassName(info).split("/").slice(0, -1).join("."),
    imports: ["dev.lucent.NativeProxy"],
    types: [
      java.cls(
        name,
        [
          java.field(["private", "final"], java.primitive("long"), "handle"),
          ...(own
            ? [
                java.constructor(
                  ["public"],
                  name,
                  [java.param(java.primitive("long"), "handle")],
                  [
                    java.exprStmt(java.call(undefined, "super")),
                    java.exprStmt(java.assign(java.access(java.self, "handle"), handle)),
                  ],
                ),
              ]
            : []),
          ...(byOs ? [osMadeConstructor(name, javaSubclassName(info), byOs)] : []),
          ...methods,
          java.method(
            ["protected"],
            java.primitive("void"),
            "finalize",
            [],
            [
              {
                k: "try",
                body: [java.exprStmt(java.call(proxy, "releaseHandle", [handle]))],
                finally: [java.exprStmt(java.call(java.superRef, "finalize"))],
              },
            ],
            {
              annotations: [
                java.annotation("Override"),
                java.annotation(
                  "SuppressWarnings",
                  java.arrayInit([java.str("deprecation"), java.str("removal")]),
                ),
              ],
              throws: [java.type("Throwable")],
            },
          ),
        ],
        {
          modifiers: ["public", "final"],
          extends: java.type(javaName(baseCls.native)),
          doc: byOs
            ? `Lucent's ${info.decl.name?.text ?? name}, which the OS makes by this name: forwards to its C++ side.`
            : `Lucent's ${info.decl.name?.text ?? name}: forwards to its C++ side.`,
        },
      ),
    ],
  });
  return { path: `${javaSubclassName(info)}.java`, source };
}

/**
 * The constructor the OS calls (decision 0097): the base's, with its
 * arguments, then the Lucent side, which NativeProxy.adopt makes from the
 * object and the same arguments.
 */
function osMadeConstructor(name: string, cls: string, descriptor: string): java.Member {
  const { params } = javaTypes(descriptor);
  const ps = params.map((t, i) => java.param(t, `a${i}`));
  const args = ps.map((p) => java.name(p.name));
  return java.constructor(
    ["public"],
    name,
    ps,
    [
      java.exprStmt(java.call(undefined, "super", args)),
      java.exprStmt(
        java.assign(
          java.access(java.self, "handle"),
          java.call(java.name("NativeProxy"), "adopt", [
            java.self,
            java.str(cls),
            java.newArray(java.type("Object"), args),
          ]),
        ),
      ),
    ],
    {
      doc: "The constructor the OS calls: the base's, then the Lucent side, through the native root.",
    },
  );
}

/** `android/net/ConnectivityManager$NetworkCallback` → `android.net.ConnectivityManager.NetworkCallback`. */
function javaName(internal: string): string {
  return internal.replace(/[/$]/g, ".");
}

/** Java source types of a JNI method descriptor. */
function javaTypes(descriptor: string): { params: java.Type[]; ret: java.Type } {
  let p = 1;
  const one = (): java.Type => {
    const c = descriptor[p++]!;
    if (c === "[") return java.array(one());
    if (c === "L") {
      const end = descriptor.indexOf(";", p);
      const name = descriptor.slice(p, end);
      p = end + 1;
      return java.type(javaName(name));
    }
    const primitive = PRIMITIVES[c];
    if (!primitive) throw new Error(`bad descriptor ${descriptor}`);
    return java.primitive(primitive);
  };
  const params: java.Type[] = [];
  while (descriptor[p] !== ")") params.push(one());
  p++;
  return { params, ret: one() };
}

const PRIMITIVES: Record<string, java.Primitive> = {
  Z: "boolean",
  B: "byte",
  C: "char",
  S: "short",
  I: "int",
  J: "long",
  F: "float",
  D: "double",
  V: "void",
};

/** The box of each primitive a forwarded method returns. */
const BOXES: Partial<Record<java.Primitive, string>> = {
  boolean: "Boolean",
  byte: "Byte",
  char: "Character",
  short: "Short",
  int: "Integer",
  long: "Long",
  float: "Float",
  double: "Double",
};

/** What a forwarded method returns: boxed results unboxed, others cast. */
function unboxed(t: java.Type, call: java.Expr): java.Expr {
  const box = t.k === "primitive" ? BOXES[t.name] : undefined;
  if (box && t.k === "primitive")
    return java.call(java.cast(java.type(box), call), `${t.name}Value`);
  return java.cast(t, call);
}
