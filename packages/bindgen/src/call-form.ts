/**
 * Lucent's call form of a member written out as Swift source (a `source`
 * module's): how the arguments of a call in Lucent stand for the Swift
 * parameters. Swift's unlabeled parameters are given in order, its labeled
 * ones as one object (keys are the labels), and a closure last (an action,
 * or a result builder's content) as an argument of its own, which Swift
 * takes as its trailing closure:
 *
 *   frame(width: 56, height: 32)       frame({ width: 56, height: 32 })
 *   VStack(spacing: 8) { Text("a") }   VStack({ spacing: 8 }, [Text("a")])
 *   onTapGesture { flip() }            onTapGesture(() => flip())
 *
 * The declarations and the code that writes the Swift both read this, so
 * the declared signature and the written call cannot disagree.
 */
import type { SdkParam } from "./schema.ts";

/** One argument of a call in the call form, and the Swift parameters it stands for (by index). */
export type CallPart =
  | { k: "positional"; param: number; optional: boolean }
  | { k: "labeled"; params: number[]; optional: boolean }
  | { k: "trailing"; param: number; optional: boolean };

/** One way to write a call: its arguments in order, the declaration's overload. */
export interface CallForm {
  parts: CallPart[];
}

/**
 * The call forms of a member with these parameters. A default leaves an
 * argument out: the object's keys each, a positional one only at the end
 * of the run (Swift fills them in order), and, where a required argument
 * follows, by a form of its own (TypeScript leaves out only trailing
 * arguments). Parameters Lucent never gives (`defaulted: "omitted"`) take
 * no part.
 */
export function callForms(params: readonly SdkParam[]): CallForm[] {
  const given = params.flatMap((p, i) => (p.defaulted === "omitted" ? [] : [i]));
  const last = given.at(-1);
  const closure = (i: number) =>
    params[i]!.swift?.kind !== undefined && params[i]!.swift?.kind !== "value";
  const trailing = last !== undefined && closure(last) ? last : undefined;
  const rest = given.filter((i) => i !== trailing);
  const defaulted = (i: number) => params[i]!.defaulted === "optional";

  // A positional default before a required positional one is given anyway.
  const positional = rest.filter((i) => params[i]!.swift?.label === undefined);
  const parts: CallPart[] = positional.map((param, n) => ({
    k: "positional",
    param,
    optional: positional.slice(n).every(defaulted),
  }));

  const labeled = rest.filter((i) => params[i]!.swift?.label !== undefined);
  if (labeled.length)
    parts.push({ k: "labeled", params: labeled, optional: labeled.every(defaulted) });

  if (trailing !== undefined)
    parts.push({ k: "trailing", param: trailing, optional: defaulted(trailing) });

  return expand(parts);
}

/**
 * Forms without optional arguments before a required one: each leaves out
 * the optional positional ones from the end of their run, and the object
 * when it may, the fewest arguments first.
 */
function expand(parts: CallPart[]): CallForm[] {
  const required = parts.findLastIndex((p) => !p.optional);
  const before = parts.slice(0, Math.max(required, 0));
  const after = parts.slice(Math.max(required, 0));

  if (!before.some((p) => p.optional)) return [{ parts }];

  const positional = before.filter((p) => p.k === "positional");
  const firstOptional = positional.findIndex((p) => p.optional);
  const kept = firstOptional < 0 ? positional.length : firstOptional;
  const object = before.find((p) => p.k === "labeled");

  const forms: CallForm[] = [];
  for (const withObject of object?.optional ? [false, true] : [!!object])
    for (let n = kept; n <= positional.length; n++)
      forms.push({
        parts: [
          ...positional.slice(0, n).map((p) => ({ ...p, optional: false })),
          ...(withObject && object ? [{ ...object, optional: false }] : []),
          ...after,
        ],
      });

  return forms.sort((a, b) => a.parts.length - b.parts.length);
}
