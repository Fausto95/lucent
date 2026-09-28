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
   * and its view, updated in place, while its key stays. \`content\` shows
   * one item; what it reads of the item (and of the setup) is the item's.
   *
   * @list
   */
  <T>(
    data: readonly T[],
    identified: { id: (item: T) => string | number },
    content: (item: T) => View | Content,
  ): View;
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

/**
 * The forms a toolkit's generated declarations end with, by its body
 * function: those whose declarations `declared` has.
 */
export function toolkitForms(body: string, declared: (name: string) => boolean): string {
  const forms = body === "swiftUI" ? SWIFTUI : [];

  return forms
    .filter((f) => f.needs.every(declared))
    .map((f) => f.text)
    .join("");
}
