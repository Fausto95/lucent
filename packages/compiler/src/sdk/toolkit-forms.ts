/**
 * Lucent's own forms in a toolkit's generated declarations: calls whose
 * Swift is Lucent's machinery rather than one member of the toolkit (a
 * keyed list is a model per item and a row view, not SwiftUI's ForEach
 * over a key path). Appended to the generated module, so they may merge
 * with its declarations (`$ForEach`) and name its types. Each carries the
 * tag the body's writer recognizes: `@list`, `@environment`.
 */

/** A form, and the declarations of the toolkit's it names beyond its view and content. */
interface Form {
  readonly needs: readonly string[];
  readonly text: string;
}

const SWIFTUI: readonly Form[] = [
  {
    needs: [],
    text: `declare interface $ForEach {
  /**
   * A view for each item of \`data\`, an array the setup computes, told
   * apart by \`id\` (a string or a number, unique): an item keeps its model
   * and its view, updated in place, while its key stays. Its children, a
   * function of one item, show it; what they read of the item (and of the
   * setup) is the item's.
   *
   * @list
   */
  <T>(props: { data: readonly T[]; id: (item: T) => string | number; children: (item: T) => Content } & Omit<View$Modifiers, "id">): View;
}
`,
  },
  {
    needs: ["EnvironmentValues"],
    text: `/**
 * A value of SwiftUI's environment where the view reading it is, read
 * where the body draws: \`Environment((values) => values.colorScheme)\` is
 * \`@Environment(\\.colorScheme)\`.
 *
 * @environment
 */
export declare function Environment<T>(value: (values: EnvironmentValues) => T): T;
`,
  },
];

/** Each source module's forms. */
const FORMS: Record<string, readonly Form[]> = { SwiftUI: SWIFTUI };

/**
 * The forms a toolkit's generated declarations end with, by its source
 * module: those whose declarations `declared` has.
 */
export function toolkitForms(module: string, declared: (name: string) => boolean): string {
  const forms = FORMS[module] ?? [];

  return forms
    .filter((f) => f.needs.every(declared))
    .map((f) => f.text)
    .join("");
}
