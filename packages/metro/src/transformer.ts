/**
 * Metro babel transformer wrapper. For `*.lucent.ts` files it compiles the
 * module in-process and hands the host's JS proxy to the upstream transformer;
 * every other file passes straight through.
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { COMPILER_VERSION, compile, renderDiagnostic } from "@lucent-lang/compiler";
import { loadLucentConfig, sourceProjectRoot, loadLucentSources, type Host } from "@lucent-lang/host-core";
import { expoHost } from "@lucent-lang/host-expo";
import { nitroHost } from "@lucent-lang/host-nitro";

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

export const LUCENT_FILE = /\.lucent\.tsx?$/;

/** Env keys through which `withLucent` reaches the transformer in Metro's worker processes. */
export const ENV_HOST = "LUCENT_HOST";
export const ENV_UPSTREAM = "LUCENT_UPSTREAM_TRANSFORMER";

export function createTransformer(options: { upstream: UpstreamTransformer; host: HostName }): LucentTransformer {
  const host = HOSTS[options.host];
  return {
    async transform(args) {
      if (!LUCENT_FILE.test(args.filename)) return options.upstream.transform(args);
      const projectRoot = typeof args.options.projectRoot === "string" ? args.options.projectRoot : process.cwd();
      const fileName = resolve(projectRoot, args.filename);
      const config = loadLucentConfig(sourceProjectRoot(fileName));
      const result = compile(args.src, {
        fileName,
        sources: loadLucentSources(fileName, args.src),
        libraries: config.libraries,
        targets: config.targets,
      });
      if (!result.module) {
        const rendered = result.diagnostics.map((d) => renderDiagnostic(d, args.src, args.filename)).join("\n\n");
        throw new Error(`Lucent: ${args.filename} did not compile\n\n${rendered}`);
      }
      for (const d of result.diagnostics)
        if (d.severity === "warning") console.warn(renderDiagnostic(d, args.src, fileName));
      const missing = (result.module.capabilities ?? []).filter((c) => !config.capabilities.includes(c));
      if (missing.length)
        throw new Error(`Lucent: enable capabilities ${missing.join(", ")} in lucent.config.ts or lucent.config.json`);
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
  const load = createRequire(import.meta.url);
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      return load(candidate) as UpstreamTransformer;
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Lucent: no upstream Metro transformer found.\n${failures.join("\n")}`);
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
