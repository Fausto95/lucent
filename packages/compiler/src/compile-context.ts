/**
 * What one compile works with and records: the SDK locations and the
 * platforms whose imports are deferred, the native extensions it binds,
 * the files it reads (reads.ts) and the SDK symbols it uses (sdk/usage.ts).
 *
 * Each compile has its own context, so two compiles in one process (the
 * editor plugin's checks and `lucent dev`'s builds) never see each other's
 * options or records. The compiler host of a program holds its compile's
 * context explicitly; code deeper in the compiler reads the context of the
 * compile it runs in (`currentCompile`), which `runInCompile` scopes to
 * the call, synchronous or not.
 *
 * Without TypeScript or the compiler's other modules: reads.ts, which
 * lucent doctor loads alone, uses it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Platform, SdkOptions, UsedSymbol } from "@lucent-lang/bindgen";
import type { ExtensionBinding } from "./extensions/bind.ts";

export interface CompileContext {
  /** Where the platform SDKs are, and the schema cache. */
  readonly sdk: SdkOptions;
  /** Platforms whose SDK imports resolve only later: other programs leave their code untyped. */
  readonly deferred: readonly Platform[];
  /** The native extensions `lucent:ext/<name>` imports. */
  readonly extensions: readonly ExtensionBinding[];
  /** Each file read, with what was found there (reads.ts). */
  readonly reads: Map<string, string>;
  /** Each path resolution followed links from, with where it led. */
  readonly realpaths: Map<string, string>;
  /** The SDK symbols binding plans accepted a use of, by key (sdk/usage.ts). */
  readonly sdkUses: Map<string, UsedSymbol>;
}

/** A context of its own: options as given, nothing recorded yet. */
export function compileContext(
  options: {
    sdk?: SdkOptions;
    deferred?: readonly Platform[];
    extensions?: readonly ExtensionBinding[];
  } = {},
): CompileContext {
  return {
    sdk: { ...options.sdk },
    deferred: options.deferred ?? [],
    extensions: options.extensions ?? [],
    reads: new Map(),
    realpaths: new Map(),
    sdkUses: new Map(),
  };
}

const current = new AsyncLocalStorage<CompileContext>();

/** Runs `f` in compile context `context`: what it calls reads its options and records into it. */
export function runInCompile<T>(context: CompileContext, f: () => T): T {
  return current.run(context, f);
}

/** The context of the compile running, if any. */
export function currentCompile(): CompileContext | undefined {
  return current.getStore();
}
