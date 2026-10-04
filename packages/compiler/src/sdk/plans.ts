/**
 * Binding plans as the compiler makes them (bindgen's rules, with the type
 * facts the compiler reads): what a use of an SDK member may do, how its
 * values cross, and why not when they cannot.
 */
import {
  type BindingPlan,
  type ConversionPlan,
  planBinding,
  planConversion,
  type Role,
  type TypeFacts,
  type TypeLookup,
} from "@lucent-lang/bindgen";
import {
  findSdkType,
  loadSdkModule,
  type Platform,
  type SdkCallable,
  type SdkClassSchema,
  type SdkMethodSchema,
  type SdkPropertySchema,
  type SdkType,
  sdkNamesOf,
  sdkTypeInfo,
} from "./schema.ts";

export type { BindingPlan, ConversionPlan, Role };
export {
  explainRefusal,
  isBigIntType,
  isUnsignedWide,
  isWideInteger,
  omitsKotlinDefault,
  ownTypes,
  planBinding,
  provenanceOf,
  SWIFT_SCALARS,
  takenReason,
  unsupportedReason,
} from "@lucent-lang/bindgen";

/**
 * The facts of the types a platform's members name, as the emitters read
 * them: kinds from names (other modules are not extracted for them), and a
 * Swift type's whole declaration, which its shims need anyway. A module
 * without names is taken as declaring its types, of unknown kind.
 */
export function sdkTypeFacts(platform: Platform): TypeLookup {
  return (module, name) => {
    if (!sdkNamesOf(platform, module)) return {};

    const info = sdkTypeInfo(platform, module, name);
    if (!info) return undefined;

    const facts: TypeFacts = {
      kind: info.kind,
      ...(info.cf ? { cf: true } : {}),
      ...(info.typeParams ? { typeParams: info.typeParams } : {}),
    };
    if (!info.swift) return facts;

    const decl = findSdkType(platform, module, name);
    const swift = decl?.kind === "class" || decl?.kind === "enum" ? decl.swift : undefined;
    return { ...facts, swift: swift ?? true };
  };
}

type Member = SdkMethodSchema | SdkPropertySchema | SdkCallable;

/** The plan of a use of `member` of `owner` (none for C functions and constants) in `module`. */
export function memberPlan(
  platform: Platform,
  module: string,
  owner: SdkClassSchema | undefined,
  member: Member,
  role?: Role,
): BindingPlan {
  return planBinding(owner, member, loadSdkModule(platform, module), sdkTypeFacts(platform), role);
}

/**
 * One value's conversion through a Swift shim, for a use specialized with
 * its type arguments (which the member's plan cannot know): `in` for what
 * the use passes, `out` for what it gets back.
 */
export function swiftConversion(t: SdkType, flow: "in" | "out"): ConversionPlan {
  return planConversion(
    t,
    { backend: "swift-shim", platform: "ios", flow, passed: flow === "in", result: flow === "out" },
    sdkTypeFacts("ios"),
  );
}

/** A function passed where Objective-C takes a block: its conversion, the block's parameters offered to it. */
export function blockConversion(t: SdkType & { k: "fn" }): ConversionPlan {
  return planConversion(
    { ...t, nullable: false },
    { backend: "objc", platform: "ios", flow: "in", passed: true },
    sdkTypeFacts("ios"),
  );
}

/** A function passed where Kotlin takes a function type: its conversion, the FunctionN's arguments offered to it. */
export function kotlinFunctionConversion(t: SdkType & { k: "fn" }): ConversionPlan {
  return planConversion(
    { ...t, nullable: false },
    { backend: "jni", platform: "android", flow: "in", passed: true },
    sdkTypeFacts("android"),
  );
}
