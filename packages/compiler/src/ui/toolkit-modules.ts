/**
 * The toolkit modules generated from an SDK module (`lucent:swiftui`, from
 * iOS's SwiftUI written as source), for tools that report on SDK modules.
 * Toolkits are internal: none while views are off.
 */
import type { Platform } from "../sdk/schema.ts";
import { fabricRequested } from "./switch.ts";
import { TOOLKITS, type ToolkitName, toolkitSource } from "./toolkits.ts";

export function toolkitsFrom(platform: Platform, module: string): `lucent:${ToolkitName}`[] {
  if (!fabricRequested()) return [];

  return (Object.keys(TOOLKITS) as ToolkitName[])
    .filter(
      (name) => TOOLKITS[name].platform === platform && toolkitSource(name)?.module === module,
    )
    .map((name) => `lucent:${name}` as const);
}
