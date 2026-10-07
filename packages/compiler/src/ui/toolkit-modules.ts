/**
 * The toolkit modules (`lucent:swiftui`, generated from iOS's SwiftUI
 * written as source; `lucent:compose`), for tools that report on SDK
 * modules: which there are, their text as compiles serve it, and which
 * SDK modules' names they declare.
 */
import fs from "node:fs";
import { sdkLibFile } from "../lib-files.ts";
import { type Platform, type SdkOptions, withSdkOptions } from "../sdk/schema.ts";
import { toolkitDeclarations } from "../sdk/toolkit-dts.ts";
import { composeModuleText } from "./compose-dts.ts";
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

/** The toolkit modules generated from an SDK module. */
export function toolkitsFrom(platform: Platform, module: string): ToolkitModule[] {
  return NAMES.filter(
    (name) => TOOLKITS[name].platform === platform && toolkitSource(name)?.module === module,
  ).map((name) => `lucent:${name}` as const);
}

/** The toolkit modules users can import. */
export function toolkitModules(): { module: ToolkitModule; platform: Platform }[] {
  return NAMES.map((name) => ({
    module: `lucent:${name}` as const,
    platform: TOOLKITS[name].platform,
  }));
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

/** The toolkit whose JSX each platform's files write: what editors type their JSX with. */
export function jsxToolkits(): Partial<Record<Platform, ToolkitName>> {
  return Object.fromEntries(NAMES.map((name) => [TOOLKITS[name].platform, name]));
}
