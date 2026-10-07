/**
 * The view classes of a module as JSX tags (T48), for `lucent sdk coverage
 * --views`: what each adds to its tags by rule (props, events, children),
 * how a tag of it is made, and what its rules leave out, each with its
 * explanation.
 */
import type { SdkClassSchema, SdkModuleSchema } from "../sdk/schema.ts";
import { type FindType, isViewClass, viewConstruction, viewRules } from "../sdk/view-rules.ts";

export interface ViewCoverage {
  view: string;
  /** How a tag makes it without `create`: or `create`, when the tag must say. */
  made: "frame" | "init" | "context" | "create";
  props: { name: string; explanation: string }[];
  events: { name: string; explanation: string }[];
  /** How it takes children, where it declares that itself. */
  children?: string;
  leftOut: { name: string; reason: string }[];
}

/** `schema`'s view classes; other modules' read with `moduleOf`. */
export function viewCoverage(
  schema: SdkModuleSchema,
  moduleOf: (module: string) => SdkModuleSchema | undefined,
): ViewCoverage[] {
  const find: FindType = (module, name) =>
    module === schema.module
      ? schema.types.find((t) => t.name === name)
      : moduleOf(module)?.types.find((t) => t.name === name);

  return schema.types
    .filter(
      (t): t is SdkClassSchema =>
        t.kind === "class" && !t.interface && isViewClass(t, schema, find),
    )
    .map((cls) => {
      const rules = viewRules(cls, schema, find);
      const explained = (x: { name: string; explanation: string }) => ({
        name: x.name,
        explanation: x.explanation,
      });

      return {
        view: cls.name,
        made: viewConstruction(cls, schema, find).kind,
        props: rules.props.map(explained),
        events: rules.events.map(explained),
        ...(rules.children ? { children: rules.children.explanation } : {}),
        leftOut: rules.refused,
      };
    });
}
