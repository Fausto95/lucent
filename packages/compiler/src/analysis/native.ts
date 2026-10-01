/**
 * What the analyses know about native code: the facts of each SDK use's
 * binding plan (thread, blocking, how callbacks run, what it copies) and
 * the thread an SDK class's objects belong to. Nothing is inferred from a
 * name; absent facts are unknown.
 */
import ts from "typescript";
import { sdkModuleOf } from "../program.ts";
import {
  classOfDecl,
  promiseForm,
  requirementOf,
  schemaConstructor,
  schemaMethod,
  schemaProperty,
  type SdkClassRef,
} from "../sdk/declarations.ts";
import { type BindingPlan, type ConversionPlan, memberPlan, type Role } from "../sdk/plans.ts";
import { findSdkModule, type NativeFacts } from "../sdk/schema.ts";

export type Known<T extends string> = T | "unknown";

/** How native code runs a function it is given: while the call runs, or kept for later. */
export interface NativeCallback {
  readonly timing: Known<"during-call" | "escaping">;
  /** It runs on the main thread. */
  readonly main: boolean;
  /** When the platform runs it: waiting for it (`sync`), or queued on the Lucent thread. */
  readonly delivery?: "sync" | "queued";
}

/** A use of an SDK member, as its binding plan describes it. */
export interface NativeUse {
  /** `UIView.setNeedsLayout`. */
  readonly display: string;
  readonly facts: NativeFacts;
  /** Function arguments by position. */
  readonly callbacks: ReadonlyMap<number, NativeCallback>;
  /** Arguments native code gets a copy of: it cannot keep the value itself. */
  readonly copies: ReadonlySet<number>;
  /** It reports failures (an NSError, Swift `throws`, a Java exception). */
  readonly throws: boolean;
  /** A compile-time constant: no native code runs. */
  readonly constant?: true;
  /** For a requirement Lucent implements: whether the platform waits for it. */
  readonly delivery?: "sync" | "queued";
}

/** An SDK class: the thread its objects belong to. */
export interface NativeClass {
  readonly display: string;
  readonly affinity: Known<"main" | "worker" | "any">;
}

/** Where the analyses get native facts: the SDK's binding plans, or a test's stand-in. */
export interface NativeFactsSource {
  /** A use in `role` of the SDK member `decl` declares; undefined when `decl` is not an SDK declaration. */
  use(decl: ts.Declaration, role: Role): NativeUse | undefined;
  /** The SDK class `decl` declares, or undefined. */
  classOf(decl: ts.Declaration): NativeClass | undefined;
  /** A Lucent class's method that the platform calls: a protocol requirement or an override. */
  implemented(checker: ts.TypeChecker, method: ts.MethodDeclaration): NativeUse | undefined;
}

/** No native code (the host, tests without SDKs): every SDK declaration is unknown. */
export const NO_NATIVE: NativeFactsSource = {
  use: () => undefined,
  classOf: () => undefined,
  implemented: () => undefined,
};

/** The first source that knows a declaration, for each question. */
export function nativeSources(...sources: NativeFactsSource[]): NativeFactsSource {
  return {
    use: (decl, role) => sources.map((s) => s.use(decl, role)).find((u) => u !== undefined),
    classOf: (decl) => sources.map((s) => s.classOf(decl)).find((c) => c !== undefined),
    implemented: (checker, method) =>
      sources.map((s) => s.implemented(checker, method)).find((u) => u !== undefined),
  };
}

/** Conversions that hand native code a copy (or a plain value). */
const COPIED = new Set<ConversionPlan["op"]>([
  "passthrough",
  "number",
  "bigint",
  "enum",
  "struct",
  "copy-string",
  "copy-bytes",
  "copy-array",
  "copy-record",
  "copy-set",
  "copy-date",
]);

/** The facts of a callback's conversion plan: `detail` names its timing, then whether it runs on main. */
function callbackOf(plan: ConversionPlan): NativeCallback | undefined {
  if (plan.op === "optional" && plan.of?.[0]) return callbackOf(plan.of[0]);

  if (plan.op !== "callback") return undefined;

  const [timing, ...rest] = (plan.detail ?? "").split(", ");
  const known = timing === "escaping" || timing === "during-call" ? timing : "unknown";

  return {
    timing: known,
    main: rest.includes("main thread"),
    ...(plan.delivery ? { delivery: plan.delivery } : {}),
  };
}

function copied(plan: ConversionPlan): boolean {
  if (plan.op === "optional") return !!plan.of?.[0] && copied(plan.of[0]);

  return COPIED.has(plan.op);
}

/** A use as a binding plan describes it. */
export function useOf(plan: BindingPlan): NativeUse {
  const callbacks = new Map<number, NativeCallback>();
  const copies = new Set<number>();

  plan.inputs.forEach((input, i) => {
    const cb = callbackOf(input);

    if (cb) callbacks.set(i, cb);

    if (copied(input)) copies.add(i);
  });

  return {
    display: plan.display,
    facts: plan.facts,
    callbacks,
    copies,
    throws: !!plan.error,
    ...(plan.delivery ? { delivery: plan.delivery } : {}),
  };
}

const CONSTANT: Omit<NativeUse, "display"> = {
  facts: { affinity: "any", blocking: "no", ownership: "unknown", evidence: [] },
  callbacks: new Map(),
  copies: new Set(),
  throws: false,
  constant: true,
};

const UNKNOWN: Omit<NativeUse, "display"> = {
  facts: { affinity: "unknown", blocking: "unknown", ownership: "unknown", evidence: [] },
  callbacks: new Map(),
  copies: new Set(),
  throws: true,
};

/** Native facts from the platform SDKs' binding plans. */
export const SDK_NATIVE: NativeFactsSource = {
  use(decl, role) {
    const sdk = sdkModuleOf(decl.getSourceFile());
    if (!sdk) return undefined;

    const cls = classOfDecl(decl);
    const plan = cls ? classMemberPlan(cls, decl, role) : moduleMemberPlan(sdk, decl);

    if (plan === "constant") return { ...CONSTANT, display: declarationName(decl) };

    return plan ? useOf(plan) : { ...UNKNOWN, display: declarationName(decl) };
  },

  classOf(decl) {
    if (!ts.isClassDeclaration(decl)) return undefined;

    const ref = classOfDecl(decl);
    if (!ref) return undefined;

    const affinity = ref.cls.facts?.affinity ?? (ref.cls.mainActor ? "main" : "unknown");

    return { display: ref.cls.name, affinity };
  },

  implemented(checker, method) {
    const requirement = requirementOf(checker, method);
    if (requirement)
      return useOf(
        memberPlan(
          requirement.protocol.platform,
          requirement.protocol.module,
          requirement.protocol.cls,
          requirement.method,
          "implement",
        ),
      );

    const base = sdkBase(checker, method);
    const overridden = base?.cls.methods?.find(
      (m) => !m.static && ts.isIdentifier(method.name) && m.name === method.name.text,
    );

    return base && overridden
      ? useOf(memberPlan(base.platform, base.module, base.cls, overridden, "implement"))
      : undefined;
  },
};

/** The plan of a use of an SDK class's member, or "constant" for a compile-time value. */
function classMemberPlan(
  ref: SdkClassRef,
  decl: ts.Declaration,
  role: Role,
): BindingPlan | "constant" | undefined {
  if (ts.isMethodDeclaration(decl)) {
    // A member the schema does not name ([Symbol.dispose], which disposes an AutoCloseable): no plan.
    if (!ts.isIdentifier(decl.name)) return undefined;

    const { ref: owner, method, promise } = schemaMethod(ref, decl);

    return memberPlan(
      owner.platform,
      owner.module,
      owner.cls,
      promise ? promiseForm(method) : method,
      "call",
    );
  }

  if (ts.isConstructorDeclaration(decl))
    return memberPlan(ref.platform, ref.module, ref.cls, schemaConstructor(ref, decl), "new");

  if (!ts.isPropertyDeclaration(decl) || !ts.isIdentifier(decl.name)) return undefined;

  const found = schemaProperty(ref, decl);
  if (!found) return undefined;

  const { ref: owner, property } = found;
  if (property.value !== undefined) return "constant";

  return memberPlan(owner.platform, owner.module, owner.cls, property, role);
}

/** The plan of a use of an SDK module's C function or constant. */
function moduleMemberPlan(
  sdk: { platform: SdkClassRef["platform"]; module: string },
  decl: ts.Declaration,
): BindingPlan | "constant" | undefined {
  if (ts.isEnumMember(decl)) return "constant";

  const schema = findSdkModule(sdk.platform, sdk.module);
  const name = declarationName(decl);

  if (ts.isFunctionDeclaration(decl)) {
    const f = schema?.functions?.find((x) => x.name === name);

    return f ? memberPlan(sdk.platform, sdk.module, undefined, f, "call") : undefined;
  }

  if (ts.isVariableDeclaration(decl)) {
    const c = schema?.constants?.find((x) => x.name === name);

    return c ? memberPlan(sdk.platform, sdk.module, undefined, c, "get") : undefined;
  }

  return undefined;
}

/** The SDK class a Lucent class extends, when it does. */
function sdkBase(checker: ts.TypeChecker, method: ts.MethodDeclaration): SdkClassRef | undefined {
  const cls = method.parent;
  if (!ts.isClassLike(cls)) return undefined;

  const clause = cls.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword);
  const t = clause?.types[0];
  const decl =
    t && checker.getTypeAtLocation(t).getSymbol()?.declarations?.find(ts.isClassDeclaration);

  return decl ? classOfDecl(decl) : undefined;
}

function declarationName(decl: ts.Declaration): string {
  const name = (decl as ts.NamedDeclaration).name;
  const own = name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : "member";
  const owner =
    decl.parent && ts.isClassDeclaration(decl.parent) ? decl.parent.name?.text : undefined;

  return owner ? `${owner}.${own}` : own;
}
