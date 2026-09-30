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
 * A view is written as JSX (`jsxForm`), each call form's arguments as its
 * attributes and children; a modifier as an attribute whose value is its
 * arguments (`argumentsShape`):
 *
 *   VStack(spacing: 8) { Text("a") }   <VStack spacing={8}><Text>a</Text></VStack>
 *   .frame(width: 56, height: 32)      frame={{ width: 56, height: 32 }}
 *   .animation(.spring, value: on)     animation={[Animation.spring(), { value: on.get() }]}
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

/** An attribute of a JSX form: the Swift parameter it gives, by index. */
export interface JsxAttribute {
  name: string;
  param: number;
  optional: boolean;
}

/**
 * How a view's initializer is written as JSX, for one call form: each
 * argument an attribute, named by its Swift label, or, unlabeled, by its
 * parameter's name (a trailing action too); the children give a trailing
 * builder's content, or else a first unlabeled string (`<Text>hi</Text>`).
 */
export interface JsxForm {
  attributes: JsxAttribute[];
  children?: { kind: "text" | "builder"; param: number; optional: boolean };
}

export function jsxForm(params: readonly SdkParam[], form: CallForm): JsxForm {
  const trailing = form.parts.find((p) => p.k === "trailing");
  const builder =
    trailing && params[trailing.param]!.swift?.kind === "builder" ? trailing : undefined;
  const text = builder
    ? undefined
    : form.parts.find(
        (p) =>
          p.k === "positional" &&
          params[p.param]!.type.k === "string" &&
          !params[p.param]!.type.nullable,
      );
  const children = builder ?? text;

  const taken = new Set<string>();
  const unique = (name: string) => {
    let out = name;
    while (taken.has(out)) out = `${out}_`;
    taken.add(out);
    return out;
  };
  const attribute = (param: number, optional: boolean): JsxAttribute => {
    const p = params[param]!;

    return { name: unique(p.swift?.label ?? p.name), param, optional };
  };

  const attributes = form.parts.flatMap((part): JsxAttribute[] => {
    if (part === children) return [];

    if (part.k !== "labeled") return [attribute(part.param, part.optional)];

    return part.params.map((i) =>
      attribute(i, part.optional || params[i]!.defaulted === "optional"),
    );
  });

  return {
    attributes,
    ...(children && children.k !== "labeled"
      ? {
          children: {
            kind: children === builder ? "builder" : "text",
            param: children.param,
            optional: children.optional,
          },
        }
      : {}),
  };
}

/**
 * How a modifier's arguments are written as one attribute's value, for a
 * call form: none (the attribute alone), one argument as it is, or more as
 * a tuple, each as the call form gives it (an object of the labeled ones).
 */
export function argumentsShape(form: CallForm): "none" | "one" | "tuple" {
  return form.parts.length === 0 ? "none" : form.parts.length === 1 ? "one" : "tuple";
}
