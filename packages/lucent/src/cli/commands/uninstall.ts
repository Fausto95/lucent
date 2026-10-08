import type { Invocation } from "../args.ts";
import { planUninstall } from "../init/uninstall.ts";
import { applyPlan } from "./init.ts";

/**
 * `lucent uninstall`: reverts what `lucent init` and the Expo config plugin
 * changed (the Metro config, app.json, the Gradle line, the
 * react-native.config.js entry, tsconfig.json, VS Code's settings,
 * .gitignore), shown as diffs like init's. The app's modules stay.
 */
export function run(invocation: Invocation): Promise<number> {
  return applyPlan("uninstall", planUninstall(invocation.root), invocation);
}
