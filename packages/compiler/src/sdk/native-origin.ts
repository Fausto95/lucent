/**
 * Where an SDK declaration comes from natively, and how Lucent maps it
 * (T61): the line each class and member's doc comment gains in the
 * generated declarations, so an editor's hover and go-to-definition say
 * what a call calls. Spelled as each platform spells it: `-[UIDevice
 * batteryLevel]`, Swift's `Point.distance(to:)`, a C function,
 * `android.os.Vibrator#vibrate(J)V`.
 */
import {
  jniDescriptor,
  type SdkCallable,
  type SdkClassSchema,
  type SdkMethodSchema,
  type SdkModuleSchema,
  type SdkPropertySchema,
} from "./schema.ts";

export type OriginMember =
  | { method: SdkMethodSchema }
  | { property: SdkPropertySchema }
  | { initializer: SdkCallable };

/** `, in UIKit`, and the artifact where it is no platform SDK (a pod, a Maven library). */
function where(schema: SdkModuleSchema): string {
  const p = schema.provenance;
  const sdk = !p || p.kind === "sdk" || p.artifact.startsWith("android-sdk:");

  return `, in ${schema.module}${sdk ? "" : ` (${p.artifact})`}`;
}

/** A JVM member's descriptor: its own, or its types' (none where a type has no Java form). */
function descriptorOf(
  c: SdkCallable,
  returns: SdkMethodSchema["returns"] | "void",
  typeParams?: string[],
) {
  if (c.descriptor) return c.descriptor;

  try {
    return jniDescriptor(
      c.params.map((p) => p.type),
      returns,
      typeParams,
    );
  } catch {
    return "";
  }
}

/** A JVM class's binary name, dotted (`android.os.Build$VERSION`). */
const jvm = (native: string) => native.replaceAll("/", ".");

const line = (schema: SdkModuleSchema, origin: string, mapping?: string) =>
  `Native: ${origin}${where(schema)}${mapping ? `; ${mapping}` : ""}`;

export function classOrigin(schema: SdkModuleSchema, cls: SdkClassSchema): string {
  if (schema.platform === "android")
    return line(
      schema,
      `${cls.kotlin ? "Kotlin" : "Java"} ${cls.interface ? "interface" : "class"} ${jvm(cls.native)}`,
    );

  const kind = cls.swift
    ? `Swift ${cls.swift.kind}`
    : cls.cf
      ? "C type"
      : `Objective-C ${cls.interface ? "protocol" : "class"}`;

  return line(schema, `${kind} ${cls.native}`);
}

export function memberOrigin(
  schema: SdkModuleSchema,
  cls: SdkClassSchema,
  member: OriginMember,
): string {
  return schema.platform === "android"
    ? jvmMember(schema, cls, member)
    : appleMember(schema, cls, member);
}

function jvmMember(schema: SdkModuleSchema, cls: SdkClassSchema, member: OriginMember): string {
  const owner = jvm(cls.native);

  if ("method" in member) {
    const m = member.method;
    return line(
      schema,
      `${owner}#${m.java ?? m.name}${descriptorOf(m, m.returns, [...(cls.typeParams ?? []), ...(m.typeParams ?? [])])}`,
    );
  }

  if ("initializer" in member)
    return line(
      schema,
      `${owner}#<init>${descriptorOf(member.initializer, "void", cls.typeParams)}`,
    );

  const p = member.property;
  if (!p.getter) return line(schema, `${owner}.${p.name}`);

  return line(
    schema,
    `${owner}#${p.getter}()${p.setter ? ` and ${owner}#${p.setter}()` : ""}`,
    `read through its getter${p.setter ? ", written through its setter" : ""}`,
  );
}

function appleMember(schema: SdkModuleSchema, cls: SdkClassSchema, member: OriginMember): string {
  const send = (isStatic: boolean | undefined, selector: string) =>
    `${isStatic ? "+" : "-"}[${cls.native} ${selector}]`;

  if ("method" in member) {
    const m = member.method;
    // A class's async method is declared as a Promise; a protocol's requirement keeps its handler.
    const mapping =
      m.async && !cls.interface
        ? "without its completion handler, a Promise it settles"
        : undefined;

    if (m.swift) return line(schema, `Swift ${cls.native}.${m.swift.name}`, mapping);
    if (m.cFunction) return line(schema, `${m.cFunction.name}()`, mapping);
    return line(schema, send(m.static, m.selector ?? m.name), mapping);
  }

  if ("initializer" in member) {
    const c = member.initializer;

    if (c.swift) return line(schema, `Swift ${cls.native}.${c.swift.name}`);
    if (c.cFunction) return line(schema, `${c.cFunction.name}()`);
    return line(schema, send(c.factory, c.selector ?? "init"));
  }

  const p = member.property;
  if (p.swift) return line(schema, `Swift ${cls.native}.${p.swift.name}`);
  if (p.cFunctions)
    return line(
      schema,
      `${p.cFunctions.getter}()${p.cFunctions.setter ? ` and ${p.cFunctions.setter}()` : ""}`,
    );
  if (p.global) return line(schema, `the C global ${p.global}`);

  return line(
    schema,
    `${send(p.static, p.selector ?? p.name)}${p.setter ? ` and ${send(p.static, p.setter)}` : ""}`,
  );
}
