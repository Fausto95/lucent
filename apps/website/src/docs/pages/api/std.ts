import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "api/std",
  title: "Built-in library",
  description:
    "The only native functions Lucent ships. Each is a direct Swift and Kotlin call and none of them needs a capability. Everything a platform SDK provides comes in through a package manifest.",
  blocks: [
    { kind: "h2", text: "@lucent-lang/core" },
    {
      kind: "code",
      filename: "declaration",
      code: "export declare function encodeUTF8(text: string): Uint8Array;\nexport declare function decodeUTF8(bytes: Uint8Array): string;\nexport declare function copyBytes(bytes: Uint8Array): Uint8Array;",
    },
    {
      kind: "p",
      text: "Results own their bytes (Swift `Data`, Kotlin `ByteArray`). `copyBytes` always creates independent storage; use it when a synchronous function must keep bytes beyond the call. Do not mutate or detach a buffer you passed to a synchronous native call while it runs.",
    },
    { kind: "h2", text: "@lucent-lang/core/math" },
    {
      kind: "code",
      filename: "declaration",
      code: "export declare function abs(value: number): number;\nexport declare function sqrt(value: number): number;\nexport declare function floor(value: number): number;\nexport declare function ceil(value: number): number;\nexport declare function sin(value: number): number;\nexport declare function cos(value: number): number;\nexport declare function min(a: number, b: number): number;\nexport declare function max(a: number, b: number): number;",
    },
    { kind: "h2", text: "@lucent-lang/core/text" },
    {
      kind: "code",
      filename: "declaration",
      code: "export declare function trim(value: string): string;\nexport declare function contains(value: string, search: string): boolean;",
    },
    { kind: "h2", text: "@lucent-lang/core/platform" },
    {
      kind: "code",
      filename: "declaration",
      code: 'export declare const Platform: { readonly OS: "ios" | "android" };',
    },
    {
      kind: "p",
      text: "`Platform.OS` is a compile-time constant per target and the only way to [guard platform-specific bindings](/docs/language/platform-and-capabilities/#platform-guards).",
    },
    { kind: "h2", text: "Removed packages" },
    {
      kind: "p",
      text: "`@lucent-lang/crypto`, `@lucent-lang/filesystem`, `@lucent-lang/network`, `@lucent-lang/device`, `@lucent-lang/core/platform/clock` and `@lucent-lang/core/platform/locale` were small hand-written native modules rather than language features, and they duplicated libraries an app already has. Importing them now fails with `LUCENT1006`. Declare what you need as a [package manifest](/docs/api/library-manifest/), as the example apps do in `native/toolkit.library.json`, or call the JavaScript equivalent.",
    },
  ],
};
