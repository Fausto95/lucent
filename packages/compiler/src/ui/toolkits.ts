/**
 * The declarative view toolkits a platform's components may draw with
 * (`lucent:<toolkit>`), each the platform's own. Internal, like lucent:ui:
 * their modules resolve only when compiles generate views.
 *
 * A component draws with one by returning its body, JSX of the toolkit's
 * elements, written in a file of the toolkit's platform
 * (`*.ios.lucent.tsx`: SwiftUI). That file's JSX is the toolkit's: its
 * module declares the JSX namespace (the program resolves the implicit JSX
 * runtime import of each file to its platform's toolkit). The component's
 * root, the object the host shows, is the toolkit's. Plain data, no
 * imports: the program, the analyses and the emitters all read it.
 */
import type { Platform } from "../sdk/schema.ts";

export interface Toolkit {
  /** Its name, in messages. */
  readonly title: string;
  readonly platform: Platform;
  /** The type of its JSX elements (`JSX.Element`): what a body is. */
  readonly element: string;
  /** The class of the component's root view, which its host shows. */
  readonly root: string;
  /**
   * The native module its declarations are generated from, written as
   * source (bindgen's `sdkSourceModule`), with the type of what a body
   * returns; none: they are written by hand (`lib/sdk/<name>.d.ts`).
   */
  readonly source?: { readonly module: string; readonly view: string };
}

export const TOOLKITS = {
  swiftui: {
    title: "SwiftUI",
    platform: "ios",
    element: "View",
    root: "UIHostingController",
    source: { module: "SwiftUI", view: "View" },
  },
  compose: {
    title: "Compose",
    platform: "android",
    element: "Composed",
    root: "ComposeView",
  },
} as const satisfies Record<string, Toolkit>;

export type ToolkitName = keyof typeof TOOLKITS;

/**
 * The module every Lucent file's JSX imports its runtime from
 * (`jsxImportSource`): `lucent:jsx/jsx-runtime` resolves to the toolkit
 * of the importing file's platform (`toolkitOfPlatform`).
 */
export const JSX_SOURCE = "lucent:jsx";

/** Where a toolkit's declarations come from: its source module, when bindgen generates them. */
export function toolkitSource(name: ToolkitName): Toolkit["source"] {
  const toolkit: Toolkit = TOOLKITS[name];

  return toolkit.source;
}

/** The toolkit a `lucent:<name>` module is, if it is one. */
export function toolkitOfModule(module: string | undefined): ToolkitName | undefined {
  const name = module && /^lucent:(\w+)$/.exec(module)?.[1];

  return name && Object.hasOwn(TOOLKITS, name) ? (name as ToolkitName) : undefined;
}

/** The toolkit a platform's files write their JSX with. */
export function toolkitOfPlatform(platform: Platform | undefined): ToolkitName | undefined {
  return (Object.keys(TOOLKITS) as ToolkitName[]).find((t) => TOOLKITS[t].platform === platform);
}

/** A toolkit's entry, as the table's type (its optional fields read as optional). */
export function toolkit(name: ToolkitName): Toolkit {
  return TOOLKITS[name];
}
