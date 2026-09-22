import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "api/runtime",
  title: "@lucent-lang/runtime",
  description: "The JavaScript side of Lucent: what generated proxies import. Tiny and host-agnostic, so Expo and Nitro modules look the same to app code.",
  blocks: [
    { kind: "h2", text: "LucentError" },
    {
      kind: "code",
      filename: "declaration",
      code: "export class LucentError extends Error {\n  readonly code: string;\n  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;\n  constructor(code: string, message?: string, metadata?: Record<string, string | number | boolean | null>);\n}",
    },
    {
      kind: "p",
      text: "What the app catches when native code throws. `name` is `\"LucentError\"`, `message` defaults to the code. Match on `code`, not on the message text.",
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: 'import { LucentError } from "@lucent-lang/runtime";\n\ntry {\n  await fetchBytes("invalid");\n} catch (error) {\n  if (error instanceof LucentError && error.code === "INVALID_URL") {\n    // handle\n  }\n}',
    },
    { kind: "h2", text: "lucentCall" },
    {
      kind: "code",
      filename: "declaration",
      code: "/** Runs a native call and rethrows failures as LucentError, for sync and promise-returning calls alike. */\nexport function lucentCall<T>(fn: () => T): T;",
    },
    {
      kind: "p",
      text: "Every generated proxy function is one `lucentCall`. It catches synchronous throws and rejected promises, then runs `normalizeError`.",
    },
    { kind: "h2", text: "normalizeError" },
    {
      kind: "code",
      filename: "declaration",
      code: "/** Turns whatever a host threw into a LucentError, preserving the code. */\nexport function normalizeError(error: unknown): LucentError;",
    },
    {
      kind: "p",
      text: "Native code serializes a thrown `LucentError` into an envelope carrying `code`, `message` and `metadata`. `normalizeError` decodes it, and falls back to the host's own error formats (Expo's `Caused by:` wrapper, Nitro's `[CODE] message` prefix) so older or foreign errors still get a `code`. Unknown errors become `UNKNOWN`.",
    },
    { kind: "h2", text: "Buffers" },
    {
      kind: "code",
      filename: "declaration",
      code: "export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer;\nexport function fromArrayBuffer(buffer: ArrayBuffer): Uint8Array;",
    },
    {
      kind: "p",
      text: "Used by proxies to pass `Uint8Array` values as `ArrayBuffer` and back. You do not normally call them yourself.",
    },
  ],
};
