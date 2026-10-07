/**
 * SDK modules as `lucent sdk` lists, shows and counts them: the
 * platforms' (bindgen's, extracted on demand), and Compose's, whose bindings Lucent ships (Android packages called from
 * Kotlin source, which lucent:compose declares).
 */
import {
  type SdkLookup,
  type SdkOptions,
  sdkModule as extractedModule,
  sdkModules as extractedModules,
} from "@lucent-lang/bindgen";
import { composeModuleDts } from "../ui/compose-dts.ts";
import { composeModule, composeModuleNames } from "../ui/compose-schemas.ts";
import { sdkDts } from "./dts.ts";
import type { Platform, SdkModuleSchema } from "./schema.ts";

const composing = (platform: Platform) => platform === "android";

/** A module's schema: Compose's, or the platform's. */
export function sdkModule(platform: Platform, module: string, opts: SdkOptions = {}): SdkLookup {
  const compose = composing(platform) ? composeModule(module) : undefined;

  return compose ? { schema: compose } : extractedModule(platform, module, opts);
}

/** Every module of a platform: its SDK's, and Compose's. */
export function sdkModules(
  platform: Platform,
  opts: SdkOptions = {},
): string[] | { missing: string } {
  const extracted = extractedModules(platform, opts);
  if (!composing(platform)) return extracted;

  const compose = composeModuleNames();
  return "missing" in extracted ? compose : [...new Set([...extracted, ...compose])].sort();
}

/** A module's declarations: lucent:compose's for Compose's, else lucent:<platform>/<module>'s. */
export function sdkDeclarations(schema: SdkModuleSchema): string {
  return schema.form === "source" ? composeModuleDts(schema.module) : sdkDts(schema);
}
