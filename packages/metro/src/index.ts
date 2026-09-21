/** `withLucent(metroConfig, { host })`: routes `*.lucent.ts` through the Lucent transformer. */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_HOST, ENV_UPSTREAM, type HostName } from "./transformer.ts";

export type { HostName } from "./transformer.ts";

export interface LucentMetroOptions {
  host?: HostName;
}

interface MetroLikeConfig {
  transformer?: { babelTransformerPath?: string; [key: string]: unknown };
  [key: string]: unknown;
}

/** The bundled CommonJS transformer Metro's workers `require`; built by `pnpm build:packages`. */
export function transformerPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const built = join(here, "..", "dist", "transformer.cjs");
  if (!existsSync(built))
    throw new Error(`Lucent: ${built} is missing. Run \`pnpm build:packages\` in the lucent repo.`);
  return built;
}

export function withLucent<C extends MetroLikeConfig>(config: C, options: LucentMetroOptions = {}): C {
  const upstream = config.transformer?.babelTransformerPath;
  // Metro spawns transform workers with the parent's environment, so env is the channel to them.
  process.env[ENV_HOST] = options.host ?? "expo";
  if (upstream) process.env[ENV_UPSTREAM] = upstream;
  else delete process.env[ENV_UPSTREAM];
  return { ...config, transformer: { ...config.transformer, babelTransformerPath: transformerPath() } };
}
