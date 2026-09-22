import { join } from "node:path";
import { findLucentFiles, HOST_NAMES, type HostName } from "../index.ts";
import { detectHost, readPackageJson } from "../project.ts";
import { reportError } from "../ui.ts";
import { watchProject } from "../watch.ts";
import type { CommandContext } from "./types.ts";

export const HOST_OPTION = {
  type: "string",
  placeholder: "<host>",
  values: HOST_NAMES,
  description: "Target host; detected from package.json when omitted",
} as const;

export const HOST_LABELS: Readonly<Record<HostName, string>> = {
  expo: "Expo Modules",
  nitro: "Nitro Modules",
};

export const NEXT_STEPS: Readonly<Record<HostName, string>> = {
  expo: "Next: npx expo prebuild, then npx expo run:ios (or run:android).",
  nitro: "Next: cd ios && pod install, then npx react-native run-ios (or run-android).",
};

/** Explicit flag, then package.json, then expo with a note. */
export function resolveHost(ctx: CommandContext, explicit: string | undefined): HostName {
  if (explicit === "expo" || explicit === "nitro") return explicit;
  const detected = detectHost(readPackageJson(ctx.root));
  if (detected) return detected;
  ctx.ui.hint("No host detected in package.json; assuming expo. Pass --host expo|nitro to be explicit.");
  return "expo";
}

/** Explicit files (root-relative or absolute) or discovery. */
export function resolveFiles(root: string, positionals: readonly string[]): string[] {
  return positionals.length ? positionals.map((f) => (f.startsWith("/") ? f : join(root, f))) : findLucentFiles(root);
}

export const elapsed = (started: number): number => Math.round(performance.now() - started);

/** Re-runs `once` on every relevant change until SIGINT. Errors are reported, never fatal. */
export async function watchLoop(ctx: CommandContext, once: () => Promise<number>): Promise<number> {
  const { ui } = ctx;
  const p = ui.palette;
  ui.line();
  ui.step("watch", `Watching for changes ${p.dim("(Ctrl+C to stop)")}`);
  await new Promise<void>((resolve) => {
    let queue = Promise.resolve();
    const watcher = watchProject(ctx.root, (paths) => {
      queue = queue.then(async () => {
        ui.line();
        ui.step("watch", `${p.cyan(paths.join(", "))} changed ${p.dim(new Date().toLocaleTimeString())}`);
        await once().catch((error: unknown) => reportError(error, ui));
        ui.step("watch", p.dim("Waiting for changes…"));
      });
    });
    const stop = (): void => {
      watcher.close();
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  ui.line();
  ui.step("sparkles", "Stopped watching.");
  return 0;
}
