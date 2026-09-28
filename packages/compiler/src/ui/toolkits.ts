/**
 * The declarative view toolkits a platform's components may draw with
 * (`lucent:<toolkit>`), each the platform's own. Internal, like lucent:ui:
 * their modules resolve only when compiles generate views.
 *
 * A component draws with one by giving its body to the toolkit's body
 * function (`swiftUI(() => …)`, `compose(() => …)`), whose value is the
 * component's root: the object the host shows. Plain data, no imports:
 * the program, the analyses and the emitters all read it.
 */
import type { Platform } from "../sdk/schema.ts";

export interface Toolkit {
  /** Its name, in messages. */
  readonly title: string;
  readonly platform: Platform;
  /** The function a setup gives its body to. */
  readonly body: string;
  /** The class that function returns: the component's root view, which its host shows. */
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
    body: "swiftUI",
    root: "UIHostingController",
    source: { module: "SwiftUI", view: "View" },
  },
  compose: { title: "Compose", platform: "android", body: "compose", root: "ComposeView" },
} as const satisfies Record<string, Toolkit>;

export type ToolkitName = keyof typeof TOOLKITS;

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
