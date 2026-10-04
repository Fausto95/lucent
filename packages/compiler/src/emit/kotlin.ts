/**
 * Kotlin shims (Android): what JNI cannot call as Kotlin declares it — a
 * suspend function, a call that leaves out Kotlin defaults, a value class
 * the JVM passes unboxed — called through a Kotlin function generated for
 * the program, one per member and pattern of arguments it uses. The glue
 * calls the shim over JNI as it calls any static Java method.
 *
 * A shim takes JVM values it can name without knowing their Kotlin types:
 * numbers and booleans as themselves, everything else as `Any?`, cast back
 * where Kotlin's inference gives the type (`search(prefix = cast(a0))`).
 * Value classes cross boxed, so Kotlin unboxes and boxes them. A suspend
 * function's shim starts its coroutine in the runtime-owned scope and
 * reports the outcome to a completion (a BiConsumer of the value or the
 * Throwable); it returns what cancels the coroutine (an AutoCloseable).
 * Arguments a call leaves out are left out of the Kotlin call too, so
 * Kotlin's own defaults apply. A generic member's type parameters are
 * `Any?` (`Any` where Kotlin bounds them so): the values are Java objects
 * either way. Where Kotlin bounds one otherwise (`T : Comparable<T>`),
 * the shim is generic itself: it declares its class's and its member's
 * type parameters with their bounds, and passes them on. A Lucent function passed where Kotlin takes a suspend
 * function, or a fun interface whose function suspends (a Flow's
 * FlowCollector), reaches the shim as a Kotlin function object
 * (`kotlin.jvm.functions.FunctionN`), which the shim calls from the lambda
 * Kotlin takes.
 */
import { createHash } from "node:crypto";
import { kotlinClassOf } from "@lucent-lang/bindgen";
import { kotlin as kt } from "@lucent-lang/codegen";
import type ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import {
  findSdkType,
  parseSdkType,
  type SdkCallable,
  type SdkClassSchema,
  type SdkMethodSchema,
  type SdkParam,
  type SdkPropertySchema,
  type SdkType,
} from "../sdk/schema.ts";
import type { KotlinTypeRef, TypeParamBounds, TypeParamUpperBounds } from "@lucent-lang/bindgen";
import type { Ctx } from "./context.ts";

/** The package of the generated shims (kept from the app's shrinker with the rest of dev.lucent). */
const SHIMS = "dev/lucent/shims";

/** One shim: a static function of its module's Kotlin object. */
export interface KotlinShim {
  /** JVM internal name of the object: `dev/lucent/shims/LucentShims_dev_orbit_search`. */
  owner: string;
  name: string;
  /** The JVM descriptor the glue looks it up with. */
  descriptor: string;
  fun: kt.Fun;
  /** Extensions and the like the call names, imported by the file. */
  imports: string[];
  suspend: boolean;
}

/** A use of a member through a shim. */
export interface KotlinUse {
  node: ts.Node;
  /** The SDK module (Java package) of the member's class. */
  module: string;
  cls: SdkClassSchema;
  role: "call" | "new" | "get" | "set";
  member: SdkMethodSchema | SdkCallable | SdkPropertySchema;
  /** Whether an instance member's receiver is passed (none for statics and constructors). */
  instance: boolean;
  /** For each parameter of the member, whether the call gives it. */
  given: boolean[];
  /** For each parameter, whether the call gives a Lucent function the shim runs as a suspend function. */
  wrapped: boolean[];
  /** What the member gives back, as the schema has it (the class, for a constructor). */
  returns: SdkType;
  what: string;
}

const isVoid = (t: SdkType) => t.k === "prim" && t.name === "void";

/** Kotlin's names of the JVM's primitive types, and their descriptors. */
const PRIMS: Record<string, { kotlin: string; jvm: string }> = {
  boolean: { kotlin: "Boolean", jvm: "Z" },
  byte: { kotlin: "Byte", jvm: "B" },
  char: { kotlin: "Char", jvm: "C" },
  short: { kotlin: "Short", jvm: "S" },
  int: { kotlin: "Int", jvm: "I" },
  long: { kotlin: "Long", jvm: "J" },
  float: { kotlin: "Float", jvm: "F" },
  double: { kotlin: "Double", jvm: "D" },
};

const primOf = (t: SdkType) => (t.k === "prim" ? PRIMS[t.name] : undefined);

const OBJECT = "Ljava/lang/Object;";

const COMPLETION = kt.type(
  "java.util.function.BiConsumer",
  kt.nullable(kt.type("Any")),
  kt.nullable(kt.type("Throwable")),
);

/**
 * What a Lucent function passed to a parameter runs as, when a shim runs
 * it as a Kotlin suspend function: a suspend function type (`params`
 * and `returns` its own), or a fun interface whose one function suspends
 * (`iface`, with that function's).
 */
export interface Suspending {
  params: SdkType[];
  returns: SdkType;
  iface?: SdkClassSchema;
}

/** How a shim runs a Lucent function passed to `p` of a member of `module`; undefined when JNI can take it. */
export function suspending(p: SdkParam, module: string): Suspending | undefined {
  const t = parseSdkType(p.type, module);
  if (p.kotlin?.suspendFunction && t.k === "fn") return { params: t.params, returns: t.ret };
  if (t.k !== "ref") return undefined;

  const iface = findSdkType("android", t.module, t.name);
  if (iface?.kind !== "class" || !iface.kotlin?.fun || !iface.functional) return undefined;

  const sam = iface.methods?.find((m) => m.name === iface.functional && m.abstract);
  if (!sam?.kotlin?.suspend) return undefined;

  const typeParams = iface.typeParams ?? [];
  return {
    params: sam.params.map((x) => parseSdkType(x.type, t.module, typeParams)),
    returns: parseSdkType(sam.returns, t.module, typeParams),
    iface,
  };
}

/** The Kotlin type a shim writes for a type parameter: `Any` where Kotlin bounds it so, else `Any?`. */
function anyFor(name: string, bounds: TypeParamBounds | undefined): kt.Type {
  return bounds?.[name] === "non-null" ? kt.type("Any") : kt.nullable(kt.type("Any"));
}

/** A bound as Kotlin types it (`kotlin.Comparable<T>`). */
function boundType(ref: KotlinTypeRef): kt.Type {
  const named = kt.type(
    ref.name,
    ...(ref.args ?? []).map((a) => (a === "*" ? kt.star : boundType(a))),
  );
  return ref.nullable ? kt.nullable(named) : named;
}

/**
 * The type parameters a use's shim declares, with their bounds: none when
 * neither its class's nor its member's are bounded other than by Any
 * (each is then `Any?`, or `Any`), else all of both, as Kotlin declares
 * them, so that a bound naming another parameter has it.
 */
function declaredTypeParams(use: KotlinUse): {
  names: string[];
  bounds: Record<string, kt.Type[]>;
} {
  const classFacts = use.cls.kotlin;
  const memberFacts = use.member.kotlin;
  const classParams = use.cls.typeParams ?? [];
  const memberParams = "typeParams" in use.member ? (use.member.typeParams ?? []) : [];
  const other = (f: { upperBounds?: TypeParamUpperBounds } | undefined) =>
    Object.keys(f?.upperBounds ?? {}).length > 0;
  if (!other(classFacts) && !other(memberFacts)) return { names: [], bounds: {} };

  // A static member does not see its class's type parameters.
  const fromClass = use.instance || use.role === "new" ? classParams : [];
  const clash = memberParams.find((n) => fromClass.includes(n));
  if (clash)
    fail(
      use.node,
      Codes.UnsupportedCall,
      `${use.what}: its type parameter ${clash} shadows its class's, which a shim cannot declare twice`,
    );

  const bounds: Record<string, kt.Type[]> = {};
  const bind = (
    names: string[],
    f: { bounds?: TypeParamBounds; upperBounds?: TypeParamUpperBounds } | undefined,
  ) => {
    for (const n of names) {
      const upper = f?.upperBounds?.[n];
      if (upper) bounds[n] = upper.map(boundType);
      else if (f?.bounds?.[n] === "non-null") bounds[n] = [kt.type("Any")];
    }
  };
  bind(fromClass, classFacts);
  bind(memberParams, memberFacts);

  return { names: [...fromClass, ...memberParams], bounds };
}

/** A value of schema type `t` as a shim takes or gives it: a primitive, else any object. */
function boundary(t: SdkType): { type: kt.Type; descriptor: string } {
  const prim = primOf(t);
  return prim
    ? { type: kt.type(prim.kotlin), descriptor: prim.jvm }
    : { type: kt.nullable(kt.type("Any")), descriptor: OBJECT };
}

/** A JVM class's Kotlin name, `.`-separated. */
function kotlinName(internal: string): string {
  return kotlinClassOf(internal).replaceAll("/", ".");
}

/** The Kotlin type a schema type is, for a receiver's cast. */
function kotlinType(use: KotlinUse, t: SdkType): kt.Type {
  const named = ((): kt.Type => {
    const prim = primOf(t);
    if (prim) return kt.type(prim.kotlin);

    switch (t.k) {
      case "string":
        return kt.type(t.charSequence ? "kotlin.CharSequence" : "kotlin.String");
      case "array": {
        if (t.list) return kt.type("kotlin.collections.List", kotlinType(use, t.of));

        const of = primOf(t.of);
        return of
          ? kt.type(`kotlin.${of.kotlin}Array`)
          : kt.type("kotlin.Array", kotlinType(use, t.of));
      }
      case "tparam": {
        if (declaredTypeParams(use).names.includes(t.name)) return kt.type(t.name);

        const own = "typeParams" in use.member && use.member.typeParams?.includes(t.name);
        return anyFor(t.name, own ? use.member.kotlin?.bounds : use.cls.kotlin?.bounds);
      }
      case "ref": {
        const cls = findSdkType("android", t.module, t.name);
        if (cls?.kind !== "class") break;

        // Raw references are star-projected; type arguments as they are.
        const args = t.args?.length
          ? t.args.map((a) => kotlinType(use, a))
          : (cls.typeParams ?? []).map(() => kt.star);
        return kt.type(kotlinName(cls.native), ...args);
      }
    }

    return fail(
      use.node,
      Codes.UnsupportedType,
      `${use.what}: its receiver's type has no Kotlin name Lucent can write yet`,
    );
  })();

  return t.nullable ? kt.nullable(named) : named;
}

/** A qualified name as an expression: `dev.orbit.shapes.perimeter`. */
function qualified(n: string): kt.Expr {
  const [first, ...rest] = n.split(".");
  return rest.reduce((e, part) => kt.member(e, part), kt.name(first!));
}

/** A Kotlin name Lucent writes as it is (the printer escapes keywords). */
function identifier(use: KotlinUse, name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    fail(
      use.node,
      Codes.UnsupportedCall,
      `${use.what}: ${name} is not a Kotlin name Lucent can write in a shim yet`,
    );

  return name;
}

/** The shim a use calls, made once per program. */
export function kotlinShim(ctx: Ctx, use: KotlinUse): KotlinShim {
  const owner = `${SHIMS}/LucentShims_${use.module.replaceAll(".", "_")}`;
  const params = "params" in use.member ? use.member.params : [];
  const facts = use.member.kotlin;
  const suspend = !!facts?.suspend;
  const extension = !!facts?.extension;
  const memberName = "name" in use.member ? use.member.name : "new";

  const key = [
    use.member.symbol ?? "",
    use.role,
    memberName,
    use.given.map((g, i) => (g ? (use.wrapped[i] ? "f" : 1) : 0)).join(""),
  ].join("|");
  const accessor = use.role === "get" || use.role === "set" ? `${use.role}_` : "";
  const name = `${use.cls.name}_${accessor}${memberName}_${hashOf(key)}`;

  const shims = ctx.kotlinShims.get(use.module) ?? new Map<string, KotlinShim>();
  ctx.kotlinShims.set(use.module, shims);

  const made = shims.get(name);
  if (made) return made;

  const imports: string[] = [];
  const shimParams: kt.Param[] = [];
  const descriptors: string[] = [];
  const take = (n: string, t: SdkType | "receiver") => {
    const b = t === "receiver" ? { type: kt.type("Any"), descriptor: OBJECT } : boundary(t);
    shimParams.push(kt.param(n, b.type));
    descriptors.push(b.descriptor);
  };

  // The receiver: an instance member's object, or an extension's first parameter.
  const receiverParam = extension ? params[0] : undefined;
  const receiverType = receiverParam?.type;
  if (use.instance) take("receiver", "receiver");
  else if (receiverType) take("receiver", primOf(receiverType) ? receiverType : "receiver");

  // A property's new value.
  if (use.role === "set" && "type" in use.member) take("value", use.member.type);

  // The arguments the call gives, by name: Kotlin's defaults fill the rest.
  const sourceParams = extension ? params.slice(1) : params;
  const given = extension ? use.given.slice(1) : use.given;
  const wrapped = extension ? use.wrapped.slice(1) : use.wrapped;
  const args: kt.Arg[] = [];
  sourceParams.forEach((p: SdkParam, i) => {
    if (!given[i]) return;

    const a = `a${i}`;
    const runs = wrapped[i] ? suspending(p, use.module) : undefined;
    take(a, p.type);
    args.push({
      name: identifier(use, p.name),
      value: runs
        ? suspendingLambda(a, runs)
        : primOf(p.type)
          ? kt.name(a)
          : kt.call(kt.name("cast"), [{ value: kt.name(a) }]),
    });
  });

  // Type parameters as Any? (Any where Kotlin bounds them so), or the shim's own, declared with
  // their bounds where Kotlin bounds them otherwise.
  const declared = declaredTypeParams(use);
  const typeArg = (n: string, bounds: TypeParamBounds | undefined) =>
    declared.names.includes(n) ? kt.type(n) : anyFor(n, bounds);
  const classArgs = (use.cls.typeParams ?? []).map((n) => typeArg(n, use.cls.kotlin?.bounds));
  const memberParams = "typeParams" in use.member ? (use.member.typeParams ?? []) : [];
  const memberArgs = memberParams.map((n) => typeArg(n, use.member.kotlin?.bounds));
  const typeArgs = (list: kt.Type[]) => (list.length ? list : undefined);

  // What the call reaches: its receiver, a top-level declaration, a class.
  const cast = (t: kt.Type) =>
    kt.call(kt.name("cast"), [{ value: kt.name("receiver") }], undefined, [t]);
  const pkg = use.module;
  const topLevel =
    use.cls.kotlin?.kind === "file-facade" || use.cls.kotlin?.kind === "multi-file-facade";
  const ownerType = kt.type(kotlinName(use.cls.native), ...classArgs);

  const target = (() => {
    if (use.instance) return cast(ownerType);
    if (receiverType)
      return primOf(receiverType) ? kt.name("receiver") : cast(kotlinType(use, receiverType));
    return undefined;
  })();

  const call = ((): kt.Expr => {
    if (use.role === "new")
      return kt.call(qualified(kotlinName(use.cls.native)), args, undefined, typeArgs(classArgs));

    const n = identifier(use, memberName);
    if (extension) imports.push(`${pkg}.${n}`);

    const reached = target
      ? kt.member(target, n)
      : qualified(`${topLevel ? pkg : kotlinName(use.cls.native)}.${n}`);
    return use.role === "get" || use.role === "set"
      ? reached
      : kt.call(reached, args, undefined, typeArgs(memberArgs));
  })();

  let body: kt.Stmt[];
  let ret: kt.Type | undefined;
  let retDescriptor: string;

  if (suspend) {
    shimParams.push(kt.param("done", COMPLETION));
    descriptors.push("Ljava/util/function/BiConsumer;");
    ret = kt.type("AutoCloseable");
    retDescriptor = "Ljava/lang/AutoCloseable;";
    body = [
      kt.ret(
        kt.call(kt.name("start"), [{ value: kt.name("done") }], kt.lambda([], [kt.exprStmt(call)])),
      ),
    ];
  } else if (use.role === "set") {
    const value = "type" in use.member && primOf(use.member.type);
    retDescriptor = "V";
    body = [
      kt.assign(
        call,
        value ? kt.name("value") : kt.call(kt.name("cast"), [{ value: kt.name("value") }]),
      ),
    ];
  } else if (isVoid(use.returns)) {
    retDescriptor = "V";
    body = [kt.exprStmt(call)];
  } else {
    const b = boundary(use.returns);
    ret = b.type;
    retDescriptor = b.descriptor;
    body = [kt.ret(call)];
  }

  const shim: KotlinShim = {
    owner,
    name,
    descriptor: `(${descriptors.join("")})${retDescriptor}`,
    fun: {
      k: "fun",
      annotations: ["JvmStatic"],
      modifiers: [],
      ...(declared.names.length ? { typeParams: declared.names, bounds: declared.bounds } : {}),
      name,
      params: shimParams,
      ...(ret ? { ret } : {}),
      body,
    },
    imports,
    suspend,
  };
  shims.set(name, shim);

  return shim;
}

/**
 * The lambda Kotlin takes where a shim runs Lucent function `a` (a Kotlin
 * function object) as a suspend function: `{ x0 -> cast<(Any?) -> Any?>(a0)(x0) }`,
 * its result cast back unless Kotlin's is Unit; a fun interface's through
 * its SAM constructor (`FlowCollector { … }`).
 */
function suspendingLambda(a: string, runs: Suspending): kt.Expr {
  const xs = runs.params.map((_, j) => `x${j}`);
  const fn = kt.fn(
    xs.map(() => ANY_OR_NULL),
    ANY_OR_NULL,
  );
  const call = kt.call(
    kt.call(kt.name("cast"), [{ value: kt.name(a) }], undefined, [fn]),
    xs.map((x) => ({ value: kt.name(x) })),
  );
  const body = isVoid(runs.returns) ? call : kt.call(kt.name("cast"), [{ value: call }]);
  const lambda = kt.lambda(xs, [kt.exprStmt(body)]);

  return runs.iface ? kt.call(qualified(kotlinName(runs.iface.native)), [], lambda) : lambda;
}

const hashOf = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 6);

// --- the files -----------------------------------------------------------------------

const ANY_OR_NULL = kt.nullable(kt.type("Any"));

/** `private fun <T> cast(value: Any?): T = value as T`: the types inference gives. */
const castFun: kt.Fun = {
  k: "fun",
  modifiers: ["private"],
  typeParams: ["T"],
  name: "cast",
  params: [kt.param("value", ANY_OR_NULL)],
  ret: kt.type("T"),
  body: [kt.ret(kt.cast(kt.name("value"), kt.type("T")))],
};

/**
 * Runs a suspend call in the scope the shims own, from the calling thread
 * until it first suspends (Dispatchers.Unconfined, as a direct call would),
 * and reports its outcome, whatever it is, to `done`.
 */
const startFun: kt.Fun = {
  k: "fun",
  modifiers: ["private"],
  name: "start",
  params: [
    kt.param("done", COMPLETION),
    kt.param("block", kt.fn([], ANY_OR_NULL, { suspend: true })),
  ],
  ret: kt.type("AutoCloseable"),
  body: [
    kt.val(
      "job",
      kt.call(
        kt.member(kt.name("scope"), "launch"),
        [],
        kt.lambda(
          [],
          [
            kt.val(
              "outcome",
              kt.call(
                kt.name("runCatching"),
                [],
                kt.lambda([], [kt.exprStmt(kt.call(kt.name("block"), []))]),
              ),
            ),
            kt.exprStmt(
              kt.call(kt.member(kt.name("done"), "accept"), [
                { value: kt.call(kt.member(kt.name("outcome"), "getOrNull"), []) },
                { value: kt.call(kt.member(kt.name("outcome"), "exceptionOrNull"), []) },
              ]),
            ),
          ],
        ),
      ),
    ),
    kt.ret(
      kt.call(
        kt.name("AutoCloseable"),
        [],
        kt.lambda([], [kt.exprStmt(kt.call(kt.member(kt.name("job"), "cancel"), []))]),
      ),
    ),
  ],
};

const scopeProperty: kt.Property = {
  k: "val",
  modifiers: ["private"],
  name: "scope",
  init: kt.call(kt.name("CoroutineScope"), [
    {
      value: kt.binary(
        kt.call(kt.name("SupervisorJob"), []),
        "+",
        kt.member(kt.name("Dispatchers"), "Unconfined"),
      ),
    },
  ]),
};

const COROUTINES = [
  "kotlinx.coroutines.CoroutineScope",
  "kotlinx.coroutines.Dispatchers",
  "kotlinx.coroutines.SupervisorJob",
  "kotlinx.coroutines.launch",
];

/** The Kotlin sources of a program's shims, keyed by path under src/main/java. */
export function kotlinFiles(ctx: Ctx): Map<string, string> {
  const files = new Map<string, string>();

  for (const [module, shims] of [...ctx.kotlinShims].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const all = [...shims.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
    if (!all.length) continue;

    const suspends = all.some((s) => s.suspend);
    const owner = all[0]!.owner;
    const imports = [
      ...new Set([...(suspends ? COROUTINES : []), ...all.flatMap((s) => s.imports)]),
    ].sort();

    const members: kt.Member[] = [
      ...(suspends ? [scopeProperty] : []),
      castFun,
      ...(suspends ? [startFun] : []),
      ...all.map((s) => s.fun),
    ];

    files.set(
      `${owner}.kt`,
      kt.printUnit({
        banner: `Generated by Lucent: the Kotlin members of ${module} the program calls. Do not edit.`,
        fileAnnotations: ['Suppress("UNCHECKED_CAST")'],
        packageName: SHIMS.replaceAll("/", "."),
        imports,
        decls: [{ k: "object", name: owner.slice(owner.lastIndexOf("/") + 1), members }],
      }),
    );
  }

  return files;
}
