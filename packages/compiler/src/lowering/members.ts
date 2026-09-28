/** The C++ of a `members` conversion step, shared by the legacy emitter and the IR. */
import { cpp } from "@lucent-lang/codegen";

/** One member of the union: its C++ type, and that member converted to the target. */
export interface MemberArm {
  type: cpp.Type;
  value: cpp.Expr;
}

/** The member of type `type` the union holds (checked), for a MemberArm's value. */
export function heldAs(type: cpp.Type): cpp.Expr {
  return cpp.call("lucent::narrow", [cpp.id("u")], [type]);
}

/**
 * `input`, a union, as a `to` through the member it holds: a lambda tests
 * each arm's member in turn and takes the last one as held, which
 * `lucent::narrow` checks, so a member without an arm throws a TypeError.
 * The lambda captures nothing, so it is valid at namespace scope too.
 */
export function throughMembers(input: cpp.Expr, to: cpp.Type, arms: MemberArm[]): cpp.Expr {
  const u = cpp.id("u");

  const value = arms
    .slice(0, -1)
    .reduceRight<cpp.Expr>(
      (orElse, arm) =>
        cpp.conditional(cpp.call("std::holds_alternative", [u], [arm.type]), arm.value, orElse),
      arms.at(-1)!.value,
    );

  const each = cpp.lambda(
    [],
    [cpp.param(cpp.reference(cpp.constType(cpp.auto)), "u")],
    [cpp.ret(value)],
    { ret: to },
  );

  return cpp.call(each, [input]);
}
