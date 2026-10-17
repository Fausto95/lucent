/**
 * The Kotlin API native code calls a module's exports through (decision
 * 0116): a file per module whose top-level functions Java sees as
 * `Exports`, and a class per exported class, in the package OS-made
 * classes use (`dev.lucent.app.<module>`). Their natives call the C
 * entries (entries.ts), through JNI glue added to the Android entries unit:
 * named as JNI finds them by name, and registered by
 * `lucent_entries_register_natives` for a host that finds none (the
 * desktop JNI host).
 */
import { kotlin as kt } from "@lucent-lang/codegen";
import { osJavaName } from "../os-names.ts";
import { findSdkType } from "../sdk/schema.ts";
import type { ClassInfo, LType } from "../types.ts";
import type { Entry, EntryApi } from "./entries.ts";

/** The JNI name of a module's Kotlin class (`dev/lucent/app/counters/Counter`). */
const javaName = (module: string, name: string) => osJavaName(module, name);
const dotted = (jni: string) => jni.replace(/[/$]/g, ".");

const LUCENT_INSTANCE = "dev.lucent.LucentInstance";
const COMPLETION = "dev.lucent.EntryCompletion";

/** `a.b.c` as member accesses: Kotlin names are one identifier each. */
const qualifiedName = (name: string): kt.Expr =>
  name
    .split(".")
    .slice(1)
    .reduce((e, part) => kt.member(e, part), kt.name(name.split(".")[0]!));

/** Whether a name is a Kotlin identifier: an export whose name or parameters' aren't has no Kotlin API. */
const kotlinName = (n: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n);

/** How a C type crosses JNI: the native's Java descriptor, its JNI C type, and the conversions. */
interface JniCrossing {
  descriptor: string;
  jni: string;
  /** The C value of argument `a` (EntryArgs `in`). */
  in: (a: string) => string;
  /** The Java value of C value `v`. */
  out: (v: string) => string;
}

/** The Kotlin type of `t`: what the entry passes as its own C type or a lucent_value. */
function kotlinType(t: LType): kt.Type {
  switch (t.k) {
    case "number":
      return kt.type("Double");
    case "boolean":
      return kt.type("Boolean");
    case "bigint":
      return kt.type("Long");
    case "string":
      return kt.type("String");
    case "bytes":
      return kt.type("ByteArray");
    case "opt":
      return kt.nullable(kotlinType(t.inner));
    case "array":
      return kt.type("List", kotlinType(t.e));
    case "dict":
      return kt.type("Map", kt.type("String"), kotlinType(t.val));
    case "native": {
      const cls = findSdkType(t.platform, t.module, t.name);
      return kt.type(cls?.kind === "class" ? dotted(cls.native) : `${t.module}.${t.name}`);
    }
    default:
      throw new Error(`no Kotlin type for ${t.k}`);
  }
}

/** The Kotlin type of a parameter or result: a class's instances are its wrapper's. */
function apiType(t: LType, classes: ReadonlyMap<string, ClassInfo>): kt.Type {
  if (t.k === "class") {
    // A class without an entry of its own has no wrapper: its instances are LucentInstances.
    const cls = classes.get(t.id);
    return kt.type(cls ? dotted(javaName(cls.module, cls.decl.name!.text)) : LUCENT_INSTANCE);
  }
  if (t.k === "opt" && t.inner.k === "class") return kt.nullable(apiType(t.inner, classes));
  if (t.k === "array") return kt.type("List", apiType(t.e, classes));
  if (t.k === "dict") return kt.type("Map", kt.type("String"), apiType(t.val, classes));
  return kotlinType(t);
}

/** The JNI descriptor of a Kotlin type, as the JVM erases it. */
function descriptor(t: kt.Type): string {
  if (t.k === "nullable") {
    const of = t.of.k === "named" ? t.of.name : "";
    const boxed: Record<string, string> = {
      Double: "Ljava/lang/Double;",
      Boolean: "Ljava/lang/Boolean;",
      Long: "Ljava/lang/Long;",
    };
    return boxed[of] ?? descriptor(t.of);
  }
  if (t.k !== "named") return "Ljava/lang/Object;";
  const primitive: Record<string, string> = {
    Double: "D",
    Boolean: "Z",
    Long: "J",
    Unit: "V",
    String: "Ljava/lang/String;",
    ByteArray: "[B",
    List: "Ljava/util/List;",
    Map: "Ljava/util/Map;",
  };
  return primitive[t.name] ?? `L${t.name.replace(/\./g, "/")};`;
}

/** How a C type an entry takes or gives crosses JNI. */
function jniCrossing(c: string, type: kt.Type): JniCrossing {
  const d = descriptor(type);
  switch (c) {
    case "double":
      return { descriptor: d, jni: "jdouble", in: (a) => a, out: (v) => v };
    case "bool":
      return {
        descriptor: d,
        jni: "jboolean",
        in: (a) => `${a} == JNI_TRUE`,
        out: (v) => `static_cast<jboolean>(${v})`,
      };
    case "int64_t":
      return {
        descriptor: d,
        jni: "jlong",
        in: (a) => `static_cast<int64_t>(${a})`,
        out: (v) => `static_cast<jlong>(${v})`,
      };
    case "lucent_string":
      return {
        descriptor: d,
        jni: "jstring",
        in: (a) => `in.string(${a})`,
        out: (v) => `lucent::jni::javaOf(env, ${v})`,
      };
    case "lucent_bytes":
      return {
        descriptor: d,
        jni: "jbyteArray",
        in: (a) => `in.bytes(${a})`,
        out: (v) => `lucent::jni::javaOf(env, ${v})`,
      };
    case "lucent_object":
      return {
        descriptor: d,
        jni: "jobject",
        in: (a) => `in.instance(${a})`,
        out: (v) => `lucent::jni::javaOf(env, ${v})`,
      };
    default:
      return {
        descriptor: d,
        jni: "jobject",
        in: (a) => `in.value(${a})`,
        out: (v) => `lucent::jni::javaOf(env, ${v})`,
      };
  }
}

/** A name as JNI mangles it in a native's symbol (`entry_get_value` → `entry_1get_1value`). */
function jniMangle(s: string): string {
  let out = "";
  for (const ch of s) {
    if (/[A-Za-z0-9]/.test(ch)) out += ch;
    else if (ch === "/") out += "_";
    else if (ch === "_") out += "_1";
    else if (ch === ";") out += "_2";
    else if (ch === "[") out += "_3";
    else out += `_0${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
  }
  return out;
}

/** One native method: its Kotlin declaration, its JNI function and its registration. */
interface Native {
  /** The JNI name of the class declaring it. */
  owner: string;
  name: string;
  signature: string;
  symbol: string;
  definition: string;
  fun: kt.Fun;
}

/** A native for `entry`, declared in `owner` (a class's companion, or a file's object). */
function nativeOf(
  entry: Entry,
  owner: string,
  name: string,
  classes: ReadonlyMap<string, ClassInfo>,
  /** Private where the class's companion holds it; a private object's are its file's already. */
  modifiers: kt.Modifier[] = ["private"],
): Native {
  const api = entry.api;
  const self = api.cls && !api.isStatic;
  const params = api.params.map((p, i) => {
    const type = apiType(p.type, classes);
    return { name: p.name, type, crossing: jniCrossing(p.c, type), at: `arg${i}` };
  });
  const retType =
    api.kind === "new" ? kt.type("Long") : api.ret ? apiType(api.ret.type, classes) : undefined;
  const ret =
    api.kind === "new"
      ? {
          descriptor: "J",
          jni: "jlong",
          in: (a: string) => a,
          out: (v: string) => `reinterpret_cast<jlong>(${v})`,
        }
      : api.ret
        ? jniCrossing(api.ret.c, retType!)
        : undefined;

  const ktParams = [
    ...(self ? [kt.param("self", kt.type("Long"))] : []),
    ...params.map((p) => kt.param(p.name, p.type)),
    ...(api.async ? [kt.param("done", kt.type(COMPLETION))] : []),
  ];
  const signature = `(${[
    ...(self ? ["J"] : []),
    ...params.map((p) => p.crossing.descriptor),
    ...(api.async ? [`L${COMPLETION.replace(/\./g, "/")};`] : []),
  ].join("")})${api.async || !ret ? "V" : ret.descriptor}`;
  const symbol = `Java_${jniMangle(owner)}_${jniMangle(name)}`;

  const jniParams = [
    "JNIEnv* env",
    "jclass",
    ...(self ? ["jlong self"] : []),
    ...params.map((p) => `${p.crossing.jni} ${p.at}`),
    ...(api.async ? ["jobject done"] : []),
  ];
  const args = [
    ...(self ? ["reinterpret_cast<lucent_object>(self)"] : []),
    ...params.map((p) => p.crossing.in(p.at)),
  ];
  const jniRet = api.async || !ret ? "void" : ret.jni;
  const zero = jniRet === "void" ? "" : " {}";
  const body = api.async
    ? [
        `    void* completion = lucent::jni::entryCompletion(env, done);`,
        `    ${entry.name}(${[
          ...args,
          api.ret
            ? `[](void* context, const ${api.ret.c}* result, const lucent_error* error) { lucent::jni::settleEntry(context, error, [&](JNIEnv* env) -> jobject { return lucent::jni::javaOf(env, *result); }); }`
            : `[](void* context, const lucent_error* error) { lucent::jni::settleEntry(context, error, [](JNIEnv*) -> jobject { return nullptr; }); }`,
          "completion",
        ].join(", ")});`,
      ]
    : [
        `    lucent_error error{};`,
        ...(ret ? [`    ${api.kind === "new" ? "lucent_object" : api.ret!.c} result{};`] : []),
        `    if (!${entry.name}(${[...args, "&error", ...(ret ? ["&result"] : [])].join(", ")})) {`,
        `      lucent::jni::throwEntryError(env, error);`,
        `      return${zero};`,
        `    }`,
        ...(ret ? [`    return ${ret.out("result")};`] : []),
      ];
  const definition = [
    `extern "C" JNIEXPORT ${jniRet} JNICALL ${symbol}(${jniParams.join(", ")}) {`,
    `  lucent::jni::EntryArgs in(env);`,
    `  try {`,
    ...body,
    `  } catch (...) {`,
    `    lucent::jni::throwCaught(env, std::current_exception());`,
    ...(jniRet === "void" ? [] : [`    return${zero};`]),
    `  }`,
    `}`,
  ].join("\n");

  return {
    owner,
    name,
    signature,
    symbol,
    definition,
    fun: {
      k: "fun",
      annotations: ["JvmStatic"],
      modifiers: [...modifiers, "external"],
      name,
      params: ktParams,
      ...(api.async || !retType ? {} : { ret: retType }),
    },
  };
}

/**
 * A call of native `name` (on `on`) with `args`; through awaitEntry for an
 * async one. Returned, its result's type is the function's; an async one
 * that gives nothing is a statement, so it names `Unit` itself: Kotlin
 * infers no type argument from a statement.
 */
function callNative(api: EntryApi, on: string | undefined, name: string, args: kt.Expr[]): kt.Expr {
  const callee = on ? kt.member(kt.name(on), name) : kt.name(name);
  const call = (more: kt.Expr[]) =>
    kt.call(
      callee,
      [...args, ...more].map((value) => ({ value })),
    );
  return api.async
    ? kt.call(
        qualifiedName("dev.lucent.app.awaitEntry"),
        [],
        kt.lambda(["done"], [kt.exprStmt(call([kt.name("done")]))]),
        api.ret ? undefined : [kt.type("Unit")],
      )
    : call([]);
}

/** A public function that calls a native: `fun sum(cs: List<Counter>): Double = …`. */
function caller(
  api: EntryApi,
  name: string,
  call: kt.Expr,
  classes: ReadonlyMap<string, ClassInfo>,
  modifiers: kt.Modifier[] = [],
  annotations: string[] = [],
): kt.Fun {
  return {
    k: "fun",
    ...(annotations.length ? { annotations } : {}),
    modifiers: [...modifiers, ...(api.async ? (["suspend"] as const) : [])],
    name,
    params: api.params.map((p) => kt.param(p.name, apiType(p.type, classes))),
    ...(api.ret ? { ret: apiType(api.ret.type, classes) } : {}),
    body: [api.ret ? kt.ret(call) : kt.exprStmt(call)],
  };
}

/** What a natives' holder runs first: the app's native library, where it isn't loaded. */
const loadsLibrary: kt.Member = {
  k: "init",
  body: [kt.exprStmt(kt.call(qualifiedName("dev.lucent.NativeProxy.loadLibrary"), []))],
};

/**
 * The Kotlin API of `entries` (an Android target's), and the JNI glue its
 * natives need, for the Android entries unit.
 */
export function kotlinExports(all: readonly Entry[]): {
  files: Map<string, string>;
  jni: string;
} {
  const files = new Map<string, string>();
  const natives: Native[] = [];
  const classes = new Map<string, ClassInfo>();
  const entries = all.filter(
    (e) =>
      kotlinName(e.api.member) &&
      e.api.params.every((p) => kotlinName(p.name)) &&
      (!e.api.cls || kotlinName(e.api.cls.decl.name!.text)),
  );
  for (const e of entries) if (e.api.cls) classes.set(e.api.cls.id, e.api.cls);
  const banner = (what: string) =>
    `Generated by Lucent: ${what}, for Kotlin and Java. Do not edit.`;

  // Each module's functions: top-level in a file Java sees as Exports, their natives in an object.
  const byModule = new Map<string, Entry[]>();
  for (const e of entries)
    if (e.api.kind === "function")
      byModule.set(e.api.module, [...(byModule.get(e.api.module) ?? []), e]);
  for (const [module, functions] of byModule) {
    const holder = javaName(module, "ExportsNatives");
    const own = functions.map((e) => nativeOf(e, holder, e.api.member, classes, []));
    natives.push(...own);
    const pkg = dotted(javaName(module, "")).replace(/\.$/, "");
    files.set(
      `${javaName(module, "Exports")}.kt`,
      kt.printUnit({
        banner: banner(`the exports of ${module}`),
        fileAnnotations: ['JvmName("Exports")'],
        packageName: pkg,
        decls: [
          ...functions.map((e) =>
            caller(
              e.api,
              e.api.member,
              callNative(
                e.api,
                "ExportsNatives",
                e.api.member,
                e.api.params.map((p) => kt.name(p.name)),
              ),
              classes,
            ),
          ),
          {
            k: "object",
            name: "ExportsNatives",
            modifiers: ["private"],
            members: [loadsLibrary, ...own.map((n) => n.fun)],
          },
        ],
      }),
    );
  }

  // Each class: a wrapper of the lucent_object, extending its base's wrapper when the base has one.
  for (const info of classes.values()) {
    const own = entries.filter((e) => e.api.cls === info);
    const jni = javaName(info.module, info.decl.name!.text);
    const name = info.decl.name!.text;
    const base = info.base ? classes.get(info.base.id) : undefined;
    // An ancestor's wrapper declares what its class declares: inherited, overridden when redeclared.
    const wrapped = (e: Entry) =>
      e.api.isStatic ||
      e.api.declaredBy === info ||
      !(e.api.declaredBy && classes.has(e.api.declaredBy.id));
    const inBase = (member: string, kind: EntryApi["kind"]) => {
      for (let b = base; b; b = b.base ? classes.get(b.base.id) : undefined)
        if (
          entries.some(
            (e) =>
              e.api.cls === b && !e.api.isStatic && e.api.member === member && e.api.kind === kind,
          )
        )
          return true;
      return false;
    };

    const classNatives = own.map((e) => nativeOf(e, jni, `entry_${e.api.entry}`, classes));
    natives.push(...classNatives);
    const nativeName = (e: Entry) => `entry_${e.api.entry}`;
    const handle = kt.call(kt.name("handle"), []);
    const args = (e: Entry) => [
      ...(e.api.isStatic ? [] : [handle]),
      ...e.api.params.map((p) => kt.name(p.name)),
    ];

    const instanceMembers: kt.Member[] = [];
    const companion: kt.Member[] = [loadsLibrary];
    const ctor = own.find((e) => e.api.kind === "new");
    if (ctor)
      instanceMembers.push({
        k: "constructor",
        params: ctor.api.params.map((p) => kt.param(p.name, apiType(p.type, classes))),
        delegate: {
          to: "this",
          args: [
            {
              value: kt.call(
                kt.name(nativeName(ctor)),
                ctor.api.params.map((p) => ({ value: kt.name(p.name) })),
              ),
            },
          ],
        },
      });

    for (const e of own.filter((x) => x.api.kind === "method" && wrapped(x))) {
      const fun = caller(
        e.api,
        e.api.member,
        callNative(e.api, undefined, nativeName(e), args(e)),
        classes,
        e.api.isStatic ? [] : [inBase(e.api.member, "method") ? "override" : "open"],
        e.api.isStatic ? ["JvmStatic"] : [],
      );
      (e.api.isStatic ? companion : instanceMembers).push(fun);
    }
    for (const get of own.filter((x) => x.api.kind === "get" && wrapped(x))) {
      const set = own.find(
        (x) =>
          x.api.kind === "set" &&
          x.api.member === get.api.member &&
          x.api.isStatic === get.api.isStatic,
      );
      const property: kt.Property = {
        k: set ? "var" : "val",
        ...(get.api.isStatic ? { annotations: ["JvmStatic"] } : {}),
        modifiers: get.api.isStatic ? [] : [inBase(get.api.member, "get") ? "override" : "open"],
        name: get.api.member,
        type: apiType(get.api.ret!.type, classes),
        get: kt.call(
          kt.name(nativeName(get)),
          args(get).map((value) => ({ value })),
        ),
        ...(set
          ? {
              set: {
                param: "value",
                value: kt.call(
                  kt.name(nativeName(set)),
                  args(set).map((value) => ({ value })),
                ),
              },
            }
          : {}),
      };
      (get.api.isStatic ? companion : instanceMembers).push(property);
    }
    companion.push(...classNatives.map((n) => n.fun));

    files.set(
      `${jni}.kt`,
      kt.printUnit({
        banner: banner(`the class ${name} of ${info.module}`),
        packageName: dotted(jni).slice(0, dotted(jni).lastIndexOf(".")),
        decls: [
          {
            k: "class",
            name,
            modifiers: ["open"],
            params: [kt.param("handle", kt.type("Long"))],
            constructorModifiers: ["internal"],
            supertypes: [
              {
                type: kt.type(
                  base ? dotted(javaName(base.module, base.decl.name!.text)) : LUCENT_INSTANCE,
                ),
                args: [{ value: kt.name("handle") }],
              },
            ],
            members: [...instanceMembers, { k: "companion", members: companion }],
          },
        ],
      }),
    );
  }

  if (entries.some((e) => e.api.async)) files.set("dev/lucent/app/LucentEntries.kt", AWAIT_FILE);

  const registration = new Map<string, Native[]>();
  for (const n of natives) registration.set(n.owner, [...(registration.get(n.owner) ?? []), n]);
  const jni = [
    "// The Kotlin API's natives (decision 0116): JNI finds them by name. Built where JNI is:",
    "// Android, and the desktop JNI host, not iOS (a shared program's unit is both's).",
    "#if __has_include(<jni.h>)",
    "#include <lucent/platform/android.h>",
    "",
    ...[...classes.values()].map(
      (c) =>
        `static const bool lucent_wrapper_${c.cppName} = lucent::jni::registerInstanceClass(typeid(lucent_app::${c.cppName}), ${JSON.stringify(javaName(c.module, c.decl.name!.text))});`,
    ),
    "",
    ...natives.flatMap((n) => [n.definition, ""]),
    "/// Registers the natives above, for a host that finds none by name (the desktop JNI host).",
    'extern "C" void lucent_entries_register_natives(JNIEnv* env) {',
    ...[...registration].flatMap(([owner, ns]) => [
      "  {",
      "    static const JNINativeMethod methods[] = {",
      ...ns.map(
        (n) =>
          `        {const_cast<char*>(${JSON.stringify(n.name)}), const_cast<char*>(${JSON.stringify(n.signature)}), reinterpret_cast<void*>(&${n.symbol})},`,
      ),
      "    };",
      `    env->RegisterNatives(lucent::jni::findClass(${JSON.stringify(owner)}), methods, ${ns.length});`,
      "    lucent::jni::check(env);",
      "  }",
    ]),
    ...(registration.size ? [] : ["  (void)env;"]),
    "}",
    "#endif",
    "",
  ].join("\n");

  return { files, jni };
}

/** What an async export's Kotlin waits with: its entry's completion, resumed once. */
const AWAIT_FILE = kt.printUnit({
  banner: "Generated by Lucent: how the exports' Kotlin awaits an async entry. Do not edit.",
  fileAnnotations: ['JvmName("LucentEntries")', 'Suppress("UNCHECKED_CAST")'],
  packageName: "dev.lucent.app",
  imports: [
    "kotlin.coroutines.resume",
    "kotlin.coroutines.resumeWithException",
    "kotlin.coroutines.suspendCoroutine",
  ],
  decls: [
    {
      k: "fun",
      modifiers: ["internal", "suspend"],
      typeParams: ["T"],
      name: "awaitEntry",
      params: [kt.param("start", kt.fn([kt.type(COMPLETION)], kt.type("Unit")))],
      ret: kt.type("T"),
      body: [
        kt.ret(
          kt.call(
            kt.name("suspendCoroutine"),
            [],
            kt.lambda(
              ["k"],
              [
                kt.exprStmt(
                  kt.call(kt.name("start"), [
                    {
                      value: kt.objectExpr(
                        [kt.type(COMPLETION)],
                        [
                          {
                            k: "fun",
                            modifiers: ["override"],
                            name: "resolve",
                            params: [kt.param("value", kt.nullable(kt.type("Any")))],
                            body: [
                              kt.exprStmt(
                                kt.call(kt.member(kt.name("k"), "resume"), [
                                  { value: kt.cast(kt.name("value"), kt.type("T")) },
                                ]),
                              ),
                            ],
                          },
                          {
                            k: "fun",
                            modifiers: ["override"],
                            name: "reject",
                            params: [kt.param("error", kt.type("dev.lucent.LucentException"))],
                            body: [
                              kt.exprStmt(
                                kt.call(kt.member(kt.name("k"), "resumeWithException"), [
                                  { value: kt.name("error") },
                                ]),
                              ),
                            ],
                          },
                        ],
                      ),
                    },
                  ]),
                ),
              ],
            ),
          ),
        ),
      ],
    },
  ],
});
