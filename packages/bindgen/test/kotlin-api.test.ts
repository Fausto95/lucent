import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { planBinding, unsupportedReason } from "../src/binding-plan.ts";
import { coverage } from "../src/coverage.ts";
import { extractKotlinApi } from "../src/kotlin-api.ts";
import type {
  SchemaType,
  SdkClassSchema,
  SdkMethodSchema,
  SdkModuleSchema,
  SdkParam,
} from "../src/schema.ts";
import {
  compileKotlin,
  kotlinFixtures,
  kotlinSources,
  kotlinToolchain,
} from "./kotlin-toolchain.ts";

/*
 * Bindings of Kotlin libraries that generated Kotlin source calls (a
 * component's Compose content): fixtures/kotlin-compose declares Compose's
 * API shapes (composables, content lambdas with receivers, state,
 * animation, value classes), compiled by plain kotlinc; the facts come from
 * its metadata and annotations, by rules.
 */

const tc = kotlinToolchain();

const fixtures = path.join(kotlinFixtures, "../kotlin-compose");

const ref = (module: string, name: string, args?: SchemaType[]): SchemaType => ({
  k: "ref",
  module,
  name,
  nullable: false,
  ...(args ? { args } : {}),
});

const prim = (name: "float" | "int" | "long" | "double" | "boolean" | "void"): SchemaType => ({
  k: "prim",
  name,
  nullable: false,
});

const UI = "androidx.compose.ui";
const RUNTIME = "androidx.compose.runtime";
const LAYOUT = "androidx.compose.foundation.layout";
const ANIMATION = "androidx.compose.animation.core";

describe.skipIf(!tc)("bindings of Kotlin called from Kotlin source (Compose)", () => {
  let modules: Map<string, SdkModuleSchema>;

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-kotlin-api-"));
    const coroutines = path.join(tc!.lib, "kotlinx-coroutines-core-jvm.jar");
    const jar = await compileKotlin(tc!, kotlinSources(fixtures), path.join(dir, "compose.jar"), {
      classpath: coroutines,
    });

    const extracted = extractKotlinApi({
      libraries: [jar],
      classpath: [coroutines],
      target: "android-35",
    });
    modules = new Map(extracted.map((m) => [m.module, m]));
  }, 300_000);

  const module = (name: string) => {
    const m = modules.get(name);
    if (!m) throw new Error(`no module ${name}`);
    return m;
  };
  const functions = (m: string, name: string) =>
    (module(m).functions ?? []).filter((f) => f.name === name);
  const fn = (m: string, name: string): SdkMethodSchema => {
    const [f] = functions(m, name);
    if (!f) throw new Error(`no function ${m}.${name}`);
    return f;
  };
  const cls = (m: string, name: string): SdkClassSchema => {
    const t = module(m).types.find((x) => x.name === name);
    if (t?.kind !== "class") throw new Error(`no class ${m}.${name}`);
    return t;
  };
  const param = (f: SdkMethodSchema, name: string): SdkParam => {
    const p = f.params.find((x) => x.name === name);
    if (!p) throw new Error(`no parameter ${name} of ${f.name}`);
    return p;
  };
  const refusal = (m: string, owner: SdkClassSchema | undefined, member: SdkMethodSchema) =>
    unsupportedReason(planBinding(owner, member, module(m), () => ({})));

  it("binds each Kotlin package as a module called from Kotlin source", () => {
    expect([...modules.keys()]).toEqual(
      expect.arrayContaining([RUNTIME, UI, `${UI}.unit`, LAYOUT, ANIMATION]),
    );
    expect(module(LAYOUT)).toMatchObject({
      platform: "android",
      form: "source",
      provenance: { kind: "jar", target: "android-35" },
    });
  });

  it("tells composables from other functions, and UI from effects, by their annotations", () => {
    expect(fn(LAYOUT, "Box").kotlin).toMatchObject({
      composable: true,
      applier: "androidx.compose.ui.UiComposable",
    });
    // An inferred target: the function's own applier comes first in the scheme.
    expect(fn(LAYOUT, "Column").kotlin).toMatchObject({
      composable: true,
      inline: true,
      applier: "androidx.compose.ui.UiComposable",
    });
    // Composables that emit nothing: effects, remember, state.
    for (const [m, name] of [
      [RUNTIME, "remember"],
      [RUNTIME, "LaunchedEffect"],
      [ANIMATION, "animateFloatAsState"],
    ] as const) {
      expect(fn(m, name).kotlin?.composable).toBe(true);
      expect(fn(m, name).kotlin).not.toHaveProperty("applier");
    }
    expect(fn(ANIMATION, "spring").kotlin?.composable).toBeUndefined();
    // A marker annotation standing for its target (Compose's @UiComposable).
    expect(fn(LAYOUT, "Measured").kotlin).toMatchObject({
      composable: true,
      applier: "androidx.compose.ui.UiComposable",
    });
    // An applier variable: it composes into what its content does, its caller's.
    expect(fn(LAYOUT, "Provide").kotlin).toMatchObject({ composable: true, applier: "*" });
    // A composable getter.
    expect(module(RUNTIME).constants?.find((c) => c.name === "currentCompositeKey")).toMatchObject({
      kotlin: { composable: true },
    });
  });

  it("records each parameter: its name, position, kind, default and Kotlin type", () => {
    const box = fn(LAYOUT, "Box");

    expect(box.params.map((p) => p.name)).toEqual(["modifier", "content"]);
    expect(param(box, "modifier")).toEqual({
      name: "modifier",
      type: ref(UI, "Modifier"),
      kotlin: { default: true },
    });
    // A @Composable lambda is content; its receiver is kept apart from its type.
    expect(param(box, "content")).toEqual({
      name: "content",
      type: {
        k: "fn",
        params: [],
        ret: prim("void"),
        escaping: true,
        main: false,
        nullable: false,
      },
      kotlin: { role: "content", receiver: ref(LAYOUT, "BoxScope") },
    });
    // A named content parameter, before a value.
    expect(fn(LAYOUT, "Labeled").params.map((p) => [p.name, p.kotlin?.role])).toEqual([
      ["label", "content"],
      ["text", undefined],
    ]);

    // Any other lambda is a callback; a suspend one keeps its source form.
    const launched = fn(RUNTIME, "LaunchedEffect");
    expect(param(launched, "block").kotlin).toEqual({
      role: "callback",
      receiver: ref("kotlinx.coroutines", "CoroutineScope"),
      suspendFunction: true,
    });
    expect(param(launched, "block").type).toMatchObject({ k: "fn", params: [], ret: prim("void") });
    expect(param(fn(UI, "clickable"), "onClick").kotlin).toEqual({ role: "callback" });
    expect(param(fn(UI, "clickable"), "enabled").kotlin).toEqual({ default: true });
  });

  it("pairs a value with its change callback, and leaves out defaults it cannot read", () => {
    const field = fn(LAYOUT, "Field");

    // `value` and `onValueChange`: one signal gives both (bind).
    expect(param(field, "value").kotlin).toEqual({ changedBy: "onValueChange" });
    expect(param(field, "onValueChange").kotlin).toEqual({ role: "callback" });
    // A collection is a read-only list.
    expect(param(field, "counts").type).toEqual({
      k: "array",
      of: prim("int"),
      nullable: false,
      list: true,
    });
    // A defaulted parameter of a type content cannot write: Kotlin gives its default.
    expect(field.params.map((p) => p.name)).toEqual(["value", "onValueChange", "counts"]);
    expect(field.kotlin?.omits).toEqual(["decoration"]);
  });

  it("keeps Kotlin's number types, through generics too", () => {
    expect(fn(ANIMATION, "animateFloatAsState").returns).toEqual(
      ref(RUNTIME, "State", [prim("float")]),
    );
    expect(param(fn(ANIMATION, "animateFloatAsState"), "targetValue").type).toEqual(prim("float"));
    expect(fn(ANIMATION, "Animatable").returns).toEqual(
      ref(ANIMATION, "Animatable", [prim("float"), ref(ANIMATION, "AnimationVector1D")]),
    );
    expect(fn(`${UI}.unit`, "sp").returns).toEqual(ref(`${UI}.unit`, "TextUnit"));
    expect(functions(UI, "Color").map((f) => f.params[0]!.type)).toEqual([
      prim("long"),
      prim("int"),
    ]);

    // A generic class's members keep its type parameters.
    const animatable = cls(ANIMATION, "Animatable");
    expect(animatable.typeParams).toEqual(["T", "V"]);
    expect(animatable.properties?.find((p) => p.name === "value")?.type).toEqual({
      k: "tparam",
      name: "T",
      nullable: false,
    });
    expect(animatable.methods?.find((m) => m.name === "animateTo")).toMatchObject({
      kotlin: { suspend: true },
      returns: ref(ANIMATION, "AnimationResult", [
        { k: "tparam", name: "T", nullable: false },
        { k: "tparam", name: "V", nullable: false },
      ]),
    });
  });

  it("declares value classes with their constructors, extension properties and companions", () => {
    const dp = cls(`${UI}.unit`, "Dp");

    expect(dp.kotlin).toMatchObject({
      kind: "class",
      value: { property: "value", type: prim("float") },
    });
    expect(dp.constructors?.map((c) => c.params.map((p) => p.type))).toEqual([[prim("float")]]);
    expect(dp.properties?.find((p) => p.name === "Hairline")).toMatchObject({
      static: true,
      type: ref(`${UI}.unit`, "Dp"),
    });
    // `20.dp`: a function of its receiver, read as a property.
    expect(functions(`${UI}.unit`, "dp").map((f) => [f.kotlin, f.params[0]!.type])).toEqual([
      [{ extension: true, property: true }, prim("int")],
      [{ extension: true, property: true }, prim("double")],
    ]);

    // `Modifier` is a value: its companion object is a Modifier.
    expect(cls(UI, "Modifier").kotlin).toMatchObject({ kind: "interface", companionValue: true });
    expect(cls(UI, "Modifier_Companion").kotlin).toEqual({ kind: "companion" });
    // Nested classes, and a companion's members as the class's statics.
    expect(cls(UI, "Alignment_Horizontal").native).toBe("androidx/compose/ui/Alignment$Horizontal");
    expect(
      cls(UI, "Alignment").properties?.find((p) => p.name === "CenterHorizontally"),
    ).toMatchObject({ static: true, type: ref(UI, "Alignment_Horizontal") });
    expect(cls(ANIMATION, "Spring").properties).toMatchObject([
      { name: "StiffnessLow", static: true, type: prim("float") },
    ]);

    // Modifier's extension functions keep their receiver first.
    expect(fn(UI, "padding")).toMatchObject({
      kotlin: { extension: true },
      params: [
        { name: "receiver", type: ref(UI, "Modifier") },
        { name: "all", type: ref(`${UI}.unit`, "Dp") },
      ],
    });
  });

  it("declares the dependencies' classes the API names, without members", () => {
    expect(cls("kotlinx.coroutines", "CoroutineScope")).toEqual({
      kind: "class",
      name: "CoroutineScope",
      native: "kotlinx/coroutines/CoroutineScope",
      symbol: "jvm:kotlinx/coroutines/CoroutineScope",
      interface: true,
      kotlin: { kind: "interface" },
    });
    expect(fn(RUNTIME, "rememberCoroutineScope").returns).toEqual(
      ref("kotlinx.coroutines", "CoroutineScope"),
    );
  });

  it("finds receiver scopes, and the member a lambda's result comes through", () => {
    expect(cls(LAYOUT, "BoxScope").kotlin?.scope).toBe(true);
    // A receiver the API also gives as a value is no scope.
    expect(cls("kotlinx.coroutines", "CoroutineScope").kotlin?.scope).toBeUndefined();
    expect(fn(LAYOUT, "Spaced").kotlin?.scope).toBe(`${LAYOUT}.ColumnScope`);
    expect(param(fn(RUNTIME, "DisposableEffect"), "effect").kotlin).toMatchObject({
      role: "callback",
      receiver: ref(RUNTIME, "DisposableEffectScope"),
      returnsThrough: "onDispose",
    });
  });

  it("plans calls from Kotlin source, refusing what content cannot call yet, with the reason", () => {
    for (const [m, name] of [
      [LAYOUT, "Box"],
      [LAYOUT, "Column"],
      [RUNTIME, "remember"],
      [RUNTIME, "LaunchedEffect"],
      [RUNTIME, "DisposableEffect"],
      [ANIMATION, "animateFloatAsState"],
      [UI, "clickable"],
    ] as const)
      expect([name, refusal(m, undefined, fn(m, name))]).toEqual([name, undefined]);

    expect(planBinding(undefined, fn(LAYOUT, "Box"), module(LAYOUT), () => ({})).backend).toBe(
      "kotlin-source",
    );
    expect(refusal(RUNTIME, undefined, fn(RUNTIME, "rememberReified"))).toBe(
      "a reified type parameter (T) is not supported yet",
    );
    expect(refusal(RUNTIME, undefined, fn(RUNTIME, "Experimental"))).toBe(
      "an experimental API: it needs opt-in to ExperimentalComposeApi",
    );
    expect(refusal(LAYOUT, undefined, fn(LAYOUT, "VectorGroup"))).toBe(
      "it composes VectorComposable content, not UI",
    );
    // What runs in a lambda's receiver scope: called on the lambda's scope parameter.
    expect(refusal(LAYOUT, undefined, fn(LAYOUT, "Spaced"))).toBeUndefined();
    const boxScope = cls(LAYOUT, "BoxScope");
    expect(
      refusal(
        LAYOUT,
        boxScope,
        boxScope.methods!.find((m) => m.name === "align")!,
      ),
    ).toBeUndefined();
    // Left empty, a vararg that would call another overload (refused, or its own): refused.
    for (const name of ["Keyed", "keep"])
      expect(
        functions(RUNTIME, name)
          .filter((f) => f.params.some((p) => p.kotlin?.vararg))
          .map((f) => refusal(RUNTIME, undefined, f)),
      ).toEqual([
        "left empty, its vararg calls another overload: vararg values are not supported yet",
      ]);
    // A vararg parameter a call may leave empty: bound, the call gives it nothing yet.
    for (const name of ["keys", "rememberKept"])
      expect([name, refusal(RUNTIME, undefined, fn(RUNTIME, name))]).toEqual([name, undefined]);
    expect(
      planBinding(undefined, fn(RUNTIME, "rememberKept"), module(RUNTIME), () => ({})).inputs[0],
    ).toMatchObject({
      op: "unsupported",
      omissible: true,
      reason: "values of a vararg parameter are not supported yet",
    });
    expect(refusal(LAYOUT, undefined, fn(LAYOUT, "Provide"))).toBeUndefined();
    // Extensions of what content has no methods on.
    expect(refusal(LAYOUT, undefined, fn(LAYOUT, "also2"))).toBe(
      "an extension of T is not supported yet",
    );
    expect(refusal(LAYOUT, undefined, fn(LAYOUT, "total"))).toBe(
      "an extension of List<int> is not supported yet",
    );
    // A callback taking arguments: content gives them to the setup's functions.
    expect(refusal(UI, undefined, fn(UI, "onSized"))).toBeUndefined();
    expect(
      planBinding(undefined, fn(ANIMATION, "animateFloatAsState"), module(ANIMATION), () => ({}))
        .inputs[2],
    ).not.toMatchObject({ op: "unsupported" });
    expect(refusal(LAYOUT, undefined, fn(LAYOUT, "Field"))).toBeUndefined();
    // A class neither the libraries nor their dependencies declare (the JDK's, Android's).
    expect(module(RUNTIME).skipped).toContain(
      `${RUNTIME}.readFrom: refers to java.io.File, which content does not declare`,
    );
    // Deprecated at level ERROR: Kotlin callers cannot call it.
    expect(module(RUNTIME).skipped).toContain(
      `${RUNTIME}.LaunchedEffect: deprecated at level ERROR: Kotlin refuses calls to it`,
    );
  });

  it("counts coverage by the same rules", () => {
    const c = coverage(module(LAYOUT));

    expect(c.reasons).toEqual({
      "an extension of T is not supported yet": 1,
      "an extension of List<int> is not supported yet": 1,
      "it composes VectorComposable content, not UI": 1,
    });
    expect(c.raw).toBe(c.total - 3);
  });
});
