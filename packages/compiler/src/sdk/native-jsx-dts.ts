/**
 * What a JSX namespace declares for native view tags (T48): a UIKit or
 * Android view class is a tag (`NativeViewTag`), typed with its
 * declarations' `~jsx` attributes (children among them, where its class
 * inserts them), and `create`, which every class tag takes. The toolkits'
 * namespaces and the shared files' runtime add them for their platforms'
 * root views.
 */
import { ts } from "@lucent-lang/codegen";
import type { Platform } from "./schema.ts";
import { ROOT_VIEW } from "./view-rules.ts";

/** The names a namespace's native part imports from lucent:ui. */
export const NATIVE_JSX_UI = ["NativeViewTag"];

/**
 * The root view classes of `platforms`: their imports, each under its
 * platform's name (`View as android_View`: a toolkit's own `View` may be
 * imported beside it), and the types naming them.
 */
export function rootViews(platforms: readonly Platform[]): {
  imports: ts.Decl[];
  types: ts.Type[];
} {
  const alias = (p: Platform) => `${p}_${ROOT_VIEW[p].name}`;

  return {
    imports: platforms.map((p) => ({
      k: "importType",
      names: [`${ROOT_VIEW[p].name} as ${alias(p)}`],
      from: `lucent:${p}/${ROOT_VIEW[p].module}`,
    })),
    types: platforms.map((p) => ts.ref(alias(p))),
  };
}

/** What a tag of `roots` (the root views' types) is: one of their classes. */
export const nativeTags = (roots: readonly ts.Type[]): ts.Type[] =>
  roots.map((r) => ts.ref("NativeViewTag", r));

/** The namespace's declarations for class tags: attributes from `~jsx`, and `create`. */
export function nativeJsxDecls(): ts.Decl[] {
  return [
    {
      k: "interface",
      name: "ElementAttributesProperty",
      members: [{ k: "property", name: "~jsx", type: ts.object([]) }],
    },
    {
      k: "interface",
      name: "IntrinsicClassAttributes",
      typeParams: [{ name: "T" }],
      members: [
        {
          k: "property",
          name: "create",
          type: ts.fn([], ts.ref("T")),
          optional: true,
          doc: "Makes the view, where its class has no frame or Context constructor to make it with.",
        },
      ],
    },
  ];
}
