/**
 * The toolkit modules (`lucent:swiftui`, generated from iOS's SwiftUI
 * written as source; `lucent:compose`), for tools that report on SDK
 * modules: which there are, their text as compiles serve it, and which
 * SDK modules' names they declare. Toolkits are internal: none while
 * views are off.
 */
import fs from "node:fs";
import { sdkLibFile } from "../lib-files.ts";
import { type Platform, type SdkOptions, withSdkOptions } from "../sdk/schema.ts";
import { toolkitDeclarations } from "../sdk/toolkit-dts.ts";
import { composeModuleNames } from "./compose-schemas.ts";
import { composeModuleText } from "./compose-dts.ts";
import { fabricRequested } from "./switch.ts";
import { TOOLKITS, type ToolkitName, toolkitSource } from "./toolkits.ts";

type ToolkitModule = `lucent:${ToolkitName}`;

const NAMES = Object.keys(TOOLKITS) as ToolkitName[];

/** Each toolkit's text, as compiles serve its module. */
const TEXTS: Record<ToolkitName, () => { text: string } | { missing: string }> = {
  swiftui: () => toolkitDeclarations("swiftui"),
  // Its own declarations, then Compose's, made from its bindings.
  compose: () => ({
    text: composeModuleText(fs.readFileSync(sdkLibFile("compose.d.ts"), "utf8")),
  }),
};

/** Which platform modules' names each toolkit declares. */
const DECLARES: Record<ToolkitName, (module: string) => boolean> = {
  swiftui: (module) => module === TOOLKITS.swiftui.source.module,
  compose: (module) => composeModuleNames().includes(module),
};

/** The toolkit modules generated from an SDK module. */
export function toolkitsFrom(platform: Platform, module: string): ToolkitModule[] {
  if (!fabricRequested()) return [];

  return NAMES.filter(
    (name) => TOOLKITS[name].platform === platform && toolkitSource(name)?.module === module,
  ).map((name) => `lucent:${name}` as const);
}

/** The toolkit modules users can import: every one with views on, none without. */
export function toolkitModules(
  views = fabricRequested(),
): { module: ToolkitModule; platform: Platform }[] {
  return views
    ? NAMES.map((name) => ({
        module: `lucent:${name}` as const,
        platform: TOOLKITS[name].platform,
      }))
    : [];
}

/** `lucent:<toolkit>`'s text, as the program serves it. */
export function toolkitText(name: ToolkitName): { text: string } | { missing: string } {
  return TEXTS[name]();
}

/** A toolkit module's text, as compiles with these SDK locations serve it, or why there is none. */
export function toolkitModuleText(
  module: ToolkitModule,
  opts: SdkOptions = {},
): { text: string } | { missing: string } {
  return withSdkOptions(opts, () => toolkitText(module.slice("lucent:".length) as ToolkitName));
}

/**
 * The toolkit module declaring a platform module's names (SwiftUI's
 * views, Compose's packages) while views are off, when none is served:
 * what messages name instead of saying the name does not exist.
 */
export function toolkitNeedingViews(platform: Platform, module: string): ToolkitModule | undefined {
  if (fabricRequested()) return undefined;

  const name = NAMES.find((n) => TOOLKITS[n].platform === platform && DECLARES[n](module));
  return name && `lucent:${name}`;
}

/** The toolkit whose JSX each platform's files write: what editors type their JSX with. */
export function jsxToolkits(): Partial<Record<Platform, ToolkitName>> {
  return Object.fromEntries(NAMES.map((name) => [TOOLKITS[name].platform, name]));
}
