/**
 * Metro babel transformer wrapper. For `*.lucent.ts` files it compiles the
 * module in-process and hands the host's JS proxy to the upstream transformer;
 * every other file passes straight through.
 */
import { COMPILER_VERSION, compile, renderDiagnostic } from "@lucent/compiler";
import type { Host } from "@lucent/host-core";
import { expoHost } from "@lucent/host-expo";
import { nitroHost } from "@lucent/host-nitro";

export type HostName = "expo" | "nitro";

export interface TransformArgs {
  src: string;
  filename: string;
  options: Record<string, unknown>;
  plugins?: unknown[];
}

export interface UpstreamTransformer {
  transform(args: TransformArgs): unknown;
  getCacheKey?(): string;
}

export interface LucentTransformer {
  transform(args: TransformArgs): Promise<unknown>;
  getCacheKey(): string;
}

const HOSTS: Readonly<Record<HostName, Host>> = { expo: expoHost, nitro: nitroHost };

export const LUCENT_FILE = /\.lucent\.ts$/;

/** Env keys through which `withLucent` reaches the transformer in Metro's worker processes. */
export const ENV_HOST = "LUCENT_HOST";
export const ENV_UPSTREAM = "LUCENT_UPSTREAM_TRANSFORMER";

export function createTransformer(options: { upstream: UpstreamTransformer; host: HostName }): LucentTransformer {
  const host = HOSTS[options.host];
  return {
    async transform(args) {
      if (!LUCENT_FILE.test(args.filename)) return options.upstream.transform(args);
      const result = compile(args.src, { fileName: args.filename });
      if (!result.module) {
        const rendered = result.diagnostics.map((d) => renderDiagnostic(d, args.src, args.filename)).join("\n\n");
        throw new Error(`Lucent: ${args.filename} did not compile\n\n${rendered}`);
      }
      const { js } = host.emitProxy(result.module);
      return options.upstream.transform({ ...args, src: js });
    },
    getCacheKey() {
      return [options.upstream.getCacheKey?.() ?? "", `lucent@${COMPILER_VERSION}`, options.host].join("|");
    },
  };
}

// ---- module-level entry used by Metro (configured through env by withLucent) ----

const UPSTREAM_CANDIDATES = ["@expo/metro-config/babel-transformer", "@react-native/metro-babel-transformer"];

function loadUpstream(): UpstreamTransformer {
  const explicit = process.env[ENV_UPSTREAM];
  const candidates = explicit ? [explicit] : UPSTREAM_CANDIDATES;
  const require = createRequire();
  for (const candidate of candidates) {
    try {
      return require(candidate) as UpstreamTransformer;
    } catch {
      continue;
    }
  }
  throw new Error(`Lucent: no upstream Metro transformer found (tried ${candidates.join(", ")}).`);
}

function createRequire(): (id: string) => unknown {
  // Bundled to CJS for Metro; `require` exists there. Under Bun/ESM tests this path is never taken.
  const r = (globalThis as { require?: (id: string) => unknown }).require;
  if (!r) throw new Error("Lucent: transformer must run in a CommonJS environment.");
  return r;
}

let lazy: LucentTransformer | undefined;
function instance(): LucentTransformer {
  if (!lazy) {
    const host = (process.env[ENV_HOST] ?? "expo") as HostName;
    if (host !== "expo" && host !== "nitro") throw new Error(`Lucent: unknown host "${host}" in ${ENV_HOST}.`);
    lazy = createTransformer({ upstream: loadUpstream(), host });
  }
  return lazy;
}

export function transform(args: TransformArgs): Promise<unknown> {
  return instance().transform(args);
}

export function getCacheKey(): string {
  return instance().getCacheKey();
}
