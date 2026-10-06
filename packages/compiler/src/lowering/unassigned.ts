/** Reads of storage that may not be written yet, shared by the legacy emitter and the IR. */
import { cpp } from "@lucent-lang/codegen";
import type { LType } from "../types.ts";

/** The kinds whose storage is a reference, null until written. */
const REFERENCES = new Set<LType["k"]>([
  "struct",
  "class",
  "iface",
  "error",
  "date",
  "regexp",
  "regexMatch",
  "abortSignal",
  "abortController",
]);

/**
 * Whether storage of type `t` holds a null reference until written: an
 * object, or a union or tuple holding one, where JavaScript has undefined.
 */
function startsUnassigned(t: LType): boolean {
  if (t.k === "union") return t.ms.some(startsUnassigned);
  if (t.k === "tuple") return t.es.some(startsUnassigned);

  return REFERENCES.has(t.k);
}

/**
 * A read of `storage`, a field, static field or module variable of type
 * `t` named `what`: one that may still hold a null reference throws a
 * TypeError (`lucent::assigned`), where JavaScript's undefined would
 * throw as soon as it is used as an object.
 */
export function assignedRead(storage: cpp.Expr, t: LType, what: string): cpp.Expr {
  return startsUnassigned(t) ? cpp.call("lucent::assigned", [storage, cpp.str(what)]) : storage;
}
