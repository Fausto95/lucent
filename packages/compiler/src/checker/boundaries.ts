import { diagnostic, type Diagnostic } from "../diagnostics/index.ts";
import type { SurfaceModule } from "../parser/surface.ts";
import { typeEquals, T, type NativeType } from "../types/native-type.ts";
import type { StructDef, TypedFunction } from "./typed.ts";
const scalar = (t: NativeType): boolean =>
  t.kind === "string" ||
  t.kind === "bool" ||
  (t.kind === "float" && t.bits === 64) ||
  (t.kind === "optional" && scalar(t.value));
/** Fail at the language boundary instead of producing host code that cannot be bridged. */
export function checkBoundaries(
  source: SurfaceModule,
  structs: Map<string, StructDef>,
  functions: TypedFunction[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const fail = (span: { start: number; end: number }, message: string) =>
    diagnostics.push(diagnostic("NT1011", span, message));

  const contains = (t: NativeType, predicate: (t: NativeType) => boolean, seen = new Set<string>()): boolean => {
    if (predicate(t)) return true;
    if (t.kind === "array") return contains(t.element, predicate, seen);
    if (t.kind === "optional" || t.kind === "map" || t.kind === "promise") return contains(t.value, predicate, seen);
    if (t.kind === "struct" && !seen.has(t.name)) {
      seen.add(t.name);
      return structs.get(t.name)?.fields.some((f) => contains(f.type, predicate, seen)) ?? false;
    }
    return false;
  };
  const reference = (t: NativeType) => t.kind === "struct" && !!structs.get(t.name)?.reference;
  const viewProps = new Set(
    functions
      .filter((f) => f.returnType.kind === "view")
      .flatMap((f) => f.params.flatMap((p) => (p.type.kind === "struct" ? [p.type.name] : []))),
  );
  for (const alias of source.typeAliases) {
    const struct = structs.get(alias.name);
    if (!struct) continue;
    if (struct.fields.some((f) => contains(f.type, (t) => t.kind === "callback")))
      diagnostics.push(
        diagnostic(
          "NT1005",
          alias.span,
          "Native callbacks are function parameters or local values, not bridge record fields.",
        ),
      );
    if (struct.reference?.native) {
      const operations = functions.filter((f) => f.classOp?.className === struct.name);
      const receiver = (fn: TypedFunction) =>
        fn.params[0]?.type.kind === "struct" && fn.params[0].type.name === struct.name;
      const ctor = operations.find((f) => f.classOp?.kind === "constructor");
      if (!ctor || ctor.async || !typeEquals(ctor.returnType, T.struct(struct.name)) || ctor.binding?.nativeOnly)
        fail(alias.span, "Native reference constructors must return their object type and support the handle bridge.");
      for (const field of struct.fields) {
        const getter = operations.find((f) => f.classOp?.kind === "get" && f.classOp.member === field.name);
        const setter = operations.find((f) => f.classOp?.kind === "set" && f.classOp.member === field.name);
        if (!getter || getter.params.length !== 1 || !receiver(getter) || !typeEquals(getter.returnType, field.type))
          fail(alias.span, `Native property ${field.name} requires a compatible getter.`);
        if (
          setter &&
          (setter.params.length !== 2 ||
            !receiver(setter) ||
            !typeEquals(setter.params[1]!.type, field.type) ||
            setter.returnType.kind !== "void")
        )
          fail(alias.span, `Native property ${field.name} has an incompatible setter.`);
      }
      for (const fn of operations)
        if (fn.classOp?.kind === "method" && !receiver(fn))
          fail(fn.span, "Native methods require their object type as the first parameter.");
    }
    if (!struct.reference && struct.fields.length === 0)
      fail(alias.span, "Empty value records are not supported. Use a tagged record or void.");
    if (
      !viewProps.has(struct.name) &&
      struct.fields.some((f) => contains(f.type, (t) => t.kind === "event" || t.kind === "view"))
    )
      fail(alias.span, "Event callbacks are only supported in native view props records.");
    if (struct.reference && !struct.reference.native && struct.fields.some((f) => !scalar(f.type)))
      fail(alias.span, "Shared object fields support scalar and nullable scalar values.");
    if (!struct.reference && struct.fields.some((f) => contains(f.type, reference)))
      fail(alias.span, "A value record cannot contain a shared native object. Pass the object directly.");
  }
  for (const fn of functions) {
    const original = source.functions.find((f) => f.name === fn.name)!;
    if (original.ambient && !fn.binding)
      fail(fn.span, "A declared native function requires a registered platform binding.");
    if (fn.event) {
      const invalid = (t: NativeType) =>
        t.kind === "bytes" ||
        t.kind === "event" ||
        t.kind === "view" ||
        t.kind === "promise" ||
        reference(t) ||
        (t.kind === "int" && !t.signed);
      if (fn.params.some((p) => contains(p.type, invalid)))
        fail(
          fn.span,
          "Events require JSON-compatible values; bytes, callbacks, views, and shared objects cannot be event payloads.",
        );
    }
    if (fn.returnType.kind === "view") continue;
    const all = [...fn.params.map((p) => p.type), fn.returnType];
    if (all.some((t) => contains(t, (inner) => inner.kind === "event" || inner.kind === "view")))
      fail(fn.span, "Event callbacks are only supported as native view props.");
    if (fn.exported && all.some((t) => contains(t, (inner) => inner.kind === "callback")))
      diagnostics.push(
        diagnostic(
          "NT1005",
          fn.span,
          "Native callbacks cannot cross the JavaScript boundary. Use typed events for JavaScript notifications.",
        ),
      );
    if (fn.exported && all.some((t) => !reference(t) && contains(t, reference)))
      fail(fn.span, "Shared objects must cross the native boundary directly, not inside containers or optionals.");
    if (fn.async && fn.params.some((p) => contains(p.type, reference)))
      fail(fn.span, "Shared object arguments require synchronous functions so their operations remain serialized.");
  }
  return diagnostics;
}
