/**
 * The members of a toolkit's source module (SwiftUI, written as source)
 * that declarations of its generated module stand for: each overload and
 * value carries `@swift <symbol> [form]` (sdk/toolkit-dts.ts), which
 * leads back to the member's schema, its plan and the call form the
 * overload declares. The body's writer reads Swift's labels and each
 * argument's kind from there, never from the TypeScript.
 */
import { type CallForm, callForms } from "@lucent-lang/bindgen";
import ts from "typescript";
import { type BindingPlan, ownTypes, planBinding } from "../sdk/plans.ts";
import type {
  SdkCallable,
  SdkClassSchema,
  SdkMethodSchema,
  SdkModuleSchema,
  SdkPropertySchema,
} from "../sdk/schema.ts";
import { sourceModuleLookup } from "../sdk/schema.ts";
import { SOURCE_TAG } from "../sdk/toolkit-dts.ts";
import { TOOLKITS, type ToolkitName, toolkitSource } from "./toolkits.ts";

export interface SourceMember {
  owner?: SdkClassSchema;
  member: SdkCallable | SdkMethodSchema | SdkPropertySchema;
  /** How the overload's arguments stand for the member's parameters; none for a value. */
  form?: CallForm;
  plan: BindingPlan;
  /** The member as its diagnostics name it: `padding(_:)`, `VStack(spacing:content:)`, `Color.green`. */
  display: string;
}

type Found = Pick<SourceMember, "owner" | "member">;

/** Each source schema's members, by symbol. */
const indexes = new WeakMap<SdkModuleSchema, Map<string, Found>>();

function indexOf(schema: SdkModuleSchema): Map<string, Found> {
  let index = indexes.get(schema);
  if (index) return index;

  index = new Map();
  for (const t of schema.types) {
    if (t.kind !== "class") continue;

    for (const m of [...(t.constructors ?? []), ...(t.methods ?? []), ...(t.properties ?? [])])
      if (m.symbol) index.set(m.symbol, { owner: t, member: m });
  }
  for (const f of schema.functions ?? []) if (f.symbol) index.set(f.symbol, { member: f });

  indexes.set(schema, index);
  return index;
}

/**
 * The member of `toolkit`'s source module a declaration of its module
 * stands for; undefined for a declaration that is the toolkit's own
 * (its body function, its root).
 */
export function sourceMemberOf(toolkit: ToolkitName, decl: ts.Node): SourceMember | undefined {
  const source = toolkitSource(toolkit);
  const tag = ts.getJSDocTags(decl).find((t) => t.tagName.text === SOURCE_TAG);
  if (!source || !tag) return undefined;

  const [symbol, form] = (ts.getTextOfJSDocComment(tag.comment) ?? "").trim().split(/\s+/);
  const found = sourceModuleLookup(TOOLKITS[toolkit].platform, source.module);
  if ("missing" in found) throw new Error(found.missing);

  const schema = found.schema;
  const at = symbol ? indexOf(schema).get(symbol) : undefined;
  if (!at) throw new Error(`${schema.module} has no member ${symbol ?? "(untagged)"}`);

  const { owner, member } = at;
  const swiftName = member.swift?.name ?? ("name" in member ? member.name : "init");
  const display =
    "type" in member
      ? `${owner?.name.replaceAll("_", ".") ?? schema.module}.${swiftName}`
      : "returns" in member
        ? swiftName
        : `${owner?.name.replaceAll("_", ".")}${swiftName.slice("init".length)}`;

  return {
    ...(owner ? { owner } : {}),
    member,
    ...("params" in member && form !== undefined
      ? { form: callForms(member.params)[Number(form)]! }
      : {}),
    plan: planBinding(owner, member, schema, ownTypes(schema)),
    display,
  };
}
