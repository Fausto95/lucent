import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "api/std",
  title: "Standard library",
  description:
    "Native functions you can import from Lucent source. Each is a direct Swift and Kotlin call; some require a capability in `lucent.config.ts`.",
  blocks: [
    { kind: "h2", text: "@lucent-lang/std/math" },
    {
      kind: "code",
      filename: "declaration",
      code: "export declare function abs(value: number): number;\nexport declare function sqrt(value: number): number;\nexport declare function floor(value: number): number;\nexport declare function ceil(value: number): number;\nexport declare function sin(value: number): number;\nexport declare function cos(value: number): number;\nexport declare function min(a: number, b: number): number;\nexport declare function max(a: number, b: number): number;",
    },
    { kind: "h2", text: "@lucent-lang/std/text" },
    {
      kind: "code",
      filename: "declaration",
      code: "export declare function trim(value: string): string;\nexport declare function contains(value: string, search: string): boolean;",
    },
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
    { kind: "h2", text: "@lucent-lang/crypto" },
    { kind: "code", filename: "declaration · capability: crypto", code: "export declare function sha256(bytes: Uint8Array): string; // lowercase hex" },
    {
      kind: "p",
      text: "Synchronous. Wrap large inputs in a `@Background` function.",
    },
    { kind: "h2", text: "@lucent-lang/filesystem" },
    {
      kind: "code",
      filename: "declaration · capability: filesystem",
      code: "export declare function read(path: string): Promise<Uint8Array>;\nexport declare function write(path: string, bytes: Uint8Array): Promise<void>;\nexport declare function exists(path: string): Promise<boolean>;\nexport declare function temporaryDirectory(): Promise<string>;",
    },
    {
      kind: "table",
      head: ["Detail", ""],
      rows: [
        ["Thread", "Runs on a worker context."],
        ["Paths", "Inside the application's native sandbox."],
        ["Errors", "`FILE_READ` / `FILE_WRITE` with `metadata.path`."],
      ],
    },
    { kind: "h2", text: "@lucent-lang/network" },
    { kind: "code", filename: "declaration · capability: network", code: "export declare function get(url: string): Promise<Uint8Array>;" },
    {
      kind: "table",
      head: ["Detail", ""],
      rows: [
        ["Scheme", "HTTPS only. Invalid URLs fail with `INVALID_URL`."],
        ["Timeout", "30 seconds for request and read."],
        ["Status", "Non-2xx responses throw `HTTP_ERROR` with `metadata.status`."],
        ["Transport", "`NETWORK_ERROR`."],
        ["Not exposed", "cancellation, streaming, uploads, headers, other methods."],
      ],
    },
    { kind: "h2", text: "@lucent-lang/device" },
    { kind: "code", filename: "declaration · capability: device", code: "export declare function model(): Promise<string>;" },
    { kind: "p", text: "Runs on the main context. `UIDevice.current.model` on iOS, `Build.MODEL` on Android." },
    { kind: "h2", text: "@lucent-lang/platform" },
    {
      kind: "code",
      filename: "declaration",
      code: '// @lucent-lang/platform\nexport declare const Platform: { readonly OS: "ios" | "android" };\n\n// @lucent-lang/platform/clock · capability: clock\nexport declare function now(): number; // Unix milliseconds\n\n// @lucent-lang/platform/locale · capability: locale\nexport declare function languageTag(): string; // e.g. "en-US"',
    },
    {
      kind: "p",
      text: "`Platform.OS` is a compile-time constant per target and the only way to [guard platform-specific bindings](/docs/language/platform-and-capabilities/#platform-guards).",
    },
  ],
};
